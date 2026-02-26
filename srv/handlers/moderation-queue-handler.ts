import cds from "@sap/cds";
import type { ReportStatus, ReportTargetType, ReportSortOption } from "@auto/shared";
import { REPORTS_PAGE_SIZE, REPORT_STATUSES, REPORT_TARGET_TYPES } from "@auto/shared";
import { auditLog, extractAuditContext } from "../middleware/audit-trail";

const LOG = cds.log("moderation");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Severity sort priority (lower = more urgent). */
const SEVERITY_ORDER: Record<string, number> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

const VALID_SEVERITIES = ["critical", "high", "medium", "low"];

// ─── getReportQueue ──────────────────────────────────────────────────────────

export async function handleGetReportQueue(req: cds.Request) {
  const data = req.data as {
    status?: string;
    targetType?: string;
    severity?: string;
    sortBy?: string;
    skip?: number;
    top?: number;
  };

  const status = data.status;
  const targetType = data.targetType;
  const severity = data.severity;
  const sortBy = data.sortBy;
  const skip = Math.max(0, data.skip ?? 0);
  const top = Math.min(100, Math.max(1, data.top ?? REPORTS_PAGE_SIZE));

  const entities = cds.entities("auto");
  const conditions: Record<string, unknown>[] = [];

  // Apply filters
  if (status && REPORT_STATUSES.includes(status as ReportStatus)) {
    conditions.push({ status });
  }
  if (targetType && REPORT_TARGET_TYPES.includes(targetType as ReportTargetType)) {
    conditions.push({ targetType });
  }
  if (severity && VALID_SEVERITIES.includes(severity)) {
    conditions.push({ severity });
  }

  // Count total matching reports
  const countQuery = SELECT.one.from(entities["Report"]).columns("count(*) as cnt");
  if (conditions.length > 0) {
    countQuery.where(conditions);
  }
  const countResult = await cds.run(countQuery);
  const total = countResult?.cnt || 0;

  // Determine sort: severity-based requires in-memory sort, date and status can be DB sorted
  const validSorts: ReportSortOption[] = ["severity", "date", "status"];
  const effectiveSort = validSorts.includes(sortBy as ReportSortOption)
    ? (sortBy as ReportSortOption)
    : "severity";

  let reports: Record<string, unknown>[];

  if (effectiveSort === "date") {
    // DB sort by createdAt desc
    const query = SELECT.from(entities["Report"]).orderBy("createdAt desc").limit(top, skip);
    if (conditions.length > 0) query.where(conditions);
    reports = await cds.run(query);
  } else if (effectiveSort === "status") {
    // DB sort by status then createdAt desc
    const query = SELECT.from(entities["Report"])
      .orderBy("status asc", "createdAt desc")
      .limit(top, skip);
    if (conditions.length > 0) query.where(conditions);
    reports = await cds.run(query);
  } else {
    // severity sort: fetch all matching, sort in-memory by severity priority then date, then paginate
    const query = SELECT.from(entities["Report"]).orderBy("createdAt asc");
    if (conditions.length > 0) query.where(conditions);
    const allReports: Record<string, unknown>[] = await cds.run(query);

    allReports.sort((a, b) => {
      const aPriority = SEVERITY_ORDER[a.severity as string] ?? 99;
      const bPriority = SEVERITY_ORDER[b.severity as string] ?? 99;
      if (aPriority !== bPriority) return aPriority - bPriority;
      // Tie-break: oldest first
      return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    });

    reports = allReports.slice(skip, skip + top);
  }

  // Batch-enrich with reporter names and reason labels
  const reporterIds = [...new Set(reports.map((r) => r.reporterId as string))];
  const reasonIds = [...new Set(reports.map((r) => r.reasonId as string))];

  const [users, reasons] = await Promise.all([
    reporterIds.length > 0
      ? cds.run(
          SELECT.from(entities["User"])
            .columns("ID", "firstName", "lastName")
            .where({ ID: { in: reporterIds } }),
        )
      : [],
    reasonIds.length > 0
      ? cds.run(
          SELECT.from(entities["ConfigReportReason"])
            .columns("ID", "label")
            .where({ ID: { in: reasonIds } }),
        )
      : [],
  ]);

  const userMap = new Map<string, string>();
  for (const u of users as { ID: string; firstName?: string; lastName?: string }[]) {
    userMap.set(
      u.ID,
      [u.firstName, u.lastName].filter(Boolean).join(" ") || (null as unknown as string),
    );
  }

  const reasonMap = new Map<string, string>();
  for (const r of reasons as { ID: string; label: string }[]) {
    reasonMap.set(r.ID, r.label);
  }

  // Enrich target labels
  const listingTargetIds = reports
    .filter((r) => r.targetType === "listing")
    .map((r) => r.targetId as string);
  const userTargetIds = reports
    .filter((r) => r.targetType === "user")
    .map((r) => r.targetId as string);

  const targetLabelMap = new Map<string, string>();

  if (listingTargetIds.length > 0) {
    const listings = (await cds.run(
      SELECT.from(entities["Listing"])
        .columns("ID", "make", "model")
        .where({ ID: { in: listingTargetIds } }),
    )) as { ID: string; make?: string; model?: string }[];
    for (const l of listings) {
      targetLabelMap.set(l.ID, [l.make, l.model].filter(Boolean).join(" ") || "Annonce");
    }
  }

  if (userTargetIds.length > 0) {
    const targetUsers = (await cds.run(
      SELECT.from(entities["User"])
        .columns("ID", "firstName", "lastName")
        .where({ ID: { in: userTargetIds } }),
    )) as { ID: string; firstName?: string; lastName?: string }[];
    for (const u of targetUsers) {
      targetLabelMap.set(
        u.ID,
        [u.firstName, u.lastName].filter(Boolean).join(" ") || "Utilisateur",
      );
    }
  }

  const items = reports.map((r) => ({
    ID: r.ID,
    reporterId: r.reporterId,
    reporterName: userMap.get(r.reporterId as string) || null,
    targetType: r.targetType,
    targetId: r.targetId,
    targetLabel: targetLabelMap.get(r.targetId as string) || null,
    reasonId: r.reasonId,
    reasonLabel: reasonMap.get(r.reasonId as string) || "",
    severity: r.severity,
    description: r.description,
    status: r.status,
    assignedTo: r.assignedTo || null,
    createdAt: r.createdAt,
    updatedAt: r.modifiedAt || null,
  }));

  return {
    items: JSON.stringify(items),
    total,
    hasMore: skip + top < total,
  };
}

// ─── getReportMetrics ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handleGetReportMetrics(req: cds.Request) {
  const entities = cds.entities("auto");

  // Calculate week start (Monday 00:00 UTC)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - diffToMonday);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartStr = weekStart.toISOString();

  // Previous week start
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekStartStr = prevWeekStart.toISOString();

  // Execute all queries in parallel
  const [
    pendingResult,
    inProgressResult,
    treatedThisWeekResult,
    dismissedThisWeekResult,
    treatedPrevWeekResult,
  ] = await Promise.all([
    cds.run(
      SELECT.one.from(entities["Report"]).columns("count(*) as cnt").where({ status: "pending" }),
    ),
    cds.run(
      SELECT.one
        .from(entities["Report"])
        .columns("count(*) as cnt")
        .where({ status: "in_progress" }),
    ),
    cds.run(
      SELECT.one
        .from(entities["Report"])
        .columns("count(*) as cnt")
        .where({ status: "treated", modifiedAt: { ">=": weekStartStr } }),
    ),
    cds.run(
      SELECT.one
        .from(entities["Report"])
        .columns("count(*) as cnt")
        .where({ status: "dismissed", modifiedAt: { ">=": weekStartStr } }),
    ),
    cds.run(
      SELECT.one
        .from(entities["Report"])
        .columns("count(*) as cnt")
        .where({
          status: { in: ["treated", "dismissed"] },
          modifiedAt: { ">=": prevWeekStartStr, "<": weekStartStr },
        }),
    ),
  ]);

  const treatedThisWeek = treatedThisWeekResult?.cnt || 0;
  const dismissedThisWeek = dismissedThisWeekResult?.cnt || 0;
  const resolvedThisWeek = treatedThisWeek + dismissedThisWeek;
  const resolvedPrevWeek = treatedPrevWeekResult?.cnt || 0;

  // Weekly trend: percentage change
  let weeklyTrend = 0;
  if (resolvedPrevWeek > 0) {
    weeklyTrend = Math.round(((resolvedThisWeek - resolvedPrevWeek) / resolvedPrevWeek) * 100);
  } else if (resolvedThisWeek > 0) {
    weeklyTrend = 100;
  }

  return {
    pendingCount: pendingResult?.cnt || 0,
    inProgressCount: inProgressResult?.cnt || 0,
    treatedThisWeek,
    dismissedThisWeek,
    weeklyTrend,
  };
}

// ─── getReportDetail ─────────────────────────────────────────────────────────

export async function handleGetReportDetail(req: cds.Request) {
  const { reportId } = req.data as { reportId: string };

  if (!reportId || !UUID_RE.test(reportId)) {
    return req.error(400, "Identifiant de rapport invalide");
  }

  const entities = cds.entities("auto");

  const report = await cds.run(SELECT.one.from(entities["Report"]).where({ ID: reportId }));
  if (!report) {
    return req.error(404, "Rapport introuvable");
  }

  // Fetch reason, reporter, related reports in parallel
  const [reason, reporter, relatedCountResult] = await Promise.all([
    cds.run(SELECT.one.from(entities["ConfigReportReason"]).where({ ID: report.reasonId })),
    cds.run(SELECT.one.from(entities["User"]).where({ ID: report.reporterId })),
    cds.run(
      SELECT.one
        .from(entities["Report"])
        .columns("count(*) as cnt")
        .where({
          targetType: report.targetType,
          targetId: report.targetId,
          ID: { "!=": reportId },
        }),
    ),
  ]);

  // Fetch target data based on type
  let targetData: string | null = null;
  if (report.targetType === "listing") {
    const listing = await cds.run(
      SELECT.one.from(entities["Listing"]).where({ ID: report.targetId }),
    );
    if (listing) {
      targetData = JSON.stringify(listing);
    }
  } else if (report.targetType === "user") {
    const targetUser = await cds.run(
      SELECT.one
        .from(entities["User"])
        .columns("ID", "firstName", "lastName", "email", "createdAt")
        .where({ ID: report.targetId }),
    );
    if (targetUser) {
      targetData = JSON.stringify(targetUser);
    }
  } else if (report.targetType === "chat") {
    const conversation = await cds.run(
      SELECT.one.from(entities["Conversation"]).where({ ID: report.targetId }),
    );
    if (conversation) {
      targetData = JSON.stringify(conversation);
    }
  }

  const detail = {
    ID: report.ID,
    reporterId: report.reporterId,
    reporterName: reporter
      ? [reporter.firstName, reporter.lastName].filter(Boolean).join(" ") || null
      : null,
    reporterEmail: reporter?.email || null,
    targetType: report.targetType,
    targetId: report.targetId,
    targetLabel: null as string | null,
    reasonId: report.reasonId,
    reasonLabel: reason?.label || "",
    severity: report.severity,
    description: report.description,
    status: report.status,
    assignedTo: report.assignedTo || null,
    createdAt: report.createdAt,
    updatedAt: report.modifiedAt || null,
    targetData,
    relatedReportsCount: relatedCountResult?.cnt || 0,
  };

  return JSON.stringify(detail);
}

// ─── assignReport ────────────────────────────────────────────────────────────

export async function handleAssignReport(req: cds.Request) {
  const { reportId } = req.data as { reportId: string };
  const moderatorId = req.user?.id;

  if (!moderatorId) {
    return req.error(401, "Authentification requise");
  }

  if (!reportId || !UUID_RE.test(reportId)) {
    return req.error(400, "Identifiant de rapport invalide");
  }

  const entities = cds.entities("auto");

  const report = await cds.run(SELECT.one.from(entities["Report"]).where({ ID: reportId }));
  if (!report) {
    return req.error(404, "Rapport introuvable");
  }

  // Only assign if pending or already assigned to this moderator
  if (
    report.status !== "pending" &&
    !(report.status === "in_progress" && report.assignedTo === moderatorId)
  ) {
    // Already assigned to another moderator
    if (report.status === "in_progress" && report.assignedTo !== moderatorId) {
      return req.error(409, "Ce rapport est déjà en cours de traitement par un autre modérateur");
    }
    // Already treated/dismissed
    if (report.status === "treated" || report.status === "dismissed") {
      return req.error(400, "Ce rapport a déjà été traité");
    }
  }

  // Update report status and assignment
  const now = new Date().toISOString();
  await cds.run(
    UPDATE(entities["Report"])
      .set({ status: "in_progress", assignedTo: moderatorId, modifiedAt: now })
      .where({ ID: reportId }),
  );

  LOG.info(`Report ${reportId} assigned to moderator ${moderatorId}`);

  // Fire-and-forget audit log
  const auditCtx = extractAuditContext(req);
  auditLog({
    action: "moderation.report_assigned",
    actorId: auditCtx.actorId,
    actorRole: auditCtx.actorRole,
    targetType: "Report",
    targetId: reportId,
    details: { moderatorId },
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
    severity: "info",
  }).catch(() => {});

  return {
    success: true,
    status: "in_progress",
  };
}
