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

      await handler.handleToggle2FA(req as any);

      expect(req.reject).toHaveBeenCalledWith(401, expect.any(String));
    });

    it("should reject if user does not have Seller role", async () => {
      const req = {
        data: { enable: true },
        user: { id: "user-1", attr: { roles: ["buyer"] } },
        reject: jest.fn(),
      };

      await handler.handleToggle2FA(req as any);

      expect(req.reject).toHaveBeenCalledWith(403, expect.any(String));
    });

    it("should succeed for Seller role user", async () => {
      const mockCds = {
        run: jest.fn().mockResolvedValue({ azureAdB2cId: "azure-id-123" }),
        ql: { SELECT: { one: { from: jest.fn().mockReturnValue({ where: jest.fn() }) } } },
      };

      const req = {
        data: { enable: true },
        user: {
          id: "user-1",
          attr: { roles: ["private_seller"] },
        },
        reject: jest.fn(),
      };

      const result = await handler.handleToggle2FA(req as any, mockCds as any);

      // Should not reject
      expect(req.reject).not.toHaveBeenCalledWith(401, expect.any(String));
      expect(req.reject).not.toHaveBeenCalledWith(403, expect.any(String));
    });
  });
});
