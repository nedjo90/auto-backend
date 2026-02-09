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
 * Map from table name to the field used as the lookup key.
 * Most tables use 'key', but some use 'code' or 'fieldName'.
 */
const KEY_FIELD_MAP: Record<string, string> = {
  ConfigParameter: "key",
  ConfigText: "key",
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
    }
  }

  async refresh(): Promise<void> {
    for (const table of CONFIG_TABLES) {
      await this.refreshTable(table);
    }
    this.ready = true;
    LOG.info(`Config cache loaded: ${CONFIG_TABLES.length} tables`);
  }

  async refreshTable(table: string): Promise<void> {
    try {
      const entities = cds.entities("auto");
      const entity = entities[table];
      if (!entity) {
        LOG.warn(`Config entity ${table} not found, skipping cache load`);
        return;
      }

      const rows = await cds.run(SELECT.from(entity));
      const keyField = KEY_FIELD_MAP[table] || "key";

      // Build indexed map
      const tableMap = new Map<string, unknown>();
      const list: unknown[] = [];
      for (const row of rows || []) {
        const keyValue = row[keyField];
        if (keyValue) {
          tableMap.set(String(keyValue), row);
        }
        list.push(row);
      }

      this.cache.set(table, tableMap);
      this.lists.set(table, list);
    } catch (err) {
      LOG.error(`Failed to load config table ${table}:`, err);
    }
  }

  isReady(): boolean {
    return this.ready;
  }
}

/** Singleton instance - the only config cache used across the application. */
export const configCache: IConfigCache = new InMemoryConfigCache();
