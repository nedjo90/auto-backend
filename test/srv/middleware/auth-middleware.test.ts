/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock jwt-validator
const mockValidateToken = jest.fn();

class MockJwtValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtValidationError";
  }
}

jest.mock("../../../srv/lib/jwt-validator", () => ({
  validateToken: mockValidateToken,
  JwtValidationError: MockJwtValidationError,
}));

// Mock @sap/cds — used via require() inside the middleware
const mockCdsRun = jest.fn();
const mockCdsEntities = jest.fn();
const mockCdsWhere = jest.fn();
const mockCdsFromOne = jest.fn().mockReturnValue({ where: mockCdsWhere });
const mockCdsFrom = jest.fn().mockReturnValue({ where: mockCdsWhere });
let cdsModuleShouldThrow = false;

jest.mock("@sap/cds", () => {
  // If configured to throw, simulate CDS being unavailable
  if (cdsModuleShouldThrow) {
    throw new Error("CDS not available");
  }
  return {
    entities: mockCdsEntities,
    run: mockCdsRun,
    ql: {
      SELECT: {
        one: { from: mockCdsFromOne },
        from: mockCdsFrom,
      },
    },
  };
});

import { createAuthMiddleware } from "../../../srv/middleware/auth-middleware";

// Helper to create mock Express req/res/next
function createMockReq(headers: Record<string, string> = {}, overrides: Record<string, any> = {}) {
  return {
    headers,
    originalUrl: "/api/test",
    user: undefined as unknown,
    ...overrides,
  };
}

function createMockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };
  return res;
}

function createMockNext() {
  return jest.fn();
}

describe("auth-middleware", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    cdsModuleShouldThrow = false;
    // Default: Azure configured, test mode — so JWT validation is required
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      AZURE_AD_B2C_TENANT_NAME: "test-tenant",
      AZURE_AD_B2C_CLIENT_ID: "test-client-id",
      AZURE_AD_B2C_TENANT_ID: "test-tenant-id",
    };

    // Default CDS mock: entities returns User, UserRole, Role
    mockCdsEntities.mockReturnValue({
      User: "auto.User",
      UserRole: "auto.UserRole",
      Role: "auto.Role",
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("valid token flow", () => {
    it("should inject user context on valid token", async () => {
      const decoded = {
        sub: "azure-user-id-123",
        email: "test@example.com",
        name: "Test User",
      };
      mockValidateToken.mockResolvedValue(decoded);
      // CDS: user not found (simplest path)
      mockCdsRun.mockResolvedValueOnce(null);

      const middleware = createAuthMiddleware();
      const req = createMockReq({ authorization: "Bearer valid-token" });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(req.user).toBeDefined();
      expect((req.user as any).azureAdB2cId).toBe("azure-user-id-123");
      expect((req.user as any).email).toBe("test@example.com");
      expect(next).toHaveBeenCalled();
    });
  });

  describe("missing/invalid auth header", () => {
    it("should return 401 on missing Authorization header", async () => {
      const middleware = createAuthMiddleware();
      const req = createMockReq({});
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/problem+json");
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "https://httpstatuses.com/401",
          title: "Unauthorized",
          status: 401,
          detail: "Missing Authorization header",
          instance: "/api/test",
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 401 on malformed Bearer format", async () => {
      const middleware = createAuthMiddleware();
      const req = createMockReq({ authorization: "Basic user:pass" });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: "Invalid Authorization header format",
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    // L85-86: Empty Bearer token
    it("should return 401 on empty Bearer token", async () => {
      const middleware = createAuthMiddleware();
      const req = createMockReq({ authorization: "Bearer " });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: "Empty Bearer token",
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("token validation errors", () => {
    it("should return 401 on expired token (JwtValidationError)", async () => {
      mockValidateToken.mockRejectedValue(new MockJwtValidationError("Token expired"));

      const middleware = createAuthMiddleware();
      const req = createMockReq({ authorization: "Bearer expired-token" });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: "Token expired",
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    // L148: Non-JwtValidationError thrown from validateToken
    it("should return 401 with generic message on non-JwtValidationError", async () => {
      mockValidateToken.mockRejectedValue(new Error("Unexpected network error"));

      const middleware = createAuthMiddleware();
      const req = createMockReq({ authorization: "Bearer bad-token" });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: "Authentication failed",
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  // L68-69: Dev mode fallback — Azure not configured, not production, not test
  describe("dev mode fallback", () => {
    it("should pass through to next() when Azure is not configured in development", async () => {
      // Remove Azure config and set to development mode
      delete process.env.AZURE_AD_B2C_TENANT_NAME;
      delete process.env.AZURE_AD_B2C_CLIENT_ID;
      delete process.env.AZURE_AD_B2C_TENANT_ID;
      process.env.NODE_ENV = "development";

      const middleware = createAuthMiddleware();
      const req = createMockReq({}); // No auth header at all
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      // Should call next() without any 401 response
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should NOT pass through in test mode even when Azure is not configured", async () => {
      delete process.env.AZURE_AD_B2C_TENANT_NAME;
      delete process.env.AZURE_AD_B2C_CLIENT_ID;
      delete process.env.AZURE_AD_B2C_TENANT_ID;
      process.env.NODE_ENV = "test";

      const middleware = createAuthMiddleware();
      const req = createMockReq({});
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      // Should return 401, not pass through
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // L106-121: CDS role lookup — full path with user found, roles resolved
  describe("CDS role lookup", () => {
    it("should resolve user roles via CDS and expand with hierarchy", async () => {
      const decoded = {
        sub: "azure-user-id-456",
        email: "seller@example.com",
        name: "Seller User",
      };
      mockValidateToken.mockResolvedValue(decoded);

      // CDS: user found, roles found
      mockCdsRun
        .mockResolvedValueOnce({
          ID: "user-db-id-1",
          azureAdB2cId: "azure-user-id-456",
        }) // SELECT user
        .mockResolvedValueOnce([{ role_ID: "role-1" }]) // SELECT userRoles
        .mockResolvedValueOnce([{ code: "seller" }]); // SELECT roles

      const middleware = createAuthMiddleware();
      const req = createMockReq({ authorization: "Bearer valid-token" });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(req.user).toBeDefined();
      expect((req.user as any).azureAdB2cId).toBe("azure-user-id-456");
      expect((req.user as any).id).toBe("user-db-id-1");
      expect((req.user as any).roles).toBeDefined();
      expect(Array.isArray((req.user as any).roles)).toBe(true);
      // "seller" should be expanded via hierarchy to include visitor, buyer, seller
      expect((req.user as any).roles).toContain("seller");
      expect(next).toHaveBeenCalled();
    });

    it("should set empty roles when user is not found in database", async () => {
      const decoded = {
        sub: "azure-user-new",
        email: "new@example.com",
      };
      mockValidateToken.mockResolvedValue(decoded);

      // CDS: user not found
      mockCdsRun.mockResolvedValueOnce(null);

      const middleware = createAuthMiddleware();
      const req = createMockReq({ authorization: "Bearer valid-token" });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(req.user).toBeDefined();
      expect((req.user as any).roles).toEqual([]);
      expect(next).toHaveBeenCalled();
    });

    it("should set empty roles when user has no role assignments", async () => {
      const decoded = {
        sub: "azure-user-noroles",
        email: "noroles@example.com",
      };
      mockValidateToken.mockResolvedValue(decoded);

      // CDS: user found, empty userRoles
      mockCdsRun
        .mockResolvedValueOnce({
          ID: "user-db-id-2",
          azureAdB2cId: "azure-user-noroles",
        })
        .mockResolvedValueOnce([]); // empty userRoles

      const middleware = createAuthMiddleware();
      const req = createMockReq({ authorization: "Bearer valid-token" });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(req.user).toBeDefined();
      expect((req.user as any).id).toBe("user-db-id-2");
      expect((req.user as any).roles).toEqual([]);
      expect(next).toHaveBeenCalled();
    });

    // L117-118: filter out invalid role codes
    it("should filter out invalid role codes not in ROLES constant", async () => {
      const decoded = {
        sub: "azure-user-mixed",
        email: "mixed@example.com",
      };
      mockValidateToken.mockResolvedValue(decoded);

      // CDS: user found with mix of valid/invalid roles
      mockCdsRun
        .mockResolvedValueOnce({
          ID: "user-db-id-3",
          azureAdB2cId: "azure-user-mixed",
        })
        .mockResolvedValueOnce([{ role_ID: "role-1" }, { role_ID: "role-2" }])
        .mockResolvedValueOnce([{ code: "seller" }, { code: "invalid_role_xyz" }]);

      const middleware = createAuthMiddleware();
      const req = createMockReq({ authorization: "Bearer valid-token" });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(req.user).toBeDefined();
      const roles = (req.user as any).roles;
      // "seller" is valid (and hierarchy expanded), "invalid_role_xyz" is filtered out
      expect(roles).toContain("seller");
      expect(roles).not.toContain("invalid_role_xyz");
      expect(next).toHaveBeenCalled();
    });

    // L130-136: CDS error in production — return 503
    it("should return 503 when CDS role lookup fails in production", async () => {
      const decoded = {
        sub: "azure-user-prod",
        email: "prod@example.com",
      };
      mockValidateToken.mockResolvedValue(decoded);
      process.env.NODE_ENV = "production";

      // CDS: entities throws
      mockCdsEntities.mockImplementation(() => {
        throw new Error("CDS connection failed");
      });

      const middleware = createAuthMiddleware();
      const req = createMockReq({ authorization: "Bearer valid-token" });
      const res = createMockRes();
      const next = createMockNext();

      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await middleware(req as any, res as any, next);

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/problem+json");
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "https://httpstatuses.com/503",
          title: "Service Unavailable",
          status: 503,
          detail: "Authorization service temporarily unavailable",
        }),
      );
      expect(next).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    // CDS error in non-production — continue with empty roles
    it("should continue with empty roles when CDS fails in non-production", async () => {
      const decoded = {
        sub: "azure-user-dev",
        email: "dev@example.com",
      };
      mockValidateToken.mockResolvedValue(decoded);
      process.env.NODE_ENV = "test";

      // CDS: entities throws
      mockCdsEntities.mockImplementation(() => {
        throw new Error("CDS not available");
      });

      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const middleware = createAuthMiddleware();
      const req = createMockReq({ authorization: "Bearer valid-token" });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(req.user).toBeDefined();
      expect((req.user as any).roles).toEqual([]);
      expect(next).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  // Branch coverage: sendUnauthorized without instance parameter (L32)
  describe("sendUnauthorized without instance", () => {
    it("should omit instance field when originalUrl is undefined", async () => {
      const middleware = createAuthMiddleware();
      // Pass a request with no originalUrl to trigger sendUnauthorized without instance
      const req = createMockReq({}, { originalUrl: undefined });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      // The response should NOT contain an 'instance' field
      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg).not.toHaveProperty("instance");
      expect(jsonArg).toEqual({
        type: "https://httpstatuses.com/401",
        title: "Unauthorized",
        status: 401,
        detail: "Missing Authorization header",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should omit instance field when originalUrl is empty string", async () => {
      const middleware = createAuthMiddleware();
      const req = createMockReq({}, { originalUrl: "" });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      const jsonArg = res.json.mock.calls[0][0];
      // Empty string is falsy, so instance should be omitted
      expect(jsonArg).not.toHaveProperty("instance");
      expect(next).not.toHaveBeenCalled();
    });
  });
});
