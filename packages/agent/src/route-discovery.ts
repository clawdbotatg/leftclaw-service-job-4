/**
 * Route discovery engine.
 * Generates candidate routes and selects the best one.
 *
 * V4 pool discovery uses a local SQLite index (V4PoolIndexer)
 * populated from PoolManager.Initialize events. The index is built
 * at startup and refreshed incrementally every 30s — no ad-hoc
 * chain scans at request time.
 *
 * V4 ETH pools use currency0 = address(0), NOT WETH.
 */

import { ethers } from "ethers";
import {
  RouteType,
  V3Route,
  V4Route,
  V3_FEE_TIERS,
  QuoteResult,
  SelectedRoute,
  BASE_ADDRESSES,
} from "./types";
import { quoteAllRoutes } from "./quoter";
import { encodeRoutePath, sortAddresses } from "./path-encoder";
import { V4PoolIndexer, V4PoolRecord } from "./v4-pool-indexer";

// ── V4 StateView ABI for pool liveness check ─────────────────────────
const STATE_VIEW_ABI = [
  {
    inputs: [{ name: "id", type: "bytes32" }],
    name: "getSlot0",
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
    stateMutability: "view",
    type: "function",
  },
];

/**
 * ETH_ADDRESS — V4 represents native ETH as address(0).
 */
const ETH_ADDRESS = ethers.ZeroAddress;

/**
 * Generate V3 route candidates for WETH → token.
 * V3 always uses WETH (the agent wraps ETH → WETH before V3 swaps).
 */
export function generateV3Candidates(token: string): V3Route[] {
  const WETH = BASE_ADDRESSES.WETH;
  const USDC = BASE_ADDRESSES.USDC;
  const routes: V3Route[] = [];

  // Direct routes at all fee tiers
  for (const fee of V3_FEE_TIERS) {
    routes.push({
      routeType: RouteType.V3,
      path: [WETH, token],
      fees: [fee],
      description: `V3 WETH→TOKEN @ ${fee}bps`,
    });
  }

  // Multi-hop via USDC at common fee combos
  const usdcFeeCombos = [
    [500, 500],
    [500, 3000],
    [3000, 500],
    [3000, 3000],
  ];
  for (const [fee0, fee1] of usdcFeeCombos) {
    routes.push({
      routeType: RouteType.V3,
      path: [WETH, USDC, token],
      fees: [fee0, fee1],
      description: `V3 WETH→USDC(${fee0})→TOKEN(${fee1})`,
    });
  }

  return routes;
}

/**
 * Compute the V4 pool ID from a pool key.
 * poolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))
 */
function computePoolId(
  currency0: string,
  currency1: string,
  fee: number,
  tickSpacing: number,
  hooks: string
): string {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const encoded = abiCoder.encode(
    ["address", "address", "uint24", "int24", "address"],
    [currency0, currency1, fee, tickSpacing, hooks]
  );
  return ethers.keccak256(encoded);
}

/**
 * Check if a V4 pool is live (sqrtPriceX96 != 0) via StateView.
 */
async function v4PoolIsLive(
  provider: ethers.Provider,
  poolId: string
): Promise<boolean> {
  const stateView = new ethers.Contract(
    BASE_ADDRESSES.V4_STATE_VIEW,
    STATE_VIEW_ABI,
    provider
  );

  try {
    const slot0 = await stateView.getSlot0(poolId);
    return slot0.sqrtPriceX96 > 0n;
  } catch {
    return false;
  }
}

/**
 * Generate V4 route candidates for ETH → token using the SQLite pool index.
 *
 * V4 ETH pools use address(0) as currency0 (NOT WETH).
 * This function queries the local SQLite index — no chain scans.
 */
export async function generateV4Candidates(
  provider: ethers.Provider,
  token: string,
  poolIndexer: V4PoolIndexer
): Promise<V4Route[]> {
  const routes: V4Route[] = [];

  // V4 ETH pools: look for pools with address(0) paired with the target token
  const ethPools = poolIndexer.findPoolsForPair(ETH_ADDRESS, token);

  // Also check WETH pools in V4 (some may exist)
  const wethPools = poolIndexer.findPoolsForPair(BASE_ADDRESSES.WETH, token);

  const allPools = [...ethPools, ...wethPools];

  if (allPools.length === 0) {
    console.log(
      `[route-discovery] No V4 pools found in index for ETH/WETH → ${token}`
    );
    return routes;
  }

  // Verify each pool is live via StateView
  for (const pool of allPools) {
    const isLive = await v4PoolIsLive(provider, pool.poolId);

    if (isLive) {
      // Determine zeroForOne based on which side is the input
      // For ETH pools: currency0 = address(0), so if we're selling ETH, zeroForOne = true
      // For WETH pools: check sort order
      const inputCurrency = pool.currency0.toLowerCase() === ETH_ADDRESS.toLowerCase()
        ? ETH_ADDRESS
        : (pool.currency0.toLowerCase() === BASE_ADDRESSES.WETH.toLowerCase() ? BASE_ADDRESSES.WETH : pool.currency1);
      const zeroForOne = inputCurrency.toLowerCase() === pool.currency0.toLowerCase();

      const isEthPool = pool.currency0.toLowerCase() === ETH_ADDRESS.toLowerCase();
      const label = isEthPool ? "ETH" : "WETH";

      routes.push({
        routeType: RouteType.V4,
        currency0: pool.currency0,
        currency1: pool.currency1,
        fee: pool.fee,
        tickSpacing: pool.tickSpacing,
        hooks: pool.hooks,
        zeroForOne,
        hookData: "0x",
        description: `V4 ${label}→TOKEN @ ${pool.fee}bps (ts=${pool.tickSpacing})`,
      });
    }
  }

  return routes;
}

/**
 * Resolve a forced poolId from the SQLite index.
 * If the pool is in the index and live, return it as a route.
 * If not found or not live, return null (caller should fail fast).
 */
export async function resolvePoolById(
  provider: ethers.Provider,
  poolId: string,
  token: string,
  poolIndexer: V4PoolIndexer
): Promise<V4Route | null> {
  const pool = poolIndexer.getPoolById(poolId);

  if (!pool) {
    console.error(
      `[route-discovery] Forced poolId ${poolId} not found in SQLite index`
    );
    return null;
  }

  // Verify pool is live
  const isLive = await v4PoolIsLive(provider, pool.poolId);
  if (!isLive) {
    console.error(
      `[route-discovery] Forced poolId ${poolId} exists in index but is not live (sqrtPriceX96 = 0)`
    );
    return null;
  }

  // Determine zeroForOne: input is ETH/WETH, output is the target token
  const inputIsC0 =
    pool.currency0.toLowerCase() === ETH_ADDRESS.toLowerCase() ||
    pool.currency0.toLowerCase() === BASE_ADDRESSES.WETH.toLowerCase();
  const zeroForOne = inputIsC0;

  // Validate output token matches
  const outputCurrency = zeroForOne ? pool.currency1 : pool.currency0;
  if (outputCurrency.toLowerCase() !== token.toLowerCase()) {
    console.error(
      `[route-discovery] Forced poolId ${poolId}: output currency ${outputCurrency} does not match target token ${token}`
    );
    return null;
  }

  const isEthPool = pool.currency0.toLowerCase() === ETH_ADDRESS.toLowerCase();
  const label = isEthPool ? "ETH" : "WETH";

  return {
    routeType: RouteType.V4,
    currency0: pool.currency0,
    currency1: pool.currency1,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    hooks: pool.hooks,
    zeroForOne,
    hookData: "0x",
    description: `V4 forced pool ${label}→TOKEN @ ${pool.fee}bps (ts=${pool.tickSpacing})`,
  };
}

/**
 * Discover all routes and pick the best one.
 *
 * @param poolIndexer - V4PoolIndexer instance (SQLite-backed)
 * @param forcedPoolId - If provided, use ONLY this pool. Fail fast if unresolved.
 * @returns The best route, or null if no viable route found.
 */
export async function discoverBestRoute(
  provider: ethers.Provider,
  token: string,
  amountIn: bigint,
  maxSlippageBps: bigint,
  poolIndexer: V4PoolIndexer,
  forcedPoolId?: string
): Promise<SelectedRoute | null> {
  console.log(`[route-discovery] Finding routes for ETH → ${token}`);
  console.log(
    `[route-discovery] Amount: ${ethers.formatEther(amountIn)} ETH, slippage: ${maxSlippageBps}bps`
  );

  // ── Issue 3: Forced poolId behavior ──────────────────────────────
  if (forcedPoolId) {
    console.log(
      `[route-discovery] Forced poolId: ${forcedPoolId} — using ONLY this pool`
    );

    const forcedRoute = await resolvePoolById(
      provider,
      forcedPoolId,
      token,
      poolIndexer
    );

    if (!forcedRoute) {
      console.error(
        `[route-discovery] FAIL: Forced poolId ${forcedPoolId} could not be resolved. No fallback.`
      );
      return null;
    }

    // Quote the forced route
    const quotes = await quoteAllRoutes(provider, [forcedRoute], amountIn);
    const successfulQuotes = quotes.filter(
      (q) => q.success && q.amountOut > 0n
    );

    if (successfulQuotes.length === 0) {
      console.error(
        `[route-discovery] FAIL: Forced pool ${forcedPoolId} returned no viable quote. No fallback.`
      );
      return null;
    }

    const best = successfulQuotes[0];
    const amountOutMin =
      (best.amountOut * (10000n - maxSlippageBps)) / 10000n;

    console.log(
      `[route-discovery] Forced pool quote: ${best.amountOut.toString()}, min: ${amountOutMin.toString()}`
    );

    const encodedPath = encodeRoutePath(best.route);

    return {
      routeType: best.route.routeType,
      encodedPath,
      amountOutMin,
      quote: best,
    };
  }

  // ── Normal discovery: V3 + V4 candidates ──────────────────────────

  // 1. Generate candidates
  const v3Candidates = generateV3Candidates(token);
  console.log(
    `[route-discovery] Generated ${v3Candidates.length} V3 candidates`
  );

  let v4Candidates: V4Route[] = [];
  try {
    v4Candidates = await generateV4Candidates(provider, token, poolIndexer);
    console.log(
      `[route-discovery] Found ${v4Candidates.length} V4 pools (from SQLite index)`
    );
  } catch (err: any) {
    console.log(
      `[route-discovery] V4 pool discovery failed: ${err.message}`
    );
  }

  const allCandidates = [...v3Candidates, ...v4Candidates];

  // 2. Quote all candidates
  console.log(
    `[route-discovery] Quoting ${allCandidates.length} total candidates...`
  );
  const quotes = await quoteAllRoutes(provider, allCandidates, amountIn);

  // 3. Filter successful quotes and log results
  const successfulQuotes = quotes.filter((q) => q.success && q.amountOut > 0n);
  console.log(
    `[route-discovery] ${successfulQuotes.length}/${quotes.length} quotes returned output`
  );

  for (const q of quotes) {
    if (q.success && q.amountOut > 0n) {
      console.log(
        `  ✓ ${q.route.description}: ${q.amountOut.toString()} (gas: ${q.gasEstimate.toString()})`
      );
    } else {
      console.log(`  ✗ ${q.route.description}: ${q.error || "no output"}`);
    }
  }

  if (successfulQuotes.length === 0) {
    console.log(`[route-discovery] No viable routes found`);
    return null;
  }

  // 4. Pick best (highest amountOut)
  const best = successfulQuotes.reduce((a, b) =>
    a.amountOut > b.amountOut ? a : b
  );

  console.log(
    `[route-discovery] Best: ${best.route.description} → ${best.amountOut.toString()}`
  );

  // 5. Apply slippage
  const amountOutMin =
    (best.amountOut * (10000n - maxSlippageBps)) / 10000n;
  console.log(
    `[route-discovery] AmountOutMin (after ${maxSlippageBps}bps slippage): ${amountOutMin.toString()}`
  );

  // 6. Encode path
  const encodedPath = encodeRoutePath(best.route);

  return {
    routeType: best.route.routeType,
    encodedPath,
    amountOutMin,
    quote: best,
  };
}
