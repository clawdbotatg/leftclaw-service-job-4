# TreasuryManager.sol — Audit Fix Results

**Job:** LeftClaw Services Job 4
**Contract:** `packages/foundry/contracts/TreasuryManager.sol`
**Client:** `0x9ba58Eea1Ea9ABDEA25BA83603D54F6D9A01E506`
**Date:** 2026-03-30
**Commit:** `22229d1`

---

## Issues Fixed

### Issue #1 [CRITICAL] — V4 Universal Router encoding wrong
**Problem:** `_swapV4` wrapped V4 params in an extra `abi.encode()` layer and used wrong V3 action codes (0x06/0x0c/0x0f).

**Fix:** Replaced the entire V4 encoding with proper V4SwapData format:
- `commands = hex"10"` (V4_SWAP)
- `inputs[0] = abi.encode(poolKey, zeroForOne, exactAmount, minAmountOut, hookData)`
- Removed the `actions` + `v4Params` wrapper entirely
- `poolKey = abi.encode(currency0, currency1, fee, tickSpacing, hooks)`

### Issue #2 [HIGH] — No output token validation in _swapV4
**Problem:** Decoded path's output token was never validated against the `token` parameter.

**Fix:** Added validation after decoding:
```solidity
address outputToken = zeroForOne ? currency1 : currency0;
require(outputToken == token, "output token mismatch");
```

### Issue #3 [MEDIUM] — sqrtPriceLimitX96 hardcoded magic values
**Problem:** Used MIN/MAX price limits (`4295128740` / `1461446703485210103287273052203988822378723970341`) instead of proper defaults.

**Fix:** Removed sqrtPriceLimitX96 entirely — it's not part of the V4SwapData struct used by the V4_SWAP command. The restructured encoding naturally eliminates this issue.

### Issue #4 [MEDIUM] — V3 path not validated
**Problem:** No check that V3 path starts with WETH and ends with target `token`.

**Fix:** Added `_validateV3Path` helper:
```solidity
function _validateV3Path(bytes calldata path, address token) internal pure {
    require(path.length >= 43, "path too short");
    address firstToken = address(bytes20(path[:20]));
    require(firstToken == WETH, "path must start with WETH");
    address lastToken = address(bytes20(path[path.length - 20:]));
    require(lastToken == token, "path must end with target token");
}
```
Called in `_swapV3` before executing the swap. Also updated `_swapV3` signature to accept `token` parameter.

---

## Additional Fix
- Fixed UNIVERSAL_ROUTER address checksum (`0x6ff5...` → `0x6fF5693b99212Da76ad316178A184AB56D299b43`)

## Build Infrastructure
- Added `foundry.toml` with Solc 0.8.20
- Added `remappings.txt` for OpenZeppelin imports
- Installed OpenZeppelin Contracts v5.6.1 as forge dependency

## Verification
- ✅ `forge build` — Compiler run successful
- ✅ All 4 GitHub issues closed with fix details
- ✅ Commit pushed to main: `fix: resolve audit issues #1-#4`

---

## GitHub Issues Status
| Issue | Severity | Status |
|-------|----------|--------|
| #1 — V4 encoding wrong | CRITICAL | ✅ Closed |
| #2 — No output token validation | HIGH | ✅ Closed |
| #3 — Hardcoded sqrtPriceLimitX96 | MEDIUM | ✅ Closed |
| #4 — V3 path not validated | MEDIUM | ✅ Closed |
