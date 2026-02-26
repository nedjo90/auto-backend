import cds from "@sap/cds";
import type { ReportSeverity } from "@auto/shared";
import {
  REPORT_TARGET_TYPES,
  MAX_REPORTS_PER_USER_PER_DAY,
  REPORT_DESCRIPTION_MIN_LENGTH,
  REPORT_DESCRIPTION_MAX_LENGTH,
} from "@auto/shared";
import { auditLog, extractAuditContext } from "../middleware/audit-trail";
import { createNotification } from "../lib/notification-emitter";

const LOG = cds.log("moderation");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── submitReport ──────────────────────────────────────────────────────────────

export async function handleSubmitReport(req: cds.Request) {
  const { targetType, targetId, reasonId, description } = req.data as {
    targetType: string;
    targetId: string;
    reasonId: string;
    description: string;
  };

  const userId = req.user?.id;
  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  // Validate targetType
  if (!REPORT_TARGET_TYPES.includes(targetType as (typeof REPORT_TARGET_TYPES)[number])) {
    return req.error(400, "Type de cible invalide");
  }

  // Validate targetId
  if (!targetId || !UUID_RE.test(targetId)) {
    return req.error(400, "Identifiant de cible invalide");
  }

  // Validate reasonId
  if (!reasonId || !UUID_RE.test(reasonId)) {
    return req.error(400, "Raison de signalement invalide");
  }

  // Validate description
  if (!description || description.trim().length < REPORT_DESCRIPTION_MIN_LENGTH) {
    return req.error(
      400,
      `La description doit contenir au moins ${REPORT_DESCRIPTION_MIN_LENGTH} caractères`,
    );
  }
  if (description.length > REPORT_DESCRIPTION_MAX_LENGTH) {
    return req.error(
      400,
      `La description ne doit pas dépasser ${REPORT_DESCRIPTION_MAX_LENGTH} caractères`,
    );
  }

  const entities = cds.entities("auto");

  // Check reason exists and is active
  const reason = await cds.run(
    SELECT.one.from(entities["ConfigReportReason"]).where({ ID: reasonId, active: true }),
  );
  if (!reason) {
    return req.error(400, "Raison de signalement invalide ou inactive");
  }

  // Prevent self-reporting (only for listing targets)
  if (targetType === "listing") {
    const listing = await cds.run(
      SELECT.one.from(entities["Listing"]).columns("sellerId").where({ ID: targetId }),
    );
    if (!listing) {
      return req.error(404, "Annonce introuvable");
    }
    if (listing.sellerId === userId) {
      return req.error(400, "Vous ne pouvez pas signaler votre propre annonce");
    }
  }

  // Rate limiting: max reports per user per day
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayStartStr = dayStart.toISOString();

  const todayCount = await cds.run(
    SELECT.one
      .from(entities["Report"])
      .columns("count(*) as cnt")
      .where({ reporterId: userId, createdAt: { ">=": dayStartStr } }),
  );

  if (todayCount && todayCount.cnt >= MAX_REPORTS_PER_USER_PER_DAY) {
    return req.error(429, "Vous avez atteint la limite de signalements pour aujourd'hui");
  }

  // Check for duplicate report (same reporter, same target)
  const duplicate = await cds.run(
    SELECT.one.from(entities["Report"]).where({
      reporterId: userId,
      targetType,
      targetId,
      status: { in: ["pending", "in_progress"] },
    }),
  );
  if (duplicate) {
    return req.error(409, "Vous avez déjà signalé cette cible");
  }

  // Create the report
  const reportId = cds.utils.uuid();
  const now = new Date().toISOString();
  const severity = (reason.severity as ReportSeverity) ?? "medium";

  await cds.run(
    INSERT.into(entities["Report"]).entries({
      ID: reportId,
      reporterId: userId,
      targetType,
      targetId,
      reasonId,
      severity,
      description: description.trim(),
      status: "pending",
      createdAt: now,
      modifiedAt: now,
    }),
  );

  LOG.info(`Report ${reportId} created by user ${userId} for ${targetType}/${targetId}`);

  // Fire-and-forget: audit log
  const auditCtx = extractAuditContext(req);
  auditLog({
    action: "moderation.report_submitted",
    actorId: auditCtx.actorId,
    actorRole: auditCtx.actorRole,
    targetType: "Report",
    targetId: reportId,
    details: { targetType, targetId, reasonKey: reason.key, severity },
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
    severity: "info",
  }).catch(() => {});

  // Fire-and-forget: confirmation notification to reporter
  createNotification({
    userId,
    type: "system",
    title: "Signalement enregistré",
    body: "Votre signalement a été enregistré. Notre équipe l'examinera dans les plus brefs délais.",
    actionUrl: null,
    listingId: targetType === "listing" ? targetId : null,
  }).catch(() => {});

  return {
    reportId,
    status: "pending",
    createdAt: now,
  };
}
