/* eslint-disable @typescript-eslint/no-explicit-any */
// Mock audit-logger
jest.mock("../../../srv/lib/audit-logger", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

// Mock rbac-utils
jest.mock("../../../srv/lib/rbac-utils", () => ({
  resolveUserPermissions: jest.fn(),
  extractIpAddress: jest.fn().mockReturnValue("127.0.0.1"),
}));

import { requirePermission, hasPermission } from "../../../srv/middleware/rbac-middleware";
import { logAudit } from "../../../srv/lib/audit-logger";
import { resolveUserPermissions } from "../../../srv/lib/rbac-utils";

const mockResolvePermissions = resolveUserPermissions as jest.Mock;
const mockLogAudit = logAudit as jest.Mock;

function createMockReq(user?: any) {
  return {
    user,
    originalUrl: "/api/test",
    headers: { "x-forwarded-for": "127.0.0.1" },
    ip: "127.0.0.1",
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

describe("rbac-middleware - requirePermission", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should call next() when user has required permission", async () => {
    mockResolvePermissions.mockResolvedValueOnce(["listing.create"]);

    const middleware = requirePermission("listing.create");
    const req = createMockReq({
      id: "user-1",
      roles: ["seller"],
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req as any, res as any, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should return 403 when user lacks required permission", async () => {
    mockResolvePermissions.mockResolvedValueOnce(["listing.view"]);

    const middleware = requirePermission("listing.create");
    const req = createMockReq({
      id: "user-1",
      roles: ["buyer"],
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "https://httpstatuses.com/403",
        title: "Forbidden",
        status: 403,
      }),
    );
  });

  it("should log audit event on permission denied", async () => {
    mockResolvePermissions.mockResolvedValueOnce(["listing.view"]);

    const middleware = requirePermission("admin.access");
    const req = createMockReq({
      id: "user-1",
      roles: ["buyer"],
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req as any, res as any, next);

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "permission.denied",
        resource: "/api/test",
      }),
    );
  });

  it("should return 403 when no user context", async () => {
    const middleware = requirePermission("listing.create");
    const req = createMockReq(undefined);
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("should return 403 when user has no ID", async () => {
    const middleware = requirePermission("listing.create");
    const req = createMockReq({ roles: ["buyer"] });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("should return 500 on error", async () => {
    mockResolvePermissions.mockRejectedValueOnce(new Error("DB connection failed"));

    const middleware = requirePermission("listing.create");
    const req = createMockReq({
      id: "user-1",
      roles: ["buyer"],
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/problem+json");
  });

  it("should use RFC 7807 format for 403 response", async () => {
    mockResolvePermissions.mockResolvedValueOnce([]);

    const middleware = requirePermission("listing.create");
    const req = createMockReq({
      id: "user-1",
      roles: [],
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req as any, res as any, next);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/problem+json");
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringContaining("403"),
        title: "Forbidden",
        status: 403,
        detail: expect.stringContaining("listing.create"),
        instance: "/api/test",
      }),
    );
  });
});

describe("rbac-middleware - hasPermission", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return true when user has permission", async () => {
    mockResolvePermissions.mockResolvedValueOnce(["listing.create", "listing.view"]);

    const result = await hasPermission("user-1", "listing.create");
    expect(result).toBe(true);
  });

  it("should return false when user lacks permission", async () => {
    mockResolvePermissions.mockResolvedValueOnce(["listing.view"]);

    const result = await hasPermission("user-1", "listing.create");
    expect(result).toBe(false);
  });

  it("should return false when user has no roles", async () => {
    mockResolvePermissions.mockResolvedValueOnce([]);

    const result = await hasPermission("user-1", "listing.create");
    expect(result).toBe(false);
  });
});
