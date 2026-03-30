/**
 * Route discovery engine.
 * Generates candidate routes and selects the best one.
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

// ── V4 StateView ABI for pool discovery ──────────────────────────────
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
 * Common V4 fee/tickSpacing combos to try.
 */
const V4_FEE_CONFIGS = [
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10000, tickSpacing: 200 },
] as const;

/**
 * Generate V3 route candidates for WETH → token.
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
 * Check if a V4 pool exists by querying StateView.getSlot0.
 * A pool exists if sqrtPriceX96 != 0.
 */
async function v4PoolExists(
  provider: ethers.Provider,
  currency0: string,
  currency1: string,
  fee: number,
  tickSpacing: number,
  hooks: string
): Promise<boolean> {
  const stateView = new ethers.Contract(
    BASE_ADDRESSES.V4_STATE_VIEW,
    STATE_VIEW_ABI,
    provider
  );

  const poolId = computePoolId(currency0, currency1, fee, tickSpacing, hooks);

  try {
    const slot0 = await stateView.getSlot0(poolId);
    return slot0.sqrtPriceX96 > 0n;
  } catch {
    return false;
  }
}

/**
 * Generate V4 route candidates for WETH → token.
 * Single-hop only in v1.
 */
export async function generateV4Candidates(
  provider: ethers.Provider,
  token: string
): Promise<V4Route[]> {
  const WETH = BASE_ADDRESSES.WETH;
  const { currency0, currency1, zeroForOne } = sortAddresses(WETH, token);
  const routes: V4Route[] = [];

  // Try each fee/tickSpacing combination
  for (const config of V4_FEE_CONFIGS) {
    const exists = await v4PoolExists(
      provider,
      currency0,
      currency1,
      config.fee,
      config.tickSpacing,
      ethers.ZeroAddress
    );

    if (exists) {
      routes.push({
        routeType: RouteType.V4,
        currency0,
        currency1,
        fee: config.fee,
        tickSpacing: config.tickSpacing,
        hooks: ethers.ZeroAddress,
        zeroForOne,
        hookData: "0x",
        description: `V4 direct @ ${config.fee}bps (ts=${config.tickSpacing})`,
      });
    }
  }

  return routes;
}

/**
 * Discover all routes and pick the best one.
 *
 * @returns The best route, or null if no viable route found.
 */
export async function discoverBestRoute(
  provider: ethers.Provider,
  token: string,
  amountIn: bigint,
  maxSlippageBps: bigint
): Promise<SelectedRoute | null> {
  console.log(`[route-discovery] Finding routes for WETH → ${token}`);
  console.log(
    `[route-discovery] Amount: ${ethers.formatEther(amountIn)} ETH, slippage: ${maxSlippageBps}bps`
  );

  // 1. Generate candidates
  const v3Candidates = generateV3Candidates(token);
  console.log(`[route-discovery] Generated ${v3Candidates.length} V3 candidates`);

  let v4Candidates: V4Route[] = [];
  try {
    v4Candidates = await generateV4Candidates(provider, token);
    console.log(
      `[route-discovery] Found ${v4Candidates.length} V4 pools`
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
