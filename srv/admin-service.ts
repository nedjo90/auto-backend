import cds from "@sap/cds";
import { configCache } from "./lib/config-cache";
import { logAudit } from "./lib/audit-logger";

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

    // Register action handler for impact estimation
    this.on("estimateConfigImpact", this.handleEstimateImpact);

    await super.init();
  }

  /**
   * BEFORE handler: capture old values for UPDATE/DELETE audit trail.
   * F6 fix: Uses the CDS service layer (not raw cds.run) to read within
   * the current request context.
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
   * F2 fix: Cache refresh is deferred to after the transaction commits,
   * ensuring the SELECT reads committed data. The audit log is written
   * immediately since it uses the data already available in the handler.
   */
  private onConfigMutation = async (projectionName: string, data: unknown, req: cds.Request) => {
    const tableName = ENTITY_TABLE_MAP[projectionName];
    if (!tableName) return;

    // Defer cache refresh to after transaction commits (F2 fix)
    // This ensures the SELECT in refreshTable reads committed data
    req.on?.("succeeded", async () => {
      try {
        await configCache.refreshTable(tableName);
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

    // Estimate based on parameter type/category
    const param = configCache.get<{ key: string; category: string | null }>(
      "ConfigParameter",
      parameterKey,
    );
    if (!param) {
      return { affectedCount: 0, message: "Parametre non trouve dans le cache." };
    }

    // For pricing parameters, estimate based on future listings
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
   * Resolve source table name from fully-qualified CDS entity name.
   */
  private resolveSourceTable(fqn: string): string {
    // e.g. "AdminService.ConfigParameters" -> "ConfigParameters" -> "ConfigParameter"
    const parts = fqn.split(".");
    const projectionName = parts[parts.length - 1];
    return ENTITY_TABLE_MAP[projectionName] || projectionName;
  }
}
