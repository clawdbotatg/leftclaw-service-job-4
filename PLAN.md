# Treasury Manager AI Agent Operator — Plan

## What We Are Building

An AI agent backend service (TypeScript/Node.js) that:
1. Monitors the `TreasuryManager` contract for `BuyRequest` events
2. Discovers optimal Uniswap routes offchain via Quoter contracts (V3 QuoterV2 + V4 Quoter)
3. Encodes `bytes path` payloads using typed routing (`routeType`: 0=V3, 1=V4)
4. Calls `TreasuryManager.buyTokenWithETH()` to execute swaps
5. Purchased tokens remain in the Treasury Manager

## Architecture

```
Agent (Node.js/TypeScript)
  ├── Blockchain reads via JSON-RPC (ethers.js)
  │     ├── V3 QuoterV2 (0x3d4e44Eb1374240CE5F1B136064a6Dbc1C84C58c)
  │     ├── V4 Quoter  (0x0d5e0f971ed27fbff6c2837bf31316121532048d)
  │     └── TreasuryManager — listens for BuyRequest events
  ├── Route discovery engine
  │     ├── V3 route generation + quoting
  │     └── V4 route generation + quoting
  ├── Path encoding
  │     ├── V3: abi.encodePacked(WETH, fee, token)
  │     └── V4: abi.encode(currency0, currency1, fee, tickSpacing, hooks, zeroForOne, hookData)
  └── Transaction executor
        └── Signs + submits buyTokenWithETH tx via worker wallet
```

## Contract Interface (what we call)

```solidity
interface ITreasuryManager {
  // The main function the agent calls
  function buyTokenWithETH(
    address token,       // token to buy
    uint256 amountETH,   // ETH amount to spend
    uint8 routeType,     // 0=V3, 1=V4
    bytes calldata path,  // encoded path (see encoding spec)
    uint256 amountOutMin // minimum out for slippage protection
  ) external payable;

  // Events we listen to
  event BuyRequest(
    address indexed bot,
    address indexed token,
    uint256 amountETH,
    uint256 maxSlippageBps
  );
}
```

## Path Encoding Specification (Locked)

### routeType == 0 (V3)

Single-hop: `abi.encodePacked(WETH, fee, token)`
- WETH: `0x4200000000000000000000000000000000000006`
- fee: uint24 (100, 500, 3000, 10000)
- token: target token address

Multi-hop: `abi.encodePacked(WETH, fee0, intermediate, fee1, token)`

### routeType == 1 (V4)

```solidity
abi.encode(
  address currency0,  // lower address (sorted)
  address currency1,  // higher address (sorted)
  uint24 fee,         // e.g. 3000
  int24 tickSpacing,  // e.g. 60
  address hooks,      // address(0) if no hooks
  bool zeroForOne,   // true if WETH < token (by address)
  bytes hookData     // 0x for no hook data
)
```

## Route Discovery Algorithm

For any `(WETH → token)` swap:

1. **V3 candidates (routeType = 0):**
   - Direct at 4 fee tiers: 100, 500, 3000, 10000
   - Via USDC (500/3000 bps)
   - Via WBTC (500 bps)

2. **V4 candidates (routeType = 1):**
   - Direct with known pool key (from `BuyRequest` event or PoolManager lookup)
   - Single-hop only in v1

3. **Quote each candidate** via `eth_call` to the appropriate Quoter

4. **Pick the best** — highest `amountOut` after slippage check

5. **Encode path** per routeType and call `buyTokenWithETH`

## Tech Stack

- **Runtime:** Node.js 20+, TypeScript
- **Blockchain:** ethers.js v6
- **RPC:** Alchemy or public Base RPC
- **Wallet:** Worker wallet (HD wallet or raw key, never committed)
- **No external APIs** — all route discovery via onchain Quoter contracts

## File Structure

```
packages/
  └── agent/
        ├── src/
        │     ├── index.ts              # Entry point, main loop
        │     ├── treasury.ts           # TreasuryManager interaction
        │     ├── quoter.ts             # V3 + V4 Quoter calls
        │     ├── path-encoder.ts       # V3 + V4 path encoding
        │     ├── route-discovery.ts    # Candidate generation + best-route pick
        │     ├── tx-executor.ts        # Signing + broadcast
        │     └── types.ts              # Shared types
        ├── scripts/
        │     └── deploy-treasury.ts   # Deploy TreasuryManager (client's contract)
        ├── test/
        │     ├── path-encoder.test.ts
        │     ├── route-discovery.test.ts
        │     └── integration.test.ts
        ├── .env.example
        └── package.json
```

## Build Phases

### Phase 1: Core Agent (local fork)
- TreasuryManager contract deployed to local fork
- Route discovery + encoding working
- Agent can execute swaps on fork

### Phase 2: Live Testing
- Deploy TreasuryManager to Base
- Test with small ETH amounts on live Base
- Verify V3 and V4 routing

### Phase 3: Production
- Clean up agent config
- IPFS report of the agent spec
- Handoff to client

## TreasuryManager Client Deployment (IMPORTANT)

The `TreasuryManager` contract itself needs to be deployed by the CLIENT (or for the client). This is THEIR contract. The agent just interacts with it.

If the client doesn't have a TreasuryManager yet, a reference implementation should be deployed during the `deploy_contract` stage.

## Security Considerations

- Worker wallet private key: never commit to git, use `.env`
- Slippage protection: always pass `amountOutMin`
- Route validation: check path ends with target token
- ETH amount limits: configurable max per swap
- Nonce management: avoid nonce collisions in concurrent ops

## Out of Scope for v1

- Multi-hop V4 routes (PathKey[])
- Universal Router direct calldata passthrough
- Frontend UI (no web dApp needed — this is a backend service)
- Token allowlisting
- Fee tier restrictions
