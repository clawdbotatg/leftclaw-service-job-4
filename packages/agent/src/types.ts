/**
 * Shared types for the Treasury Manager AI Agent
 */

/** Route type enum matching the contract's uint8 routeType */
export enum RouteType {
  V3 = 0,
  V4 = 1,
}

/** V3 fee tiers in basis points */
export const V3_FEE_TIERS = [100, 500, 3000, 10000] as const;
export type V3FeeTier = (typeof V3_FEE_TIERS)[number];

/** A parsed BuyRequest event from the TreasuryManager contract */
export interface BuyRequest {
  bot: string;
  token: string;
  amountETH: bigint;
  maxSlippageBps: bigint;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
}

/** A V3 route candidate */
export interface V3Route {
  routeType: RouteType.V3;
  path: string[]; // array of token addresses
  fees: number[]; // array of fee tiers
  description: string;
}

/** A V4 route candidate */
export interface V4Route {
  routeType: RouteType.V4;
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  zeroForOne: boolean;
  hookData: string;
  description: string;
}

export type RouteCandidate = V3Route | V4Route;

/** Result of quoting a route */
export interface QuoteResult {
  route: RouteCandidate;
  amountOut: bigint;
  gasEstimate: bigint;
  success: boolean;
  error?: string;
}

/** The best route selected for execution */
export interface SelectedRoute {
  routeType: RouteType;
  encodedPath: string; // hex-encoded bytes
  amountOutMin: bigint;
  quote: QuoteResult;
}

/** Agent configuration */
export interface AgentConfig {
  workerPrivateKey: string;
  rpcUrl: string;
  treasuryManagerAddress: string;
  maxSwapETH: number;
  minSlippageBps: number;
  pollIntervalMs: number;
  chainId: number;
}

/** Known addresses on Base (chain 8453) */
export const BASE_ADDRESSES = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  SWAP_ROUTER_02: "0x2626664c2603336E57B271c5C0b26F421741e481",
  UNIVERSAL_ROUTER: "0x6fF5693b99212Da76ad316178A184AB56D299b43",
  V3_QUOTER_V2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
  V4_QUOTER: "0x0d5e0F971ED27FBfF6c2837bf31316121532048D",
  V4_POOL_MANAGER: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
  V4_STATE_VIEW: "0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71",
  PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;

export const CHAIN_ID = 8453;
