# Treasury Manager AI Agent — User Journey

## Overview

This is a **backend service**, not a web dApp. The "user" is the client's backend system or a bot operator who owns the Treasury Manager.

---

## Happy Path: Agent Executes a Token Purchase

### Step 1: Treasury Manager Emits BuyRequest

The Treasury Manager emits an event:
```
BuyRequest(bot, token, amountETH, maxSlippageBps)
```

The agent is monitoring this event (via polling or websocket).

### Step 2: Agent Receives the Request

The agent parses the event and extracts:
- `token` — the token to buy
- `amountETH` — how much ETH to spend
- `maxSlippageBps` — slippage tolerance in basis points

### Step 3: Route Discovery

Agent generates candidate routes:

**V3 candidates (routeType = 0):**
- `WETH —[100]→ token`
- `WETH —[500]→ token`
- `WETH —[3000]→ token`
- `WETH —[10000]→ token`
- `WETH —[500]→ USDC —[500]→ token`
- `WETH —[500]→ USDC —[3000]→ token`

**V4 candidates (routeType = 1):**
- Direct V4 swap using pool key from the event (if provided) or PoolManager lookup

### Step 4: Quoting

Agent calls `quoteExactInput` on the V3 QuoterV2 and/or V4 Quoter for each candidate route via `eth_call`.

Results:
```
Candidate: WETH—[3000]→ token  → amountOut: 150,000 TOKEN  ← BEST
Candidate: WETH—[500]→ token   → amountOut: 148,500 TOKEN
Candidate: WETH—[10000]→ token → amountOut: 147,200 TOKEN
```

### Step 5: Path Encoding

Best route is WETH—[3000]→ token (V3, single-hop, routeType=0).

Agent encodes:
```typescript
const path = encodeV3Path([WETH, token], [3000])
// = 0x4200...006 + 000BB8 + <token address>  (packed)
```

### Step 6: Slippage Check

minOut = `amountOut * (10000 - maxSlippageBps) / 10000`
If `maxSlippageBps = 50` (0.5%):
```
minOut = 150,000 * 0.995 = 149,250 TOKEN
```

### Step 7: Transaction Execution

Agent calls:
```solidity
treasuryManager.buyTokenWithETH(
  token,           // 0x50D2...
  1_000_000,      // 1 ETH in wei
  0,               // routeType = V3
  path,            // encoded V3 path
  149_250          // minOut (with slippage)
)
```

Transaction is signed with the worker wallet and broadcast to Base.

### Step 8: Confirmation

- Block confirmation (1-2 blocks on Base)
- Tokens delivered to Treasury Manager
- Agent logs the tx hash and amount purchased

---

## Edge Cases

### Edge Case 1: No Pool Exists

**Scenario:** All V3 fee tiers return 0 liquidity for the token.

**Agent behavior:**
1. Try all fee tiers and multi-hop routes
2. If all return 0, log warning: "No liquidity found for token X"
3. Do NOT send a tx that will revert
4. Optionally: alert via job message

### Edge Case 2: Slippage Exceeded

**Scenario:** Quoted amount was 150,000 TOKEN, but execution returns 140,000 TOKEN (due to price movement).

**Agent behavior:**
- Transaction would revert if `amountOut < minOut`
- Agent should either:
  a. Retry with lower `minOut` (if there's still time), OR
  b. Skip and log "Slippage exceeded, skipping"

### Edge Case 3: V4 Pool Key Unknown

**Scenario:** `BuyRequest` provides `routeType=1` but no pool key.

**Agent behavior:**
- Query V4 PoolManager (`getPoolState`) to check if pool exists
- If yes → proceed with V4
- If no → fall back to V3, or log "V4 pool not found, skipping"

### Edge Case 4: ETH Balance Insufficient

**Scenario:** Treasury Manager doesn't have enough ETH for the swap.

**Agent behavior:**
- Check `address(this).balance` before building the tx
- If insufficient, do NOT send — log warning

### Edge Case 5: Wrong Network

**Scenario:** Agent is accidentally pointed at Ethereum mainnet instead of Base.

**Agent behavior:**
- Verify chainId == 8453 before any operation
- Hard revert if wrong chain

### Edge Case 6: Concurrent Requests

**Scenario:** Two `BuyRequest` events arrive simultaneously for different tokens.

**Agent behavior:**
- Process sequentially (or use nonce management for concurrent)
- Each tx needs unique nonce
- Never send same nonce twice

---

## Configuration

| Param | Description | Example |
|---|---|---|
| `TREASURY_MANAGER_ADDRESS` | Contract to call | `0x...` |
| `WORKER_PRIVATE_KEY` | Wallet key (from env, never git) | `0x...` |
| `BASE_RPC_URL` | Base JSON-RPC | `https://...` |
| `MAX_SWAP_ETH` | Max ETH per swap (safety) | `1.0` |
| `MIN_SLIPPAGE_BPS` | Minimum slippage floor | `10` (0.1%) |
| `POLL_INTERVAL_MS` | How often to check for events | `5000` |

---

## Monitoring & Observability

Agent should log:
- Every `BuyRequest` received (with token, amount)
- Every route quoted (all candidates + best)
- Every tx submitted (tx hash, gas price)
- Every tx confirmed (block number, actual amount out)
- Every error (with full context)

No UI needed — logs are the dashboard.
