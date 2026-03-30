/**
 * Tests for V3 and V4 path encoding.
 */

import { describe, it, expect } from "vitest";
import {
  encodeV3Path,
  decodeV3Path,
  encodeV4Path,
  decodeV4Path,
  sortAddresses,
  encodeRoutePath,
} from "../src/path-encoder";
import { RouteType, V3Route, V4Route, BASE_ADDRESSES } from "../src/types";
import { ethers } from "ethers";

const WETH = BASE_ADDRESSES.WETH;
const USDC = BASE_ADDRESSES.USDC;
const FAKE_TOKEN = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF";

describe("V3 Path Encoding", () => {
  it("encodes a single-hop path correctly", () => {
    const path = encodeV3Path([WETH, FAKE_TOKEN], [3000]);

    // Should be: 20 bytes (WETH) + 3 bytes (fee) + 20 bytes (token) = 43 bytes
    // = 86 hex chars + 0x prefix = 88 chars
    expect(path.length).toBe(88);
    expect(path.startsWith("0x")).toBe(true);

    // First 20 bytes should be WETH address (lowercase, no 0x)
    const wethPart = path.slice(2, 42);
    expect(wethPart).toBe(WETH.slice(2).toLowerCase());

    // Next 3 bytes should be fee (3000 = 0x000BB8)
    const feePart = path.slice(42, 48);
    expect(feePart).toBe("000bb8");

    // Last 20 bytes should be token address
    const tokenPart = path.slice(48, 88);
    expect(tokenPart).toBe(FAKE_TOKEN.slice(2).toLowerCase());
  });

  it("encodes a multi-hop path correctly", () => {
    const path = encodeV3Path([WETH, USDC, FAKE_TOKEN], [500, 3000]);

    // 20 + 3 + 20 + 3 + 20 = 66 bytes = 132 hex chars + 0x = 134
    expect(path.length).toBe(134);

    const decoded = decodeV3Path(path);
    expect(decoded.tokens.length).toBe(3);
    expect(decoded.fees.length).toBe(2);
    expect(decoded.tokens[0].toLowerCase()).toBe(WETH.toLowerCase());
    expect(decoded.tokens[1].toLowerCase()).toBe(USDC.toLowerCase());
    expect(decoded.tokens[2].toLowerCase()).toBe(FAKE_TOKEN.toLowerCase());
    expect(decoded.fees[0]).toBe(500);
    expect(decoded.fees[1]).toBe(3000);
  });

  it("roundtrips encode/decode correctly", () => {
    const tokens = [WETH, USDC, FAKE_TOKEN];
    const fees = [500, 3000];

    const encoded = encodeV3Path(tokens, fees);
    const decoded = decodeV3Path(encoded);

    expect(decoded.tokens.length).toBe(3);
    expect(decoded.fees.length).toBe(2);
    for (let i = 0; i < tokens.length; i++) {
      expect(decoded.tokens[i].toLowerCase()).toBe(tokens[i].toLowerCase());
    }
    for (let i = 0; i < fees.length; i++) {
      expect(decoded.fees[i]).toBe(fees[i]);
    }
  });

  it("handles all fee tiers", () => {
    for (const fee of [100, 500, 3000, 10000]) {
      const path = encodeV3Path([WETH, FAKE_TOKEN], [fee]);
      const decoded = decodeV3Path(path);
      expect(decoded.fees[0]).toBe(fee);
    }
  });

  it("throws for insufficient tokens", () => {
    expect(() => encodeV3Path([WETH], [3000])).toThrow();
  });

  it("throws for mismatched fees length", () => {
    expect(() => encodeV3Path([WETH, FAKE_TOKEN], [500, 3000])).toThrow();
  });
});

describe("V4 Path Encoding", () => {
  it("encodes and decodes V4 path correctly", () => {
    const currency0 = FAKE_TOKEN; // lower
    const currency1 = WETH; // higher (in this case WETH might be higher)
    const fee = 3000;
    const tickSpacing = 60;
    const hooks = ethers.ZeroAddress;
    const zeroForOne = true;
    const hookData = "0x";

    const encoded = encodeV4Path(
      currency0,
      currency1,
      fee,
      tickSpacing,
      hooks,
      zeroForOne,
      hookData
    );

    expect(encoded.startsWith("0x")).toBe(true);

    const decoded = decodeV4Path(encoded);
    expect(decoded.currency0.toLowerCase()).toBe(currency0.toLowerCase());
    expect(decoded.currency1.toLowerCase()).toBe(currency1.toLowerCase());
    expect(decoded.fee).toBe(fee);
    expect(decoded.tickSpacing).toBe(tickSpacing);
    expect(decoded.hooks).toBe(hooks);
    expect(decoded.zeroForOne).toBe(zeroForOne);
    expect(decoded.hookData).toBe("0x");
  });

  it("handles non-empty hookData", () => {
    const hookData = "0xdeadbeef";
    const encoded = encodeV4Path(
      WETH,
      FAKE_TOKEN,
      500,
      10,
      ethers.ZeroAddress,
      false,
      hookData
    );
    const decoded = decodeV4Path(encoded);
    expect(decoded.hookData).toBe(hookData);
  });
});

describe("sortAddresses", () => {
  it("sorts correctly when a < b", () => {
    const a = "0x0000000000000000000000000000000000000001";
    const b = "0x0000000000000000000000000000000000000002";
    const result = sortAddresses(a, b);
    expect(result.currency0).toBe(a);
    expect(result.currency1).toBe(b);
    expect(result.zeroForOne).toBe(true);
  });

  it("sorts correctly when b < a", () => {
    const a = "0x9999999999999999999999999999999999999999";
    const b = "0x1111111111111111111111111111111111111111";
    const result = sortAddresses(a, b);
    expect(result.currency0).toBe(b);
    expect(result.currency1).toBe(a);
    expect(result.zeroForOne).toBe(false);
  });

  it("WETH vs token sorts deterministically", () => {
    const result = sortAddresses(WETH, FAKE_TOKEN);
    // WETH (0x42...) vs FAKE_TOKEN (0xDe...) — WETH is lower
    expect(result.currency0.toLowerCase()).toBe(WETH.toLowerCase());
    expect(result.currency1.toLowerCase()).toBe(FAKE_TOKEN.toLowerCase());
    expect(result.zeroForOne).toBe(true);
  });
});

describe("encodeRoutePath", () => {
  it("encodes V3 route", () => {
    const route: V3Route = {
      routeType: RouteType.V3,
      path: [WETH, FAKE_TOKEN],
      fees: [3000],
      description: "test",
    };
    const encoded = encodeRoutePath(route);
    expect(encoded.startsWith("0x")).toBe(true);
    const decoded = decodeV3Path(encoded);
    expect(decoded.tokens[0].toLowerCase()).toBe(WETH.toLowerCase());
    expect(decoded.fees[0]).toBe(3000);
  });

  it("encodes V4 route", () => {
    const route: V4Route = {
      routeType: RouteType.V4,
      currency0: WETH,
      currency1: FAKE_TOKEN,
      fee: 3000,
      tickSpacing: 60,
      hooks: ethers.ZeroAddress,
      zeroForOne: true,
      hookData: "0x",
      description: "test",
    };
    const encoded = encodeRoutePath(route);
    const decoded = decodeV4Path(encoded);
    expect(decoded.fee).toBe(3000);
    expect(decoded.tickSpacing).toBe(60);
    expect(decoded.zeroForOne).toBe(true);
  });
});
