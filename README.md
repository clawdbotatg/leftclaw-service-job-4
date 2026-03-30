# Treasury Manager AI Agent Operator — Job 4

**Client:** `0x9ba58Eea1Ea9ABDEA25BA83603D54F6D9A01E506`
**Service Type:** Build (Type 6)
**Contract:** LeftClaw Services (`0xb3c4ecf74cb3427432adff277bb5c9b8fd9b71e0`) on Base (8453)

## What This Project Is

An AI agent operator that executes token purchases through Uniswap V3 and V4 routes on Base, driven by a `TreasuryManager` contract.

The agent:
1. Monitors the TreasuryManager for `BuyRequest` events
2. Discovers optimal routes offchain via Uniswap Quoters (V3 QuoterV2 + V4 Quoter)
3. Encodes route payloads (`bytes path`) with typed routing (`routeType`: 0=V3, 1=V4)
4. Calls `TreasuryManager.buyTokenWithETH()` to execute swaps
5. Purchased tokens remain in the Treasury Manager contract

## Quick Start

```bash
cd packages/agent
npm install
cp .env.example .env
# Edit .env with your private key and treasury address

# Run tests
npm test

# Build
npm run build

# Start agent
npm start
```

## Key Design Decisions (Locked)

| Decision | Choice |
|---|---|
| Routing | Typed routing — `uint8 routeType` (0=V3, 1=V4) |
| V4 scope | Single-hop only in v1 |
| V4 payload | `abi.encode(currency0, currency1, fee, tickSpacing, hooks, zeroForOne, hookData)` |
| Token destination | Treasury Manager contract |
| ETH handling | Contract wraps ETH → WETH; routes always start from WETH |

## Project Structure

```
packages/
├── agent/                        # TypeScript agent
│   ├── src/
│   │   ├── index.ts              # Main loop
│   │   ├── treasury.ts           # Contract interaction
│   │   ├── quoter.ts             # V3/V4 quoting
│   │   ├── path-encoder.ts       # Path encoding
│   │   ├── route-discovery.ts    # Route optimization
│   │   ├── tx-executor.ts        # TX signing
│   │   └── types.ts              # Shared types
│   └── test/                     # 21 tests (17 unit + 4 integration)
└── foundry/
    └── contracts/
        └── TreasuryManager.sol   # Reference contract
```

## Contract Addresses (Base)

| Contract | Address |
|---|---|
| V3 QuoterV2 | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` |
| V4 Quoter | `0x0d5e0F971ED27FBfF6c2837bf31316121532048D` |
| V4 StateView | `0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71` |
| SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| Universal Router | `0x6fF5693b99212Da76ad316178A184AB56D299b43` |
| WETH | `0x4200000000000000000000000000000000000006` |

## Results

See [RESULTS.md](./RESULTS.md) for full test results and verification details.

**IPFS:** [bafkreiab4emolrfz2etu2c3q4mscirbalmnxfavclucqrld3sm73sc56ia](https://bafkreiab4emolrfz2etu2c3q4mscirbalmnxfavclucqrld3sm73sc56ia.ipfs.community.bgipfs.com/)

## Build Pipeline

- [x] create_repo
- [x] create_plan
- [x] create_user_journey
- [x] prototype ← **COMPLETE**
- [ ] contract_audit
- [ ] contract_fix
- [ ] deploy_contract
- [ ] ready
