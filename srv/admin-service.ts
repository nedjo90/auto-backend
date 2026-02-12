import cds from "@sap/cds";
import { configCache } from "./lib/config-cache";
import { logAudit } from "./lib/audit-logger";
import { invalidateAdapter } from "./adapters/factory/adapter-factory";
import { signalrClient } from "./lib/signalr-client";
import {
  configAlertInputSchema,
  configSeoTemplateInputSchema,
  publishLegalVersionInputSchema,
} from "@auto/shared";

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
  ConfigAlerts: "ConfigAlert",
  ConfigSeoTemplates: "ConfigSeoTemplate",
  LegalDocuments: "LegalDocument",
  LegalDocumentVersions: "LegalDocumentVersion",
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

    // Validate ConfigAlerts input with Zod schema (full on CREATE, partial on UPDATE)
    this.before("CREATE", "ConfigAlerts", this.validateAlertInput);
    this.before("UPDATE", "ConfigAlerts", this.validateAlertInputPartial);

    // Validate ConfigSeoTemplates input with Zod schema (full on CREATE, partial on UPDATE)
    this.before("CREATE", "ConfigSeoTemplates", this.validateSeoTemplateInput);
    this.before("UPDATE", "ConfigSeoTemplates", this.validateSeoTemplateInputPartial);

    // Register action handlers
    this.on("estimateConfigImpact", this.handleEstimateImpact);
    this.on("getApiCostSummary", this.handleGetApiCostSummary);
    this.on("getProviderAnalytics", this.handleGetProviderAnalytics);
    this.on("switchProvider", this.handleSwitchProvider);
    this.on("getDashboardKpis", this.handleGetDashboardKpis);
    this.on("getDashboardTrend", this.handleGetDashboardTrend);
    this.on("getKpiDrillDown", this.handleGetKpiDrillDown);
    this.on("acknowledgeAlert", this.handleAcknowledgeAlert);
    this.on("getActiveAlerts", this.handleGetActiveAlerts);
    this.on("publishLegalVersion", this.handlePublishLegalVersion);
    this.on("getLegalAcceptanceCount", this.handleGetLegalAcceptanceCount);

    // Initialize SignalR client for real-time admin updates
    signalrClient.initialize();

    await super.init();
  }

  /**
   * BEFORE handler: validate ConfigAlert input with Zod schema (CREATE - full validation).
   */
  private validateAlertInput = (req: cds.Request) => {
    const result = configAlertInputSchema.safeParse(req.data);
    if (!result.success) {
      const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      req.reject(400, `Invalid alert configuration: ${errors.join("; ")}`);
    }
  };

  /**
   * BEFORE handler: validate ConfigAlert input with Zod schema (UPDATE - partial validation).
   */
  private validateAlertInputPartial = (req: cds.Request) => {
    const result = configAlertInputSchema.partial().safeParse(req.data);
    if (!result.success) {
      const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      req.reject(400, `Invalid alert configuration: ${errors.join("; ")}`);
    }
  };

  /**
   * BEFORE handler: validate ConfigSeoTemplate input with Zod schema (CREATE - full validation).
   */
  private validateSeoTemplateInput = (req: cds.Request) => {
    const result = configSeoTemplateInputSchema.safeParse(req.data);
    if (!result.success) {
      const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      req.reject(400, `Invalid SEO template configuration: ${errors.join("; ")}`);
    }
  };

  /**
   * BEFORE handler: validate ConfigSeoTemplate input with Zod schema (UPDATE - partial validation).
   */
  private validateSeoTemplateInputPartial = (req: cds.Request) => {
    const result = configSeoTemplateInputSchema.partial().safeParse(req.data);
    if (!result.success) {
      const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      req.reject(400, `Invalid SEO template configuration: ${errors.join("; ")}`);
    }
  };

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
   * Emit a KPI update event via SignalR to connected admin clients.
   * NOTE: Infrastructure only — will be wired to CDS AFTER handlers
   * when Listing, Contact, Sale entities are added in future epics.
   */
  async emitKpiUpdate(event: string, data: Record<string, unknown>): Promise<void> {
    try {
      await signalrClient.broadcast("kpiUpdate", {
        event,
        ...data,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      LOG.warn("Failed to emit SignalR KPI update:", err);
    }
  }

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
   * Action handler: get dashboard KPIs for a given period.
   * Queries available tables (User, AuditLog, ApiCallLog).
   * Listings, contacts, sales, revenue return 0 until those entities exist.
   */
  private handleGetDashboardKpis = async (req: cds.Request) => {
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

      // Calculate current and previous period thresholds
      const now = new Date();
      const currentStart = new Date(now);
      const previousStart = new Date(now);

      if (period === "day") {
        currentStart.setDate(now.getDate() - 1);
        previousStart.setDate(now.getDate() - 2);
      } else if (period === "week") {
        currentStart.setDate(now.getDate() - 7);
        previousStart.setDate(now.getDate() - 14);
      } else {
        currentStart.setMonth(now.getMonth() - 1);
        previousStart.setMonth(now.getMonth() - 2);
      }

      const currentStartStr = currentStart.toISOString();
      const previousStartStr = previousStart.toISOString();

      // Registrations KPI (from User table)
      const registrations = await this.computeKpi(
        entities["User"],
        "createdAt",
        currentStartStr,
        previousStartStr,
        now.toISOString(),
      );

      // Visitors KPI (from AuditLog - count unique user actions)
      const visitors = await this.computeKpi(
        entities["AuditLog"],
        "timestamp",
        currentStartStr,
        previousStartStr,
        now.toISOString(),
      );

      // Placeholder KPIs for entities that don't exist yet
      const zeroKpi = { current: 0, previous: 0, trend: 0 };

      return {
        visitors,
        registrations,
        listings: zeroKpi,
        contacts: zeroKpi,
        sales: zeroKpi,
        revenue: zeroKpi,
        trafficSources: [],
      };
    } catch (err) {
      LOG.error("Failed to compute dashboard KPIs:", err);
      return req.reject(500, "Failed to compute dashboard KPIs");
    }
  };

  /**
   * Compute a KPI with current/previous period comparison.
   */
  private async computeKpi(
    entity: unknown,
    timestampField: string,
    currentStart: string,
    previousStart: string,
    currentEnd: string,
  ): Promise<{ current: number; previous: number; trend: number }> {
    if (!entity) {
      return { current: 0, previous: 0, trend: 0 };
    }

    const currentRows = (await cds.run(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      SELECT.from(entity as any).where({
        [timestampField]: { ">=": currentStart, "<=": currentEnd },
      }),
    )) as unknown[];

    const previousRows = (await cds.run(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      SELECT.from(entity as any).where({
        [timestampField]: { ">=": previousStart, "<": currentStart },
      }),
    )) as unknown[];

    const current = currentRows?.length || 0;
    const previous = previousRows?.length || 0;
    const trend = previous > 0 ? Number((((current - previous) / previous) * 100).toFixed(1)) : 0;

    return { current, previous, trend };
  }

  /**
   * Action handler: get trend data for a specific metric over N days.
   */
  private handleGetDashboardTrend = async (req: cds.Request) => {
    const { metric, days } = req.data as { metric: string; days: number };
    if (!metric?.trim()) {
      return req.reject(400, "metric is required");
    }
    if (!days || days < 1 || days > 365) {
      return req.reject(400, "days must be between 1 and 365");
    }

    try {
      return await this.aggregateMetricByDate(metric, days);
    } catch (err) {
      LOG.error("Failed to compute dashboard trend:", err);
      return req.reject(500, "Failed to compute dashboard trend");
    }
  };

  /**
   * Action handler: get drill-down data for a specific KPI metric.
   * Returns daily aggregation for the requested period.
   */
  private handleGetKpiDrillDown = async (req: cds.Request) => {
    const { metric, period } = req.data as { metric: string; period: string };
    if (!metric?.trim()) {
      return req.reject(400, "metric is required");
    }
    const validPeriods = ["day", "week", "month"];
    if (!validPeriods.includes(period)) {
      return req.reject(400, `period must be one of: ${validPeriods.join(", ")}`);
    }

    const days = period === "day" ? 1 : period === "week" ? 7 : 30;

    try {
      return await this.aggregateMetricByDate(metric, days);
    } catch (err) {
      LOG.error("Failed to compute KPI drill-down:", err);
      return req.reject(500, "Failed to compute KPI drill-down");
    }
  };

  /**
   * Shared aggregation: query a metric's entity and bucket rows by date.
   * Used by both getDashboardTrend and getKpiDrillDown.
   */
  private async aggregateMetricByDate(
    metric: string,
    days: number,
  ): Promise<{ date: string; value: number }[]> {
    const entities = cds.entities("auto");

    const metricConfig: Record<string, { entity: unknown; timestampField: string }> = {
      visitors: { entity: entities["AuditLog"], timestampField: "timestamp" },
      registrations: { entity: entities["User"], timestampField: "createdAt" },
    };

    const config = metricConfig[metric];
    if (!config?.entity) {
      return this.generateEmptyTrend(days);
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr = startDate.toISOString();

    const rows = (await cds.run(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      SELECT.from(config.entity as any).where({
        [config.timestampField]: { ">=": startStr },
      }),
    )) as { [key: string]: string }[];

    // Aggregate by date
    const countByDate = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - days + i + 1);
      countByDate.set(d.toISOString().split("T")[0], 0);
    }

    for (const row of rows || []) {
      const ts = row[config.timestampField];
      if (ts) {
        const dateKey = new Date(ts).toISOString().split("T")[0];
        if (countByDate.has(dateKey)) {
          countByDate.set(dateKey, (countByDate.get(dateKey) || 0) + 1);
        }
      }
    }

    return Array.from(countByDate.entries()).map(([date, value]) => ({ date, value }));
  }

  /**
   * Generate empty trend data (zeros) for N days.
   */
  private generateEmptyTrend(days: number): { date: string; value: number }[] {
    const result: { date: string; value: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - days + i + 1);
      result.push({ date: d.toISOString().split("T")[0], value: 0 });
    }
    return result;
  }

  /**
   * Action handler: acknowledge an alert event.
   */
  private handleAcknowledgeAlert = async (req: cds.Request) => {
    const { alertEventId } = req.data as { alertEventId: string };
    if (!alertEventId?.trim()) {
      return req.reject(400, "alertEventId is required");
    }

    try {
      const entities = cds.entities("auto");
      const AlertEvent = entities["AlertEvent"];
      if (!AlertEvent) {
        return req.reject(500, "AlertEvent entity not found");
      }

      const event = (await cds.run(SELECT.one.from(AlertEvent).where({ ID: alertEventId }))) as {
        ID: string;
        acknowledged: boolean;
      } | null;

      if (!event) {
        return req.reject(404, "Alert event not found");
      }

      if (event.acknowledged) {
        return { success: true, message: "Alert already acknowledged." };
      }

      const userId = req.user?.id || "system";
      const now = new Date().toISOString();

      await cds.run(
        UPDATE(AlertEvent)
          .set({ acknowledged: true, acknowledgedBy: userId, acknowledgedAt: now })
          .where({ ID: alertEventId }),
      );

      await logAudit({
        userId,
        action: "ALERT_ACKNOWLEDGED",
        resource: "AlertEvent",
        details: JSON.stringify({ alertEventId }),
      });

      return { success: true, message: "Alert acknowledged." };
    } catch (err) {
      LOG.error("Failed to acknowledge alert:", err);
      return req.reject(500, "Failed to acknowledge alert");
    }
  };

  /**
   * Action handler: get unacknowledged alert events.
   */
  private handleGetActiveAlerts = async (req: cds.Request) => {
    try {
      const entities = cds.entities("auto");
      const AlertEvent = entities["AlertEvent"];
      if (!AlertEvent) {
        return [];
      }

      const events = (await cds.run(
        SELECT.from(AlertEvent).where({ acknowledged: false }).orderBy("createdAt desc").limit(50),
      )) as {
        ID: string;
        alertId: string;
        metric: string;
        currentValue: number;
        thresholdValue: number;
        severity: string;
        message: string;
        createdAt: string;
      }[];

      return events || [];
    } catch (err) {
      LOG.error("Failed to get active alerts:", err);
      return req.reject(500, "Failed to get active alerts");
    }
  };

  /**
   * Action handler: publish a new version of a legal document.
   * Atomically increments version, creates version record, archives previous, updates document.
   */
  private handlePublishLegalVersion = async (req: cds.Request) => {
    const { documentId, content, summary, requiresReacceptance } = req.data as {
      documentId: string;
      content: string;
      summary?: string;
      requiresReacceptance?: boolean;
    };

    // Validate input with Zod
    const validation = publishLegalVersionInputSchema.safeParse({
      documentId,
      content,
      summary,
      requiresReacceptance,
    });
    if (!validation.success) {
      const errors = validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      return req.reject(400, `Invalid publish input: ${errors.join("; ")}`);
    }

    try {
      const entities = cds.entities("auto");
      const LegalDocument = entities["LegalDocument"];
      const LegalDocumentVersion = entities["LegalDocumentVersion"];
      if (!LegalDocument || !LegalDocumentVersion) {
        return req.reject(500, "Legal entities not found");
      }

      // Fetch existing document
      const doc = (await cds.run(SELECT.one.from(LegalDocument).where({ ID: documentId }))) as {
        ID: string;
        key: string;
        currentVersion: number;
      } | null;

      if (!doc) {
        return req.reject(404, "Document legal non trouve");
      }

      const newVersion = doc.currentVersion + 1;
      const now = new Date().toISOString();
      const userId = req.user?.id || "system";

      // Archive current version(s)
      await cds.run(
        UPDATE(LegalDocumentVersion)
          .set({ archived: true })
          .where({ document_ID: documentId, archived: false }),
      );

      // Create new version record
      const newVersionId = cds.utils.uuid();
      await cds.run(
        INSERT.into(LegalDocumentVersion).entries({
          ID: newVersionId,
          document_ID: documentId,
          version: newVersion,
          content: validation.data.content,
          summary: validation.data.summary || "",
          publishedAt: now,
          publishedBy: userId,
          archived: false,
        }),
      );

      // Update document master record
      const shouldRequireReacceptance = validation.data.requiresReacceptance ?? true;
      await cds.run(
        UPDATE(LegalDocument)
          .set({
            currentVersion: newVersion,
            requiresReacceptance: shouldRequireReacceptance,
          })
          .where({ ID: documentId }),
      );

      // Log to audit trail
      await logAudit({
        userId,
        action: "LEGAL_VERSION_PUBLISHED",
        resource: "LegalDocumentVersion",
        details: JSON.stringify({
          documentId,
          documentKey: doc.key,
          previousVersion: doc.currentVersion,
          newVersion,
          requiresReacceptance: shouldRequireReacceptance,
        }),
      });

      return {
        ID: newVersionId,
        document_ID: documentId,
        version: newVersion,
        content: validation.data.content,
        summary: validation.data.summary || "",
        publishedAt: now,
        publishedBy: userId,
        archived: false,
      };
    } catch (err) {
      LOG.error("Failed to publish legal version:", err);
      return req.reject(500, "Failed to publish legal version");
    }
  };

  /**
   * Function handler: get acceptance count for a legal document.
   */
  private handleGetLegalAcceptanceCount = async (req: cds.Request) => {
    const { documentId } = req.data as { documentId: string };
    if (!documentId?.trim()) {
      return req.reject(400, "documentId is required");
    }

    try {
      const entities = cds.entities("auto");
      const LegalAcceptance = entities["LegalAcceptance"];
      if (!LegalAcceptance) {
        return 0;
      }

      const rows = (await cds.run(
        SELECT.from(LegalAcceptance).where({ document_ID: documentId }),
      )) as unknown[];

      return rows?.length || 0;
    } catch (err) {
      LOG.error("Failed to count legal acceptances:", err);
      return req.reject(500, "Failed to count acceptances");
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
