# Treasury Manager AI Agent Operator — Results

**Job:** LeftClaw Services Job 4
**Client:** `0x9ba58Eea1Ea9ABDEA25BA83603D54F6D9A01E506`
**Contract:** `0xb3c4ecf74cb3427432adff277bb5c9b8fd9b71e0` (LeftClaw Services) on Base (8453)
**Worker:** `0x11fF8D99AD47Cd7Cf78cFfA302FDAF20E36340BA`
**Date:** 2026-03-30

---

## Client V4 Spec Fixes (Issues 1-3)

### Issue 1 [CRITICAL] — ETH Handling is Route-Dependent ✅

**Problem:** The contract unconditionally wrapped ALL ETH → WETH before any swap, including V4 swaps. V4 Universal Router handles native ETH natively — wrapping was incorrect for V4 routes.

**Fix (TreasuryManager.sol):**
- `routeType == 0 (V3)`: Wrap ETH → WETH, approve, swap via WETH (unchanged)
- `routeType == 1 (V4)`: **No wrapping.** Forward native ETH as `msg.value` directly to the Universal Router via `execute{value: amountIn}(...)`

```solidity
if (routeType == 0) {
    // V3: Wrap ETH → WETH, approve, swap via WETH
    IWETH(WETH).deposit{value: amountETH}();
    _swapV3(token, path, amountETH, amountOutMin);
} else if (routeType == 1) {
    // V4: Forward native ETH as msg.value — no wrapping
    _swapV4(token, path, amountETH, amountOutMin);
}
```

The `_swapV4` function now calls:
```solidity
IUniversalRouter(UNIVERSAL_ROUTER).execute{value: amountIn}(commands, inputs, deadline);
```

### Issue 2 [CRITICAL] — V4 Pool Discovery Uses address(0) for ETH ✅

**Problem:** The spec didn't describe how `route-discovery.ts` finds V4 pools, and V4 ETH pools use `currency0 = address(0)` — NOT the WETH address. The previous code used WETH for V4 pool lookups.

**Fix (new file: `v4-pool-indexer.ts` + updated `route-discovery.ts`):**

1. **SQLite-backed pool index** (`v4-pool-indexer.ts`):
   - Indexes `PoolManager.Initialize` events into a local SQLite database
   - Built at agent startup by scanning historical events
   - Incremental refresh every 30 seconds — no ad-hoc chain scans at request time
   - Indexed by `currency0`, `currency1`, and `pool_id` for fast lookups

2. **V4 pool discovery** now searches for:
   - ETH pools: `currency0 = address(0)` paired with the target token
   - WETH pools: `currency0 = WETH` paired with the target token (some V4 pools may use WETH)
   - Both are checked for liveness via `StateView.getSlot0` before quoting

3. **V4 path encoding** always uses `address(0)` as `currency0` for ETH pairs — never WETH.

### Issue 3 — Forced Pool ID Behavior ✅

**Problem:** If the operator provides a V4 `poolId`, the agent should use ONLY that pool with no silent fallback to other pools or routing methods.

**Fix:**

1. **Contract** (`TreasuryManager.sol`):
   - `BuyRequest` event now includes `bytes32 poolId`
   - New `requestBuyWithPool(token, amountETH, maxSlippageBps, poolId)` function for forcing a specific pool
   - Original `requestBuy()` emits `poolId = bytes32(0)` (no forced pool)

2. **Agent** (`route-discovery.ts` + `treasury.ts`):
   - `BuyRequest` type includes optional `poolId` field
   - If `poolId` is present and non-zero: agent looks up the pool in the SQLite index
   - If pool is NOT found in the index → **fail immediately** with clear error message
   - If pool is found but not live (sqrtPriceX96 = 0) → **fail immediately**
   - **No silent fallback** to other pools or routing methods
   - If `poolId` is not set: normal V3+V4 discovery proceeds as before

---

## Architecture

```
Agent (Node.js/TypeScript + ethers.js v6)
  ├── Event Monitor — polls TreasuryManager for BuyRequest events
  ├── V4 Pool Indexer (SQLite)
  │     ├── Startup: scans PoolManager.Initialize events historically
  │     └── Auto-refresh: incremental every 30s (no ad-hoc scans)
  ├── Route Discovery Engine
  │     ├── V3: 4 direct fee tiers + 4 multi-hop via USDC (uses WETH)
  │     ├── V4: Pool lookup from SQLite index (uses address(0) for ETH)
  │     └── Forced poolId: fail-fast, no fallback
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
│   │   ├── treasury.ts           # TreasuryManager interaction (with poolId)
│   │   ├── quoter.ts             # V3 QuoterV2 + V4 Quoter (with retries)
│   │   ├── path-encoder.ts       # V3 packed + V4 ABI encoding
│   │   ├── route-discovery.ts    # Candidate generation + forced poolId + best-route selection
│   │   ├── v4-pool-indexer.ts    # NEW: SQLite-backed V4 pool index
│   │   ├── tx-executor.ts        # Wallet signing + broadcast
│   │   └── types.ts              # Shared types + Base contract addresses
│   ├── test/
│   │   ├── path-encoder.test.ts  # Unit tests
│   │   ├── route-discovery.test.ts # Unit tests
│   │   └── integration.test.ts   # Integration tests (live Base RPC)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── .env.example
└── foundry/
    └── contracts/
        └── TreasuryManager.sol   # Updated: route-dependent ETH handling + poolId
```

---

## Key Design Decisions

| Decision | Implementation |
|---|---|
| **ETH Handling** | Route-dependent: V3 wraps ETH→WETH; V4 forwards native ETH as msg.value |
| **V4 currency0** | `address(0)` for ETH pairs (never WETH in V4 context) |
| **V4 Pool Index** | SQLite via better-sqlite3; built at startup, refreshed every 30s |
| **Pool Discovery** | From local SQLite index — never ad-hoc chain scans at request time |
| **Forced poolId** | Fail fast if unresolved; no silent fallback |
| **V3 routes** | Direct at 4 fee tiers (100, 500, 3000, 10000) + multi-hop via USDC |
| **V4 routes** | Single-hop; pools from SQLite index, verified live via StateView |
| **V4 payload** | `abi.encode(currency0, currency1, fee, tickSpacing, hooks, zeroForOne, hookData)` |
| **Quoting** | eth_call with retry logic (3 attempts, 500ms backoff) |
| **Best route** | Highest `amountOut` across all quoted candidates |
| **Slippage** | `amountOutMin = amountOut * (10000 - maxSlippageBps) / 10000` |

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

## Security Notes

- ✅ No private keys committed to git
- ✅ `.env` excluded via `.gitignore`
- ✅ SQLite database (`v4-pools.db`) excluded via `.gitignore`
- ✅ Slippage protection enforced (configurable minimum)
- ✅ Max swap amount configurable (default 1 ETH)
- ✅ Chain ID verification (rejects wrong chain)
- ✅ Bot authorization check before operation
- ✅ Treasury balance check before swap attempt
- ✅ Forced poolId fails fast — no silent fallback
