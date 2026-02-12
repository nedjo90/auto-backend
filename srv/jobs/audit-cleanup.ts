import cds from "@sap/cds";
import { auditLog } from "../middleware/audit-trail";

const LOG = cds.log("audit-cleanup");

/** Default retention periods (days). */
const DEFAULT_AUDIT_TRAIL_RETENTION_DAYS = 365;
const DEFAULT_API_CALL_LOG_RETENTION_DAYS = 90;

/**
 * Get retention period from ConfigParameter table.
 * Falls back to default if not configured.
 */
export async function getRetentionDays(paramKey: string, defaultDays: number): Promise<number> {
  try {
    const entities = cds.entities("auto");
    const ConfigParameter = entities["ConfigParameter"];
    if (!ConfigParameter) return defaultDays;

    const param = (await cds.run(SELECT.one.from(ConfigParameter).where({ key: paramKey }))) as {
      value: string;
    } | null;

    if (param?.value) {
      const days = parseInt(param.value, 10);
      if (!isNaN(days) && days > 0) return days;
    }
  } catch (err) {
    LOG.warn(`Failed to read ${paramKey} config, using default ${defaultDays}:`, err);
  }
  return defaultDays;
}

/**
 * Calculate the cutoff date for retention.
 */
export function calculateCutoffDate(retentionDays: number): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff.toISOString();
}

/**
 * Delete records older than the cutoff date from a given entity.
 * Returns the number of deleted records.
 */
export async function deleteOldRecords(
  entityName: string,
  timestampField: string,
  cutoffDate: string,
): Promise<number> {
  const entities = cds.entities("auto");
  const entity = entities[entityName];
  if (!entity) {
    LOG.warn(`Entity ${entityName} not found, skipping cleanup`);
    return 0;
  }

  // Count records to delete
  const oldRecords = (await cds.run(
    SELECT.from(entity).where({ [timestampField]: { "<": cutoffDate } }),
  )) as unknown[];

  const count = oldRecords?.length || 0;
  if (count === 0) return 0;

  // Delete old records
  await cds.run(DELETE.from(entity).where({ [timestampField]: { "<": cutoffDate } }));

  return count;
}

/**
 * Run the audit trail cleanup job.
 * Deletes AuditTrailEntry and ApiCallLog records older than configured retention period.
 */
export async function runAuditCleanup(): Promise<{
  auditTrailDeleted: number;
  apiCallLogDeleted: number;
}> {
  LOG.info("Starting audit trail cleanup job...");

  // Get retention periods from config
  const auditRetentionDays = await getRetentionDays(
    "audit_trail_retention_days",
    DEFAULT_AUDIT_TRAIL_RETENTION_DAYS,
  );
  const apiLogRetentionDays = await getRetentionDays(
    "api_call_log_retention_days",
    DEFAULT_API_CALL_LOG_RETENTION_DAYS,
  );

  const auditCutoff = calculateCutoffDate(auditRetentionDays);
  const apiLogCutoff = calculateCutoffDate(apiLogRetentionDays);

  // Delete old records
  const auditTrailDeleted = await deleteOldRecords("AuditTrailEntry", "timestamp", auditCutoff);
  const apiCallLogDeleted = await deleteOldRecords("ApiCallLog", "timestamp", apiLogCutoff);

  // Meta-audit: log the cleanup action itself
  await auditLog({
    action: "audit.cleanup",
    actorId: "system",
    actorRole: "system",
    targetType: "AuditTrailEntry",
    details: {
      auditTrailDeleted,
      apiCallLogDeleted,
      auditRetentionDays,
      apiLogRetentionDays,
      auditCutoff,
      apiLogCutoff,
    },
    severity: "info",
  });

  LOG.info(
    `Audit cleanup complete: ${auditTrailDeleted} audit entries, ${apiCallLogDeleted} API call logs deleted`,
  );

  return { auditTrailDeleted, apiCallLogDeleted };
}
