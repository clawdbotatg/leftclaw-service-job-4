# TreasuryManager V2 — AI Agent Operator

On-chain treasury management agent for USDT on Base. Executes token buys via Uniswap V3/V4 routes.

## Contract Deployment

| Network | Address |
|---------|---------|
| Base (8453) | `0xCEd0900f9E6f36f041D36980c6733D3A5814DE5f` |
| Owner | `0x9ba58Eea1Ea9ABDEA25BA83603D54F6D9A01E506` (job client) |

## Architecture

- **TreasuryManager.sol**: Holds ETH/USDTVault, accepts buy requests from registered bots, executes swaps via Uniswap V3/V4
- **AI Agent**: Monitors `BuyRequest` events, finds best V3/V4 route via Quoter, calls `buyTokenWithETH`
- **V3 QuoterV2**: `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a`
- **V4 Quoter**: `0x0d5e0f971ed27fbff6c2837bf31316121532048d`
- **Universal Router**: `0x6ff5693b99212da76ad316178a184ab56d299b43`
- **V3 SwapRouter02**: `0x2626664c2603336E57B271c5C0b26F421741e481`
- **WETH**: `0x4200000000000000000000000000000000000006`
- **Permit2**: `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- **V4 PoolManager**: `0x498581ff718922c3f8e6a244956af099b2652b2b`
- **V4 StateView**: `0xa3c0c9b65bad0b08107aa264b0f3db444b867a71`

## Key Design Decisions

- **Typed routing**: `uint8 routeType` — 0=V3, 1=V4 (single-hop)
- **V3**: `bytes path` = `abi.encodePacked(WETH, fee, token)` or multi-hop
- **V4**: `bytes path` = `abi.encode(currency0, currency1, fee, tickSpacing, hooks, zeroForOne, hookData)`
- **ETH handling**: V3 wraps ETH→WETH first; V4 forwards native ETH directly (no wrap)
- **V4 ETH pairs**: Use `address(0)` as `currency0` for native ETH pools
- **No allowlists**: Any pool/token route is allowed
- **Token destination**: All bought tokens stay in TreasuryManager contract

## V4 Pool Discovery

V4 pools discovered via local SQLite index of `PoolManager.Initialize` events:
- Built at agent startup (historical scan)
- Incremental refresh every 30 seconds
- No ad-hoc chain scans at request time
- Forced poolId: if provided, use only that pool — fail fast if unresolved

## Agent Setup

```bash
cd packages/agent
cp .env.example .env
# Set PRIVATE_KEY and RPC_URL
npm install
npm run build
node dist/index.js
```

## Build Contracts

```bash
cd packages/foundry
forge build
```

## Deploy Contracts

```bash
cd packages/foundry
PRIVATE_KEY=<deployer-key> CONTRACT_OWNER=<client-address> forge script script/DeployTreasuryManager.s.sol:DeployTreasuryManager --rpc-url https://mainnet.base.org --broadcast
```

## Run Tests

```bash
cd packages/agent && npm test
cd packages/foundry && forge test
```
