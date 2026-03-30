# Treasury Manager AI Agent Operator — Results

**Job:** LeftClaw Services Job 4
**Client:** `0x9ba58Eea1Ea9ABDEA25BA83603D54F6D9A01E506`
**Contract:** `0xb3c4ecf74cb3427432adff277bb5c9b8fd9b71e0` (LeftClaw Services) on Base (8453)
**Worker:** `0x11fF8D99AD47Cd7Cf78cFfA302FDAF20E36340BA`
**Date:** 2026-03-30

---

## What Was Built

A **TypeScript/Node.js backend agent** that executes token purchases through Uniswap V3 and V4 routes, driven by `TreasuryManager` contract events on Base (chain 8453).

### Architecture

```
Agent (Node.js/TypeScript + ethers.js v6)
  ├── Event Monitor — polls TreasuryManager for BuyRequest events
  ├── Route Discovery Engine
  │     ├── V3: 4 direct fee tiers + 4 multi-hop via USDC
  │     └── V4: Single-hop pool discovery via StateView
  ├── Quoter Layer (with retry + rate-limit handling)
  │     ├── V3 QuoterV2 — quoteExactInput
  │     └── V4 Quoter — quoteExactInputSingle
  ├── Path Encoder
  │     ├── V3: abi.encodePacked(address, uint24, address, ...)
  │     └── V4: abi.encode(currency0, currency1, fee, tickSpacing, hooks, zeroForOne, hookData)
  └── Transaction Executor — signs + submits buyTokenWithETH
```

### Files Delivered

```
packages/
├── agent/
│   ├── src/
│   │   ├── index.ts              # Main loop (polls BuyRequest events)
│   │   ├── treasury.ts           # TreasuryManager interaction
│   │   ├── quoter.ts             # V3 QuoterV2 + V4 Quoter (with retries)
│   │   ├── path-encoder.ts       # V3 packed + V4 ABI encoding
│   │   ├── route-discovery.ts    # Candidate generation + best-route selection
│   │   ├── tx-executor.ts        # Wallet signing + broadcast
│   │   └── types.ts              # Shared types + Base contract addresses
│   ├── test/
│   │   ├── path-encoder.test.ts  # 13 unit tests
│   │   ├── route-discovery.test.ts # 4 unit tests
│   │   └── integration.test.ts   # 4 integration tests (live Base RPC)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── .env.example
└── foundry/
    └── contracts/
        └── TreasuryManager.sol   # Reference contract implementation
```

---

## Key Design Decisions

| Decision | Implementation |
|---|---|
| **Routing** | Typed routing — `uint8 routeType` (0=V3, 1=V4) |
| **V3 routes** | Direct at 4 fee tiers (100, 500, 3000, 10000) + multi-hop via USDC |
| **V4 routes** | Single-hop only; pool discovery via StateView.getSlot0 |
| **V4 payload** | `abi.encode(currency0, currency1, fee, tickSpacing, hooks, zeroForOne, hookData)` |
| **Quoting** | eth_call with retry logic (3 attempts, 500ms backoff) and concurrency control |
| **Path encoding** | V3: packed bytes; V4: ABI-encoded pool key + swap params |
| **Best route** | Highest `amountOut` across all quoted candidates |
| **Slippage** | `amountOutMin = amountOut * (10000 - maxSlippageBps) / 10000` |
| **Token destination** | Stays in TreasuryManager contract |
| **ETH handling** | Contract wraps ETH → WETH; routes always start from WETH |

---

## Contract Addresses (Verified on Base)

| Contract | Address | Has Code |
|---|---|---|
| V3 QuoterV2 | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` | ✅ |
| V4 Quoter | `0x0d5e0F971ED27FBfF6c2837bf31316121532048D` | ✅ |
| V4 PoolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` | ✅ |
| V4 StateView | `0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71` | ✅ |
| SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` | ✅ |
| Universal Router | `0x6fF5693b99212Da76ad316178A184AB56D299b43` | ✅ |
| WETH | `0x4200000000000000000000000000000000000006` | ✅ |

**Note:** The V3 QuoterV2 address from the original spec (`0x3d4e44Eb1374240CE5F1B136064a6Dbc1C84C58c`) had no deployed code on Base. The correct address was sourced from the official [Uniswap V3 Base deployments docs](https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments).

---

## Test Results

### Unit Tests (17 passing)

**Path Encoder (13 tests):**
- V3 single-hop encoding
- V3 multi-hop encoding
- V3 encode/decode roundtrip
- V3 all fee tiers
- V3 edge cases (insufficient tokens, mismatched fees)
- V4 encode/decode with zero hookData
- V4 encode/decode with custom hookData
- Address sorting (currency0 < currency1)
- Route path encoding (V3 + V4)

**Route Discovery (4 tests):**
- Direct routes at all fee tiers
- Multi-hop routes via USDC
- Correct candidate count
- Informative descriptions

### Integration Tests (4 passing — live Base RPC)

| Test | Result |
|---|---|
| V3 WETH→USDC @ 500bps | ✅ 20.5M USDC (~$2054/ETH) |
| V3 all fee tiers | ✅ All 4 return quotes |
| V4 pool discovery | ✅ Found 3 V4 WETH/USDC pools |
| Full route discovery | ✅ Best: V3 @ 100bps → 20.5M USDC |

### Live Quote Results

```
V3 WETH→USDC @ 100bps:   20,524,734 USDC  ← BEST
V3 WETH→USDC @ 500bps:   20,509,383 USDC
V3 WETH→USDC @ 3000bps:  20,503,505 USDC
V3 WETH→USDC @ 10000bps: 20,416,328 USDC
V4 WETH→USDC @ 500bps:   20,036,693 USDC
V4 WETH→USDC @ 3000bps:  20,514,086 USDC
V4 WETH→USDC @ 10000bps: ✗ (pool uninitialized)
```

---

## TreasuryManager Contract

A reference `TreasuryManager.sol` is included in `packages/foundry/contracts/`. Key features:

- **Authorization**: Only authorized bots can call `buyTokenWithETH` and `requestBuy`
- **V3 swaps**: Via SwapRouter02 (`exactInput`)
- **V4 swaps**: Via UniversalRouter (V4_SWAP command with SWAP_EXACT_IN_SINGLE)
- **Safety**: ReentrancyGuard, balance checks, owner-only admin functions
- **Approvals**: Pre-approved WETH to SwapRouter02 + Permit2 (for Universal Router)

### Contract Interface

```solidity
function buyTokenWithETH(
    address token,        // Token to buy
    uint256 amountETH,    // ETH to spend (wraps to WETH)
    uint8 routeType,      // 0=V3, 1=V4
    bytes calldata path,  // Encoded path
    uint256 amountOutMin  // Slippage protection
) external;

event BuyRequest(
    address indexed bot,
    address indexed token,
    uint256 amountETH,
    uint256 maxSlippageBps
);
```

---

## How to Run

```bash
# Install
cd packages/agent
npm install

# Configure
cp .env.example .env
# Edit .env with worker private key and treasury address

# Run unit tests
npm test

# Run integration tests (uses live Base RPC)
BASE_RPC_URL=https://mainnet.base.org npm test

# Build
npm run build

# Start agent
npm start
```

---

## Phase 2 Status

The agent prototype is **code-complete and tested** against live Base state:
- ✅ V3 route discovery and quoting works on live Base
- ✅ V4 pool discovery and quoting works on live Base
- ✅ Path encoding verified with roundtrip tests
- ✅ Best route selection works correctly
- ⏳ Live swap execution requires a deployed TreasuryManager contract with ETH funding

### To complete Phase 2:
1. Deploy `TreasuryManager.sol` to Base
2. Fund the TreasuryManager with ETH
3. Authorize the worker wallet as a bot
4. Emit a `BuyRequest` event
5. Run the agent — it will discover the best route and execute the swap

---

## Security Notes

- ✅ No private keys committed to git
- ✅ `.env` excluded via `.gitignore`
- ✅ `.env.example` with placeholder values only
- ✅ Slippage protection enforced (configurable minimum)
- ✅ Max swap amount configurable (default 1 ETH)
- ✅ Chain ID verification (rejects wrong chain)
- ✅ Bot authorization check before operation
- ✅ Treasury balance check before swap attempt
