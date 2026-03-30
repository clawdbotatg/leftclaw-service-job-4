/**
 * V4 Pool Indexer — SQLite-backed local index of PoolManager.Initialize events.
 *
 * Builds at startup, refreshes incrementally every 30s.
 * Never does ad-hoc chain scans at request time.
 *
 * V4 ETH pools use currency0 = address(0), NOT WETH.
 */

import Database from "better-sqlite3";
import { ethers } from "ethers";
import { BASE_ADDRESSES } from "./types";

// ── PoolManager Initialize event ABI ─────────────────────────────────
const POOL_MANAGER_ABI = [
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks)",
];

export interface V4PoolRecord {
  poolId: string;
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  blockNumber: number;
}

/**
 * V4PoolIndexer — manages a local SQLite index of V4 pools from PoolManager.Initialize events.
 */
export class V4PoolIndexer {
  private db: Database.Database;
  private provider: ethers.Provider;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private isRefreshing = false;

  constructor(provider: ethers.Provider, dbPath: string = "./v4-pools.db") {
    this.provider = provider;
    this.db = new Database(dbPath);
    this._initSchema();
  }

  /** Create tables if they don't exist */
  private _initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS v4_pools (
        pool_id TEXT PRIMARY KEY,
        currency0 TEXT NOT NULL,
        currency1 TEXT NOT NULL,
        fee INTEGER NOT NULL,
        tick_spacing INTEGER NOT NULL,
        hooks TEXT NOT NULL,
        block_number INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_v4_pools_currency0 ON v4_pools(currency0);
      CREATE INDEX IF NOT EXISTS idx_v4_pools_currency1 ON v4_pools(currency1);
      CREATE INDEX IF NOT EXISTS idx_v4_pools_currencies ON v4_pools(currency0, currency1);

      CREATE TABLE IF NOT EXISTS v4_indexer_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /** Get the last indexed block number */
  private _getLastIndexedBlock(): number {
    const row = this.db
      .prepare("SELECT value FROM v4_indexer_state WHERE key = 'last_block'")
      .get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  }

  /** Set the last indexed block number */
  private _setLastIndexedBlock(blockNumber: number): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO v4_indexer_state (key, value) VALUES ('last_block', ?)"
      )
      .run(blockNumber.toString());
  }

  /** Insert a pool record (upsert) */
  private _insertPool(pool: V4PoolRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO v4_pools (pool_id, currency0, currency1, fee, tick_spacing, hooks, block_number)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        pool.poolId,
        pool.currency0.toLowerCase(),
        pool.currency1.toLowerCase(),
        pool.fee,
        pool.tickSpacing,
        pool.hooks.toLowerCase(),
        pool.blockNumber
      );
  }

  /**
   * Build the initial index from genesis (or last checkpoint) to current block.
   * Fetches PoolManager.Initialize events in chunks.
   */
  async buildIndex(): Promise<void> {
    const currentBlock = await this.provider.getBlockNumber();
    let fromBlock = this._getLastIndexedBlock();

    if (fromBlock === 0) {
      // PoolManager deployed on Base around block 23880000 (approximate)
      // Start from a reasonable point to avoid scanning entire chain
      fromBlock = 23880000;
    } else {
      fromBlock += 1; // Don't re-process last block
    }

    if (fromBlock > currentBlock) {
      console.log(`[v4-indexer] Index is up to date (block ${currentBlock})`);
      return;
    }

    console.log(
      `[v4-indexer] Building index from block ${fromBlock} to ${currentBlock} (${currentBlock - fromBlock} blocks)`
    );

    const pmContract = new ethers.Contract(
      BASE_ADDRESSES.V4_POOL_MANAGER,
      POOL_MANAGER_ABI,
      this.provider
    );

    const CHUNK_SIZE = 10000;
    let totalPools = 0;

    const insertMany = this.db.transaction((pools: V4PoolRecord[]) => {
      for (const pool of pools) {
        this._insertPool(pool);
      }
    });

    for (let start = fromBlock; start <= currentBlock; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE - 1, currentBlock);

      try {
        const events = await pmContract.queryFilter(
          pmContract.filters.Initialize(),
          start,
          end
        );

        if (events.length > 0) {
          const pools: V4PoolRecord[] = events.map((event) => {
            const log = event as ethers.EventLog;
            return {
              poolId: log.args[0] as string,
              currency0: log.args[1] as string,
              currency1: log.args[2] as string,
              fee: Number(log.args[3]),
              tickSpacing: Number(log.args[4]),
              hooks: log.args[5] as string,
              blockNumber: log.blockNumber,
            };
          });

          insertMany(pools);
          totalPools += pools.length;
        }
      } catch (err: any) {
        console.error(
          `[v4-indexer] Error fetching blocks ${start}-${end}: ${err.message}`
        );
        // Continue with next chunk — don't lose progress
      }

      this._setLastIndexedBlock(end);
    }

    console.log(
      `[v4-indexer] Index built: ${totalPools} new pools indexed (up to block ${currentBlock})`
    );
  }

  /**
   * Incremental refresh — fetch new Initialize events since last checkpoint.
   */
  async refresh(): Promise<void> {
    if (this.isRefreshing) return;
    this.isRefreshing = true;

    try {
      const currentBlock = await this.provider.getBlockNumber();
      const lastBlock = this._getLastIndexedBlock();

      if (currentBlock <= lastBlock) {
        return;
      }

      const pmContract = new ethers.Contract(
        BASE_ADDRESSES.V4_POOL_MANAGER,
        POOL_MANAGER_ABI,
        this.provider
      );

      const events = await pmContract.queryFilter(
        pmContract.filters.Initialize(),
        lastBlock + 1,
        currentBlock
      );

      if (events.length > 0) {
        const insertMany = this.db.transaction((pools: V4PoolRecord[]) => {
          for (const pool of pools) {
            this._insertPool(pool);
          }
        });

        const pools: V4PoolRecord[] = events.map((event) => {
          const log = event as ethers.EventLog;
          return {
            poolId: log.args[0] as string,
            currency0: log.args[1] as string,
            currency1: log.args[2] as string,
            fee: Number(log.args[3]),
            tickSpacing: Number(log.args[4]),
            hooks: log.args[5] as string,
            blockNumber: log.blockNumber,
          };
        });

        insertMany(pools);
        console.log(
          `[v4-indexer] Refresh: ${pools.length} new pools (blocks ${lastBlock + 1}-${currentBlock})`
        );
      }

      this._setLastIndexedBlock(currentBlock);
    } catch (err: any) {
      console.error(`[v4-indexer] Refresh error: ${err.message}`);
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Start the 30s refresh interval.
   */
  startAutoRefresh(intervalMs: number = 30000): void {
    if (this.refreshInterval) return;
    this.refreshInterval = setInterval(() => this.refresh(), intervalMs);
    console.log(
      `[v4-indexer] Auto-refresh started (every ${intervalMs / 1000}s)`
    );
  }

  /**
   * Stop the auto-refresh interval.
   */
  stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Find V4 pools where one side is the given token.
   * For ETH pairs, searches for currency0 = address(0).
   */
  findPoolsForToken(token: string): V4PoolRecord[] {
    const tokenLower = token.toLowerCase();
    const rows = this.db
      .prepare(
        `SELECT * FROM v4_pools WHERE currency0 = ? OR currency1 = ?`
      )
      .all(tokenLower, tokenLower) as any[];

    return rows.map((row) => ({
      poolId: row.pool_id,
      currency0: row.currency0,
      currency1: row.currency1,
      fee: row.fee,
      tickSpacing: row.tick_spacing,
      hooks: row.hooks,
      blockNumber: row.block_number,
    }));
  }

  /**
   * Find V4 pools for a specific pair (e.g., address(0) + targetToken for ETH pairs).
   */
  findPoolsForPair(
    tokenA: string,
    tokenB: string
  ): V4PoolRecord[] {
    const aLower = tokenA.toLowerCase();
    const bLower = tokenB.toLowerCase();
    // Sort addresses — V4 enforces currency0 < currency1
    const [c0, c1] = aLower < bLower ? [aLower, bLower] : [bLower, aLower];

    const rows = this.db
      .prepare(
        `SELECT * FROM v4_pools WHERE currency0 = ? AND currency1 = ?`
      )
      .all(c0, c1) as any[];

    return rows.map((row) => ({
      poolId: row.pool_id,
      currency0: row.currency0,
      currency1: row.currency1,
      fee: row.fee,
      tickSpacing: row.tick_spacing,
      hooks: row.hooks,
      blockNumber: row.block_number,
    }));
  }

  /**
   * Look up a specific pool by its poolId.
   */
  getPoolById(poolId: string): V4PoolRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM v4_pools WHERE pool_id = ?`)
      .get(poolId.toLowerCase()) as any | undefined;

    if (!row) return null;

    return {
      poolId: row.pool_id,
      currency0: row.currency0,
      currency1: row.currency1,
      fee: row.fee,
      tickSpacing: row.tick_spacing,
      hooks: row.hooks,
      blockNumber: row.block_number,
    };
  }

  /**
   * Get total pool count in the index.
   */
  getPoolCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM v4_pools")
      .get() as { count: number };
    return row.count;
  }

  /**
   * Close the database connection and stop auto-refresh.
   */
  close(): void {
    this.stopAutoRefresh();
    this.db.close();
  }
}
