# Treasury Manager AI Agent Operator — Job 4

**Client:** `0x9ba58Eea1Ea9ABDEA25BA83603D54F6D9A01E506`
**Service Type:** Build (Type 6)
**Contract:** LeftClaw Services (`0xb3c4ecf74cb3427432adff277bb5c9b8fd9b71e0`) on Base (8453)

## What This Project Is

An AI agent operator that executes token purchases through Uniswap V3 and V4 routes on Base, driven by a `TreasuryManager` contract.

The agent:
1. Discovers optimal routes offchain via Uniswap Quoters (V3 QuoterV2 + V4 Quoter)
2. Encodes route payloads (`bytes path`) with typed routing (`routeType`: 0=V3, 1=V4)
3. Calls `TreasuryManager.buyTokenWithETH()` to execute swaps
4. Purchased tokens remain in the Treasury Manager contract

## Key Design Decisions (Locked)

| Decision | Choice |
|---|---|
| Routing | Typed routing — `uint8 routeType` (0=V3, 1=V4) |
| V4 scope | Single-hop only in v1 |
| V4 payload | Custom `abi.encode(currency0, currency1, fee, tickSpacing, hooks, zeroForOne, hookData)` |
| Allowlists | None |
| Token destination | Treasury Manager contract |
| ETH handling | Contract wraps ETH → WETH internally; routes always start from WETH |

## Deployed Contract Addresses (Base)

| Contract | Address |
|---|---|
| V3 QuoterV2 | `0x3d4e44Eb1374240CE5F1B136064a6Dbc1C84C58c` |
| V4 Quoter | `0x0d5e0f971ed27fbff6c2837bf31316121532048d` |
| V4 PoolManager | `0x498581ff718922c3f8e6a244956af099b2652b2b` |
| V4 StateView | `0xa3c0c9b65bad0b08107aa264b0f3db444b867a71` |
| Universal Router | `0x6ff5693b99212da76ad316178a184ab56d299b43` |
| V3 SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| WETH on Base | `0x4200000000000000000000000000000000000006` |

## Project Structure

TBD — scaffold in progress.

## Build Pipeline

- [ ] create_repo
- [ ] create_plan ← you are here
- [ ] create_user_journey
- [ ] prototype
- [ ] contract_audit
- [ ] contract_fix
- [ ] frontend_audit
- [ ] frontend_fix
- [ ] deploy_contract
- [ ] deploy_app
- [ ] ready
