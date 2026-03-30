/**
 * Integration tests for the agent against live Base RPC.
 * Tests route discovery with real on-chain state.
 * 
 * These tests use eth_call only — no gas spent.
 * Run with: npx vitest run test/integration.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { ethers } from "ethers";
import { generateV3Candidates, generateV4Candidates, discoverBestRoute } from "../src/route-discovery";
import { quoteV3, quoteAllRoutes } from "../src/quoter";
import { encodeV3Path } from "../src/path-encoder";
import { BASE_ADDRESSES, RouteType } from "../src/types";

// Well-known tokens on Base for testing
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = BASE_ADDRESSES.WETH;

let provider: ethers.Provider;

beforeAll(() => {
  // Use Alchemy RPC for better rate limits, fallback to public
  const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  provider = new ethers.JsonRpcProvider(rpcUrl);
});

describe("Integration: V3 Quoting", () => {
  it("quotes WETH → USDC at 500 bps", async () => {
    const route = {
      routeType: RouteType.V3 as const,
      path: [WETH, USDC],
      fees: [500],
      description: "V3 WETH→USDC @ 500bps",
    };

    const amountIn = ethers.parseEther("0.01"); // 0.01 ETH
    const result = await quoteV3(provider, route, amountIn);

    console.log(`WETH→USDC (500bps): ${result.success ? result.amountOut.toString() : result.error}`);

    expect(result.success).toBe(true);
    expect(result.amountOut).toBeGreaterThan(0n);
    // 0.01 ETH should be worth > $10 USDC (at current prices)
    // USDC has 6 decimals, so > 10_000_000
    expect(result.amountOut).toBeGreaterThan(10_000_000n);
  }, 15000);

  it("quotes WETH → USDC at all fee tiers", async () => {
    const amountIn = ethers.parseEther("0.01");
    const candidates = generateV3Candidates(USDC);
    const directRoutes = candidates.filter(c => c.path.length === 2);

    const results = await quoteAllRoutes(provider, directRoutes, amountIn);
    const successful = results.filter(r => r.success && r.amountOut > 0n);

    console.log(`\nV3 WETH→USDC quotes:`);
    for (const r of results) {
      console.log(`  ${r.route.description}: ${r.success ? r.amountOut.toString() : r.error}`);
    }

    // At least one fee tier should work for USDC
    expect(successful.length).toBeGreaterThan(0);
  }, 30000);
});

describe("Integration: V4 Pool Discovery", () => {
  it("checks for V4 WETH/USDC pools", async () => {
    const candidates = await generateV4Candidates(provider, USDC);
    console.log(`\nV4 WETH/USDC pools found: ${candidates.length}`);
    for (const c of candidates) {
      console.log(`  ${c.description} (fee=${c.fee}, ts=${c.tickSpacing})`);
    }
    // V4 pools may or may not exist — this is informational
    expect(candidates).toBeDefined();
  }, 15000);
});

describe("Integration: Full Route Discovery", () => {
  it("finds best route for WETH → USDC", async () => {
    const amountIn = ethers.parseEther("0.01");
    const slippage = 100n; // 1%

    const bestRoute = await discoverBestRoute(provider, USDC, amountIn, slippage);

    expect(bestRoute).not.toBeNull();
    if (bestRoute) {
      console.log(`\nBest route: ${bestRoute.quote.route.description}`);
      console.log(`  AmountOut: ${bestRoute.quote.amountOut.toString()}`);
      console.log(`  AmountOutMin: ${bestRoute.amountOutMin.toString()}`);
      console.log(`  RouteType: ${bestRoute.routeType === 0 ? "V3" : "V4"}`);
      console.log(`  Path: ${bestRoute.encodedPath}`);

      expect(bestRoute.quote.amountOut).toBeGreaterThan(0n);
      expect(bestRoute.amountOutMin).toBeGreaterThan(0n);
      expect(bestRoute.amountOutMin).toBeLessThan(bestRoute.quote.amountOut);
    }
  }, 60000);
});
