/**
 * Treasury Manager AI Agent Operator
 *
 * Main loop: polls for BuyRequest events and executes optimal swaps
 * via Uniswap V3/V4 routes.
 */

import { ethers } from "ethers";
import * as dotenv from "dotenv";
import {
  AgentConfig,
  BuyRequest,
  CHAIN_ID,
} from "./types";
import {
  getTreasuryContract,
  getBuyRequests,
  isAuthorizedBot,
  checkTreasuryBalance,
} from "./treasury";
import { discoverBestRoute } from "./route-discovery";
import { executeTokenBuy } from "./tx-executor";
import { V4PoolIndexer } from "./v4-pool-indexer";

dotenv.config();

// ── Configuration ────────────────────────────────────────────────────
function loadConfig(): AgentConfig {
  const workerPrivateKey = process.env.WORKER_PRIVATE_KEY;
  if (!workerPrivateKey) {
    throw new Error("WORKER_PRIVATE_KEY not set in environment");
  }

  const treasuryManagerAddress = process.env.TREASURY_MANAGER_ADDRESS;
  if (!treasuryManagerAddress) {
    throw new Error("TREASURY_MANAGER_ADDRESS not set in environment");
  }

  return {
    workerPrivateKey,
    rpcUrl: process.env.BASE_RPC_URL || process.env.ALCHEMY_RPC_URL || "https://mainnet.base.org",
    treasuryManagerAddress,
    maxSwapETH: parseFloat(process.env.MAX_SWAP_ETH || "1.0"),
    minSlippageBps: parseInt(process.env.MIN_SLIPPAGE_BPS || "10"),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "5000"),
    chainId: CHAIN_ID,
  };
}

// ── Process a single BuyRequest ──────────────────────────────────────
async function processBuyRequest(
  buyRequest: BuyRequest,
  config: AgentConfig,
  provider: ethers.Provider,
  contract: ethers.Contract,
  poolIndexer: V4PoolIndexer
): Promise<void> {
  const { token, amountETH, maxSlippageBps } = buyRequest;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[agent] Processing BuyRequest:`);
  console.log(`  Bot: ${buyRequest.bot}`);
  console.log(`  Token: ${token}`);
  console.log(`  Amount: ${ethers.formatEther(amountETH)} ETH`);
  console.log(`  Max slippage: ${maxSlippageBps.toString()} bps`);
  if (buyRequest.poolId) {
    console.log(`  Forced poolId: ${buyRequest.poolId}`);
  }
  console.log(`  Block: ${buyRequest.blockNumber} | TX: ${buyRequest.transactionHash}`);

  // Safety check: max ETH per swap
  const maxWei = ethers.parseEther(config.maxSwapETH.toString());
  if (amountETH > maxWei) {
    console.log(
      `[agent] ⚠ Amount ${ethers.formatEther(amountETH)} ETH exceeds max ${config.maxSwapETH} ETH. Skipping.`
    );
    return;
  }

  // Check treasury balance
  const { sufficient, balance } = await checkTreasuryBalance(
    provider,
    config.treasuryManagerAddress,
    amountETH
  );
  if (!sufficient) {
    console.log(
      `[agent] ⚠ Treasury balance (${ethers.formatEther(balance)} ETH) insufficient for ${ethers.formatEther(amountETH)} ETH. Skipping.`
    );
    return;
  }

  // Ensure slippage is at least the configured minimum
  const effectiveSlippage =
    maxSlippageBps > BigInt(config.minSlippageBps)
      ? maxSlippageBps
      : BigInt(config.minSlippageBps);

  // Discover best route (pass poolIndexer + optional forced poolId)
  const route = await discoverBestRoute(
    provider,
    token,
    amountETH,
    effectiveSlippage,
    poolIndexer,
    buyRequest.poolId
  );

  if (!route) {
    console.log(`[agent] ✗ No viable route found for token ${token}. Skipping.`);
    return;
  }

  // Execute the buy
  const result = await executeTokenBuy(contract, token, amountETH, route);

  if (result.success) {
    console.log(`[agent] ✓ Buy executed successfully!`);
    console.log(`  TX: ${result.txHash}`);
    console.log(`  Block: ${result.blockNumber}`);
    console.log(`  Tokens received: ${result.amountOut?.toString() || "unknown"}`);
    console.log(`  Gas used: ${result.gasUsed?.toString() || "unknown"}`);
  } else {
    console.log(`[agent] ✗ Buy failed: ${result.error}`);
    if (result.txHash) {
      console.log(`  TX: ${result.txHash}`);
    }
  }
}

// ── Main Agent Loop ──────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Treasury Manager AI Agent Operator                 ║");
  console.log("║  Uniswap V3/V4 Route Discovery & Execution         ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  const config = loadConfig();
  console.log(`[agent] RPC: ${config.rpcUrl.replace(/\/v2\/.*/, "/v2/***")}`);
  console.log(`[agent] Treasury: ${config.treasuryManagerAddress}`);
  console.log(`[agent] Max swap: ${config.maxSwapETH} ETH`);
  console.log(`[agent] Poll interval: ${config.pollIntervalMs}ms`);

  // Set up provider, wallet, and V4 pool indexer
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);

  // Verify chain ID
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) {
    throw new Error(
      `Wrong chain! Expected ${config.chainId} (Base), got ${network.chainId}`
    );
  }
  console.log(`[agent] ✓ Connected to Base (chain ${network.chainId})`);

  const wallet = new ethers.Wallet(config.workerPrivateKey, provider);
  console.log(`[agent] Worker wallet: ${wallet.address}`);

  // Check worker wallet balance for gas
  const walletBalance = await provider.getBalance(wallet.address);
  console.log(
    `[agent] Worker balance: ${ethers.formatEther(walletBalance)} ETH`
  );
  if (walletBalance < ethers.parseEther("0.001")) {
    console.warn(
      `[agent] ⚠ Worker wallet balance is very low. May not have enough for gas.`
    );
  }

  // Set up contract
  const contract = getTreasuryContract(
    config.treasuryManagerAddress,
    wallet
  );

  // Check if we're authorized
  const authorized = await isAuthorizedBot(contract, wallet.address);
  if (!authorized) {
    console.warn(
      `[agent] ⚠ Worker wallet is NOT authorized as a bot on TreasuryManager.`
    );
    console.warn(
      `[agent] The owner must call setBot(${wallet.address}, true)`
    );
  } else {
    console.log(`[agent] ✓ Worker wallet is authorized as bot`);
  }

  // Initialize V4 pool indexer (SQLite-backed, incremental refresh every 30s)
  const poolIndexer = new V4PoolIndexer(provider);
  console.log(`[agent] Building V4 pool index from PoolManager.Initialize events...`);
  await poolIndexer.buildIndex();
  console.log(`[agent] ✓ V4 pool index ready (${poolIndexer.getPoolCount()} pools)`);
  poolIndexer.startAutoRefresh(30000);

  // Start polling
  let lastProcessedBlock = (await provider.getBlockNumber()) - 1;
  console.log(
    `[agent] Starting from block ${lastProcessedBlock + 1}`
  );
  console.log(`[agent] Polling for BuyRequest events...`);

  // Processed event tracking (deduplicate)
  const processedEvents = new Set<string>();

  while (true) {
    try {
      const currentBlock = await provider.getBlockNumber();

      if (currentBlock > lastProcessedBlock) {
        const fromBlock = lastProcessedBlock + 1;
        const toBlock = currentBlock;

        const buyRequests = await getBuyRequests(
          contract,
          fromBlock,
          toBlock
        );

        if (buyRequests.length > 0) {
          console.log(
            `[agent] Found ${buyRequests.length} BuyRequest(s) in blocks ${fromBlock}-${toBlock}`
          );
        }

        // Process each request sequentially
        for (const request of buyRequests) {
          const eventId = `${request.transactionHash}-${request.logIndex}`;
          if (processedEvents.has(eventId)) {
            continue; // Already processed
          }

          processedEvents.add(eventId);
          await processBuyRequest(request, config, provider, contract, poolIndexer);
        }

        lastProcessedBlock = toBlock;
      }
    } catch (error: any) {
      console.error(`[agent] Poll error: ${error.message}`);
      // Continue polling — transient errors shouldn't kill the agent
    }

    // Wait before next poll
    await new Promise((resolve) =>
      setTimeout(resolve, config.pollIntervalMs)
    );
  }
}

// ── Entry point ──────────────────────────────────────────────────────
main().catch((error) => {
  console.error(`[agent] Fatal error: ${error.message}`);
  process.exit(1);
});
