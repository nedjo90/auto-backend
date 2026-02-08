import cds from "@sap/cds";

export interface AuditEvent {
  userId: string;
  action: string;
  resource: string;
  details?: string;
  ipAddress?: string;
}

/**
 * Logs an audit event to the AuditLog entity.
 * Used by RBAC middleware and other sensitive operations.
 */
export async function logAudit(event: AuditEvent): Promise<void> {
  try {
    const { AuditLog } = cds.entities("auto");
    await cds.run(
      INSERT.into(AuditLog).entries({
        ID: cds.utils.uuid(),
        userId: event.userId,
        action: event.action,
        resource: event.resource,
        details: event.details || null,
        ipAddress: event.ipAddress || null,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[audit-logger] Failed to log audit event:", error);
  }
}
