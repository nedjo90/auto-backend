// ─── ConsentService handler (mocked CDS) ────────────────────────────

jest.mock("@sap/cds", () => {
  class MockApplicationService {
    on = jest.fn();
    before = jest.fn();
    async init() {}
  }
  return {
    __esModule: true,
    default: {
      ApplicationService: MockApplicationService,
      entities: jest.fn(() => ({
        ConfigConsentType: "ConfigConsentType",
        UserConsent: "UserConsent",
      })),
      run: jest.fn(),
      utils: { uuid: jest.fn(() => "consent-uuid-123") },
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require("@sap/cds").default;
const mockRun = cds.run as jest.Mock;
const mockUuid = cds.utils.uuid as jest.Mock;

// Mock CDS query builders
(global as any).SELECT = {
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue("select-query"),
    }),
  }),
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("select-one-query"),
    }),
  },
};

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-query"),
  }),
};

// Import handler after CDS is mocked
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ConsentServiceHandler =
  require("../../../srv/handlers/consent-handler").default;

describe("ConsentServiceHandler", () => {
  let service: any;
  let registeredHandlers: Record<string, Function>;
  let registeredBeforeHandlers: Record<string, Function>;

  const mockConsentTypes = [
    {
      ID: "ct-1",
      code: "essential_processing",
      labelKey: "consent.essential.label",
      descriptionKey: "consent.essential.description",
      isMandatory: true,
      isActive: true,
      displayOrder: 10,
      version: 1,
    },
    {
      ID: "ct-2",
      code: "marketing_email",
      labelKey: "consent.marketing.label",
      descriptionKey: "consent.marketing.description",
      isMandatory: false,
      isActive: true,
      displayOrder: 20,
      version: 1,
    },
  ];

  const mockReq = (
    data: Record<string, unknown>,
    opts?: { userId?: string; headers?: Record<string, string> },
  ) => ({
    data,
    user: { id: opts?.userId || "user-123" },
    headers: opts?.headers || {},
    reject: jest.fn((code: number, msg: string) => {
      const err: any = new Error(msg);
      err.code = code;
      throw err;
    }),
  });

  beforeEach(async () => {
    mockRun.mockReset();
    mockUuid.mockReturnValue("consent-uuid-123");

    // Reset query builder mocks
    (global as any).SELECT.from.mockReturnValue({
      where: jest.fn().mockReturnValue({
        orderBy: jest.fn().mockReturnValue("select-query"),
      }),
    });
    (global as any).SELECT.one.from.mockReturnValue({
      where: jest.fn().mockReturnValue("select-one-query"),
    });
    (global as any).INSERT.into.mockReturnValue({
      entries: jest.fn().mockReturnValue("insert-query"),
    });

    registeredHandlers = {};
    registeredBeforeHandlers = {};

    service = new ConsentServiceHandler();
    service.on = jest.fn(
      (event: string, entityOrHandler: any, handler?: any) => {
        const key = handler ? `${event}:${entityOrHandler}` : event;
        registeredHandlers[key] = handler || entityOrHandler;
      },
    );
    service.before = jest.fn(
      (events: string[], entity: any, handler?: any) => {
        for (const event of events) {
          registeredBeforeHandlers[`${event}:${entity}`] = handler;
        }
      },
    );
    await service.init();
  });

  it("should register all handlers on init", () => {
    expect(service.on).toHaveBeenCalledWith(
      "READ",
      "ActiveConsentTypes",
      expect.any(Function),
    );
    expect(service.on).toHaveBeenCalledWith(
      "recordConsent",
      expect.any(Function),
    );
    expect(service.on).toHaveBeenCalledWith(
      "recordConsents",
      expect.any(Function),
    );
    expect(service.on).toHaveBeenCalledWith(
      "getUserConsents",
      expect.any(Function),
    );
    expect(service.on).toHaveBeenCalledWith(
      "getPendingConsents",
      expect.any(Function),
    );
  });

  it("should register before handlers for UPDATE/DELETE on UserConsent", () => {
    expect(service.before).toHaveBeenCalledWith(
      ["UPDATE", "DELETE"],
      "UserConsent",
      expect.any(Function),
    );
  });

  // ─── getActiveConsentTypes ────────────────────────────

  describe("getActiveConsentTypes", () => {
    it("should return active consent types ordered by displayOrder", async () => {
      mockRun.mockResolvedValueOnce(mockConsentTypes);

      const handler = registeredHandlers["READ:ActiveConsentTypes"];
      const result = await handler();

      expect(mockRun).toHaveBeenCalled();
      expect(result).toEqual(mockConsentTypes);
    });
  });

  // ─── recordConsent ────────────────────────────

  describe("recordConsent", () => {
    it("should record a consent decision successfully", async () => {
      mockRun
        .mockResolvedValueOnce(mockConsentTypes[0]) // SELECT consent type
        .mockResolvedValueOnce(undefined); // INSERT

      const req = mockReq({
        input: { consentTypeId: "ct-1", decision: "granted" },
      });
      const handler = registeredHandlers["recordConsent"];
      const result = await handler(req);

      expect(result).toEqual({ success: true, id: "consent-uuid-123" });
    });

    it("should reject for non-existent consent type", async () => {
      mockRun.mockResolvedValueOnce(null); // no consent type found

      const req = mockReq({
        input: { consentTypeId: "invalid-id", decision: "granted" },
      });
      const handler = registeredHandlers["recordConsent"];

      await expect(handler(req)).rejects.toThrow(
        "Consent type not found or inactive",
      );
      expect(req.reject).toHaveBeenCalledWith(
        404,
        "Consent type not found or inactive",
      );
    });

    it("should reject for invalid decision value", async () => {
      mockRun.mockResolvedValueOnce(mockConsentTypes[0]);

      const req = mockReq({
        input: { consentTypeId: "ct-1", decision: "maybe" },
      });
      const handler = registeredHandlers["recordConsent"];

      await expect(handler(req)).rejects.toThrow(
        "Decision must be 'granted' or 'revoked'",
      );
    });

    it("should accept 'revoked' decision", async () => {
      mockRun
        .mockResolvedValueOnce(mockConsentTypes[1])
        .mockResolvedValueOnce(undefined);

      const req = mockReq({
        input: { consentTypeId: "ct-2", decision: "revoked" },
      });
      const handler = registeredHandlers["recordConsent"];
      const result = await handler(req);

      expect(result).toEqual({ success: true, id: "consent-uuid-123" });
    });
  });

  // ─── recordConsents (batch) ────────────────────────────

  describe("recordConsents", () => {
    it("should record multiple consents at once", async () => {
      mockRun
        .mockResolvedValueOnce(mockConsentTypes) // SELECT consent types
        .mockResolvedValueOnce(undefined); // INSERT batch

      const req = mockReq({
        input: {
          consents: [
            { consentTypeId: "ct-1", decision: "granted" },
            { consentTypeId: "ct-2", decision: "revoked" },
          ],
        },
      });
      const handler = registeredHandlers["recordConsents"];
      const result = await handler(req);

      expect(result).toEqual({ success: true, count: 2 });
    });

    it("should reject for empty consents array", async () => {
      const req = mockReq({ input: { consents: [] } });
      const handler = registeredHandlers["recordConsents"];

      await expect(handler(req)).rejects.toThrow(
        "Consents array is required and must not be empty",
      );
    });

    it("should reject if any consent type is not found", async () => {
      mockRun.mockResolvedValueOnce([mockConsentTypes[0]]); // only ct-1 found

      const req = mockReq({
        input: {
          consents: [
            { consentTypeId: "ct-1", decision: "granted" },
            { consentTypeId: "ct-nonexistent", decision: "granted" },
          ],
        },
      });
      const handler = registeredHandlers["recordConsents"];

      await expect(handler(req)).rejects.toThrow(
        "Consent type ct-nonexistent not found or inactive",
      );
    });

    it("should reject if any decision is invalid", async () => {
      mockRun.mockResolvedValueOnce(mockConsentTypes);

      const req = mockReq({
        input: {
          consents: [
            { consentTypeId: "ct-1", decision: "granted" },
            { consentTypeId: "ct-2", decision: "invalid" },
          ],
        },
      });
      const handler = registeredHandlers["recordConsents"];

      await expect(handler(req)).rejects.toThrow(
        "Decision must be 'granted' or 'revoked'",
      );
    });
  });

  // ─── getUserConsents ────────────────────────────

  describe("getUserConsents", () => {
    it("should return all consent records for a user", async () => {
      const userConsents = [
        {
          ID: "uc-1",
          user_ID: "user-123",
          consentType_ID: "ct-1",
          consentTypeVersion: 1,
          decision: "granted",
          timestamp: "2026-02-08T12:00:00Z",
        },
        {
          ID: "uc-2",
          user_ID: "user-123",
          consentType_ID: "ct-2",
          consentTypeVersion: 1,
          decision: "revoked",
          timestamp: "2026-02-08T12:01:00Z",
        },
      ];
      mockRun.mockResolvedValueOnce(userConsents);

      const req = mockReq({ userId: "user-123" });
      const handler = registeredHandlers["getUserConsents"];
      const result = await handler(req);

      expect(result).toEqual(userConsents);
    });

    it("should return empty array for user with no consents", async () => {
      mockRun.mockResolvedValueOnce([]);

      const req = mockReq({ userId: "user-no-consents" });
      const handler = registeredHandlers["getUserConsents"];
      const result = await handler(req);

      expect(result).toEqual([]);
    });
  });

  // ─── getPendingConsents ────────────────────────────

  describe("getPendingConsents", () => {
    it("should return all consent types when user has no prior consents", async () => {
      mockRun
        .mockResolvedValueOnce(mockConsentTypes) // active types
        .mockResolvedValueOnce([]); // no user consents

      const req = mockReq({ userId: "new-user" });
      const handler = registeredHandlers["getPendingConsents"];
      const result = await handler(req);

      expect(result).toEqual(mockConsentTypes);
    });

    it("should return empty when user has consented to all at current version", async () => {
      mockRun
        .mockResolvedValueOnce(mockConsentTypes)
        .mockResolvedValueOnce([
          { consentType_ID: "ct-1", consentTypeVersion: 1, decision: "granted" },
          { consentType_ID: "ct-2", consentTypeVersion: 1, decision: "granted" },
        ]);

      const req = mockReq({ userId: "up-to-date-user" });
      const handler = registeredHandlers["getPendingConsents"];
      const result = await handler(req);

      expect(result).toEqual([]);
    });

    it("should return consent types with newer versions", async () => {
      const updatedTypes = [
        { ...mockConsentTypes[0], version: 2 }, // version bumped
        mockConsentTypes[1],
      ];
      mockRun
        .mockResolvedValueOnce(updatedTypes)
        .mockResolvedValueOnce([
          { consentType_ID: "ct-1", consentTypeVersion: 1, decision: "granted" },
          { consentType_ID: "ct-2", consentTypeVersion: 1, decision: "granted" },
        ]);

      const req = mockReq({ userId: "user-needs-reconsent" });
      const handler = registeredHandlers["getPendingConsents"];
      const result = await handler(req);

      expect(result).toHaveLength(1);
      expect(result[0].ID).toBe("ct-1");
      expect(result[0].version).toBe(2);
    });

    it("should use latest consent record per type (most recent first)", async () => {
      mockRun
        .mockResolvedValueOnce(mockConsentTypes)
        .mockResolvedValueOnce([
          // Most recent first (ordered by timestamp desc)
          { consentType_ID: "ct-1", consentTypeVersion: 1, decision: "revoked" },
          { consentType_ID: "ct-1", consentTypeVersion: 1, decision: "granted" },
        ]);

      const req = mockReq({ userId: "user-with-history" });
      const handler = registeredHandlers["getPendingConsents"];
      const result = await handler(req);

      // ct-1 has version 1, user's latest is version 1 → not pending
      // ct-2 has no consent at all → pending
      expect(result).toHaveLength(1);
      expect(result[0].ID).toBe("ct-2");
    });
  });

  // ─── Immutability enforcement ────────────────────────────

  describe("UserConsent immutability", () => {
    it("should reject UPDATE on UserConsent", () => {
      const handler = registeredBeforeHandlers["UPDATE:UserConsent"];
      expect(handler).toBeDefined();

      const req = mockReq({});
      expect(() => handler(req)).toThrow(
        "UserConsent records are immutable",
      );
    });

    it("should reject DELETE on UserConsent", () => {
      const handler = registeredBeforeHandlers["DELETE:UserConsent"];
      expect(handler).toBeDefined();

      const req = mockReq({});
      expect(() => handler(req)).toThrow(
        "UserConsent records are immutable",
      );
    });
  });
});
