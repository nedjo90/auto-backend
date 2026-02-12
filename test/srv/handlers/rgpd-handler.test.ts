/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-function-type */
import { generateConfirmationCode, buildAnonymizedData } from "../../../srv/handlers/rgpd-handler";

// ─── Pure function tests ────────────────────────────────────────────────────

describe("generateConfirmationCode", () => {
  it("should return a 6-digit string", () => {
    const code = generateConfirmationCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("should return different codes on successive calls", () => {
    const codes = new Set(Array.from({ length: 10 }, () => generateConfirmationCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("buildAnonymizedData", () => {
  it("should return anonymized fields", () => {
    const data = buildAnonymizedData("test-user-123");
    expect(data.firstName).toBe("Anonyme");
    expect(data.lastName).toBe("Utilisateur");
    expect(data.displayName).toBe("Utilisateur anonymisé");
    expect(data.email).toContain("anonymized-");
    expect(data.email).toContain("@anonymized.auto");
    expect(data.phone).toBeNull();
    expect(data.siret).toBeNull();
    expect(data.avatarUrl).toBeNull();
    expect(data.bio).toBeNull();
    expect(data.isAnonymized).toBe(true);
    expect(data.status).toBe("anonymized");
  });

  it("should use user ID hash in email", () => {
    const data = buildAnonymizedData("abcdef12-3456-7890-abcd-ef1234567890");
    expect(data.email).toBe("anonymized-abcdef12@anonymized.auto");
  });
});

// ─── RgpdService handler (mocked CDS) ─────────────────────────────────

jest.mock("../../../srv/adapters/factory/adapter-factory", () => ({
  getIdentityProvider: jest.fn(() => ({
    createUser: jest.fn(),
    disableUser: jest.fn(),
    updateUser: jest.fn(),
  })),
  getBlobStorage: jest.fn(() => ({
    uploadFile: jest.fn().mockResolvedValue("https://storage.blob.core.windows.net/test"),
    generateSignedUrl: jest
      .fn()
      .mockResolvedValue("https://storage.blob.core.windows.net/test?sig=xxx"),
    deleteFile: jest.fn(),
  })),
}));

const mockLogAudit = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../srv/lib/audit-logger", () => ({
  logAudit: (...args: any[]) => mockLogAudit(...args),
}));

jest.mock("@sap/cds", () => {
  class MockApplicationService {
    on = jest.fn();
    async init() {}
  }
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    __esModule: true,
    default: {
      ApplicationService: MockApplicationService,
      entities: jest.fn(() => ({
        User: "User",
        UserConsent: "UserConsent",
        DataExportRequest: "DataExportRequest",
        AnonymizationRequest: "AnonymizationRequest",
        AuditTrailEntry: "AuditTrailEntry",
      })),
      run: jest.fn(),
      log: jest.fn(() => mockLog),
      utils: { uuid: jest.fn(() => "test-uuid-rgpd") },
    },
  };
});

const cds = require("@sap/cds").default;
const mockRun = cds.run as jest.Mock;

// Mock CDS query builders
(global as any).SELECT = {
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue("select-query"),
    }),
    orderBy: jest.fn().mockReturnValue("select-ordered-query"),
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

(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("update-query"),
  }),
});

const RgpdService = require("../../../srv/handlers/rgpd-handler").default;

describe("RgpdService handler", () => {
  let service: any;
  let registeredHandlers: Record<string, Function>;
  const mockAdapter = {
    createUser: jest.fn(),
    disableUser: jest.fn(),
    updateUser: jest.fn(),
  };
  const mockBlobStorage = {
    uploadFile: jest.fn().mockResolvedValue("https://storage.blob.core.windows.net/test"),
    generateSignedUrl: jest
      .fn()
      .mockResolvedValue("https://storage.blob.core.windows.net/test?sig=xxx"),
    deleteFile: jest.fn(),
  };

  beforeEach(async () => {
    mockRun.mockReset();
    mockLogAudit.mockReset();
    mockLogAudit.mockResolvedValue(undefined);
    mockAdapter.disableUser.mockReset();
    mockBlobStorage.uploadFile.mockReset();
    mockBlobStorage.generateSignedUrl.mockReset();
    mockBlobStorage.uploadFile.mockResolvedValue("https://storage.blob.core.windows.net/test");
    mockBlobStorage.generateSignedUrl.mockResolvedValue(
      "https://storage.blob.core.windows.net/test?sig=xxx",
    );

    registeredHandlers = {};
    service = new RgpdService();
    service.on = jest.fn((event: string, handler: any) => {
      registeredHandlers[event] = handler;
    });
    await service.init();
    service.identityProvider = mockAdapter;
    service.blobStorage = mockBlobStorage;
  });

  const mockReq = (data: Record<string, unknown> = {}, userId = "azure-user-id") => ({
    data,
    user: { id: userId },
    reject: jest.fn((code: number, msg: string) => {
      const err: any = new Error(msg);
      err.code = code;
      throw err;
    }),
  });

  it("should register all handlers on init", () => {
    expect(service.on).toHaveBeenCalledWith("requestDataExport", expect.any(Function));
    expect(service.on).toHaveBeenCalledWith("getExportStatus", expect.any(Function));
    expect(service.on).toHaveBeenCalledWith("downloadExport", expect.any(Function));
    expect(service.on).toHaveBeenCalledWith("requestAnonymization", expect.any(Function));
    expect(service.on).toHaveBeenCalledWith("confirmAnonymization", expect.any(Function));
  });

  describe("requestDataExport", () => {
    it("should create export request and return requestId", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1", azureAdB2cId: "azure-user-id" }) // find user
        .mockResolvedValueOnce(null) // no existing export
        .mockResolvedValueOnce(undefined); // INSERT DataExportRequest

      const req = mockReq();
      const handler = registeredHandlers["requestDataExport"];
      const result = await handler(req);

      expect(result.requestId).toBe("test-uuid-rgpd");
      expect(result.status).toBe("pending");
      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "DATA_EXPORT_REQUESTED",
          resource: "DataExportRequest",
        }),
      );
    });

    it("should return existing export if pending", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1", azureAdB2cId: "azure-user-id" })
        .mockResolvedValueOnce({ ID: "existing-export", status: "processing" });

      const req = mockReq();
      const handler = registeredHandlers["requestDataExport"];
      const result = await handler(req);

      expect(result.requestId).toBe("existing-export");
      expect(result.status).toBe("processing");
    });

    it("should reject unauthenticated request", async () => {
      const req = {
        data: {},
        user: {},
        reject: jest.fn((c: number, m: string) => {
          throw new Error(m);
        }),
      };
      const handler = registeredHandlers["requestDataExport"];
      await expect(handler(req)).rejects.toThrow("Authentication required");
    });
  });

  describe("getExportStatus", () => {
    it("should return export status for valid request", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1", azureAdB2cId: "azure-user-id" })
        .mockResolvedValueOnce({ ID: "export-1", status: "ready" });

      const req = mockReq({ requestId: "export-1" });
      const handler = registeredHandlers["getExportStatus"];
      const result = await handler(req);

      expect(result.status).toBe("ready");
      expect(result.estimatedCompletionMinutes).toBe(0);
    });

    it("should reject when requestId is missing", async () => {
      const req = mockReq({});
      const handler = registeredHandlers["getExportStatus"];
      await expect(handler(req)).rejects.toThrow("requestId is required");
    });
  });

  describe("downloadExport", () => {
    it("should return download URL for ready export", async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      mockRun
        .mockResolvedValueOnce({ ID: "user-1", azureAdB2cId: "azure-user-id" })
        .mockResolvedValueOnce({
          ID: "export-1",
          status: "ready",
          downloadUrl: "https://storage/test.json",
          expiresAt: futureDate,
          fileSizeBytes: 1024,
        })
        .mockResolvedValueOnce(undefined); // UPDATE to downloaded

      const req = mockReq({ requestId: "export-1" });
      const handler = registeredHandlers["downloadExport"];
      const result = await handler(req);

      expect(result.downloadUrl).toBe("https://storage/test.json");
      expect(result.fileSizeBytes).toBe(1024);
    });

    it("should reject if export is not ready", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1", azureAdB2cId: "azure-user-id" })
        .mockResolvedValueOnce({ ID: "export-1", status: "processing" });

      const req = mockReq({ requestId: "export-1" });
      const handler = registeredHandlers["downloadExport"];
      await expect(handler(req)).rejects.toThrow("Export is not ready for download");
    });

    it("should reject if export has expired", async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      mockRun
        .mockResolvedValueOnce({ ID: "user-1", azureAdB2cId: "azure-user-id" })
        .mockResolvedValueOnce({
          ID: "export-1",
          status: "ready",
          expiresAt: pastDate,
        })
        .mockResolvedValueOnce(undefined); // UPDATE to expired

      const req = mockReq({ requestId: "export-1" });
      const handler = registeredHandlers["downloadExport"];
      await expect(handler(req)).rejects.toThrow("Export download has expired");
    });
  });

  describe("requestAnonymization", () => {
    it("should create anonymization request", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1", azureAdB2cId: "azure-user-id", isAnonymized: false })
        .mockResolvedValueOnce(null) // no existing request
        .mockResolvedValueOnce(undefined); // INSERT AnonymizationRequest

      const req = mockReq();
      const handler = registeredHandlers["requestAnonymization"];
      const result = await handler(req);

      expect(result.requestId).toBe("test-uuid-rgpd");
      expect(result.status).toBe("requested");
      expect(result.confirmationCode).toMatch(/^\d{6}$/);
      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ANONYMIZATION_REQUESTED",
          resource: "AnonymizationRequest",
        }),
      );
    });

    it("should reject if already anonymized", async () => {
      mockRun.mockResolvedValueOnce({ ID: "user-1", isAnonymized: true });

      const req = mockReq();
      const handler = registeredHandlers["requestAnonymization"];
      await expect(handler(req)).rejects.toThrow("Account is already anonymized");
    });

    it("should return existing request if pending", async () => {
      mockRun.mockResolvedValueOnce({ ID: "user-1", isAnonymized: false }).mockResolvedValueOnce({
        ID: "existing-req",
        status: "requested",
        anonymizedFields: JSON.stringify({ confirmationCode: "654321" }),
      });

      const req = mockReq();
      const handler = registeredHandlers["requestAnonymization"];
      const result = await handler(req);

      expect(result.requestId).toBe("existing-req");
      expect(result.confirmationCode).toBe("654321");
    });
  });

  describe("confirmAnonymization", () => {
    it("should anonymize user successfully", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1", azureAdB2cId: "azure-user-id" }) // find user
        .mockResolvedValueOnce({
          ID: "anon-req-1",
          user_ID: "user-1",
          status: "requested",
          anonymizedFields: JSON.stringify({ confirmationCode: "123456" }),
        }) // find request
        .mockResolvedValueOnce(undefined) // UPDATE status to processing
        .mockResolvedValueOnce(undefined) // UPDATE User (anonymize)
        .mockResolvedValueOnce(undefined); // UPDATE AnonymizationRequest (completed)

      const req = mockReq({ requestId: "anon-req-1", confirmationCode: "123456" });
      const handler = registeredHandlers["confirmAnonymization"];
      const result = await handler(req);

      expect(result.success).toBe(true);
      expect(result.requestId).toBe("anon-req-1");
      expect(mockAdapter.disableUser).toHaveBeenCalledWith("azure-user-id");
      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ANONYMIZATION_COMPLETED",
          resource: "AnonymizationRequest",
        }),
      );
    });

    it("should reject invalid confirmation code", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1", azureAdB2cId: "azure-user-id" })
        .mockResolvedValueOnce({
          ID: "anon-req-1",
          status: "requested",
          anonymizedFields: JSON.stringify({ confirmationCode: "123456" }),
        });

      const req = mockReq({ requestId: "anon-req-1", confirmationCode: "999999" });
      const handler = registeredHandlers["confirmAnonymization"];
      await expect(handler(req)).rejects.toThrow("Invalid confirmation code");
    });

    it("should reject when request not found", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1", azureAdB2cId: "azure-user-id" })
        .mockResolvedValueOnce(null);

      const req = mockReq({ requestId: "unknown", confirmationCode: "123456" });
      const handler = registeredHandlers["confirmAnonymization"];
      await expect(handler(req)).rejects.toThrow("Anonymization request not found");
    });

    it("should reject when missing required fields", async () => {
      const req = mockReq({});
      const handler = registeredHandlers["confirmAnonymization"];
      await expect(handler(req)).rejects.toThrow("requestId and confirmationCode are required");
    });

    it("should continue anonymization even if AD B2C disable fails", async () => {
      mockAdapter.disableUser.mockRejectedValueOnce(new Error("AD B2C error"));

      mockRun
        .mockResolvedValueOnce({ ID: "user-1", azureAdB2cId: "azure-user-id" })
        .mockResolvedValueOnce({
          ID: "anon-req-1",
          status: "requested",
          anonymizedFields: JSON.stringify({ confirmationCode: "123456" }),
        })
        .mockResolvedValueOnce(undefined) // processing
        .mockResolvedValueOnce(undefined) // anonymize user
        .mockResolvedValueOnce(undefined); // completed

      const req = mockReq({ requestId: "anon-req-1", confirmationCode: "123456" });
      const handler = registeredHandlers["confirmAnonymization"];
      const result = await handler(req);

      expect(result.success).toBe(true);
    });
  });
});
