// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/**
 * @title TreasuryManager
 * @notice Holds ETH, accepts buy requests from authorized bots, and executes
 *         swaps via Uniswap V3 (SwapRouter02) or V4 (UniversalRouter).
 *         Purchased tokens stay in this contract.
 */
contract TreasuryManager is Ownable, ReentrancyGuard {
    // ── Constants ──────────────────────────────────────────────────────
    address public constant WETH = 0x4200000000000000000000000000000000000006;
    address public constant SWAP_ROUTER_02 = 0x2626664c2603336E57B271c5C0b26F421741e481;
    address public constant UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // ── State ──────────────────────────────────────────────────────────
    mapping(address => bool) public authorizedBots;

    // ── Events ─────────────────────────────────────────────────────────
    event BuyRequest(
        address indexed bot,
        address indexed token,
        uint256 amountETH,
        uint256 maxSlippageBps
    );

    event BuyExecuted(
        address indexed bot,
        address indexed token,
        uint256 amountETHSpent,
        uint256 amountTokenReceived,
        uint8 routeType
    );

    event BotAuthorized(address indexed bot, bool authorized);

    // ── Errors ─────────────────────────────────────────────────────────
    error NotAuthorized();
    error InsufficientBalance();
    error InvalidRouteType();
    error SwapFailed();
    error ZeroAmount();

    // ── Constructor ────────────────────────────────────────────────────
    constructor(address _owner) Ownable(_owner) {
        // Pre-approve WETH to SwapRouter02 and Permit2
        IWETH(WETH).approve(SWAP_ROUTER_02, type(uint256).max);
        IWETH(WETH).approve(PERMIT2, type(uint256).max);
        // Approve Universal Router via Permit2
        IPermit2(PERMIT2).approve(WETH, UNIVERSAL_ROUTER, type(uint160).max, type(uint48).max);
    }

    // ── Modifiers ──────────────────────────────────────────────────────
    modifier onlyBot() {
        if (!authorizedBots[msg.sender]) revert NotAuthorized();
        _;
    }

    // ── Admin ──────────────────────────────────────────────────────────
    function setBot(address bot, bool authorized) external onlyOwner {
        authorizedBots[bot] = authorized;
        emit BotAuthorized(bot, authorized);
    }

    // ── Request a buy (emits event for the off-chain agent) ────────────
    function requestBuy(
        address token,
        uint256 amountETH,
        uint256 maxSlippageBps
    ) external onlyBot {
        if (amountETH == 0) revert ZeroAmount();
        if (address(this).balance < amountETH) revert InsufficientBalance();
        emit BuyRequest(msg.sender, token, amountETH, maxSlippageBps);
    }

    // ── Execute a buy (called by authorized bot / agent wallet) ───────
    function buyTokenWithETH(
        address token,
        uint256 amountETH,
        uint8 routeType,
        bytes calldata path,
        uint256 amountOutMin
    ) external onlyBot nonReentrant {
        if (amountETH == 0) revert ZeroAmount();
        if (address(this).balance < amountETH) revert InsufficientBalance();

        // Wrap ETH → WETH
        IWETH(WETH).deposit{value: amountETH}();

        uint256 tokenBalBefore = IERC20(token).balanceOf(address(this));

        if (routeType == 0) {
            _swapV3(token, path, amountETH, amountOutMin);
        } else if (routeType == 1) {
            _swapV4(token, path, amountETH, amountOutMin);
        } else {
            revert InvalidRouteType();
        }

        uint256 tokenBalAfter = IERC20(token).balanceOf(address(this));
        uint256 received = tokenBalAfter - tokenBalBefore;

        if (received < amountOutMin) revert SwapFailed();

        emit BuyExecuted(msg.sender, token, amountETH, received, routeType);
    }

    // ── V3 path validation ───────────────────────────────────────────
    function _validateV3Path(bytes calldata path, address token) internal pure {
        require(path.length >= 43, "path too short");
        address firstToken = address(bytes20(path[:20]));
        require(firstToken == WETH, "path must start with WETH");
        address lastToken = address(bytes20(path[path.length - 20:]));
        require(lastToken == token, "path must end with target token");
    }

    // ── V3 swap via SwapRouter02 ───────────────────────────────────────
    function _swapV3(
        address token,
        bytes calldata path,
        uint256 amountIn,
        uint256 amountOutMin
    ) internal {
        _validateV3Path(path, token);

        ISwapRouter02(SWAP_ROUTER_02).exactInput(
            ISwapRouter02.ExactInputParams({
                path: path,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: amountOutMin
            })
        );
    }

    // ── V4 swap via UniversalRouter ────────────────────────────────────
    function _swapV4(
        address token,
        bytes calldata path,
        uint256 amountIn,
        uint256 amountOutMin
    ) internal {
        // Decode V4 pool key and swap params from path
        (
            address currency0,
            address currency1,
            uint24 fee,
            int24 tickSpacing,
            address hooks,
            bool zeroForOne,
            bytes memory hookData
        ) = abi.decode(path, (address, address, uint24, int24, address, bool, bytes));

        // Issue #2: Validate output token matches the target token
        address outputToken = zeroForOne ? currency1 : currency0;
        require(outputToken == token, "output token mismatch");

        // Build Universal Router commands for V4_SWAP
        // Command 0x10 = V4_SWAP
        bytes memory commands = hex"10";

        // Issue #1 & #3: Properly encode V4SwapData as a single bytes input
        // V4_SWAP command takes: abi.encode(poolKey, zeroForOne, exactAmount, minAmountOut, hookData)
        // Issue #3: Use sqrtPriceLimitX96 = 0 (no price limit) instead of hardcoded magic values
        bytes memory poolKey = abi.encode(currency0, currency1, fee, tickSpacing, hooks);

        bytes memory v4SwapData = abi.encode(
            poolKey,
            zeroForOne,
            uint256(amountIn),
            uint256(amountOutMin),
            hookData
        );

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = v4SwapData;

        IUniversalRouter(UNIVERSAL_ROUTER).execute(
            commands,
            inputs,
            block.timestamp + 300
        );
    }

    // ── Withdraw functions ─────────────────────────────────────────────
    function withdrawETH(uint256 amount) external onlyOwner {
        payable(owner()).transfer(amount);
    }

    function withdrawToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }

    // ── Receive ETH ────────────────────────────────────────────────────
    receive() external payable {}
}
