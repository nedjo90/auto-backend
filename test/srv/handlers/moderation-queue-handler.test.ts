/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockAuditLog = jest.fn<any, any[]>().mockResolvedValue(undefined);
const mockExtractAuditContext = jest.fn<any, any[]>(() => ({
  actorId: "mod-1",
  actorRole: "moderator",
}));

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        Report: "Report",
        ConfigReportReason: "ConfigReportReason",
        Listing: "Listing",
        User: "User",
        Conversation: "Conversation",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
    },
  };
});

jest.mock("../../../srv/middleware/audit-trail", () => ({
  auditLog: (...args: any[]) => mockAuditLog(...args),
  extractAuditContext: (...args: any[]) => mockExtractAuditContext(...args),
}));

jest.mock("@auto/shared", () => ({
  REPORT_TARGET_TYPES: ["listing", "user", "chat"],
  REPORT_STATUSES: ["pending", "in_progress", "treated", "dismissed"],
  REPORTS_PAGE_SIZE: 20,
}));

// Global CDS query helpers
(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("q"),
      columns: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue("q"),
      }),
    }),
  },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    columns: jest.fn().mockReturnThis(),
  }),
};
(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("q"),
  }),
});

// ─── Import handlers ────────────────────────────────────────────────────────

const {
  handleGetReportQueue,
  handleGetReportMetrics,
  handleGetReportDetail,
  handleAssignReport,
} = require("../../../srv/handlers/moderation-queue-handler");

// ─── Helper ─────────────────────────────────────────────────────────────────

function makeReq(data: Record<string, unknown>, userId = "mod-1") {
  const errors: string[] = [];
  return {
    data,
    user: userId ? { id: userId } : null,
    error: jest.fn((status: number, message: string) => {
      errors.push(message);
      return undefined;
    }),
    _errors: errors,
  } as any;
}

const REPORT_ID = "a0000000-0000-0000-0000-000000000001";
const REPORTER_ID = "b0000000-0000-0000-0000-000000000001";
const TARGET_ID = "c0000000-0000-0000-0000-000000000001";
const REASON_ID = "d0000000-0000-0000-0000-000000000001";

const MOCK_REPORT = {
  ID: REPORT_ID,
  reporterId: REPORTER_ID,
  targetType: "listing",
  targetId: TARGET_ID,
  reasonId: REASON_ID,
  severity: "high",
  description: "Fraudulent listing description",
  status: "pending",
  assignedTo: null,
  createdAt: "2026-02-20T10:00:00.000Z",
  modifiedAt: "2026-02-20T10:00:00.000Z",
};

// ─── Tests: getReportQueue ──────────────────────────────────────────────────

describe("handleGetReportQueue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("returns paginated reports sorted by severity (default)", async () => {
    const reports = [
      { ...MOCK_REPORT, severity: "low", createdAt: "2026-02-20T08:00:00.000Z" },
      { ...MOCK_REPORT, ID: "r2", severity: "critical", createdAt: "2026-02-20T09:00:00.000Z" },
      { ...MOCK_REPORT, ID: "r3", severity: "high", createdAt: "2026-02-20T10:00:00.000Z" },
    ];

    mockRun
      .mockResolvedValueOnce({ cnt: 3 }) // count
      .mockResolvedValueOnce(reports) // reports (will be sorted in-memory)
      .mockResolvedValueOnce([]) // users (batch)
      .mockResolvedValueOnce([]) // reasons (batch)
      .mockResolvedValueOnce([]); // listing targets (batch)

    const req = makeReq({ skip: 0, top: 20 });
    const result = await handleGetReportQueue(req);

    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(false);
    const items = JSON.parse(result.items);
    expect(items).toHaveLength(3);
    // Critical should be first, then high, then low
    expect(items[0].severity).toBe("critical");
    expect(items[1].severity).toBe("high");
    expect(items[2].severity).toBe("low");
  });

  it("filters by status", async () => {
    mockRun
      .mockResolvedValueOnce({ cnt: 1 }) // count
      .mockResolvedValueOnce([MOCK_REPORT]) // reports
      .mockResolvedValueOnce([]) // users
      .mockResolvedValueOnce([]) // reasons
      .mockResolvedValueOnce([]); // listing targets

    const req = makeReq({ status: "pending", skip: 0, top: 20 });
    const result = await handleGetReportQueue(req);

    expect(result.total).toBe(1);
  });

  it("filters by targetType", async () => {
    mockRun
      .mockResolvedValueOnce({ cnt: 1 })
      .mockResolvedValueOnce([MOCK_REPORT])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // listing targets

    const req = makeReq({ targetType: "listing", skip: 0, top: 20 });
    const result = await handleGetReportQueue(req);

    expect(result.total).toBe(1);
  });

  it("filters by severity", async () => {
    mockRun
      .mockResolvedValueOnce({ cnt: 1 })
      .mockResolvedValueOnce([MOCK_REPORT])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // listing targets

    const req = makeReq({ severity: "high", skip: 0, top: 20 });
    const result = await handleGetReportQueue(req);

    expect(result.total).toBe(1);
  });

  it("returns hasMore when more results exist", async () => {
    mockRun
      .mockResolvedValueOnce({ cnt: 25 }) // 25 total
      .mockResolvedValueOnce([MOCK_REPORT]) // first page
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // listing targets

    const req = makeReq({ skip: 0, top: 20 });
    const result = await handleGetReportQueue(req);

    expect(result.hasMore).toBe(true);
  });

  it("enriches reports with reporter names and reason labels", async () => {
    mockRun
      .mockResolvedValueOnce({ cnt: 1 }) // count
      .mockResolvedValueOnce([MOCK_REPORT]) // reports
      .mockResolvedValueOnce([{ ID: REPORTER_ID, firstName: "Jean", lastName: "Dupont" }]) // users
      .mockResolvedValueOnce([{ ID: REASON_ID, label: "Annonce frauduleuse" }]) // reasons
      .mockResolvedValueOnce([{ ID: TARGET_ID, make: "Peugeot", model: "308" }]); // listing target

    const req = makeReq({ skip: 0, top: 20 });
    const result = await handleGetReportQueue(req);

    const items = JSON.parse(result.items);
    expect(items[0].reporterName).toBe("Jean Dupont");
    expect(items[0].reasonLabel).toBe("Annonce frauduleuse");
    expect(items[0].targetLabel).toBe("Peugeot 308");
  });

  it("sorts by date when sortBy is 'date'", async () => {
    mockRun
      .mockResolvedValueOnce({ cnt: 2 }) // count
      .mockResolvedValueOnce([MOCK_REPORT, { ...MOCK_REPORT, ID: "r2" }]) // DB-sorted by date
      .mockResolvedValueOnce([]) // users
      .mockResolvedValueOnce([]) // reasons
      .mockResolvedValueOnce([]); // listing targets

    const req = makeReq({ sortBy: "date", skip: 0, top: 20 });
    const result = await handleGetReportQueue(req);

    expect(result.total).toBe(2);
  });

  it("handles empty queue", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 0 }).mockResolvedValueOnce([]);

    const req = makeReq({ skip: 0, top: 20 });
    const result = await handleGetReportQueue(req);

    expect(result.total).toBe(0);
    expect(JSON.parse(result.items)).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it("ignores invalid filter values", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 0 }).mockResolvedValueOnce([]);

    const req = makeReq({
      status: "invalid_status",
      targetType: "bad",
      severity: "nope",
      skip: 0,
      top: 20,
    });
    const result = await handleGetReportQueue(req);

    // Should still succeed with no filters applied
    expect(result.total).toBe(0);
  });
});

// ─── Tests: getReportMetrics ────────────────────────────────────────────────

describe("handleGetReportMetrics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("returns correct metrics counts", async () => {
    mockRun
      .mockResolvedValueOnce({ cnt: 5 }) // pending
      .mockResolvedValueOnce({ cnt: 3 }) // in_progress
      .mockResolvedValueOnce({ cnt: 10 }) // treated this week
      .mockResolvedValueOnce({ cnt: 2 }) // dismissed this week
      .mockResolvedValueOnce({ cnt: 8 }); // resolved prev week

    const req = makeReq({});
    const result = await handleGetReportMetrics(req);

    expect(result.pendingCount).toBe(5);
    expect(result.inProgressCount).toBe(3);
    expect(result.treatedThisWeek).toBe(10);
    expect(result.dismissedThisWeek).toBe(2);
  });

  it("calculates weekly trend as percentage change", async () => {
    mockRun
      .mockResolvedValueOnce({ cnt: 0 }) // pending
      .mockResolvedValueOnce({ cnt: 0 }) // in_progress
      .mockResolvedValueOnce({ cnt: 8 }) // treated this week
      .mockResolvedValueOnce({ cnt: 4 }) // dismissed this week
      .mockResolvedValueOnce({ cnt: 10 }); // resolved prev week (10)

    const req = makeReq({});
    const result = await handleGetReportMetrics(req);

    // (12 - 10) / 10 * 100 = 20%
    expect(result.weeklyTrend).toBe(20);
  });

  it("returns 100% trend when no previous week data", async () => {
    mockRun
      .mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce({ cnt: 5 })
      .mockResolvedValueOnce({ cnt: 3 })
      .mockResolvedValueOnce({ cnt: 0 }); // no prev week

    const req = makeReq({});
    const result = await handleGetReportMetrics(req);

    expect(result.weeklyTrend).toBe(100);
  });

  it("returns 0% trend when both weeks are zero", async () => {
    mockRun
      .mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce({ cnt: 0 });

    const req = makeReq({});
    const result = await handleGetReportMetrics(req);

    expect(result.weeklyTrend).toBe(0);
  });
});

// ─── Tests: getReportDetail ─────────────────────────────────────────────────

describe("handleGetReportDetail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("returns 400 for invalid reportId", async () => {
    const req = makeReq({ reportId: "bad-id" });
    await handleGetReportDetail(req);
    expect(req.error).toHaveBeenCalledWith(400, "Identifiant de rapport invalide");
  });

  it("returns 404 when report not found", async () => {
    mockRun.mockResolvedValueOnce(null);
    const req = makeReq({ reportId: REPORT_ID });
    await handleGetReportDetail(req);
    expect(req.error).toHaveBeenCalledWith(404, "Rapport introuvable");
  });

  it("returns full report detail for listing target", async () => {
    mockRun
      .mockResolvedValueOnce(MOCK_REPORT) // report
      .mockResolvedValueOnce({ ID: REASON_ID, label: "Fraude" }) // reason
      .mockResolvedValueOnce({
        ID: REPORTER_ID,
        firstName: "Jean",
        lastName: "Dupont",
        email: "jean@test.com",
      }) // reporter
      .mockResolvedValueOnce({ cnt: 2 }) // related reports
      .mockResolvedValueOnce({ ID: TARGET_ID, make: "Peugeot", model: "308" }); // listing target

    const req = makeReq({ reportId: REPORT_ID });
    const result = await handleGetReportDetail(req);
    const detail = JSON.parse(result);

    expect(detail.ID).toBe(REPORT_ID);
    expect(detail.reporterName).toBe("Jean Dupont");
    expect(detail.reporterEmail).toBe("jean@test.com");
    expect(detail.reasonLabel).toBe("Fraude");
    expect(detail.relatedReportsCount).toBe(2);
    expect(detail.targetData).toBeTruthy();
    expect(JSON.parse(detail.targetData).make).toBe("Peugeot");
  });

  it("returns detail for user target", async () => {
    const userReport = { ...MOCK_REPORT, targetType: "user" };
    mockRun
      .mockResolvedValueOnce(userReport) // report
      .mockResolvedValueOnce({ ID: REASON_ID, label: "Spam" }) // reason
      .mockResolvedValueOnce({
        ID: REPORTER_ID,
        firstName: "Marie",
        lastName: "Martin",
        email: "marie@test.com",
      }) // reporter
      .mockResolvedValueOnce({ cnt: 0 }) // related
      .mockResolvedValueOnce({
        ID: TARGET_ID,
        firstName: "Spammer",
        lastName: "User",
        email: "spam@test.com",
        createdAt: "2025-01-01",
      }); // target user

    const req = makeReq({ reportId: REPORT_ID });
    const result = await handleGetReportDetail(req);
    const detail = JSON.parse(result);

    expect(detail.targetType).toBe("user");
    expect(detail.targetData).toBeTruthy();
    expect(JSON.parse(detail.targetData).firstName).toBe("Spammer");
  });

  it("returns null targetData when target entity not found", async () => {
    mockRun
      .mockResolvedValueOnce(MOCK_REPORT) // report
      .mockResolvedValueOnce({ ID: REASON_ID, label: "Fraude" }) // reason
      .mockResolvedValueOnce({
        ID: REPORTER_ID,
        firstName: "Jean",
        lastName: "Dupont",
        email: "jean@test.com",
      }) // reporter
      .mockResolvedValueOnce({ cnt: 0 }) // related
      .mockResolvedValueOnce(null); // listing not found

    const req = makeReq({ reportId: REPORT_ID });
    const result = await handleGetReportDetail(req);
    const detail = JSON.parse(result);

    expect(detail.targetData).toBeNull();
  });
});

// ─── Tests: assignReport ────────────────────────────────────────────────────

describe("handleAssignReport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    const req = makeReq({ reportId: REPORT_ID }, "");
    await handleAssignReport(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("returns 400 for invalid reportId", async () => {
    const req = makeReq({ reportId: "bad" });
    await handleAssignReport(req);
    expect(req.error).toHaveBeenCalledWith(400, "Identifiant de rapport invalide");
  });

  it("returns 404 when report not found", async () => {
    mockRun.mockResolvedValueOnce(null);
    const req = makeReq({ reportId: REPORT_ID });
    await handleAssignReport(req);
    expect(req.error).toHaveBeenCalledWith(404, "Rapport introuvable");
  });

  it("assigns pending report to moderator", async () => {
    mockRun
      .mockResolvedValueOnce({ ...MOCK_REPORT, status: "pending" }) // report
      .mockResolvedValueOnce(undefined); // UPDATE

    const req = makeReq({ reportId: REPORT_ID });
    const result = await handleAssignReport(req);

    expect(result.success).toBe(true);
    expect(result.status).toBe("in_progress");
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "moderation.report_assigned",
        targetId: REPORT_ID,
      }),
    );
  });

  it("allows re-assignment to same moderator", async () => {
    mockRun
      .mockResolvedValueOnce({ ...MOCK_REPORT, status: "in_progress", assignedTo: "mod-1" })
      .mockResolvedValueOnce(undefined);

    const req = makeReq({ reportId: REPORT_ID });
    const result = await handleAssignReport(req);

    expect(result.success).toBe(true);
  });

  it("returns 409 when assigned to another moderator", async () => {
    mockRun.mockResolvedValueOnce({
      ...MOCK_REPORT,
      status: "in_progress",
      assignedTo: "other-mod",
    });

    const req = makeReq({ reportId: REPORT_ID });
    await handleAssignReport(req);
    expect(req.error).toHaveBeenCalledWith(409, expect.stringContaining("autre modérateur"));
  });

  it("returns 400 when report already treated", async () => {
    mockRun.mockResolvedValueOnce({ ...MOCK_REPORT, status: "treated" });

    const req = makeReq({ reportId: REPORT_ID });
    await handleAssignReport(req);
    expect(req.error).toHaveBeenCalledWith(400, "Ce rapport a déjà été traité");
  });
});
