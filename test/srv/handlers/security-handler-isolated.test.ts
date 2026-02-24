/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Isolated tests for security-handler getGraphClient env validation
 * and authProvider callback paths. These tests run in a fresh module
 * so the graphClient singleton is null and Client.init is called.
 */

// Capture authProvider callback when Client.init is called
let capturedAuthProvider:
  | ((done: (err: Error | null, token: string | null) => void) => void)
  | null = null;

const mockPatch = jest.fn().mockResolvedValue({});
const mockGraphClient = {
  api: jest.fn().mockReturnThis(),
  patch: mockPatch,
};

const mockGetToken = jest.fn().mockResolvedValue({ token: "mock-token" });

// Mock @sap/cds
jest.mock("@sap/cds", () => ({
  __esModule: true,
  default: {
    ql: {
      SELECT: {
        one: {
          from: jest.fn().mockReturnValue({ where: jest.fn() }),
        },
      },
    },
  },
}));

// Mock Graph client — capture authProvider
jest.mock("@microsoft/microsoft-graph-client", () => ({
  Client: {
    init: jest.fn((opts: any) => {
      capturedAuthProvider = opts.authProvider;
      return mockGraphClient;
    }),
  },
}));

// Mock Azure Identity
jest.mock("@azure/identity", () => ({
  ClientSecretCredential: jest.fn().mockImplementation(() => ({
    getToken: mockGetToken,
  })),
}));

describe("security-handler — getGraphClient & authProvider", () => {
  const originalEnv = { ...process.env };

  // L75: Missing env vars — must test BEFORE any successful getGraphClient call
  // because the singleton caches the result
  describe("missing env vars (L75)", () => {
    it("should reject 502 when all Graph API env vars are missing", async () => {
      // Remove env vars before importing to test the validation path
      delete process.env.AZURE_AD_B2C_TENANT_ID;
      delete process.env.AZURE_AD_B2C_GRAPH_CLIENT_ID;
      delete process.env.AZURE_AD_B2C_CLIENT_SECRET;

      // Import fresh (singleton is null in this test file)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SecurityHandler } = require("../../../srv/handlers/security-handler");
      const handler = new SecurityHandler();

      const mockUser = { azureAdB2cId: "azure-id-envtest" };
      const mockCds = {
        run: jest.fn().mockResolvedValue(mockUser),
        entities: jest.fn().mockReturnValue({ User: "auto.User" }),
      };

      const req = {
        data: { enable: true },
        user: { id: "user-1", roles: ["seller"] },
        reject: jest.fn(),
      };

      await handler.handleToggle2FA(req, mockCds);

      // getGraphClient throws because env vars are missing.
      // The error has no 'code' property, so it hits the catch block → req.reject(502)
      expect(req.reject).toHaveBeenCalledWith(502, "Failed to update MFA settings in Azure AD B2C");

      // Restore env vars for subsequent tests
      process.env.AZURE_AD_B2C_TENANT_ID = "test-tenant-id";
      process.env.AZURE_AD_B2C_GRAPH_CLIENT_ID = "test-graph-client-id";
      process.env.AZURE_AD_B2C_CLIENT_SECRET = "test-client-secret";
    });
  });

  // L84-88: authProvider callback — these tests must run after env vars are set
  // and after the first successful getGraphClient call that captures authProvider
  describe("authProvider callback (L84-88)", () => {
    beforeAll(async () => {
      // Ensure env vars are set
      process.env.AZURE_AD_B2C_TENANT_ID = "test-tenant-id";
      process.env.AZURE_AD_B2C_GRAPH_CLIENT_ID = "test-graph-client-id";
      process.env.AZURE_AD_B2C_CLIENT_SECRET = "test-client-secret";

      // Trigger getGraphClient to capture the authProvider
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SecurityHandler } = require("../../../srv/handlers/security-handler");
      const handler = new SecurityHandler();

      const mockUser = { azureAdB2cId: "azure-id-init" };
      const mockCds = {
        run: jest.fn().mockResolvedValue(mockUser),
        entities: jest.fn().mockReturnValue({ User: "auto.User" }),
      };

      const req = {
        data: { enable: true },
        user: { id: "user-1", roles: ["seller"] },
        reject: jest.fn(),
      };

      await handler.handleToggle2FA(req, mockCds);
    });

    it("should pass token to done callback on getToken success", async () => {
      expect(capturedAuthProvider).not.toBeNull();

      mockGetToken.mockResolvedValueOnce({ token: "fresh-token-123" });

      const done = jest.fn();
      await capturedAuthProvider!(done);

      expect(mockGetToken).toHaveBeenCalledWith("https://graph.microsoft.com/.default");
      expect(done).toHaveBeenCalledWith(null, "fresh-token-123");
    });

    it("should pass error to done callback on getToken failure", async () => {
      expect(capturedAuthProvider).not.toBeNull();

      const tokenError = new Error("Token acquisition failed");
      mockGetToken.mockRejectedValueOnce(tokenError);

      const done = jest.fn();
      await capturedAuthProvider!(done);

      expect(done).toHaveBeenCalledWith(tokenError, null);
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });
});
