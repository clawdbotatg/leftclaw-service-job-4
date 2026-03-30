/**
 * Transaction execution — signing and broadcasting.
 * Handles nonce management and gas estimation.
 */

import { ethers } from "ethers";
import { SelectedRoute } from "./types";
import { executeBuy } from "./treasury";

export interface TxResult {
  success: boolean;
  txHash?: string;
  blockNumber?: number;
  amountOut?: bigint;
  error?: string;
  gasUsed?: bigint;
}

/**
 * Execute a token buy via the TreasuryManager contract.
 */
export async function executeTokenBuy(
  contract: ethers.Contract,
  token: string,
  amountETH: bigint,
  route: SelectedRoute
): Promise<TxResult> {
  try {
    console.log(`[tx-executor] Submitting buy transaction...`);
    console.log(`  Token: ${token}`);
    console.log(`  Amount: ${ethers.formatEther(amountETH)} ETH`);
    console.log(`  Route type: ${route.routeType === 0 ? "V3" : "V4"}`);
    console.log(`  Min out: ${route.amountOutMin.toString()}`);

    const tx = await executeBuy(
      contract,
      token,
      amountETH,
      route.routeType,
      route.encodedPath,
      route.amountOutMin
    );

    console.log(`[tx-executor] Waiting for confirmation: ${tx.hash}`);
    const receipt = await tx.wait(1); // 1 confirmation

    if (!receipt) {
      return {
        success: false,
        txHash: tx.hash,
        error: "No receipt received",
      };
    }

    if (receipt.status === 0) {
      return {
        success: false,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        error: "Transaction reverted",
      };
    }

    // Parse BuyExecuted event from receipt
    let amountOut: bigint | undefined;
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed?.name === "BuyExecuted") {
          amountOut = parsed.args[3] as bigint; // amountTokenReceived
          break;
        }
      } catch {
        // Not our event, skip
      }
    }

    console.log(`[tx-executor] ✓ TX confirmed in block ${receipt.blockNumber}`);
    if (amountOut) {
      console.log(`[tx-executor] Received: ${amountOut.toString()} tokens`);
    }

    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      amountOut,
      gasUsed: receipt.gasUsed,
    };
  } catch (error: any) {
    console.error(`[tx-executor] ✗ Transaction failed: ${error.message}`);

    // Parse common revert reasons
    let errorMsg = error.message;
    if (error.reason) {
      errorMsg = error.reason;
    } else if (error.data) {
      try {
        const iface = contract.interface;
        const decodedError = iface.parseError(error.data);
        if (decodedError) {
          errorMsg = `${decodedError.name}(${decodedError.args.join(", ")})`;
        }
      } catch {
        // Can't decode, use raw message
      }
    }

    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Estimate gas for a buy transaction (dry run).
 */
export async function estimateBuyGas(
  contract: ethers.Contract,
  token: string,
  amountETH: bigint,
  route: SelectedRoute
): Promise<bigint | null> {
  try {
    const gasEstimate = await contract.buyTokenWithETH.estimateGas(
      token,
      amountETH,
      route.routeType,
      route.encodedPath,
      route.amountOutMin
    );
    return gasEstimate;
  } catch (error: any) {
    console.error(`[tx-executor] Gas estimation failed: ${error.message}`);
    return null;
  }
}
