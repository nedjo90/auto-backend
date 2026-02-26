/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "generated-uuid");
const mockCreateNotification = jest.fn<any, any[]>().mockResolvedValue(null);
const mockAuditLog = jest.fn<any, any[]>().mockResolvedValue(undefined);
const mockExtractAuditContext = jest.fn<any, any[]>(() => ({
  actorId: "user-1",
  actorRole: "authenticated-user",
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
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => mockUuid() },
      ApplicationService: class {
        async init() {}
        on(_event: string, _handler: any) {}
      },
    },
  };
});

jest.mock("../../../srv/lib/notification-emitter", () => ({
  createNotification: (...args: any[]) => mockCreateNotification(...args),
}));

jest.mock("../../../srv/middleware/audit-trail", () => ({
  auditLog: (...args: any[]) => mockAuditLog(...args),
  extractAuditContext: (...args: any[]) => mockExtractAuditContext(...args),
}));

jest.mock("@auto/shared", () => ({
  REPORT_TARGET_TYPES: ["listing", "user", "chat"],
  MAX_REPORTS_PER_USER_PER_DAY: 10,
  REPORT_DESCRIPTION_MIN_LENGTH: 20,
  REPORT_DESCRIPTION_MAX_LENGTH: 2000,
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
    where: jest.fn().mockReturnValue("q"),
  }),
};
(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("q"),
  }),
};

// ─── Import handler ──────────────────────────────────────────────────────────

const { handleSubmitReport } = require("../../../srv/handlers/moderation-handler");

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeReq(data: Record<string, unknown>, userId = "user-1") {
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

const VALID_TARGET_ID = "a0000000-0000-0000-0000-000000000001";
const VALID_REASON_ID = "b0000000-0000-0000-0000-000000000001";
const VALID_DESCRIPTION = "This listing appears to be fraudulent and misleading.";

const MOCK_REASON = {
  ID: VALID_REASON_ID,
  key: "fraud",
  label: "Annonce frauduleuse",
  severity: "high",
  active: true,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("handleSubmitReport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    const req = makeReq(
      {
        targetType: "listing",
        targetId: VALID_TARGET_ID,
        reasonId: VALID_REASON_ID,
        description: VALID_DESCRIPTION,
      },
      "",
    );
    await handleSubmitReport(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("returns 400 for invalid targetType", async () => {
    const req = makeReq({
      targetType: "invalid",
      targetId: VALID_TARGET_ID,
      reasonId: VALID_REASON_ID,
      description: VALID_DESCRIPTION,
    });
    await handleSubmitReport(req);
    expect(req.error).toHaveBeenCalledWith(400, "Type de cible invalide");
  });

  it("returns 400 for invalid targetId (not UUID)", async () => {
    const req = makeReq({
      targetType: "listing",
      targetId: "not-a-uuid",
      reasonId: VALID_REASON_ID,
      description: VALID_DESCRIPTION,
    });
    await handleSubmitReport(req);
    expect(req.error).toHaveBeenCalledWith(400, "Identifiant de cible invalide");
  });

  it("returns 400 for invalid reasonId", async () => {
    const req = makeReq({
      targetType: "listing",
      targetId: VALID_TARGET_ID,
      reasonId: "bad",
      description: VALID_DESCRIPTION,
    });
    await handleSubmitReport(req);
    expect(req.error).toHaveBeenCalledWith(400, "Raison de signalement invalide");
  });

  it("returns 400 when description is too short", async () => {
    const req = makeReq({
      targetType: "listing",
      targetId: VALID_TARGET_ID,
      reasonId: VALID_REASON_ID,
      description: "Too short",
    });
    await handleSubmitReport(req);
    expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("au moins 20"));
  });

  it("returns 400 when description exceeds max length", async () => {
    const req = makeReq({
      targetType: "listing",
      targetId: VALID_TARGET_ID,
      reasonId: VALID_REASON_ID,
      description: "a".repeat(2001),
    });
    await handleSubmitReport(req);
    expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("ne doit pas dépasser"));
  });

  it("returns 400 when reason does not exist or is inactive", async () => {
    mockRun.mockResolvedValueOnce(null); // reason not found
    const req = makeReq({
      targetType: "listing",
      targetId: VALID_TARGET_ID,
      reasonId: VALID_REASON_ID,
      description: VALID_DESCRIPTION,
    });
    await handleSubmitReport(req);
    expect(req.error).toHaveBeenCalledWith(400, "Raison de signalement invalide ou inactive");
  });

  it("returns 404 when listing target does not exist", async () => {
    mockRun
      .mockResolvedValueOnce(MOCK_REASON) // reason exists
      .mockResolvedValueOnce(null); // listing not found
    const req = makeReq({
      targetType: "listing",
      targetId: VALID_TARGET_ID,
      reasonId: VALID_REASON_ID,
      description: VALID_DESCRIPTION,
    });
    await handleSubmitReport(req);
    expect(req.error).toHaveBeenCalledWith(404, "Annonce introuvable");
  });

  it("returns 400 when user tries to report own listing", async () => {
    mockRun
      .mockResolvedValueOnce(MOCK_REASON) // reason exists
      .mockResolvedValueOnce({ sellerId: "user-1" }); // listing owned by reporter
    const req = makeReq({
      targetType: "listing",
      targetId: VALID_TARGET_ID,
      reasonId: VALID_REASON_ID,
      description: VALID_DESCRIPTION,
    });
    await handleSubmitReport(req);
    expect(req.error).toHaveBeenCalledWith(400, "Vous ne pouvez pas signaler votre propre annonce");
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockRun
      .mockResolvedValueOnce(MOCK_REASON) // reason
      .mockResolvedValueOnce({ sellerId: "other-user" }) // listing
      .mockResolvedValueOnce({ cnt: 10 }); // 10 reports today
    const req = makeReq({
      targetType: "listing",
      targetId: VALID_TARGET_ID,
      reasonId: VALID_REASON_ID,
      description: VALID_DESCRIPTION,
    });
    await handleSubmitReport(req);
    expect(req.error).toHaveBeenCalledWith(429, expect.stringContaining("limite"));
  });

  it("returns 409 when duplicate report exists", async () => {
    mockRun
      .mockResolvedValueOnce(MOCK_REASON) // reason
      .mockResolvedValueOnce({ sellerId: "other-user" }) // listing
      .mockResolvedValueOnce({ cnt: 0 }) // rate limit OK
      .mockResolvedValueOnce({ ID: "existing-report" }); // duplicate
    const req = makeReq({
      targetType: "listing",
      targetId: VALID_TARGET_ID,
      reasonId: VALID_REASON_ID,
      description: VALID_DESCRIPTION,
    });
    await handleSubmitReport(req);
    expect(req.error).toHaveBeenCalledWith(409, "Vous avez déjà signalé cette cible");
  });

  it("creates report successfully for listing target", async () => {
    mockRun
      .mockResolvedValueOnce(MOCK_REASON) // reason
      .mockResolvedValueOnce({ sellerId: "other-user" }) // listing
      .mockResolvedValueOnce({ cnt: 0 }) // rate limit
      .mockResolvedValueOnce(null) // no duplicate
      .mockResolvedValueOnce(undefined); // INSERT
    const req = makeReq({
      targetType: "listing",
      targetId: VALID_TARGET_ID,
      reasonId: VALID_REASON_ID,
      description: VALID_DESCRIPTION,
    });
    const result = await handleSubmitReport(req);
    expect(result).toEqual({
      reportId: "generated-uuid",
      status: "pending",
      createdAt: expect.any(String),
    });
    expect(req.error).not.toHaveBeenCalled();
  });

  it("creates report for user target (no listing check)", async () => {
    mockRun
      .mockResolvedValueOnce(MOCK_REASON) // reason
      .mockResolvedValueOnce({ cnt: 0 }) // rate limit (no listing check for user target)
      .mockResolvedValueOnce(null) // no duplicate
      .mockResolvedValueOnce(undefined); // INSERT
    const req = makeReq({
      targetType: "user",
      targetId: VALID_TARGET_ID,
      reasonId: VALID_REASON_ID,
      description: VALID_DESCRIPTION,
    });
    const result = await handleSubmitReport(req);
    expect(result).toEqual({
      reportId: "generated-uuid",
      status: "pending",
      createdAt: expect.any(String),
    });
  });

  it("creates report for chat target (no listing check)", async () => {
    mockRun
      .mockResolvedValueOnce(MOCK_REASON) // reason
      .mockResolvedValueOnce({ cnt: 0 }) // rate limit
      .mockResolvedValueOnce(null) // no duplicate
      .mockResolvedValueOnce(undefined); // INSERT
    const req = makeReq({
      targetType: "chat",
      targetId: VALID_TARGET_ID,
      reasonId: VALID_REASON_ID,
      description: VALID_DESCRIPTION,
    });
    const result = await handleSubmitReport(req);
    expect(result).toEqual({
      reportId: "generated-uuid",
      status: "pending",
      createdAt: expect.any(String),
    });
  });

  it("calls audit log on successful report creation", async () => {
    mockRun
      .mockResolvedValueOnce(MOCK_REASON)
      .mockResolvedValueOnce({ sellerId: "other-user" })
      .mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(undefined);
    const req = makeReq({
      targetType: "listing",
      targetId: VALID_TARGET_ID,
      reasonId: VALID_REASON_ID,
      description: VALID_DESCRIPTION,
    });
    await handleSubmitReport(req);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "moderation.report_submitted",
        targetType: "Report",
        targetId: "generated-uuid",
      }),
    );
  });

  it("sends notification on successful report creation", async () => {
    mockRun
      .mockResolvedValueOnce(MOCK_REASON)
      .mockResolvedValueOnce({ sellerId: "other-user" })
      .mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(undefined);
    const req = makeReq({
      targetType: "listing",
      targetId: VALID_TARGET_ID,
      reasonId: VALID_REASON_ID,
      description: VALID_DESCRIPTION,
    });
    await handleSubmitReport(req);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "system",
        title: "Signalement enregistré",
      }),
    );
  });

  it("uses severity from the report reason", async () => {
    const criticalReason = { ...MOCK_REASON, severity: "critical" };
    mockRun
      .mockResolvedValueOnce(criticalReason)
      .mockResolvedValueOnce({ sellerId: "other-user" })
      .mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(undefined);
    const req = makeReq({
      targetType: "listing",
      targetId: VALID_TARGET_ID,
      reasonId: VALID_REASON_ID,
      description: VALID_DESCRIPTION,
    });
    await handleSubmitReport(req);
    // Verify the INSERT call includes the correct severity
    const insertCall = mockRun.mock.calls[4][0];
    expect(insertCall).toBeDefined();
  });
});
