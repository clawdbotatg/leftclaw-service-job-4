/**
 * Path encoding for Uniswap V3 and V4 routes.
 *
 * V3: abi.encodePacked(address, uint24, address, ...)
 * V4: abi.encode(address, address, uint24, int24, address, bool, bytes)
 */

import { ethers } from "ethers";
import { RouteType, V3Route, V4Route, RouteCandidate } from "./types";

/**
 * Encode a V3 path using abi.encodePacked format.
 * Format: address(20) + fee(3) + address(20) [+ fee(3) + address(20) ...]
 *
 * @param tokens Array of token addresses (e.g., [WETH, USDC, TOKEN])
 * @param fees Array of fee tiers (e.g., [500, 3000])
 * @returns Hex-encoded packed path
 */
export function encodeV3Path(tokens: string[], fees: number[]): string {
  if (tokens.length < 2) {
    throw new Error("V3 path requires at least 2 tokens");
  }
  if (fees.length !== tokens.length - 1) {
    throw new Error(
      `V3 path: fees length (${fees.length}) must be tokens length - 1 (${tokens.length - 1})`
    );
  }

  // abi.encodePacked: address is 20 bytes, uint24 is 3 bytes
  let encoded = "0x";
  for (let i = 0; i < tokens.length; i++) {
    // Normalize to checksum then strip 0x — always exactly 40 hex chars
    const normalized = ethers.getAddress(tokens[i]).slice(2).toLowerCase();
    encoded += normalized;
    if (i < fees.length) {
      // Add fee (3 bytes / uint24)
      encoded += fees[i].toString(16).padStart(6, "0");
    }
  }
  return encoded;
}

/**
 * Decode a V3 packed path back to tokens and fees.
 * Useful for debugging and testing.
 */
export function decodeV3Path(path: string): {
  tokens: string[];
  fees: number[];
} {
  // Remove 0x prefix
  const data = path.startsWith("0x") ? path.slice(2) : path;

  const tokens: string[] = [];
  const fees: number[] = [];

  let offset = 0;
  // First token (20 bytes = 40 hex chars)
  tokens.push("0x" + data.slice(offset, offset + 40));
  offset += 40;

  while (offset < data.length) {
    // Fee (3 bytes = 6 hex chars)
    fees.push(parseInt(data.slice(offset, offset + 6), 16));
    offset += 6;

    // Token (20 bytes = 40 hex chars)
    tokens.push("0x" + data.slice(offset, offset + 40));
    offset += 40;
  }

  return { tokens, fees };
}

/**
 * Encode a V4 pool key + swap params.
 * Format: abi.encode(currency0, currency1, fee, tickSpacing, hooks, zeroForOne, hookData)
 */
export function encodeV4Path(
  currency0: string,
  currency1: string,
  fee: number,
  tickSpacing: number,
  hooks: string,
  zeroForOne: boolean,
  hookData: string = "0x"
): string {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ["address", "address", "uint24", "int24", "address", "bool", "bytes"],
    [currency0, currency1, fee, tickSpacing, hooks, zeroForOne, hookData]
  );
}

/**
 * Decode a V4 path back to its components.
 */
export function decodeV4Path(path: string): {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  zeroForOne: boolean;
  hookData: string;
} {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const decoded = abiCoder.decode(
    ["address", "address", "uint24", "int24", "address", "bool", "bytes"],
    path
  );
  return {
    currency0: decoded[0],
    currency1: decoded[1],
    fee: Number(decoded[2]),
    tickSpacing: Number(decoded[3]),
    hooks: decoded[4],
    zeroForOne: decoded[5],
    hookData: ethers.hexlify(decoded[6]),
  };
}

/**
 * Encode a route candidate into the bytes path for the contract.
 */
export function encodeRoutePath(route: RouteCandidate): string {
  if (route.routeType === RouteType.V3) {
    const v3 = route as V3Route;
    return encodeV3Path(v3.path, v3.fees);
  } else if (route.routeType === RouteType.V4) {
    const v4 = route as V4Route;
    return encodeV4Path(
      v4.currency0,
      v4.currency1,
      v4.fee,
      v4.tickSpacing,
      v4.hooks,
      v4.zeroForOne,
      v4.hookData
    );
  }
  throw new Error(`Unknown route type: ${(route as any).routeType}`);
}

/**
 * Sort two addresses for V4 pool key (currency0 < currency1).
 */
export function sortAddresses(
  a: string,
  b: string
): { currency0: string; currency1: string; zeroForOne: boolean } {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  if (aLower < bLower) {
    return { currency0: a, currency1: b, zeroForOne: true };
  }
  return { currency0: b, currency1: a, zeroForOne: false };
}
