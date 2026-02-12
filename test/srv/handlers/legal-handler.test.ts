/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-function-type */

const mockLogAudit = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../srv/lib/audit-logger", () => ({
  logAudit: (...args: any[]) => mockLogAudit(...args),
}));

jest.mock("@sap/cds", () => {
  class MockApplicationService {
    on = jest.fn();
    before = jest.fn();
    after = jest.fn();
    async init() {}
  }
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    __esModule: true,
    default: {
      ApplicationService: MockApplicationService,
      entities: jest.fn(() => ({
        LegalDocument: "LegalDocument",
        LegalDocumentVersion: "LegalDocumentVersion",
        LegalAcceptance: "LegalAcceptance",
      })),
      run: jest.fn(),
      log: jest.fn(() => mockLog),
      utils: { uuid: jest.fn(() => "test-uuid") },
    },
  };
});

const cds = require("@sap/cds").default;
const mockRun = cds.run as jest.Mock;

const selectFromWhereResult = {
  orderBy: jest.fn().mockReturnValue({
    limit: jest.fn().mockReturnValue("select-from-where-ordered-query"),
  }),
  toString: () => "select-from-where-query",
};
(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("select-one-query"),
    }),
  },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue(selectFromWhereResult),
  }),
};

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-query"),
  }),
};

const LegalServiceHandler = require("../../../srv/handlers/legal-handler").default;

describe("LegalServiceHandler", () => {
  let service: any;
  let registeredOnHandlers: Map<string, Function[]>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockLogAudit.mockResolvedValue(undefined);

    registeredOnHandlers = new Map();

    service = new LegalServiceHandler();
    service.on = jest.fn((actionName: string, handler: Function) => {
      if (!registeredOnHandlers.has(actionName)) registeredOnHandlers.set(actionName, []);
      registeredOnHandlers.get(actionName)!.push(handler);
    });

    await service.init();
  });

  it("should register all handlers", () => {
    expect(registeredOnHandlers.has("getCurrentVersion")).toBe(true);
    expect(registeredOnHandlers.has("acceptLegalDocument")).toBe(true);
    expect(registeredOnHandlers.has("checkLegalAcceptance")).toBe(true);
  });

  describe("getCurrentVersion", () => {
    it("should reject empty documentKey", async () => {
      const handler = registeredOnHandlers.get("getCurrentVersion")![0];
      const req: any = { data: { documentKey: "" }, reject: jest.fn() };
      await handler(req);
      expect(req.reject).toHaveBeenCalledWith(400, "documentKey is required");
    });

    it("should reject when document not found", async () => {
      mockRun.mockResolvedValueOnce(null);
      const handler = registeredOnHandlers.get("getCurrentVersion")![0];
      const req: any = { data: { documentKey: "cgu" }, reject: jest.fn() };
      await handler(req);
      expect(req.reject).toHaveBeenCalledWith(404, "Document legal non trouve");
    });

    it("should return current version content", async () => {
      mockRun.mockResolvedValueOnce({ ID: "doc-1", currentVersion: 2 }); // document
      mockRun.mockResolvedValueOnce({
        ID: "ver-2",
        document_ID: "doc-1",
        version: 2,
        content: "Legal content v2",
        summary: "Updated section",
        publishedAt: "2026-02-01T10:00:00Z",
      }); // version

      const handler = registeredOnHandlers.get("getCurrentVersion")![0];
      const req: any = { data: { documentKey: "cgu" }, reject: jest.fn() };
      const result = await handler(req);

      expect(req.reject).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ID: "ver-2",
        version: 2,
        content: "Legal content v2",
      });
    });

    it("should reject when version not found", async () => {
      mockRun.mockResolvedValueOnce({ ID: "doc-1", currentVersion: 2 }); // document
      mockRun.mockResolvedValueOnce(null); // version not found

      const handler = registeredOnHandlers.get("getCurrentVersion")![0];
      const req: any = { data: { documentKey: "cgu" }, reject: jest.fn() };
      await handler(req);
      expect(req.reject).toHaveBeenCalledWith(404, "Version du document non trouvee");
    });
  });

  describe("acceptLegalDocument", () => {
    it("should reject invalid input", async () => {
      const handler = registeredOnHandlers.get("acceptLegalDocument")![0];
      const req: any = {
        data: { documentId: "", version: 0 },
        reject: jest.fn(),
        user: { id: "user-1" },
        headers: {},
      };
      await handler(req);
      expect(req.reject).toHaveBeenCalledWith(400, expect.stringContaining("Invalid input"));
    });

    it("should reject when document not found", async () => {
      mockRun.mockResolvedValueOnce(null);
      const handler = registeredOnHandlers.get("acceptLegalDocument")![0];
      const req: any = {
        data: { documentId: "nonexistent", version: 1 },
        reject: jest.fn(),
        user: { id: "user-1" },
        headers: {},
      };
      await handler(req);
      expect(req.reject).toHaveBeenCalledWith(404, "Document legal non trouve");
    });

    it("should reject version mismatch", async () => {
      mockRun.mockResolvedValueOnce({ ID: "doc-1", key: "cgu", currentVersion: 2 });
      const handler = registeredOnHandlers.get("acceptLegalDocument")![0];
      const req: any = {
        data: { documentId: "doc-1", version: 1 },
        reject: jest.fn(),
        user: { id: "user-1" },
        headers: {},
      };
      await handler(req);
      expect(req.reject).toHaveBeenCalledWith(400, expect.stringContaining("ne correspond pas"));
    });

    it("should reject unauthenticated user", async () => {
      mockRun.mockResolvedValueOnce({ ID: "doc-1", key: "cgu", currentVersion: 1 });
      const handler = registeredOnHandlers.get("acceptLegalDocument")![0];
      const req: any = {
        data: { documentId: "doc-1", version: 1 },
        reject: jest.fn(),
        user: {},
        headers: {},
      };
      await handler(req);
      expect(req.reject).toHaveBeenCalledWith(401, "Utilisateur non authentifie");
    });

    it("should return early if document already accepted", async () => {
      mockRun.mockResolvedValueOnce({ ID: "doc-1", key: "cgu", currentVersion: 1 }); // document
      mockRun.mockResolvedValueOnce({ ID: "existing-acceptance" }); // existing acceptance found

      const handler = registeredOnHandlers.get("acceptLegalDocument")![0];
      const req: any = {
        data: { documentId: "doc-1", version: 1 },
        reject: jest.fn(),
        user: { id: "user-1" },
        headers: {},
      };
      const result = await handler(req);

      expect(req.reject).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: true, message: "Document deja accepte." });
      expect(mockLogAudit).not.toHaveBeenCalled();
    });

    it("should record acceptance successfully", async () => {
      mockRun.mockResolvedValueOnce({ ID: "doc-1", key: "cgu", currentVersion: 1 }); // document
      mockRun.mockResolvedValueOnce(null); // no existing acceptance
      mockRun.mockResolvedValueOnce(undefined); // INSERT acceptance

      const handler = registeredOnHandlers.get("acceptLegalDocument")![0];
      const req: any = {
        data: { documentId: "doc-1", version: 1 },
        reject: jest.fn(),
        user: { id: "user-1" },
        headers: { "x-forwarded-for": "127.0.0.1, 10.0.0.1", "user-agent": "TestBrowser" },
      };
      const result = await handler(req);

      expect(req.reject).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: true, message: "Document accepte." });
      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "LEGAL_ACCEPTED",
          resource: "LegalAcceptance",
        }),
      );
    });
  });

  describe("checkLegalAcceptance", () => {
    it("should reject unauthenticated user", async () => {
      const handler = registeredOnHandlers.get("checkLegalAcceptance")![0];
      const req: any = { reject: jest.fn(), user: {} };
      await handler(req);
      expect(req.reject).toHaveBeenCalledWith(401, "Utilisateur non authentifie");
    });

    it("should return empty array when no documents require reacceptance", async () => {
      mockRun.mockResolvedValueOnce([]); // no docs with requiresReacceptance
      const handler = registeredOnHandlers.get("checkLegalAcceptance")![0];
      const req: any = { reject: jest.fn(), user: { id: "user-1" } };
      const result = await handler(req);
      expect(result).toEqual([]);
    });

    it("should return pending documents when user hasn't accepted current version", async () => {
      // Documents requiring reacceptance
      mockRun.mockResolvedValueOnce([{ ID: "doc-1", key: "cgu", title: "CGU", currentVersion: 2 }]);
      // Batch: user acceptances (empty - user hasn't accepted)
      mockRun.mockResolvedValueOnce([]);
      // Batch: current versions
      mockRun.mockResolvedValueOnce([
        { document_ID: "doc-1", version: 2, summary: "Updated privacy section" },
      ]);

      const handler = registeredOnHandlers.get("checkLegalAcceptance")![0];
      const req: any = { reject: jest.fn(), user: { id: "user-1" } };
      const result = await handler(req);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        documentId: "doc-1",
        documentKey: "cgu",
        title: "CGU",
        version: 2,
        summary: "Updated privacy section",
      });
    });

    it("should skip documents already accepted by user", async () => {
      mockRun.mockResolvedValueOnce([{ ID: "doc-1", key: "cgu", title: "CGU", currentVersion: 2 }]);
      // Batch: user has accepted doc-1 version 2
      mockRun.mockResolvedValueOnce([{ document_ID: "doc-1", version: 2 }]);
      // Batch: versions (still fetched but won't be used)
      mockRun.mockResolvedValueOnce([{ document_ID: "doc-1", version: 2, summary: "Summary" }]);

      const handler = registeredOnHandlers.get("checkLegalAcceptance")![0];
      const req: any = { reject: jest.fn(), user: { id: "user-1" } };
      const result = await handler(req);

      expect(result).toEqual([]);
    });
  });
});
