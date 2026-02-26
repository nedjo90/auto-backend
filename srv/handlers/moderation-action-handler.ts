import cds from "@sap/cds";
import { auditLog, extractAuditContext } from "../middleware/audit-trail";
import { createNotification } from "../lib/notification-emitter";

const LOG = cds.log("moderation");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validateUUID(value: string | undefined, label: string, req: cds.Request): boolean {
  if (!value || !UUID_RE.test(value)) {
    req.error(400, `${label} invalide`);
    return false;
  }
  return true;
}

async function createModerationAction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities: Record<string, any>,
  data: {
    reportId: string | null;
    moderatorId: string;
    actionType: string;
    reason: string | null;
    targetType: string;
    targetId: string;
  },
): Promise<string> {
  const actionId = cds.utils.uuid();
  const now = new Date().toISOString();
  await cds.run(
    INSERT.into(entities["ModerationAction"]).entries({
      ID: actionId,
      reportId: data.reportId,
      moderatorId: data.moderatorId,
      actionType: data.actionType,
      reason: data.reason,
      targetType: data.targetType,
      targetId: data.targetId,
      createdAt: now,
      modifiedAt: now,
    }),
  );
  return actionId;
}

async function updateReportStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities: Record<string, any>,
  reportId: string,
  status: string,
): Promise<void> {
  await cds.run(
    UPDATE(entities["Report"])
      .set({ status, modifiedAt: new Date().toISOString() })
      .where({ ID: reportId }),
  );
}

/** CR-Fix #7: Validate report exists and is actionable before proceeding. */
async function validateReport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities: Record<string, any>,
  reportId: string,
  req: cds.Request,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any> | null> {
  const report = await cds.run(SELECT.one.from(entities["Report"]).where({ ID: reportId }));
  if (!report) {
    req.error(404, "Rapport introuvable");
    return null;
  }
  if (report.status === "treated" || report.status === "dismissed") {
    req.error(400, "Rapport deja traite ou rejete");
    return null;
  }
  return report;
}

// ─── deactivateListing ───────────────────────────────────────────────────────

export async function handleDeactivateListing(req: cds.Request) {
  const { reportId, listingId, reason } = req.data as {
    reportId: string;
    listingId: string;
    reason?: string;
  };
  const moderatorId = req.user?.id;
  if (!moderatorId) return req.error(401, "Authentification requise");
  if (!validateUUID(reportId, "Identifiant de rapport", req)) return;
  if (!validateUUID(listingId, "Identifiant d'annonce", req)) return;

  const entities = cds.entities("auto");

  // CR-Fix #7: Validate report exists and is actionable
  const report = await validateReport(entities, reportId, req);
  if (!report) return;

  // Validate listing exists and is active/published
  const listing = await cds.run(
    SELECT.one
      .from(entities["Listing"])
      .columns("ID", "sellerId", "status")
      .where({ ID: listingId }),
  );
  if (!listing) return req.error(404, "Annonce introuvable");
  if (listing.status === "suspended") return req.error(400, "Annonce deja suspendue");
  if (listing.status !== "published")
    return req.error(400, "Seule une annonce publiee peut etre suspendue");

  // Suspend listing
  await cds.run(
    UPDATE(entities["Listing"])
      .set({ status: "suspended", modifiedAt: new Date().toISOString() })
      .where({ ID: listingId }),
  );

  // Create action record
  const actionId = await createModerationAction(entities, {
    reportId,
    moderatorId,
    actionType: "deactivate_listing",
    reason: reason || null,
    targetType: "listing",
    targetId: listingId,
  });

  // Update report status
  await updateReportStatus(entities, reportId, "treated");

  LOG.info(`Listing ${listingId} suspended by moderator ${moderatorId}`);

  // CR-Fix #1: Notification text matches AC specification exactly
  createNotification({
    userId: listing.sellerId,
    type: "system",
    title: "Annonce mise en pause",
    body: "Votre annonce a ete mise en pause pour verification",
    actionUrl: null,
    listingId,
  }).catch(() => {});

  // CR-Fix #2: Include ipAddress, userAgent, requestId in audit log
  const auditCtx = extractAuditContext(req);
  auditLog({
    action: "moderation.action_taken",
    actorId: auditCtx.actorId,
    actorRole: auditCtx.actorRole,
    targetType: "Listing",
    targetId: listingId,
    details: { actionType: "deactivate_listing", reportId, reason },
    severity: "warning",
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
  }).catch(() => {});

  return { success: true, actionId, message: "Annonce suspendue avec succes" };
}

// ─── sendWarning ─────────────────────────────────────────────────────────────

export async function handleSendWarning(req: cds.Request) {
  const { reportId, userId, warningMessage } = req.data as {
    reportId: string;
    userId: string;
    warningMessage?: string;
  };
  const moderatorId = req.user?.id;
  if (!moderatorId) return req.error(401, "Authentification requise");
  if (!validateUUID(reportId, "Identifiant de rapport", req)) return;
  if (!validateUUID(userId, "Identifiant utilisateur", req)) return;

  const entities = cds.entities("auto");

  // CR-Fix #7: Validate report exists and is actionable
  const report = await validateReport(entities, reportId, req);
  if (!report) return;

  // Validate user exists
  const user = await cds.run(
    SELECT.one.from(entities["User"]).columns("ID", "status").where({ ID: userId }),
  );
  if (!user) return req.error(404, "Utilisateur introuvable");

  // T3.3: Use configurable warning template from ConfigModerationRule if no custom message
  let message = warningMessage;
  if (!message) {
    const template = await cds.run(
      SELECT.one
        .from(entities["ConfigModerationRule"])
        .columns("action")
        .where({ key: "warning_default_template", active: true }),
    );
    message =
      (template?.action as string) ||
      "Vous avez recu un avertissement suite a un signalement. Veuillez respecter les regles de la plateforme.";
  }

  // Create action record
  const actionId = await createModerationAction(entities, {
    reportId,
    moderatorId,
    actionType: "warning",
    reason: message,
    targetType: "user",
    targetId: userId,
  });

  // Update report status
  await updateReportStatus(entities, reportId, "treated");

  LOG.info(`Warning sent to user ${userId} by moderator ${moderatorId}`);

  // Notify user
  createNotification({
    userId,
    type: "system",
    title: "Avertissement",
    body: message,
    actionUrl: null,
    listingId: null,
  }).catch(() => {});

  // CR-Fix #2 + #6: Include ipAddress/userAgent/requestId and warningMessage in audit details
  const auditCtx = extractAuditContext(req);
  auditLog({
    action: "moderation.action_taken",
    actorId: auditCtx.actorId,
    actorRole: auditCtx.actorRole,
    targetType: "User",
    targetId: userId,
    details: { actionType: "warning", reportId, warningMessage: message },
    severity: "warning",
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
  }).catch(() => {});

  return { success: true, actionId, message: "Avertissement envoye avec succes" };
}

// ─── deactivateAccount ───────────────────────────────────────────────────────

export async function handleDeactivateAccount(req: cds.Request) {
  const { reportId, userId, reason, confirmed } = req.data as {
    reportId: string;
    userId: string;
    reason?: string;
    confirmed: boolean;
  };
  const moderatorId = req.user?.id;
  if (!moderatorId) return req.error(401, "Authentification requise");
  if (!validateUUID(reportId, "Identifiant de rapport", req)) return;
  if (!validateUUID(userId, "Identifiant utilisateur", req)) return;

  // Double confirmation required (CR-Fix #4: documented as intentional server-side boolean check;
  // moderator role auth already protects against unauthorized access)
  if (!confirmed) {
    return req.error(400, "Confirmation requise pour desactiver un compte");
  }

  const entities = cds.entities("auto");

  // CR-Fix #7: Validate report exists and is actionable
  const report = await validateReport(entities, reportId, req);
  if (!report) return;

  // Validate user exists and is active
  const user = await cds.run(
    SELECT.one.from(entities["User"]).columns("ID", "status").where({ ID: userId }),
  );
  if (!user) return req.error(404, "Utilisateur introuvable");
  if (user.status === "suspended") return req.error(400, "Compte deja suspendu");

  const now = new Date().toISOString();

  // Suspend user account
  await cds.run(
    UPDATE(entities["User"]).set({ status: "suspended", modifiedAt: now }).where({ ID: userId }),
  );

  // Suspend all active listings for this user
  await cds.run(
    UPDATE(entities["Listing"])
      .set({ status: "suspended", modifiedAt: now })
      .where({ sellerId: userId, status: "published" }),
  );

  // Create action record
  const actionId = await createModerationAction(entities, {
    reportId,
    moderatorId,
    actionType: "deactivate_account",
    reason: reason || null,
    targetType: "user",
    targetId: userId,
  });

  // Update report status
  await updateReportStatus(entities, reportId, "treated");

  LOG.info(`Account ${userId} suspended by moderator ${moderatorId}`);

  // Notify user
  createNotification({
    userId,
    type: "system",
    title: "Compte suspendu",
    body: reason
      ? `Votre compte a ete suspendu. Raison : ${reason}`
      : "Votre compte a ete suspendu suite a un examen de moderation.",
    actionUrl: null,
    listingId: null,
  }).catch(() => {});

  // CR-Fix #2: Include ipAddress, userAgent, requestId in audit log
  const auditCtx = extractAuditContext(req);
  auditLog({
    action: "moderation.action_taken",
    actorId: auditCtx.actorId,
    actorRole: auditCtx.actorRole,
    targetType: "User",
    targetId: userId,
    details: { actionType: "deactivate_account", reportId, reason },
    severity: "critical",
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
  }).catch(() => {});

  return { success: true, actionId, message: "Compte suspendu avec succes" };
}

// ─── reactivateListing ───────────────────────────────────────────────────────

export async function handleReactivateListing(req: cds.Request) {
  const { listingId, reason } = req.data as { listingId: string; reason?: string };
  const moderatorId = req.user?.id;
  if (!moderatorId) return req.error(401, "Authentification requise");
  if (!validateUUID(listingId, "Identifiant d'annonce", req)) return;

  const entities = cds.entities("auto");

  const listing = await cds.run(
    SELECT.one
      .from(entities["Listing"])
      .columns("ID", "sellerId", "status")
      .where({ ID: listingId }),
  );
  if (!listing) return req.error(404, "Annonce introuvable");
  if (listing.status !== "suspended")
    return req.error(400, "Seule une annonce suspendue peut etre reactivee");

  // Reactivate listing
  await cds.run(
    UPDATE(entities["Listing"])
      .set({ status: "published", modifiedAt: new Date().toISOString() })
      .where({ ID: listingId }),
  );

  // Create action record
  const actionId = await createModerationAction(entities, {
    reportId: null,
    moderatorId,
    actionType: "reactivate_listing",
    reason: reason || null,
    targetType: "listing",
    targetId: listingId,
  });

  LOG.info(`Listing ${listingId} reactivated by moderator ${moderatorId}`);

  // Notify seller
  createNotification({
    userId: listing.sellerId,
    type: "system",
    title: "Annonce reactivee",
    body: "Votre annonce a ete reactivee. Elle est de nouveau visible sur la plateforme.",
    actionUrl: null,
    listingId,
  }).catch(() => {});

  // CR-Fix #2: Include ipAddress, userAgent, requestId in audit log
  const auditCtx = extractAuditContext(req);
  auditLog({
    action: "moderation.action_taken",
    actorId: auditCtx.actorId,
    actorRole: auditCtx.actorRole,
    targetType: "Listing",
    targetId: listingId,
    details: { actionType: "reactivate_listing", reason },
    severity: "info",
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
  }).catch(() => {});

  return { success: true, actionId, message: "Annonce reactivee avec succes" };
}

// ─── reactivateAccount ───────────────────────────────────────────────────────

export async function handleReactivateAccount(req: cds.Request) {
  const { userId, reason } = req.data as { userId: string; reason?: string };
  const moderatorId = req.user?.id;
  if (!moderatorId) return req.error(401, "Authentification requise");
  if (!validateUUID(userId, "Identifiant utilisateur", req)) return;

  const entities = cds.entities("auto");

  const user = await cds.run(
    SELECT.one.from(entities["User"]).columns("ID", "status").where({ ID: userId }),
  );
  if (!user) return req.error(404, "Utilisateur introuvable");
  if (user.status !== "suspended")
    return req.error(400, "Seul un compte suspendu peut etre reactive");

  // Reactivate account (listings remain suspended per design)
  await cds.run(
    UPDATE(entities["User"])
      .set({ status: "active", modifiedAt: new Date().toISOString() })
      .where({ ID: userId }),
  );

  // Create action record
  const actionId = await createModerationAction(entities, {
    reportId: null,
    moderatorId,
    actionType: "reactivate_account",
    reason: reason || null,
    targetType: "user",
    targetId: userId,
  });

  LOG.info(`Account ${userId} reactivated by moderator ${moderatorId}`);

  // Notify user
  createNotification({
    userId,
    type: "system",
    title: "Compte reactive",
    body: "Votre compte a ete reactive. Vous pouvez de nouveau acceder a la plateforme.",
    actionUrl: null,
    listingId: null,
  }).catch(() => {});

  // CR-Fix #2: Include ipAddress, userAgent, requestId in audit log
  const auditCtx = extractAuditContext(req);
  auditLog({
    action: "moderation.action_taken",
    actorId: auditCtx.actorId,
    actorRole: auditCtx.actorRole,
    targetType: "User",
    targetId: userId,
    details: { actionType: "reactivate_account", reason },
    severity: "info",
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
  }).catch(() => {});

  return { success: true, actionId, message: "Compte reactive avec succes" };
}

// ─── dismissReport ───────────────────────────────────────────────────────────

export async function handleDismissReport(req: cds.Request) {
  const { reportId, reason } = req.data as { reportId: string; reason?: string };
  const moderatorId = req.user?.id;
  if (!moderatorId) return req.error(401, "Authentification requise");
  if (!validateUUID(reportId, "Identifiant de rapport", req)) return;

  const entities = cds.entities("auto");

  const report = await cds.run(SELECT.one.from(entities["Report"]).where({ ID: reportId }));
  if (!report) return req.error(404, "Rapport introuvable");
  if (report.status === "dismissed") return req.error(400, "Rapport deja rejete");
  if (report.status === "treated") return req.error(400, "Rapport deja traite");

  // Create action record
  const actionId = await createModerationAction(entities, {
    reportId,
    moderatorId,
    actionType: "dismiss",
    reason: reason || null,
    targetType: report.targetType,
    targetId: report.targetId,
  });

  // Update report status
  await updateReportStatus(entities, reportId, "dismissed");

  LOG.info(`Report ${reportId} dismissed by moderator ${moderatorId}`);

  // CR-Fix #2: Include ipAddress, userAgent, requestId in audit log
  const auditCtx = extractAuditContext(req);
  auditLog({
    action: "moderation.action_taken",
    actorId: auditCtx.actorId,
    actorRole: auditCtx.actorRole,
    targetType: "Report",
    targetId: reportId,
    details: { actionType: "dismiss", reason },
    severity: "info",
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
  }).catch(() => {});

  return { success: true, actionId, message: "Signalement rejete" };
}
