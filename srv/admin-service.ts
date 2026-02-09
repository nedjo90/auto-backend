import cds from "@sap/cds";
import { configCache } from "./lib/config-cache";
import { logAudit } from "./lib/audit-logger";
import { invalidateAdapter } from "./adapters/factory/adapter-factory";

const LOG = cds.log("admin");

/**
 * Map of AdminService entity names to their source config table names.
 */
const ENTITY_TABLE_MAP: Record<string, string> = {
  ConfigParameters: "ConfigParameter",
  ConfigTexts: "ConfigText",
  ConfigFeatures: "ConfigFeature",
  ConfigBoostFactors: "ConfigBoostFactor",
  ConfigVehicleTypes: "ConfigVehicleType",
  ConfigListingDurations: "ConfigListingDuration",
  ConfigReportReasons: "ConfigReportReason",
  ConfigChatActions: "ConfigChatAction",
  ConfigModerationRules: "ConfigModerationRule",
  ConfigApiProviders: "ConfigApiProvider",
};

const CONFIG_ENTITIES = Object.keys(ENTITY_TABLE_MAP);

export default class AdminServiceHandler extends cds.ApplicationService {
  async init() {
    // Register BEFORE handlers to capture old values for audit
    for (const entity of CONFIG_ENTITIES) {
      this.before(["UPDATE", "DELETE"], entity, this.captureOldValue);
    }

    // Register AFTER handlers for audit logging + deferred cache refresh
    for (const entity of CONFIG_ENTITIES) {
      this.after(["CREATE", "UPDATE", "DELETE"], entity, this.onConfigMutation.bind(this, entity));
    }

    // Register action handlers
    this.on("estimateConfigImpact", this.handleEstimateImpact);
    this.on("getApiCostSummary", this.handleGetApiCostSummary);
    this.on("getProviderAnalytics", this.handleGetProviderAnalytics);
    this.on("switchProvider", this.handleSwitchProvider);

    await super.init();
  }

  /**
   * BEFORE handler: capture old values for UPDATE/DELETE audit trail.
   */
  private captureOldValue = async (req: cds.Request) => {
    if (!req.data?.ID) return;
    const entityName = req.target?.name;
    if (!entityName) return;

    try {
      const entity = cds.entities("auto")[this.resolveSourceTable(entityName)];
      if (!entity) return;
      const old = await cds.run(SELECT.one.from(entity).where({ ID: req.data.ID }));
      if (old) {
        (req as cds.Request & { _oldValue?: unknown })._oldValue = old;
      }
    } catch (err) {
      LOG.warn("Failed to capture old value for audit:", err);
    }
  };

  /**
   * AFTER handler: log audit + schedule cache refresh after commit.
   */
  private onConfigMutation = async (projectionName: string, data: unknown, req: cds.Request) => {
    const tableName = ENTITY_TABLE_MAP[projectionName];
    if (!tableName) return;

    // Defer cache refresh to after transaction commits
    req.on?.("succeeded", async () => {
      try {
        await configCache.refreshTable(tableName);
        // If a provider was changed, invalidate adapter instances
        if (tableName === "ConfigApiProvider") {
          invalidateAdapter();
        }
      } catch (err) {
        LOG.error(`Failed to refresh cache for ${tableName}:`, err);
      }
    });

    // Determine action type
    const event = req.event;
    const action =
      event === "CREATE"
        ? "CONFIG_CREATED"
        : event === "UPDATE"
          ? "CONFIG_UPDATED"
          : "CONFIG_DELETED";

    // Build audit details
    const oldValue = (req as cds.Request & { _oldValue?: unknown })._oldValue;
    const details: Record<string, unknown> = {
      table: tableName,
      entityId: req.data?.ID,
    };
    if (oldValue) details.oldValue = oldValue;
    if (event !== "DELETE" && data) details.newValue = data;

    // Log to audit trail
    const userId = req.user?.id || "system";
    await logAudit({
      userId,
      action,
      resource: tableName,
      details: JSON.stringify(details),
    });
  };

  /**
   * Action handler: estimate impact of changing a config parameter.
   */
  private handleEstimateImpact = async (req: cds.Request) => {
    const { parameterKey } = req.data as { parameterKey: string };
    if (!parameterKey?.trim()) {
      return req.reject(400, "parameterKey is required");
    }

    const param = configCache.get<{ key: string; category: string | null }>(
      "ConfigParameter",
      parameterKey,
    );
    if (!param) {
      return { affectedCount: 0, message: "Parametre non trouve dans le cache." };
    }

    if (param.category === "pricing") {
      return {
        affectedCount: 0,
        message: "Cette modification affectera les prochaines annonces.",
      };
    }

    return {
      affectedCount: 0,
      message: "Cette modification prendra effet immediatement.",
    };
  };

  /**
   * Action handler: get aggregated API cost summary for a time period.
   */
  private handleGetApiCostSummary = async (req: cds.Request) => {
    const { period } = req.data as { period: string };
    if (!period?.trim()) {
      return req.reject(400, "period is required");
    }

    const validPeriods = ["day", "week", "month"];
    if (!validPeriods.includes(period)) {
      return req.reject(400, `period must be one of: ${validPeriods.join(", ")}`);
    }

    try {
      const entities = cds.entities("auto");
      const ApiCallLog = entities["ApiCallLog"];
      if (!ApiCallLog) {
        return { totalCost: 0, callCount: 0, avgCostPerCall: 0, byProvider: "[]" };
      }

      // Calculate date threshold based on period
      const now = new Date();
      const threshold = new Date(now);
      if (period === "day") threshold.setDate(now.getDate() - 1);
      else if (period === "week") threshold.setDate(now.getDate() - 7);
      else threshold.setMonth(now.getMonth() - 1);

      const thresholdStr = threshold.toISOString();

      // Fetch logs within period
      const logs = (await cds.run(
        SELECT.from(ApiCallLog).where({ timestamp: { ">=": thresholdStr } }),
      )) as { providerKey: string; cost: number }[];

      if (!logs || logs.length === 0) {
        return { totalCost: 0, callCount: 0, avgCostPerCall: 0, byProvider: "[]" };
      }

      // Aggregate
      let totalCost = 0;
      const byProviderMap = new Map<string, { cost: number; count: number }>();

      for (const log of logs) {
        const cost = Number(log.cost) || 0;
        totalCost += cost;
        const existing = byProviderMap.get(log.providerKey) || { cost: 0, count: 0 };
        existing.cost += cost;
        existing.count += 1;
        byProviderMap.set(log.providerKey, existing);
      }

      const byProvider = Array.from(byProviderMap.entries()).map(([key, val]) => ({
        providerKey: key,
        totalCost: Number(val.cost.toFixed(4)),
        callCount: val.count,
      }));

      return {
        totalCost: Number(totalCost.toFixed(4)),
        callCount: logs.length,
        avgCostPerCall: Number((totalCost / logs.length).toFixed(4)),
        byProvider: JSON.stringify(byProvider),
      };
    } catch (err) {
      LOG.error("Failed to compute API cost summary:", err);
      return req.reject(500, "Failed to compute cost summary");
    }
  };

  /**
   * Action handler: get analytics for a specific provider.
   */
  private handleGetProviderAnalytics = async (req: cds.Request) => {
    const { providerKey } = req.data as { providerKey: string };
    if (!providerKey?.trim()) {
      return req.reject(400, "providerKey is required");
    }

    try {
      const entities = cds.entities("auto");
      const ApiCallLog = entities["ApiCallLog"];
      if (!ApiCallLog) {
        return {
          avgResponseTimeMs: 0,
          successRate: 0,
          totalCalls: 0,
          totalCost: 0,
          avgCostPerCall: 0,
          lastCallTimestamp: null,
        };
      }

      // Default 90-day lookback to prevent unbounded query growth
      const lookback = new Date();
      lookback.setDate(lookback.getDate() - 90);
      const lookbackStr = lookback.toISOString();

      const logs = (await cds.run(
        SELECT.from(ApiCallLog).where({ providerKey, timestamp: { ">=": lookbackStr } }),
      )) as {
        httpStatus: number;
        responseTimeMs: number;
        cost: number;
        timestamp: string;
      }[];

      if (!logs || logs.length === 0) {
        return {
          avgResponseTimeMs: 0,
          successRate: 0,
          totalCalls: 0,
          totalCost: 0,
          avgCostPerCall: 0,
          lastCallTimestamp: null,
        };
      }

      let totalResponseTime = 0;
      let totalCost = 0;
      let successCount = 0;
      let lastTimestamp: string | null = null;

      for (const log of logs) {
        totalResponseTime += Number(log.responseTimeMs) || 0;
        totalCost += Number(log.cost) || 0;
        if (log.httpStatus >= 200 && log.httpStatus < 300) {
          successCount++;
        }
        if (log.timestamp && (!lastTimestamp || log.timestamp > lastTimestamp)) {
          lastTimestamp = log.timestamp;
        }
      }

      return {
        avgResponseTimeMs: Math.round(totalResponseTime / logs.length),
        successRate: Number(((successCount / logs.length) * 100).toFixed(2)),
        totalCalls: logs.length,
        totalCost: Number(totalCost.toFixed(4)),
        avgCostPerCall: Number((totalCost / logs.length).toFixed(4)),
        lastCallTimestamp: lastTimestamp,
      };
    } catch (err) {
      LOG.error("Failed to compute provider analytics:", err);
      return req.reject(500, "Failed to compute provider analytics");
    }
  };

  /**
   * Action handler: switch active provider for an adapter interface.
   * Enforces mutual exclusion: only one active provider per interface.
   */
  private handleSwitchProvider = async (req: cds.Request) => {
    const { adapterInterface, newProviderKey } = req.data as {
      adapterInterface: string;
      newProviderKey: string;
    };

    if (!adapterInterface?.trim() || !newProviderKey?.trim()) {
      return req.reject(400, "adapterInterface and newProviderKey are required");
    }

    try {
      const entities = cds.entities("auto");
      const ConfigApiProvider = entities["ConfigApiProvider"];
      if (!ConfigApiProvider) {
        return req.reject(500, "ConfigApiProvider entity not found");
      }

      // Find the new provider
      const newProvider = (await cds.run(
        SELECT.one.from(ConfigApiProvider).where({ key: newProviderKey, adapterInterface }),
      )) as { ID: string; key: string; status: string } | null;

      if (!newProvider) {
        return req.reject(
          404,
          `Provider '${newProviderKey}' not found for interface '${adapterInterface}'`,
        );
      }

      if (newProvider.status === "active") {
        return { success: true, message: "Provider is already active." };
      }

      // Deactivate current active provider(s) for this interface
      const currentActive = (await cds.run(
        SELECT.from(ConfigApiProvider).where({ adapterInterface, status: "active" }),
      )) as { ID: string; key: string }[];

      for (const provider of currentActive || []) {
        await cds.run(
          UPDATE(ConfigApiProvider).set({ status: "inactive" }).where({ ID: provider.ID }),
        );
      }

      // Activate the new provider
      await cds.run(
        UPDATE(ConfigApiProvider).set({ status: "active" }).where({ ID: newProvider.ID }),
      );

      // Invalidate adapter cache so next call resolves the new provider
      invalidateAdapter(adapterInterface);

      // Refresh config cache
      await configCache.refreshTable("ConfigApiProvider");

      // Log the switch in audit trail
      const oldProviderKeys = (currentActive || []).map((p) => p.key).join(", ");
      await logAudit({
        userId: req.user?.id || "system",
        action: "PROVIDER_SWITCHED",
        resource: "ConfigApiProvider",
        details: JSON.stringify({
          adapterInterface,
          oldProvider: oldProviderKeys || "(none)",
          newProvider: newProviderKey,
        }),
      });

      return {
        success: true,
        message: `Provider switched from '${oldProviderKeys || "(none)"}' to '${newProviderKey}' for ${adapterInterface}.`,
      };
    } catch (err) {
      LOG.error("Failed to switch provider:", err);
      return req.reject(500, "Failed to switch provider");
    }
  };

  /**
   * Resolve source table name from fully-qualified CDS entity name.
   */
  private resolveSourceTable(fqn: string): string {
    const parts = fqn.split(".");
    const projectionName = parts[parts.length - 1];
    return ENTITY_TABLE_MAP[projectionName] || projectionName;
  }
}
