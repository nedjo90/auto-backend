/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "action-uuid-001");
const mockAuditLog = jest.fn<any, any[]>().mockResolvedValue(undefined);
const mockExtractAuditContext = jest.fn<any, any[]>(() => ({
  actorId: "mod-1",
  actorRole: "moderator",
}));
const mockCreateNotification = jest.fn<any, any[]>().mockResolvedValue(undefined);

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
        ConfigModerationRule: "ConfigModerationRule",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => mockUuid() },
    },
  };
});

jest.mock("../../../srv/middleware/audit-trail", () => ({
  auditLog: (...args: any[]) => mockAuditLog(...args),
  extractAuditContext: (...args: any[]) => mockExtractAuditContext(...args),
}));

jest.mock("../../../srv/lib/notification-emitter", () => ({
  createNotification: (...args: any[]) => mockCreateNotification(...args),
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
};
(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("q"),
  }),
});
(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("q"),
  }),
};

// ─── Import handlers ────────────────────────────────────────────────────────

const {
  handleDeactivateListing,
  handleSendWarning,
  handleDeactivateAccount,
  handleReactivateListing,
  handleReactivateAccount,
  handleDismissReport,
} = require("../../../srv/handlers/moderation-action-handler");

// ─── Helper ─────────────────────────────────────────────────────────────────

function makeReq(data: Record<string, unknown>, userId = "mod-1") {
  return {
    data,
    user: userId ? { id: userId } : null,
    error: jest.fn((status: number, message: string) => undefined),
  } as any;
}

const REPORT_ID = "a0000000-0000-0000-0000-000000000001";
const LISTING_ID = "b0000000-0000-0000-0000-000000000001";
const USER_ID = "c0000000-0000-0000-0000-000000000001";
const SELLER_ID = "d0000000-0000-0000-0000-000000000001";

// ─── Tests: deactivateListing ───────────────────────────────────────────────

describe("handleDeactivateListing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    const req = makeReq({ reportId: REPORT_ID, listingId: LISTING_ID }, "");
    await handleDeactivateListing(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("returns 400 for invalid reportId", async () => {
    const req = makeReq({ reportId: "bad", listingId: LISTING_ID });
    await handleDeactivateListing(req);
    expect(req.error).toHaveBeenCalledWith(400, "Identifiant de rapport invalide");
  });

  it("returns 400 for invalid listingId", async () => {
    const req = makeReq({ reportId: REPORT_ID, listingId: "bad" });
    await handleDeactivateListing(req);
    expect(req.error).toHaveBeenCalledWith(400, "Identifiant d'annonce invalide");
  });

  it("returns 404 when listing not found", async () => {
    mockRun.mockResolvedValueOnce(null);
    const req = makeReq({ reportId: REPORT_ID, listingId: LISTING_ID });
    await handleDeactivateListing(req);
    expect(req.error).toHaveBeenCalledWith(404, "Annonce introuvable");
  });

  it("returns 400 when listing already suspended", async () => {
    mockRun.mockResolvedValueOnce({ ID: LISTING_ID, sellerId: SELLER_ID, status: "suspended" });
    const req = makeReq({ reportId: REPORT_ID, listingId: LISTING_ID });
    await handleDeactivateListing(req);
    expect(req.error).toHaveBeenCalledWith(400, "Annonce deja suspendue");
  });

  it("returns 400 when listing not published", async () => {
    mockRun.mockResolvedValueOnce({ ID: LISTING_ID, sellerId: SELLER_ID, status: "draft" });
    const req = makeReq({ reportId: REPORT_ID, listingId: LISTING_ID });
    await handleDeactivateListing(req);
    expect(req.error).toHaveBeenCalledWith(400, "Seule une annonce publiee peut etre suspendue");
  });

  it("suspends a published listing and creates action record", async () => {
    mockRun
      .mockResolvedValueOnce({ ID: LISTING_ID, sellerId: SELLER_ID, status: "published" }) // listing
      .mockResolvedValueOnce(undefined) // UPDATE listing
      .mockResolvedValueOnce(undefined) // INSERT action
      .mockResolvedValueOnce(undefined); // UPDATE report

    const req = makeReq({ reportId: REPORT_ID, listingId: LISTING_ID, reason: "Fraudulent" });
    const result = await handleDeactivateListing(req);

    expect(result.success).toBe(true);
    expect(result.actionId).toBe("action-uuid-001");
    expect(result.message).toBe("Annonce suspendue avec succes");
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SELLER_ID, type: "system" }),
    );
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "moderation.action_taken",
        targetType: "Listing",
        targetId: LISTING_ID,
      }),
    );
  });
});

// ─── Tests: sendWarning ─────────────────────────────────────────────────────

describe("handleSendWarning", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    const req = makeReq({ reportId: REPORT_ID, userId: USER_ID }, "");
    await handleSendWarning(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("returns 400 for invalid userId", async () => {
    const req = makeReq({ reportId: REPORT_ID, userId: "bad" });
    await handleSendWarning(req);
    expect(req.error).toHaveBeenCalledWith(400, "Identifiant utilisateur invalide");
  });

  it("returns 404 when user not found", async () => {
    mockRun.mockResolvedValueOnce(null);
    const req = makeReq({ reportId: REPORT_ID, userId: USER_ID });
    await handleSendWarning(req);
    expect(req.error).toHaveBeenCalledWith(404, "Utilisateur introuvable");
  });

  it("sends warning with custom message", async () => {
    mockRun
      .mockResolvedValueOnce({ ID: USER_ID, status: "active" }) // user
      .mockResolvedValueOnce(undefined) // INSERT action
      .mockResolvedValueOnce(undefined); // UPDATE report

    const req = makeReq({
      reportId: REPORT_ID,
      userId: USER_ID,
      warningMessage: "Custom warning",
    });
    const result = await handleSendWarning(req);

    expect(result.success).toBe(true);
    expect(result.actionId).toBe("action-uuid-001");
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, body: "Custom warning" }),
    );
  });

  it("sends warning with default message when no custom message and no template", async () => {
    mockRun
      .mockResolvedValueOnce({ ID: USER_ID, status: "active" }) // user
      .mockResolvedValueOnce(null) // ConfigModerationRule lookup (no template found)
      .mockResolvedValueOnce(undefined) // INSERT action
      .mockResolvedValueOnce(undefined); // UPDATE report

    const req = makeReq({ reportId: REPORT_ID, userId: USER_ID });
    const result = await handleSendWarning(req);

    expect(result.success).toBe(true);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("avertissement"),
      }),
    );
  });

  it("sends warning with configurable template from ConfigModerationRule", async () => {
    const templateMessage = "Veuillez respecter les conditions d'utilisation de la plateforme.";
    mockRun
      .mockResolvedValueOnce({ ID: USER_ID, status: "active" }) // user
      .mockResolvedValueOnce({ action: templateMessage }) // ConfigModerationRule template
      .mockResolvedValueOnce(undefined) // INSERT action
      .mockResolvedValueOnce(undefined); // UPDATE report

    const req = makeReq({ reportId: REPORT_ID, userId: USER_ID });
    const result = await handleSendWarning(req);

    expect(result.success).toBe(true);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: templateMessage,
      }),
    );
  });
});

// ─── Tests: deactivateAccount ───────────────────────────────────────────────

describe("handleDeactivateAccount", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    const req = makeReq({ reportId: REPORT_ID, userId: USER_ID, confirmed: true }, "");
    await handleDeactivateAccount(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("returns 400 when not confirmed", async () => {
    const req = makeReq({ reportId: REPORT_ID, userId: USER_ID, confirmed: false });
    await handleDeactivateAccount(req);
    expect(req.error).toHaveBeenCalledWith(400, "Confirmation requise pour desactiver un compte");
  });

  it("returns 404 when user not found", async () => {
    mockRun.mockResolvedValueOnce(null);
    const req = makeReq({ reportId: REPORT_ID, userId: USER_ID, confirmed: true });
    await handleDeactivateAccount(req);
    expect(req.error).toHaveBeenCalledWith(404, "Utilisateur introuvable");
  });

  it("returns 400 when user already suspended", async () => {
    mockRun.mockResolvedValueOnce({ ID: USER_ID, status: "suspended" });
    const req = makeReq({ reportId: REPORT_ID, userId: USER_ID, confirmed: true });
    await handleDeactivateAccount(req);
    expect(req.error).toHaveBeenCalledWith(400, "Compte deja suspendu");
  });

  it("suspends user account and all published listings", async () => {
    mockRun
      .mockResolvedValueOnce({ ID: USER_ID, status: "active" }) // user
      .mockResolvedValueOnce(undefined) // UPDATE user
      .mockResolvedValueOnce(undefined) // UPDATE listings
      .mockResolvedValueOnce(undefined) // INSERT action
      .mockResolvedValueOnce(undefined); // UPDATE report

    const req = makeReq({
      reportId: REPORT_ID,
      userId: USER_ID,
      confirmed: true,
      reason: "Repeated violations",
    });
    const result = await handleDeactivateAccount(req);

    expect(result.success).toBe(true);
    expect(result.actionId).toBe("action-uuid-001");
    expect(result.message).toBe("Compte suspendu avec succes");
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        body: expect.stringContaining("Repeated violations"),
      }),
    );
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ severity: "critical" }));
  });

  it("suspends account with generic message when no reason", async () => {
    mockRun
      .mockResolvedValueOnce({ ID: USER_ID, status: "active" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const req = makeReq({ reportId: REPORT_ID, userId: USER_ID, confirmed: true });
    const result = await handleDeactivateAccount(req);

    expect(result.success).toBe(true);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("examen de moderation"),
      }),
    );
  });
});

// ─── Tests: reactivateListing ───────────────────────────────────────────────

describe("handleReactivateListing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    const req = makeReq({ listingId: LISTING_ID }, "");
    await handleReactivateListing(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("returns 400 for invalid listingId", async () => {
    const req = makeReq({ listingId: "bad" });
    await handleReactivateListing(req);
    expect(req.error).toHaveBeenCalledWith(400, "Identifiant d'annonce invalide");
  });

  it("returns 404 when listing not found", async () => {
    mockRun.mockResolvedValueOnce(null);
    const req = makeReq({ listingId: LISTING_ID });
    await handleReactivateListing(req);
    expect(req.error).toHaveBeenCalledWith(404, "Annonce introuvable");
  });

  it("returns 400 when listing not suspended", async () => {
    mockRun.mockResolvedValueOnce({ ID: LISTING_ID, sellerId: SELLER_ID, status: "published" });
    const req = makeReq({ listingId: LISTING_ID });
    await handleReactivateListing(req);
    expect(req.error).toHaveBeenCalledWith(400, "Seule une annonce suspendue peut etre reactivee");
  });

  it("reactivates a suspended listing", async () => {
    mockRun
      .mockResolvedValueOnce({ ID: LISTING_ID, sellerId: SELLER_ID, status: "suspended" }) // listing
      .mockResolvedValueOnce(undefined) // UPDATE listing
      .mockResolvedValueOnce(undefined); // INSERT action

    const req = makeReq({ listingId: LISTING_ID, reason: "Verified by team" });
    const result = await handleReactivateListing(req);

    expect(result.success).toBe(true);
    expect(result.actionId).toBe("action-uuid-001");
    expect(result.message).toBe("Annonce reactivee avec succes");
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: SELLER_ID,
        title: "Annonce reactivee",
      }),
    );
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ severity: "info" }));
  });
});

// ─── Tests: reactivateAccount ───────────────────────────────────────────────

describe("handleReactivateAccount", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    const req = makeReq({ userId: USER_ID }, "");
    await handleReactivateAccount(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("returns 400 for invalid userId", async () => {
    const req = makeReq({ userId: "bad" });
    await handleReactivateAccount(req);
    expect(req.error).toHaveBeenCalledWith(400, "Identifiant utilisateur invalide");
  });

  it("returns 404 when user not found", async () => {
    mockRun.mockResolvedValueOnce(null);
    const req = makeReq({ userId: USER_ID });
    await handleReactivateAccount(req);
    expect(req.error).toHaveBeenCalledWith(404, "Utilisateur introuvable");
  });

  it("returns 400 when user not suspended", async () => {
    mockRun.mockResolvedValueOnce({ ID: USER_ID, status: "active" });
    const req = makeReq({ userId: USER_ID });
    await handleReactivateAccount(req);
    expect(req.error).toHaveBeenCalledWith(400, "Seul un compte suspendu peut etre reactive");
  });

  it("reactivates a suspended user account", async () => {
    mockRun
      .mockResolvedValueOnce({ ID: USER_ID, status: "suspended" }) // user
      .mockResolvedValueOnce(undefined) // UPDATE user
      .mockResolvedValueOnce(undefined); // INSERT action

    const req = makeReq({ userId: USER_ID, reason: "Appeal accepted" });
    const result = await handleReactivateAccount(req);

    expect(result.success).toBe(true);
    expect(result.actionId).toBe("action-uuid-001");
    expect(result.message).toBe("Compte reactive avec succes");
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        title: "Compte reactive",
      }),
    );
  });
});

// ─── Tests: dismissReport ───────────────────────────────────────────────────

describe("handleDismissReport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    const req = makeReq({ reportId: REPORT_ID }, "");
    await handleDismissReport(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("returns 400 for invalid reportId", async () => {
    const req = makeReq({ reportId: "bad" });
    await handleDismissReport(req);
    expect(req.error).toHaveBeenCalledWith(400, "Identifiant de rapport invalide");
  });

  it("returns 404 when report not found", async () => {
    mockRun.mockResolvedValueOnce(null);
    const req = makeReq({ reportId: REPORT_ID });
    await handleDismissReport(req);
    expect(req.error).toHaveBeenCalledWith(404, "Rapport introuvable");
  });

  it("returns 400 when report already dismissed", async () => {
    mockRun.mockResolvedValueOnce({
      ID: REPORT_ID,
      status: "dismissed",
      targetType: "listing",
      targetId: LISTING_ID,
    });
    const req = makeReq({ reportId: REPORT_ID });
    await handleDismissReport(req);
    expect(req.error).toHaveBeenCalledWith(400, "Rapport deja rejete");
  });

  it("returns 400 when report already treated", async () => {
    mockRun.mockResolvedValueOnce({
      ID: REPORT_ID,
      status: "treated",
      targetType: "listing",
      targetId: LISTING_ID,
    });
    const req = makeReq({ reportId: REPORT_ID });
    await handleDismissReport(req);
    expect(req.error).toHaveBeenCalledWith(400, "Rapport deja traite");
  });

  it("dismisses a pending report", async () => {
    mockRun
      .mockResolvedValueOnce({
        ID: REPORT_ID,
        status: "pending",
        targetType: "listing",
        targetId: LISTING_ID,
      }) // report
      .mockResolvedValueOnce(undefined) // INSERT action
      .mockResolvedValueOnce(undefined); // UPDATE report

    const req = makeReq({ reportId: REPORT_ID, reason: "No violation found" });
    const result = await handleDismissReport(req);

    expect(result.success).toBe(true);
    expect(result.actionId).toBe("action-uuid-001");
    expect(result.message).toBe("Signalement rejete");
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "moderation.action_taken",
        targetType: "Report",
        targetId: REPORT_ID,
      }),
    );
  });

  it("dismisses an in_progress report", async () => {
    mockRun
      .mockResolvedValueOnce({
        ID: REPORT_ID,
        status: "in_progress",
        targetType: "user",
        targetId: USER_ID,
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const req = makeReq({ reportId: REPORT_ID });
    const result = await handleDismissReport(req);

    expect(result.success).toBe(true);
  });
});
