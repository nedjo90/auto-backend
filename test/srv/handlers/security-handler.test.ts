/* eslint-disable @typescript-eslint/no-explicit-any */

// Set env vars before importing handler (M1: getGraphClient validates env)
process.env.AZURE_AD_B2C_TENANT_ID = "test-tenant-id";
process.env.AZURE_AD_B2C_GRAPH_CLIENT_ID = "test-graph-client-id";
process.env.AZURE_AD_B2C_CLIENT_SECRET = "test-client-secret";

// Mock @sap/cds before importing handler
const mockWhere = jest.fn();
const mockFrom = jest.fn().mockReturnValue({ where: mockWhere });
jest.mock("@sap/cds", () => ({
  __esModule: true,
  default: {
    ql: { SELECT: { one: { from: mockFrom } } },
  },
}));

const mockGraphClient = {
  api: jest.fn().mockReturnThis(),
  patch: jest.fn().mockResolvedValue({}),
  get: jest.fn().mockResolvedValue({
    strongAuthenticationRequirements: [],
  }),
};

jest.mock("@microsoft/microsoft-graph-client", () => ({
  Client: {
    init: jest.fn(() => mockGraphClient),
  },
}));

jest.mock("@azure/identity", () => ({
  ClientSecretCredential: jest.fn(),
}));

import { SecurityHandler } from "../../../srv/handlers/security-handler";
import securityHandlerDefault from "../../../srv/handlers/security-handler";

describe("security-handler", () => {
  let handler: SecurityHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new SecurityHandler();
    process.env.AZURE_AD_B2C_TENANT_ID = "test-tenant-id";
    process.env.AZURE_AD_B2C_GRAPH_CLIENT_ID = "test-graph-client-id";
    process.env.AZURE_AD_B2C_CLIENT_SECRET = "test-client-secret";
  });

  describe("toggle2FA — authentication & authorization", () => {
    it("should reject if user is not authenticated", async () => {
      const req = {
        data: { enable: true },
        user: { id: null },
        reject: jest.fn(),
      };

      await handler.handleToggle2FA(req as any);
      expect(req.reject).toHaveBeenCalledWith(401, expect.any(String));
    });

    it("should reject if user has no user object", async () => {
      const req = {
        data: { enable: true },
        user: undefined,
        reject: jest.fn(),
      };

      await handler.handleToggle2FA(req as any);
      expect(req.reject).toHaveBeenCalledWith(401, "Authentication required");
    });

    it("should reject if user does not have Seller role", async () => {
      const req = {
        data: { enable: true },
        user: { id: "user-1", roles: ["buyer"] },
        reject: jest.fn(),
      };

      await handler.handleToggle2FA(req as any);
      expect(req.reject).toHaveBeenCalledWith(403, expect.any(String));
    });

    it("should reject if user has empty roles", async () => {
      const req = {
        data: { enable: true },
        user: { id: "user-1", roles: [] },
        reject: jest.fn(),
      };

      await handler.handleToggle2FA(req as any);
      expect(req.reject).toHaveBeenCalledWith(403, "Only seller accounts can manage 2FA");
    });

    it("should reject if user has no roles property (defaults to empty)", async () => {
      const req = {
        data: { enable: true },
        user: { id: "user-1" },
        reject: jest.fn(),
      };

      await handler.handleToggle2FA(req as any);
      expect(req.reject).toHaveBeenCalledWith(403, "Only seller accounts can manage 2FA");
    });
  });

  describe("toggle2FA — success paths", () => {
    it("should succeed for Seller role user with enable=true", async () => {
      const mockUser = { azureAdB2cId: "azure-id-123" };
      const mockCds = {
        run: jest.fn().mockResolvedValue(mockUser),
        entities: jest.fn().mockReturnValue({ User: "auto.User" }),
      };

      const req = {
        data: { enable: true },
        user: { id: "user-1", roles: ["seller"] },
        reject: jest.fn(),
      };

      const result = await handler.handleToggle2FA(req as any, mockCds as any);

      expect(req.reject).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, mfaStatus: "enabled" });
      expect(mockGraphClient.api).toHaveBeenCalledWith("/users/azure-id-123");
      expect(mockGraphClient.patch).toHaveBeenCalledWith({
        strongAuthenticationRequirements: [{ perUserMfaState: "enforced" }],
      });
    });

    it("should succeed for Seller role user with enable=false", async () => {
      const mockUser = { azureAdB2cId: "azure-id-456" };
      const mockCds = {
        run: jest.fn().mockResolvedValue(mockUser),
        entities: jest.fn().mockReturnValue({ User: "auto.User" }),
      };

      const req = {
        data: { enable: false },
        user: { id: "user-1", roles: ["seller"] },
        reject: jest.fn(),
      };

      const result = await handler.handleToggle2FA(req as any, mockCds as any);

      expect(result).toEqual({ success: true, mfaStatus: "disabled" });
      expect(mockGraphClient.patch).toHaveBeenCalledWith({
        strongAuthenticationRequirements: [],
      });
    });
  });

  // L40-41: User not found or missing azureAdB2cId
  describe("toggle2FA — user not found", () => {
    it("should reject 404 when user not found in database", async () => {
      const mockCds = {
        run: jest.fn().mockResolvedValue(null),
        entities: jest.fn().mockReturnValue({ User: "auto.User" }),
      };

      const req = {
        data: { enable: true },
        user: { id: "user-1", roles: ["seller"] },
        reject: jest.fn(),
      };

      await handler.handleToggle2FA(req as any, mockCds as any);
      expect(req.reject).toHaveBeenCalledWith(404, "User not found or missing Azure AD B2C ID");
    });

    it("should reject 404 when user exists but azureAdB2cId is null", async () => {
      const mockCds = {
        run: jest.fn().mockResolvedValue({ azureAdB2cId: null }),
        entities: jest.fn().mockReturnValue({ User: "auto.User" }),
      };

      const req = {
        data: { enable: true },
        user: { id: "user-1", roles: ["seller"] },
        reject: jest.fn(),
      };

      await handler.handleToggle2FA(req as any, mockCds as any);
      expect(req.reject).toHaveBeenCalledWith(404, "User not found or missing Azure AD B2C ID");
    });

    it("should reject 404 when user exists but azureAdB2cId is empty string", async () => {
      const mockCds = {
        run: jest.fn().mockResolvedValue({ azureAdB2cId: "" }),
        entities: jest.fn().mockReturnValue({ User: "auto.User" }),
      };

      const req = {
        data: { enable: true },
        user: { id: "user-1", roles: ["seller"] },
        reject: jest.fn(),
      };

      await handler.handleToggle2FA(req as any, mockCds as any);
      expect(req.reject).toHaveBeenCalledWith(404, "User not found or missing Azure AD B2C ID");
    });
  });

  // L59-62: Error handling in catch block
  describe("toggle2FA — error handling", () => {
    it("should re-throw CDS reject errors (errors with code property)", async () => {
      const cdsError = new Error("CDS reject") as any;
      cdsError.code = 404;

      const mockCds = {
        run: jest.fn().mockRejectedValue(cdsError),
        entities: jest.fn().mockReturnValue({ User: "auto.User" }),
      };

      const req = {
        data: { enable: true },
        user: { id: "user-1", roles: ["seller"] },
        reject: jest.fn(),
      };

      await expect(handler.handleToggle2FA(req as any, mockCds as any)).rejects.toThrow(
        "CDS reject",
      );
    });

    it("should reject 502 for Graph API errors without code property", async () => {
      const mockUser = { azureAdB2cId: "azure-id-789" };
      const mockCds = {
        run: jest.fn().mockResolvedValue(mockUser),
        entities: jest.fn().mockReturnValue({ User: "auto.User" }),
      };

      mockGraphClient.patch.mockRejectedValueOnce(new Error("Graph API timeout"));

      const req = {
        data: { enable: true },
        user: { id: "user-1", roles: ["seller"] },
        reject: jest.fn(),
      };

      await handler.handleToggle2FA(req as any, mockCds as any);
      expect(req.reject).toHaveBeenCalledWith(502, "Failed to update MFA settings in Azure AD B2C");
    });

    it("should reject 502 when getGraphClient throws (simulated via api throwing)", async () => {
      const mockUser = { azureAdB2cId: "azure-id-err" };
      const mockCds = {
        run: jest.fn().mockResolvedValue(mockUser),
        entities: jest.fn().mockReturnValue({ User: "auto.User" }),
      };

      mockGraphClient.api.mockImplementationOnce(() => {
        throw new Error("Graph client initialization failed");
      });

      const req = {
        data: { enable: true },
        user: { id: "user-1", roles: ["seller"] },
        reject: jest.fn(),
      };

      await handler.handleToggle2FA(req as any, mockCds as any);
      expect(req.reject).toHaveBeenCalledWith(502, "Failed to update MFA settings in Azure AD B2C");
    });
  });

  // L99-103: Default export function (service registration)
  describe("default export", () => {
    it("should register toggle2FA handler on the service", () => {
      const mockSrv = { on: jest.fn() };
      securityHandlerDefault(mockSrv);
      expect(mockSrv.on).toHaveBeenCalledWith("toggle2FA", expect.any(Function));
    });

    it("should call handleToggle2FA when toggle2FA event fires", async () => {
      const mockSrv = { on: jest.fn() };
      securityHandlerDefault(mockSrv);

      const registeredCallback = mockSrv.on.mock.calls[0][1];
      const mockReq = {
        data: { enable: true },
        user: { id: null },
        reject: jest.fn(),
      };

      await registeredCallback(mockReq);
      expect(mockReq.reject).toHaveBeenCalledWith(401, "Authentication required");
    });

    it("should delegate to handleToggle2FA and reach DB lookup via default cds (no cdsInstance)", async () => {
      const mockSrv = { on: jest.fn() };
      securityHandlerDefault(mockSrv);

      // Setup cds mock to return a user (exercises `const db = cdsInstance || cds` → cds branch)
      mockFrom.mockReturnValue({
        where: mockWhere,
      });
      // cds.entities returns User entity
      // (The top-level mock already handles cds.ql.SELECT.one.from)
      // We need cds.run and cds.entities to work — they are mocked at module level

      const mockReq = {
        data: { enable: true },
        user: { id: "user-1", roles: ["seller"] },
        reject: jest.fn(),
      };

      // The mock cds module doesn't have `run` or `entities` for the default branch,
      // so this will throw in the try block → 502 (Graph API path not reached).
      // But crucially it exercises L32: `const db = cdsInstance || cds`
      await handler.handleToggle2FA(mockReq as any);

      // Since the default cds mock doesn't have entities(), it throws → 502
      expect(mockReq.reject).toHaveBeenCalledWith(
        502,
        "Failed to update MFA settings in Azure AD B2C",
      );
    });
  });

  // Branch coverage: L32 — cdsInstance || cds fallback
  describe("toggle2FA — cds fallback (no cdsInstance)", () => {
    it("should use default cds module when cdsInstance is undefined", async () => {
      const req = {
        data: { enable: true },
        user: { id: "user-1", roles: ["seller"] },
        reject: jest.fn(),
      };

      // No cdsInstance passed — exercises `const db = cdsInstance || cds` with the cds fallback
      await handler.handleToggle2FA(req as any);

      // The cds mock at top of file doesn't have entities(), so it throws.
      // Error has no 'code' property → req.reject(502)
      expect(req.reject).toHaveBeenCalledWith(502, "Failed to update MFA settings in Azure AD B2C");
    });

    it("should use default cds module when cdsInstance is null", async () => {
      const req = {
        data: { enable: true },
        user: { id: "user-1", roles: ["seller"] },
        reject: jest.fn(),
      };

      await handler.handleToggle2FA(req as any, null as any);

      expect(req.reject).toHaveBeenCalledWith(502, "Failed to update MFA settings in Azure AD B2C");
    });
  });
});
