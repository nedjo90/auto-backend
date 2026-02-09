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

    // Register AFTER handlers for cache invalidation + audit logging
    for (const entity of CONFIG_ENTITIES) {
      this.after(["CREATE", "UPDATE", "DELETE"], entity, this.onConfigMutation.bind(this, entity));
    }

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
   * AFTER handler: invalidate cache + log audit for CREATE/UPDATE/DELETE.
   */
  private onConfigMutation = async (projectionName: string, data: unknown, req: cds.Request) => {
    const tableName = ENTITY_TABLE_MAP[projectionName];
    if (!tableName) return;

    // Invalidate cache for the affected table
    try {
      configCache.invalidate(tableName);
      await configCache.refreshTable(tableName);
    } catch (err) {
      LOG.error(`Failed to refresh cache for ${tableName}:`, err);
    }

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
   * Resolve source table name from fully-qualified CDS entity name.
   */
  private resolveSourceTable(fqn: string): string {
    // e.g. "AdminService.ConfigParameters" -> "ConfigParameters" -> "ConfigParameter"
    const parts = fqn.split(".");
    const projectionName = parts[parts.length - 1];
    return ENTITY_TABLE_MAP[projectionName] || projectionName;
  }
}
