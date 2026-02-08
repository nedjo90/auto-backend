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

import { SecurityHandler } from "../../../srv/handlers/security-handler";

// Mock the Graph Client adapter
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

describe("security-handler", () => {
  let handler: SecurityHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new SecurityHandler();
  });

  describe("toggle2FA", () => {
    it("should reject if user is not authenticated", async () => {
      const req = {
        data: { enable: true },
        user: { id: null },
        reject: jest.fn(),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await handler.handleToggle2FA(req as any);

      expect(req.reject).toHaveBeenCalledWith(401, expect.any(String));
    });

    it("should reject if user does not have Seller role", async () => {
      const req = {
        data: { enable: true },
        user: { id: "user-1", roles: ["buyer"] },
        reject: jest.fn(),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await handler.handleToggle2FA(req as any);

      expect(req.reject).toHaveBeenCalledWith(403, expect.any(String));
    });

    it("should succeed for Seller role user", async () => {
      const mockUser = { azureAdB2cId: "azure-id-123" };
      const mockCds = {
        run: jest.fn().mockResolvedValue(mockUser),
        entities: jest.fn().mockReturnValue({ User: "auto.User" }),
      };

      const req = {
        data: { enable: true },
        user: {
          id: "user-1",
          roles: ["seller"],
        },
        reject: jest.fn(),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await handler.handleToggle2FA(req as any, mockCds as any);

      // Should not reject
      expect(req.reject).not.toHaveBeenCalledWith(401, expect.any(String));
      expect(req.reject).not.toHaveBeenCalledWith(403, expect.any(String));
      expect(result).toEqual({
        success: true,
        mfaStatus: "enabled",
      });
    });
  });
});
