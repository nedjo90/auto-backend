import cds from "@sap/cds";

const LOG = cds.log("config-cache");

/**
 * Interface for config cache implementations.
 * Designed for Redis swap: replace InMemoryConfigCache with a Redis-backed
 * implementation without changing consumers.
 */
export interface IConfigCache {
  /** Get a single config entry by table name and key field value. */
  get<T>(table: string, key: string): T | undefined;

  /** Get all config entries for a table. */
  getAll<T>(table: string): T[];

  /** Invalidate a specific table's cache, or all tables if no argument. */
  invalidate(table?: string): void;

  /** Refresh all config tables from the database. */
  refresh(): Promise<void>;

  /** Refresh a single config table from the database. */
  refreshTable(table: string): Promise<void>;

  /** Whether the cache has been initialized. */
  isReady(): boolean;
}

/**
 * Config table names that are loaded into the cache.
 */
const CONFIG_TABLES = [
  "ConfigParameter",
  "ConfigText",
  "ConfigFeature",
  "ConfigBoostFactor",
  "ConfigVehicleType",
  "ConfigListingDuration",
  "ConfigReportReason",
  "ConfigChatAction",
  "ConfigModerationRule",
  "ConfigApiProvider",
  "ConfigRegistrationField",
  "ConfigProfileField",
] as const;

/**
 * Map from table name to the field(s) used as the lookup key.
 * Most tables use 'key', but some use 'code' or 'fieldName'.
 * ConfigText uses a composite key ['key', 'language'] since the same key
 * can have multiple language variants.
 */
const KEY_FIELD_MAP: Record<string, string | string[]> = {
  ConfigParameter: "key",
  ConfigText: ["key", "language"],
  ConfigFeature: "code",
  ConfigBoostFactor: "key",
  ConfigVehicleType: "key",
  ConfigListingDuration: "key",
  ConfigReportReason: "key",
  ConfigChatAction: "key",
  ConfigModerationRule: "key",
  ConfigApiProvider: "key",
  ConfigRegistrationField: "fieldName",
  ConfigProfileField: "fieldName",
};

/**
 * In-memory config cache singleton.
 * Loads all config tables into Map-based memory on startup.
 *
 * Redis swap strategy:
 * 1. Create RedisConfigCache implementing IConfigCache
 * 2. Use Redis HASH per table (key: table name, field: config key, value: JSON)
 * 3. Use Redis pub/sub for multi-instance invalidation
 * 4. Replace the singleton export below
 */
class InMemoryConfigCache implements IConfigCache {
  private cache: Map<string, Map<string, unknown>> = new Map();
  private lists: Map<string, unknown[]> = new Map();
  private ready = false;
  private loadedCount = 0;

  get<T>(table: string, key: string): T | undefined {
    const tableCache = this.cache.get(table);
    if (!tableCache) return undefined;
    return tableCache.get(key) as T | undefined;
  }

  getAll<T>(table: string): T[] {
    return (this.lists.get(table) || []) as T[];
  }

  invalidate(table?: string): void {
    if (table) {
      this.cache.delete(table);
      this.lists.delete(table);
    } else {
      this.cache.clear();
      this.lists.clear();
      this.ready = false;
      this.loadedCount = 0;
    }
  }

  async refresh(): Promise<void> {
    let successCount = 0;
    for (const table of CONFIG_TABLES) {
      const ok = await this.loadTable(table);
      if (ok) successCount++;
    }
    this.loadedCount = successCount;
    // Only mark ready if at least one table loaded successfully
    this.ready = successCount > 0;
    LOG.info(`Config cache loaded: ${successCount}/${CONFIG_TABLES.length} tables`);
  }

  async refreshTable(table: string): Promise<void> {
    await this.loadTable(table);
  }

  /**
   * Build a cache key from a row based on the key field config.
   * Supports composite keys (e.g., ConfigText uses key+language).
   */
  private buildCacheKey(
    row: Record<string, unknown>,
    keyFieldDef: string | string[],
  ): string | null {
    if (Array.isArray(keyFieldDef)) {
      const parts = keyFieldDef.map((f) => String(row[f] ?? ""));
      if (parts.some((p) => !p)) return null;
      return parts.join(":");
    }
    const val = row[keyFieldDef];
    return val ? String(val) : null;
  }

  /**
   * Load a single table into cache. Builds the new Map first, then
   * swaps it in atomically (F4: avoids undefined window during refresh).
   */
  private async loadTable(table: string): Promise<boolean> {
    try {
      const entities = cds.entities("auto");
      const entity = entities[table];
      if (!entity) {
        LOG.warn(`Config entity ${table} not found, skipping cache load`);
        return false;
      }

      const rows = await cds.run(SELECT.from(entity));
      const keyFieldDef = KEY_FIELD_MAP[table] || "key";

      // Build new map first, then swap atomically
      const newTableMap = new Map<string, unknown>();
      const newList: unknown[] = [];
      for (const row of rows || []) {
        const cacheKey = this.buildCacheKey(row as Record<string, unknown>, keyFieldDef);
        if (cacheKey) {
          newTableMap.set(cacheKey, row);
        }
        newList.push(row);
      }

      // Atomic swap - no window where cache is empty
      this.cache.set(table, newTableMap);
      this.lists.set(table, newList);
      return true;
    } catch (err) {
      LOG.error(`Failed to load config table ${table}:`, err);
      return false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }
}

/** Singleton instance - the only config cache used across the application. */
export const configCache: IConfigCache = new InMemoryConfigCache();
