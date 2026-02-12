import cds from "@sap/cds";

const LOG = cds.log("audit-trail");

/**
 * All auditable action types in the platform.
 */
export const AUDITABLE_ACTIONS = [
  // Listing operations
  "listing.created",
  "listing.published",
  "listing.updated",
  "listing.deleted",
  "listing.moderated",
  // User operations
  "user.registered",
  "user.updated",
  "user.role_changed",
  "user.deactivated",
  // Config operations
  "config.created",
  "config.updated",
  "config.deleted",
  // Payment operations
  "payment.initiated",
  "payment.processed",
  "payment.refunded",
  // Moderation operations
  "moderation.action_taken",
  "moderation.appeal_reviewed",
  // Legal operations
  "legal.version_published",
  "legal.acceptance_recorded",
  // API provider operations
  "api_provider.status_changed",
  // Auth/permission operations
  "permission.denied",
  "alert.acknowledged",
  // Data management
  "data.exported",
  "data.anonymized",
  "audit.cleanup",
] as const;

export type AuditableAction = (typeof AUDITABLE_ACTIONS)[number];

export type AuditSeverity = "info" | "warning" | "critical";

export interface AuditTrailEvent {
  action: AuditableAction | string;
  actorId: string;
  actorRole?: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown> | string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  severity?: AuditSeverity;
}

/**
 * Log an audit trail entry to the AuditTrailEntry entity.
 * Fire-and-forget: errors are logged but do not propagate.
 */
export async function auditLog(event: AuditTrailEvent): Promise<void> {
  try {
    const entities = cds.entities("auto");
    const entity = entities["AuditTrailEntry"];
    if (!entity) {
      LOG.warn("AuditTrailEntry entity not found, skipping audit logging");
      return;
    }

    const detailsStr =
      typeof event.details === "string"
        ? event.details
        : event.details
          ? JSON.stringify(event.details)
          : null;

    await cds.run(
      INSERT.into(entity).entries({
        action: event.action,
        actorId: event.actorId,
        actorRole: event.actorRole || "system",
        targetType: event.targetType,
        targetId: event.targetId || null,
        timestamp: new Date().toISOString(),
        details: detailsStr,
        ipAddress: event.ipAddress || null,
        userAgent: event.userAgent || null,
        requestId: event.requestId || null,
        severity: event.severity || "info",
      }),
    );
  } catch (err) {
    LOG.error("Failed to log audit trail entry:", err);
  }
}

/**
 * Extract audit context from a CDS request.
 */
export function extractAuditContext(req: cds.Request): {
  actorId: string;
  actorRole: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
} {
  const user = req.user;
  const headers = (req as unknown as { headers?: Record<string, string> }).headers || {};

  return {
    actorId: user?.id || "system",
    actorRole: (user as unknown as { roles?: string[] })?.roles?.[0] || "system",
    ipAddress: extractIpAddress(headers),
    userAgent: headers["user-agent"] || undefined,
    requestId: headers["x-request-id"] || undefined,
  };
}

/**
 * Extract client IP address from request headers.
 */
function extractIpAddress(headers: Record<string, string>): string | undefined {
  const forwarded = headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return undefined;
}

/**
 * Backward-compatible adapter for old logAudit interface.
 * Maps old AuditEvent fields to new AuditTrailEvent fields.
 */
export interface LegacyAuditEvent {
  userId: string;
  action: string;
  resource: string;
  details?: string;
  ipAddress?: string;
}

export async function logAudit(event: LegacyAuditEvent): Promise<void> {
  return auditLog({
    action: event.action,
    actorId: event.userId,
    targetType: event.resource,
    details: event.details,
    ipAddress: event.ipAddress,
    severity: "info",
  });
}
