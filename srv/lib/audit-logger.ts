/**
 * Backward-compatible re-export from new audit-trail middleware.
 * All new code should import from "../middleware/audit-trail" directly.
 */
export { logAudit } from "../middleware/audit-trail";
export type { LegacyAuditEvent as AuditEvent } from "../middleware/audit-trail";
