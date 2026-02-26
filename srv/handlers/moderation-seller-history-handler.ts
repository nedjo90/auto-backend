import cds from "@sap/cds";
import { auditLog, extractAuditContext } from "../middleware/audit-trail";
import type {
  ISellerHistory,
  ISellerStatistics,
  ISellerTimelineEvent,
  IViolationPattern,
  PatternSeverity,
  PatternType,
} from "@auto/shared";

const LOG = cds.log("moderation");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Pattern detection defaults (overridden by ConfigModerationRule) ─────────

interface PatternThresholds {
  frequentReportsThreshold: number;
  frequentReportsPeriodDays: number;
  repeatedWarningsThreshold: number;
  repeatedWarningsPeriodDays: number;
  repeatOffenderSuspensionCount: number;
  sameReasonThreshold: number;
  sameReasonPeriodDays: number;
}

const DEFAULT_THRESHOLDS: PatternThresholds = {
  frequentReportsThreshold: 3,
  frequentReportsPeriodDays: 30,
  repeatedWarningsThreshold: 2,
  repeatedWarningsPeriodDays: 90,
  repeatOffenderSuspensionCount: 2,
  sameReasonThreshold: 3,
  sameReasonPeriodDays: 90,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadThresholds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities: Record<string, any>,
): Promise<PatternThresholds> {
  const thresholds = { ...DEFAULT_THRESHOLDS };

  try {
    const rules = await cds.run(
      SELECT.from(entities["ConfigModerationRule"])
        .columns("key", "condition")
        .where({ active: true }),
    );

    for (const rule of rules) {
      const val = parseInt(rule.condition, 10);
      if (isNaN(val)) continue;

      switch (rule.key) {
        case "frequentReports.threshold":
          thresholds.frequentReportsThreshold = val;
          break;
        case "frequentReports.periodDays":
          thresholds.frequentReportsPeriodDays = val;
          break;
        case "repeatedWarnings.threshold":
          thresholds.repeatedWarningsThreshold = val;
          break;
        case "repeatedWarnings.periodDays":
          thresholds.repeatedWarningsPeriodDays = val;
          break;
        case "repeatOffender.suspensionCount":
          thresholds.repeatOffenderSuspensionCount = val;
          break;
        case "sameReasonPattern.threshold":
          thresholds.sameReasonThreshold = val;
          break;
        case "sameReasonPattern.periodDays":
          thresholds.sameReasonPeriodDays = val;
          break;
      }
    }
  } catch {
    LOG.warn("Failed to load pattern thresholds from ConfigModerationRule, using defaults");
  }

  return thresholds;
}

function detectPatterns(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reports: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: any[],
  thresholds: PatternThresholds,
): IViolationPattern[] {
  const patterns: IViolationPattern[] = [];
  const now = Date.now();

  // Pattern 1: Frequent reports (X reports in last N days)
  const reportPeriodMs = thresholds.frequentReportsPeriodDays * 86400000;
  const recentReports = reports.filter(
    (r) => now - new Date(r.createdAt).getTime() < reportPeriodMs,
  );
  if (recentReports.length >= thresholds.frequentReportsThreshold) {
    const severity: PatternSeverity =
      recentReports.length >= thresholds.frequentReportsThreshold * 2 ? "critical" : "warning";
    patterns.push({
      type: "frequentReports" as PatternType,
      description: `${recentReports.length} signalements en ${thresholds.frequentReportsPeriodDays} jours`,
      count: recentReports.length,
      period: `${thresholds.frequentReportsPeriodDays}j`,
      severity,
    });
  }

  // Pattern 2: Repeated warnings (X warnings in last N days)
  const warningActions = actions.filter((a) => a.actionType === "warning");
  const warningPeriodMs = thresholds.repeatedWarningsPeriodDays * 86400000;
  const recentWarnings = warningActions.filter(
    (a) => now - new Date(a.createdAt).getTime() < warningPeriodMs,
  );
  if (recentWarnings.length >= thresholds.repeatedWarningsThreshold) {
    const severity: PatternSeverity =
      recentWarnings.length >= thresholds.repeatedWarningsThreshold * 2 ? "critical" : "warning";
    patterns.push({
      type: "repeatedWarnings" as PatternType,
      description: `${recentWarnings.length} avertissements en ${thresholds.repeatedWarningsPeriodDays} jours`,
      count: recentWarnings.length,
      period: `${thresholds.repeatedWarningsPeriodDays}j`,
      severity,
    });
  }

  // Pattern 3: Repeat offender (X total suspensions)
  const suspensions = actions.filter((a) => a.actionType === "deactivate_account");
  if (suspensions.length >= thresholds.repeatOffenderSuspensionCount) {
    patterns.push({
      type: "repeatOffender" as PatternType,
      description: `${suspensions.length} suspensions de compte au total`,
      count: suspensions.length,
      period: null,
      severity: "critical",
    });
  }

  // Pattern 4: Same reason pattern (same reasonId appearing X+ times in N days)
  const reasonPeriodMs = thresholds.sameReasonPeriodDays * 86400000;
  const recentReasonReports = reports.filter(
    (r) => now - new Date(r.createdAt).getTime() < reasonPeriodMs,
  );
  const reasonCounts = new Map<string, number>();
  for (const r of recentReasonReports) {
    const cnt = (reasonCounts.get(r.reasonId) || 0) + 1;
    reasonCounts.set(r.reasonId, cnt);
  }
  for (const [, count] of reasonCounts) {
    if (count >= thresholds.sameReasonThreshold) {
      patterns.push({
        type: "sameReasonPattern" as PatternType,
        description: `Meme motif de signalement ${count} fois en ${thresholds.sameReasonPeriodDays} jours`,
        count,
        period: `${thresholds.sameReasonPeriodDays}j`,
        severity: "warning",
      });
      break; // Only report the first matching reason pattern
    }
  }

  return patterns;
}

function buildTimeline(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reports: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: any[],
  reasonMap: Map<string, string>,
): ISellerTimelineEvent[] {
  const events: ISellerTimelineEvent[] = [];

  // Add reports as timeline events
  for (const r of reports) {
    const statusLabel =
      r.status === "treated"
        ? "Traite"
        : r.status === "dismissed"
          ? "Rejete"
          : r.status === "in_progress"
            ? "En cours"
            : "En attente";
    events.push({
      id: r.ID,
      date: r.createdAt,
      eventType: "report",
      description: `Signalement: ${reasonMap.get(r.reasonId) || "Motif inconnu"}`,
      outcome: statusLabel,
      moderatorId: r.assignedTo || null,
      reportId: r.ID,
      reason: r.description || null,
    });
  }

  // Add moderation actions as timeline events
  const actionLabels: Record<string, string> = {
    deactivate_listing: "Annonce suspendue",
    deactivate_account: "Compte suspendu",
    warning: "Avertissement envoye",
    reactivate_listing: "Annonce reactivee",
    reactivate_account: "Compte reactive",
    dismiss: "Signalement rejete",
  };

  for (const a of actions) {
    events.push({
      id: a.ID,
      date: a.createdAt,
      eventType: a.actionType,
      description: actionLabels[a.actionType] || a.actionType,
      outcome: null,
      moderatorId: a.moderatorId,
      reportId: a.reportId || null,
      reason: a.reason || null,
    });
  }

  // Sort by date descending (most recent first)
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return events;
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function handleGetSellerHistory(req: cds.Request) {
  const { sellerId } = req.data as { sellerId: string };
  const moderatorId = req.user?.id;
  if (!moderatorId) return req.error(401, "Authentification requise");
  if (!sellerId || !UUID_RE.test(sellerId)) {
    return req.error(400, "Identifiant vendeur invalide");
  }

  const entities = cds.entities("auto");

  // Fetch seller profile
  const seller = await cds.run(
    SELECT.one
      .from(entities["User"])
      .columns("ID", "displayName", "firstName", "lastName", "createdAt", "status")
      .where({ ID: sellerId }),
  );
  if (!seller) return req.error(404, "Vendeur introuvable");

  // Fetch seller's listing IDs for cross-referencing reports
  const listings = await cds.run(
    SELECT.from(entities["Listing"])
      .columns("ID", "status", "certificationLevel")
      .where({ sellerId }),
  );
  const listingIds: string[] = listings.map((l: { ID: string }) => l.ID);

  // Fetch all reports against this seller or their listings in parallel
  const [directReports, listingReports, actions, listingActions, sellerRatingRow, thresholds] =
    await Promise.all([
      // Reports targeting the seller directly
      cds.run(
        SELECT.from(entities["Report"])
          .columns("ID", "reasonId", "severity", "description", "status", "assignedTo", "createdAt")
          .where({ targetType: "user", targetId: sellerId })
          .orderBy("createdAt desc"),
      ),
      // Reports targeting seller's listings
      listingIds.length > 0
        ? cds.run(
            SELECT.from(entities["Report"])
              .columns(
                "ID",
                "reasonId",
                "severity",
                "description",
                "status",
                "assignedTo",
                "createdAt",
              )
              .where({ targetType: "listing", targetId: { in: listingIds } })
              .orderBy("createdAt desc"),
          )
        : Promise.resolve([]),
      // Actions targeting the seller directly
      cds.run(
        SELECT.from(entities["ModerationAction"])
          .columns("ID", "reportId", "moderatorId", "actionType", "reason", "createdAt")
          .where({ targetType: "user", targetId: sellerId })
          .orderBy("createdAt desc"),
      ),
      // Actions targeting seller's listings
      listingIds.length > 0
        ? cds.run(
            SELECT.from(entities["ModerationAction"])
              .columns("ID", "reportId", "moderatorId", "actionType", "reason", "createdAt")
              .where({ targetType: "listing", targetId: { in: listingIds } })
              .orderBy("createdAt desc"),
          )
        : Promise.resolve([]),
      // Seller rating
      cds
        .run(
          SELECT.one
            .from(entities["SellerRating"])
            .columns("overallRating")
            .where({ user_ID: sellerId }),
        )
        .catch(() => null),
      // Load configurable thresholds
      loadThresholds(entities),
    ]);

  const allReports = [...directReports, ...listingReports];
  const allActions = [...actions, ...listingActions];

  // Build reason label map for timeline
  const reasonIds = [...new Set(allReports.map((r: { reasonId: string }) => r.reasonId))];
  let reasonMap = new Map<string, string>();
  if (reasonIds.length > 0) {
    const reasons = await cds.run(
      SELECT.from(entities["ConfigReportReason"])
        .columns("ID", "label")
        .where({ ID: { in: reasonIds } }),
    );
    reasonMap = new Map(reasons.map((r: { ID: string; label: string }) => [r.ID, r.label]));
  }

  // Compute statistics
  const totalListings = listings.length;
  const activeListings = listings.filter(
    (l: { status: string }) => l.status === "published",
  ).length;
  const warningCount = allActions.filter(
    (a: { actionType: string }) => a.actionType === "warning",
  ).length;
  const suspensionCount = allActions.filter(
    (a: { actionType: string }) => a.actionType === "deactivate_account",
  ).length;

  // Certification rate: percentage of listings with a certificationLevel set
  const certifiedListings = listings.filter(
    (l: { certificationLevel: string | null }) => l.certificationLevel != null,
  ).length;
  const certificationRate =
    totalListings > 0 ? Math.round((certifiedListings / totalListings) * 100) : 0;

  const statistics: ISellerStatistics = {
    totalListings,
    activeListings,
    reportsReceived: allReports.length,
    warningsReceived: warningCount,
    suspensions: suspensionCount,
    certificationRate,
  };

  // Detect patterns
  const patterns = detectPatterns(allReports, allActions, thresholds);

  // Build timeline
  const timeline = buildTimeline(allReports, allActions, reasonMap);

  const displayName =
    seller.displayName ||
    [seller.firstName, seller.lastName].filter(Boolean).join(" ") ||
    "Vendeur";

  const sellerRating =
    sellerRatingRow && typeof sellerRatingRow.overallRating === "number"
      ? sellerRatingRow.overallRating
      : null;

  const result: ISellerHistory = {
    sellerId: seller.ID,
    displayName,
    memberSince: seller.createdAt,
    accountStatus: seller.status || "active",
    sellerRating,
    statistics,
    patterns,
    timeline,
  };

  LOG.info(`Seller history viewed for ${sellerId} by moderator ${moderatorId}`);

  // Audit log: track moderator access to seller history
  const auditCtx = extractAuditContext(req);
  auditLog({
    action: "moderation.seller_history_viewed",
    actorId: auditCtx.actorId,
    actorRole: auditCtx.actorRole,
    targetType: "User",
    targetId: sellerId,
    details: { sellerId },
    severity: "info",
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
  }).catch(() => {});

  return JSON.stringify(result);
}
