/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockAuditLog = jest.fn<any, any[]>().mockResolvedValue(undefined);
const mockExtractAuditContext = jest.fn<any, any[]>(() => ({
  actorId: "mod-1",
  actorRole: "moderator",
  ipAddress: "127.0.0.1",
  userAgent: "test-agent",
  requestId: "req-001",
}));

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        Report: "Report",
        Listing: "Listing",
        User: "User",
        ModerationAction: "ModerationAction",
        SellerRating: "SellerRating",
        ConfigReportReason: "ConfigReportReason",
        ConfigModerationRule: "ConfigModerationRule",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => "action-uuid-001" },
    },
  };
});

jest.mock("../../../srv/middleware/audit-trail", () => ({
  auditLog: (...args: any[]) => mockAuditLog(...args),
  extractAuditContext: (...args: any[]) => mockExtractAuditContext(...args),
}));

// Global CDS query helpers (simplified: always return "q" for any chain)
function makeChain() {
  const chain: any = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.columns = jest.fn().mockReturnValue(chain);
  chain.orderBy = jest.fn().mockReturnValue(chain);
  return chain;
}
(global as any).SELECT = { one: makeChain(), ...makeChain() };
(global as any).SELECT.one = makeChain();
(global as any).INSERT = {
  into: jest.fn().mockReturnValue({ entries: jest.fn().mockReturnValue("q") }),
};
(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }),
});

// ─── Import handler ─────────────────────────────────────────────────────────

const {
  handleGetSellerHistory,
} = require("../../../srv/handlers/moderation-seller-history-handler");

// ─── Test data ───────────────────────────────────────────────────────────────

const SELLER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const MOD_ID = "mod-1";

const SELLER = {
  ID: SELLER_ID,
  displayName: "Jean Dupont",
  firstName: "Jean",
  lastName: "Dupont",
  createdAt: "2024-01-15T10:00:00Z",
  status: "active",
};

const LISTINGS = [
  { ID: "listing-1", status: "published", certificationLevel: "tres_documente" },
  { ID: "listing-2", status: "published", certificationLevel: null },
  { ID: "listing-3", status: "suspended", certificationLevel: "bien_documente" },
];

const REPORT_1 = {
  ID: "report-1",
  reasonId: "reason-fraud",
  severity: "high",
  description: "Annonce frauduleuse",
  status: "treated",
  assignedTo: MOD_ID,
  createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
};

const REPORT_2 = {
  ID: "report-2",
  reasonId: "reason-fraud",
  severity: "medium",
  description: "Encore une fraude",
  status: "pending",
  assignedTo: null,
  createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
};

const REPORT_3 = {
  ID: "report-3",
  reasonId: "reason-spam",
  severity: "low",
  description: "Spam",
  status: "dismissed",
  assignedTo: MOD_ID,
  createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
};

const WARNING_ACTION = {
  ID: "action-1",
  reportId: "report-1",
  moderatorId: MOD_ID,
  actionType: "warning",
  reason: "Premier avertissement",
  createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
};

const SUSPEND_ACTION = {
  ID: "action-2",
  reportId: "report-2",
  moderatorId: MOD_ID,
  actionType: "deactivate_account",
  reason: "Suspension",
  createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
};

const REASON_FRAUD = { ID: "reason-fraud", label: "Fraude" };
const REASON_SPAM = { ID: "reason-spam", label: "Spam" };

function makeReq(data: Record<string, any> = {}, userId = MOD_ID) {
  return {
    data,
    user: userId ? { id: userId } : undefined,
    error: jest.fn(),
  } as any;
}

/**
 * Set up mockRun for getSellerHistory call sequence.
 * The call order varies based on whether listings exist (changes Promise.all calls).
 */
function setupMockRun(
  overrides: Partial<{
    seller: any;
    listings: any[];
    directReports: any[];
    listingReports: any[];
    actions: any[];
    listingActions: any[];
    sellerRating: any;
    thresholds: any[];
    reasons: any[];
  }> = {},
) {
  const {
    seller = SELLER,
    listings = [],
    directReports = [],
    listingReports = [],
    actions = [],
    listingActions = [],
    sellerRating = null,
    thresholds = [],
    reasons = [],
  } = overrides;

  const hasListings = listings.length > 0;
  const allReports = [...directReports, ...listingReports];
  const hasReasons = new Set(allReports.map((r: any) => r.reasonId)).size > 0;

  // Sequential calls first
  mockRun.mockResolvedValueOnce(seller); // 1. SELECT.one User
  mockRun.mockResolvedValueOnce(listings); // 2. SELECT Listing

  // Promise.all items (evaluated synchronously in order):
  mockRun.mockResolvedValueOnce(directReports); // 3. directReports (always cds.run)
  if (hasListings) {
    mockRun.mockResolvedValueOnce(listingReports); // 4. listingReports (only if listings exist)
  }
  mockRun.mockResolvedValueOnce(actions); // 5. actions (always cds.run)
  if (hasListings) {
    mockRun.mockResolvedValueOnce(listingActions); // 6. listingActions (only if listings exist)
  }
  mockRun.mockResolvedValueOnce(sellerRating); // 7. sellerRating (always cds.run)
  mockRun.mockResolvedValueOnce(thresholds); // 8. thresholds (inside loadThresholds)

  // Post-Promise.all: reasons lookup (only if reports have reasonIds)
  if (hasReasons) {
    mockRun.mockResolvedValueOnce(reasons); // 9. ConfigReportReason
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe("handleGetSellerHistory", () => {
  it("returns 401 when not authenticated", async () => {
    const req = makeReq({ sellerId: SELLER_ID }, "");
    await handleGetSellerHistory(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("returns 400 for invalid sellerId", async () => {
    const req = makeReq({ sellerId: "not-a-uuid" });
    await handleGetSellerHistory(req);
    expect(req.error).toHaveBeenCalledWith(400, "Identifiant vendeur invalide");
  });

  it("returns 400 for missing sellerId", async () => {
    const req = makeReq({});
    await handleGetSellerHistory(req);
    expect(req.error).toHaveBeenCalledWith(400, "Identifiant vendeur invalide");
  });

  it("returns 404 when seller not found", async () => {
    mockRun.mockResolvedValueOnce(null);
    const req = makeReq({ sellerId: SELLER_ID });
    await handleGetSellerHistory(req);
    expect(req.error).toHaveBeenCalledWith(404, "Vendeur introuvable");
  });

  it("returns seller history with empty data (no listings)", async () => {
    setupMockRun(); // all defaults: empty listings, no reports, no actions

    const req = makeReq({ sellerId: SELLER_ID });
    const result = await handleGetSellerHistory(req);
    const parsed = JSON.parse(result);

    expect(parsed.sellerId).toBe(SELLER_ID);
    expect(parsed.displayName).toBe("Jean Dupont");
    expect(parsed.memberSince).toBe("2024-01-15T10:00:00Z");
    expect(parsed.accountStatus).toBe("active");
    expect(parsed.statistics.totalListings).toBe(0);
    expect(parsed.statistics.activeListings).toBe(0);
    expect(parsed.statistics.reportsReceived).toBe(0);
    expect(parsed.statistics.warningsReceived).toBe(0);
    expect(parsed.statistics.suspensions).toBe(0);
    expect(parsed.statistics.certificationRate).toBe(0);
    expect(parsed.patterns).toEqual([]);
    expect(parsed.timeline).toEqual([]);
  });

  it("returns correct statistics with listings and reports", async () => {
    setupMockRun({
      listings: LISTINGS,
      directReports: [REPORT_1],
      listingReports: [REPORT_2, REPORT_3],
      actions: [WARNING_ACTION],
      listingActions: [],
      reasons: [REASON_FRAUD, REASON_SPAM],
    });

    const req = makeReq({ sellerId: SELLER_ID });
    const result = await handleGetSellerHistory(req);
    const parsed = JSON.parse(result);

    expect(parsed.statistics.totalListings).toBe(3);
    expect(parsed.statistics.activeListings).toBe(2); // 2 published
    expect(parsed.statistics.reportsReceived).toBe(3);
    expect(parsed.statistics.warningsReceived).toBe(1);
    expect(parsed.statistics.suspensions).toBe(0);
    // 2 out of 3 listings have certificationLevel
    expect(parsed.statistics.certificationRate).toBe(67);
  });

  it("builds timeline with reports and actions", async () => {
    setupMockRun({
      listings: LISTINGS,
      directReports: [REPORT_1],
      listingReports: [],
      actions: [WARNING_ACTION],
      listingActions: [],
      reasons: [REASON_FRAUD],
    });

    const req = makeReq({ sellerId: SELLER_ID });
    const result = await handleGetSellerHistory(req);
    const parsed = JSON.parse(result);

    expect(parsed.timeline.length).toBe(2);
    const types = parsed.timeline.map((e: any) => e.eventType);
    expect(types).toContain("report");
    expect(types).toContain("warning");

    // Report event should have reason label
    const reportEvent = parsed.timeline.find((e: any) => e.eventType === "report");
    expect(reportEvent.description).toContain("Fraude");
  });

  it("detects frequent reports pattern", async () => {
    // 3 reports within 30 days = meets default threshold
    setupMockRun({
      directReports: [REPORT_1, REPORT_2, REPORT_3],
      reasons: [REASON_FRAUD, REASON_SPAM],
    });

    const req = makeReq({ sellerId: SELLER_ID });
    const result = await handleGetSellerHistory(req);
    const parsed = JSON.parse(result);

    const frequentPattern = parsed.patterns.find((p: any) => p.type === "frequentReports");
    expect(frequentPattern).toBeDefined();
    expect(frequentPattern.count).toBe(3);
    expect(frequentPattern.severity).toBe("warning");
  });

  it("detects repeated warnings pattern", async () => {
    const warnings = [
      {
        ...WARNING_ACTION,
        ID: "w1",
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      },
      {
        ...WARNING_ACTION,
        ID: "w2",
        createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
      },
    ];
    setupMockRun({
      actions: warnings,
    });

    const req = makeReq({ sellerId: SELLER_ID });
    const result = await handleGetSellerHistory(req);
    const parsed = JSON.parse(result);

    const warningPattern = parsed.patterns.find((p: any) => p.type === "repeatedWarnings");
    expect(warningPattern).toBeDefined();
    expect(warningPattern.count).toBe(2);
    expect(warningPattern.severity).toBe("warning");
  });

  it("detects repeat offender pattern", async () => {
    const suspensions = [
      {
        ...SUSPEND_ACTION,
        ID: "s1",
        createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
      },
      {
        ...SUSPEND_ACTION,
        ID: "s2",
        createdAt: new Date(Date.now() - 120 * 86400000).toISOString(),
      },
    ];
    setupMockRun({
      actions: suspensions,
    });

    const req = makeReq({ sellerId: SELLER_ID });
    const result = await handleGetSellerHistory(req);
    const parsed = JSON.parse(result);

    const offenderPattern = parsed.patterns.find((p: any) => p.type === "repeatOffender");
    expect(offenderPattern).toBeDefined();
    expect(offenderPattern.count).toBe(2);
    expect(offenderPattern.severity).toBe("critical");
  });

  it("detects same reason pattern", async () => {
    const sameReasonReports = [
      { ...REPORT_1, ID: "r1" },
      { ...REPORT_2, ID: "r2" },
      { ...REPORT_3, ID: "r3", reasonId: "reason-fraud" },
    ];
    setupMockRun({
      directReports: sameReasonReports,
      reasons: [REASON_FRAUD],
    });

    const req = makeReq({ sellerId: SELLER_ID });
    const result = await handleGetSellerHistory(req);
    const parsed = JSON.parse(result);

    const sameReasonP = parsed.patterns.find((p: any) => p.type === "sameReasonPattern");
    expect(sameReasonP).toBeDefined();
    expect(sameReasonP.count).toBe(3);
    expect(sameReasonP.severity).toBe("warning");
  });

  it("uses configurable thresholds from ConfigModerationRule", async () => {
    // Set threshold to 5 reports, so 3 reports won't trigger
    setupMockRun({
      directReports: [REPORT_1, REPORT_2, REPORT_3],
      thresholds: [
        { key: "frequentReports.threshold", condition: "5" },
        { key: "frequentReports.periodDays", condition: "30" },
      ],
      reasons: [REASON_FRAUD, REASON_SPAM],
    });

    const req = makeReq({ sellerId: SELLER_ID });
    const result = await handleGetSellerHistory(req);
    const parsed = JSON.parse(result);

    const frequentPattern = parsed.patterns.find((p: any) => p.type === "frequentReports");
    expect(frequentPattern).toBeUndefined();
  });

  it("falls back to firstName+lastName when displayName is null", async () => {
    setupMockRun({
      seller: { ...SELLER, displayName: null },
    });

    const req = makeReq({ sellerId: SELLER_ID });
    const result = await handleGetSellerHistory(req);
    const parsed = JSON.parse(result);
    expect(parsed.displayName).toBe("Jean Dupont");
  });

  it("falls back to 'Vendeur' when no name available", async () => {
    setupMockRun({
      seller: { ...SELLER, displayName: null, firstName: null, lastName: null },
    });

    const req = makeReq({ sellerId: SELLER_ID });
    const result = await handleGetSellerHistory(req);
    const parsed = JSON.parse(result);
    expect(parsed.displayName).toBe("Vendeur");
  });

  it("logs audit trail for seller history access", async () => {
    setupMockRun();

    const req = makeReq({ sellerId: SELLER_ID });
    await handleGetSellerHistory(req);

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "moderation.seller_history_viewed",
        targetType: "User",
        targetId: SELLER_ID,
        ipAddress: "127.0.0.1",
      }),
    );
  });

  it("returns no patterns when seller has clean history", async () => {
    setupMockRun({
      listings: LISTINGS,
    });

    const req = makeReq({ sellerId: SELLER_ID });
    const result = await handleGetSellerHistory(req);
    const parsed = JSON.parse(result);

    expect(parsed.patterns).toEqual([]);
    expect(parsed.statistics.reportsReceived).toBe(0);
  });

  it("escalates frequent reports to critical when double threshold", async () => {
    // 6 reports = 2x the default threshold of 3
    const manyReports = Array.from({ length: 6 }, (_, i) => ({
      ...REPORT_1,
      ID: `report-${i}`,
      createdAt: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
    }));
    setupMockRun({
      directReports: manyReports,
      reasons: [REASON_FRAUD],
    });

    const req = makeReq({ sellerId: SELLER_ID });
    const result = await handleGetSellerHistory(req);
    const parsed = JSON.parse(result);

    const frequentPattern = parsed.patterns.find((p: any) => p.type === "frequentReports");
    expect(frequentPattern).toBeDefined();
    expect(frequentPattern.severity).toBe("critical");
    expect(frequentPattern.count).toBe(6);
  });

  it("combines reports from both user and listing targets", async () => {
    setupMockRun({
      listings: LISTINGS,
      directReports: [REPORT_1],
      listingReports: [REPORT_2],
      actions: [WARNING_ACTION],
      listingActions: [{ ...WARNING_ACTION, ID: "listing-action-1" }],
      reasons: [REASON_FRAUD],
    });

    const req = makeReq({ sellerId: SELLER_ID });
    const result = await handleGetSellerHistory(req);
    const parsed = JSON.parse(result);

    expect(parsed.statistics.reportsReceived).toBe(2);
    expect(parsed.statistics.warningsReceived).toBe(2);
    expect(parsed.timeline.length).toBe(4); // 2 reports + 2 actions
  });
});
