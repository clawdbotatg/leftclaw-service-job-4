/**
 * TreasuryManager contract interaction.
 * Handles event parsing and buyTokenWithETH calls.
 */

import { ethers } from "ethers";
import { BuyRequest } from "./types";

/** Minimal ABI for the TreasuryManager contract */
export const TREASURY_MANAGER_ABI = [
  // Events
  "event BuyRequest(address indexed bot, address indexed token, uint256 amountETH, uint256 maxSlippageBps, bytes32 poolId)",
  "event BuyExecuted(address indexed bot, address indexed token, uint256 amountETHSpent, uint256 amountTokenReceived, uint8 routeType)",
  "event BotAuthorized(address indexed bot, bool authorized)",

  // Functions
  "function buyTokenWithETH(address token, uint256 amountETH, uint8 routeType, bytes calldata path, uint256 amountOutMin) external",
  "function requestBuy(address token, uint256 amountETH, uint256 maxSlippageBps) external",
  "function requestBuyWithPool(address token, uint256 amountETH, uint256 maxSlippageBps, bytes32 poolId) external",
  "function setBot(address bot, bool authorized) external",
  "function authorizedBots(address) external view returns (bool)",
  "function owner() external view returns (address)",
  "function withdrawETH(uint256 amount) external",
  "function withdrawToken(address token, uint256 amount) external",
];

/**
 * Create a TreasuryManager contract instance.
 */
export function getTreasuryContract(
  address: string,
  signerOrProvider: ethers.Signer | ethers.Provider
): ethers.Contract {
  return new ethers.Contract(address, TREASURY_MANAGER_ABI, signerOrProvider);
}

/**
 * Parse BuyRequest events from a range of blocks.
 */
export async function getBuyRequests(
  contract: ethers.Contract,
  fromBlock: number,
  toBlock: number | "latest"
): Promise<BuyRequest[]> {
  const filter = contract.filters.BuyRequest();
  const events = await contract.queryFilter(filter, fromBlock, toBlock);

  const ZERO_BYTES32 = "0x" + "0".repeat(64);

  return events.map((event) => {
    const log = event as ethers.EventLog;
    const rawPoolId = log.args[4] as string;
    // If poolId is zero bytes32, treat as no forced pool
    const poolId =
      rawPoolId && rawPoolId !== ZERO_BYTES32 ? rawPoolId : undefined;

    return {
      bot: log.args[0] as string,
      token: log.args[1] as string,
      amountETH: log.args[2] as bigint,
      maxSlippageBps: log.args[3] as bigint,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      logIndex: log.index,
      poolId,
    };
  });
}

/**
 * Execute a buyTokenWithETH transaction.
 */
export async function executeBuy(
  contract: ethers.Contract,
  token: string,
  amountETH: bigint,
  routeType: number,
  path: string,
  amountOutMin: bigint
): Promise<ethers.TransactionResponse> {
  console.log(`[treasury] Executing buyTokenWithETH:`);
  console.log(`  token: ${token}`);
  console.log(`  amountETH: ${ethers.formatEther(amountETH)} ETH`);
  console.log(`  routeType: ${routeType === 0 ? "V3" : "V4"}`);
  console.log(`  amountOutMin: ${amountOutMin.toString()}`);

  const tx = await contract.buyTokenWithETH(
    token,
    amountETH,
    routeType,
    path,
    amountOutMin
  );

  console.log(`[treasury] TX submitted: ${tx.hash}`);
  return tx;
}

/**
 * Check if the TreasuryManager has enough ETH balance.
 */
export async function checkTreasuryBalance(
  provider: ethers.Provider,
  treasuryAddress: string,
  requiredETH: bigint
): Promise<{ sufficient: boolean; balance: bigint }> {
  const balance = await provider.getBalance(treasuryAddress);
  return {
    sufficient: balance >= requiredETH,
    balance,
  };
}

/**
 * Check if a wallet is an authorized bot.
 */
export async function isAuthorizedBot(
  contract: ethers.Contract,
  botAddress: string
): Promise<boolean> {
  return contract.authorizedBots(botAddress);
}
