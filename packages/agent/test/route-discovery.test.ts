/**
 * Tests for route discovery (candidate generation).
 * Integration tests with live quoting are in integration.test.ts.
 */

import { describe, it, expect } from "vitest";
import { generateV3Candidates } from "../src/route-discovery";
import { RouteType, BASE_ADDRESSES, V3_FEE_TIERS } from "../src/types";

const FAKE_TOKEN = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF";
const WETH = BASE_ADDRESSES.WETH;
const USDC = BASE_ADDRESSES.USDC;

describe("generateV3Candidates", () => {
  it("generates direct routes at all fee tiers", () => {
    const candidates = generateV3Candidates(FAKE_TOKEN);

    // Should have at least 4 direct routes (one per fee tier)
    const directRoutes = candidates.filter((c) => c.path.length === 2);
    expect(directRoutes.length).toBe(V3_FEE_TIERS.length);

    // Each should start with WETH and end with token
    for (const route of directRoutes) {
      expect(route.routeType).toBe(RouteType.V3);
      expect(route.path[0]).toBe(WETH);
      expect(route.path[1]).toBe(FAKE_TOKEN);
      expect(V3_FEE_TIERS).toContain(route.fees[0]);
    }
  });

  it("generates multi-hop routes via USDC", () => {
    const candidates = generateV3Candidates(FAKE_TOKEN);

    const multiHopRoutes = candidates.filter((c) => c.path.length === 3);
    expect(multiHopRoutes.length).toBeGreaterThan(0);

    // Each multi-hop should go WETH → USDC → TOKEN
    for (const route of multiHopRoutes) {
      expect(route.path[0]).toBe(WETH);
      expect(route.path[1]).toBe(USDC);
      expect(route.path[2]).toBe(FAKE_TOKEN);
      expect(route.fees.length).toBe(2);
    }
  });

  it("total candidates = 4 direct + 4 multi-hop = 8", () => {
    const candidates = generateV3Candidates(FAKE_TOKEN);
    // 4 direct fee tiers + 4 USDC combos (500/500, 500/3000, 3000/500, 3000/3000)
    expect(candidates.length).toBe(8);
  });

  it("descriptions are informative", () => {
    const candidates = generateV3Candidates(FAKE_TOKEN);
    for (const c of candidates) {
      expect(c.description).toBeTruthy();
      expect(c.description.includes("V3")).toBe(true);
    }
  });
});
