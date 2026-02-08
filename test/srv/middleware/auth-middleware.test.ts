import { createAuthMiddleware } from "../../../srv/middleware/auth-middleware";

// Mock jwt-validator
jest.mock("../../../srv/lib/jwt-validator", () => ({
  validateToken: jest.fn(),
  JwtValidationError: class JwtValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "JwtValidationError";
    }
  },
}));

import { validateToken } from "../../../srv/lib/jwt-validator";

const mockValidateToken = validateToken as jest.MockedFunction<
  typeof validateToken
>;

// Helper to create mock Express req/res/next
function createMockReq(headers: Record<string, string> = {}) {
  return {
    headers,
    user: undefined as unknown,
    path: "/api/test",
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
  let middleware: ReturnType<typeof createAuthMiddleware>;

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = createAuthMiddleware();
  });

  it("should inject user context on valid token", async () => {
    const decoded = {
      sub: "azure-user-id-123",
      email: "test@example.com",
      name: "Test User",
    };
    mockValidateToken.mockResolvedValue(decoded);

    const req = createMockReq({ authorization: "Bearer valid-token" });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req as any, res as any, next);

    expect(req.user).toBeDefined();
    expect((req.user as any).azureAdB2cId).toBe("azure-user-id-123");
    expect((req.user as any).email).toBe("test@example.com");
    expect(next).toHaveBeenCalled();
  });

  it("should return 401 on missing Authorization header", async () => {
    const req = createMockReq({});
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.any(String),
        title: expect.any(String),
        status: 401,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 on expired token", async () => {
    const { JwtValidationError } = jest.requireMock(
      "../../../srv/lib/jwt-validator",
    );
    mockValidateToken.mockRejectedValue(
      new JwtValidationError("Token expired"),
    );

    const req = createMockReq({ authorization: "Bearer expired-token" });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 on invalid signature", async () => {
    const { JwtValidationError } = jest.requireMock(
      "../../../srv/lib/jwt-validator",
    );
    mockValidateToken.mockRejectedValue(
      new JwtValidationError("Invalid signature"),
    );

    const req = createMockReq({
      authorization: "Bearer invalid-signature-token",
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 on malformed Bearer format", async () => {
    const req = createMockReq({ authorization: "NotBearer token" });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should query user roles from database", async () => {
    const decoded = {
      sub: "azure-user-id-456",
      email: "seller@example.com",
      name: "Seller User",
    };
    mockValidateToken.mockResolvedValue(decoded);

    const req = createMockReq({ authorization: "Bearer valid-token" });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req as any, res as any, next);

    expect(req.user).toBeDefined();
    expect((req.user as any).azureAdB2cId).toBe("azure-user-id-456");
    expect((req.user as any).roles).toBeDefined();
    expect(Array.isArray((req.user as any).roles)).toBe(true);
    expect(next).toHaveBeenCalled();
  });
});
