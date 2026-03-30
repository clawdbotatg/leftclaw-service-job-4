/**
 * Uniswap V3 QuoterV2 and V4 Quoter interaction.
 * All quoting is done via eth_call (no gas spent).
 */

import { ethers } from "ethers";
import {
  RouteType,
  V3Route,
  V4Route,
  QuoteResult,
  BASE_ADDRESSES,
} from "./types";
import { encodeV3Path } from "./path-encoder";

// ── V3 QuoterV2 ABI ─────────────────────────────────────────────────
const V3_QUOTER_ABI = [
  "function quoteExactInput(bytes memory path, uint256 amountIn) external returns (uint256 amountOut, uint160[] memory sqrtPriceX96AfterList, uint32[] memory initializedTicksCrossedList, uint256 gasEstimate)",
];

// ── V4 Quoter ABI ────────────────────────────────────────────────────
// QuoteExactSingleParams struct:
//   PoolKey poolKey { currency0, currency1, fee, tickSpacing, hooks }
//   bool zeroForOne
//   uint128 exactAmount
//   bytes hookData
const V4_QUOTER_ABI = [
  {
    inputs: [
      {
        components: [
          {
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
            name: "poolKey",
            type: "tuple",
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "quoteExactInputSingle",
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
];

/**
 * Quote a V3 route using QuoterV2.
 */
export async function quoteV3(
  provider: ethers.Provider,
  route: V3Route,
  amountIn: bigint
): Promise<QuoteResult> {
  const quoter = new ethers.Contract(
    BASE_ADDRESSES.V3_QUOTER_V2,
    V3_QUOTER_ABI,
    provider
  );

  const encodedPath = encodeV3Path(route.path, route.fees);

  try {
    // Use staticCall to simulate without spending gas
    const result = await quoter.quoteExactInput.staticCall(
      encodedPath,
      amountIn
    );

    return {
      route,
      amountOut: result[0] as bigint,
      gasEstimate: result[3] as bigint,
      success: true,
    };
  } catch (error: any) {
    return {
      route,
      amountOut: 0n,
      gasEstimate: 0n,
      success: false,
      error: error.message || "V3 quote failed",
    };
  }
}

/**
 * Quote a V4 route using V4 Quoter.
 */
export async function quoteV4(
  provider: ethers.Provider,
  route: V4Route,
  amountIn: bigint
): Promise<QuoteResult> {
  const quoter = new ethers.Contract(
    BASE_ADDRESSES.V4_QUOTER,
    V4_QUOTER_ABI,
    provider
  );

  try {
    // Build QuoteExactSingleParams (no sqrtPriceLimitX96)
    const params = {
      poolKey: {
        currency0: route.currency0,
        currency1: route.currency1,
        fee: route.fee,
        tickSpacing: route.tickSpacing,
        hooks: route.hooks,
      },
      zeroForOne: route.zeroForOne,
      exactAmount: amountIn,
      hookData: route.hookData || "0x",
    };

    const result = await quoter.quoteExactInputSingle.staticCall(params);

    return {
      route,
      amountOut: result[0] as bigint,
      gasEstimate: result[1] as bigint,
      success: true,
    };
  } catch (error: any) {
    return {
      route,
      amountOut: 0n,
      gasEstimate: 0n,
      success: false,
      error: error.message || "V4 quote failed",
    };
  }
}

/**
 * Quote any route candidate (dispatches to V3 or V4).
 */
export async function quoteRoute(
  provider: ethers.Provider,
  route: V3Route | V4Route,
  amountIn: bigint
): Promise<QuoteResult> {
  if (route.routeType === RouteType.V3) {
    return quoteV3(provider, route as V3Route, amountIn);
  } else {
    return quoteV4(provider, route as V4Route, amountIn);
  }
}

/**
 * Quote a single route with retries.
 */
async function quoteWithRetry(
  provider: ethers.Provider,
  route: V3Route | V4Route,
  amountIn: bigint,
  maxRetries: number = 3,
  delayMs: number = 500
): Promise<QuoteResult> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await quoteRoute(provider, route, amountIn);
    if (result.success || attempt === maxRetries - 1) {
      return result;
    }
    // Only retry on transient errors (CALL_EXCEPTION with null data = rate limit)
    if (
      result.error &&
      (result.error.includes("missing revert data") ||
        result.error.includes("could not decode"))
    ) {
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      continue;
    }
    // Non-transient error (e.g., pool doesn't exist), don't retry
    return result;
  }
  // Should not reach here
  return quoteRoute(provider, route, amountIn);
}

/**
 * Quote multiple routes with concurrency control and retries.
 * Batches calls to avoid rate limiting on public RPCs.
 */
export async function quoteAllRoutes(
  provider: ethers.Provider,
  routes: (V3Route | V4Route)[],
  amountIn: bigint,
  concurrency: number = 3
): Promise<QuoteResult[]> {
  const results: QuoteResult[] = [];

  // Process in batches
  for (let i = 0; i < routes.length; i += concurrency) {
    const batch = routes.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((route) => quoteWithRetry(provider, route, amountIn))
    );
    results.push(...batchResults);

    // Delay between batches to avoid rate limiting
    if (i + concurrency < routes.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return results;
}
