/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-function-type */
jest.mock("../../../srv/lib/audit-logger", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../srv/lib/rbac-utils", () => ({
  resolveUserPermissions: jest.fn().mockResolvedValue([]),
  extractIpAddress: jest.fn().mockReturnValue("127.0.0.1"),
}));

import { logAudit } from "../../../srv/lib/audit-logger";
import { resolveUserPermissions } from "../../../srv/lib/rbac-utils";

jest.mock("@sap/cds", () => {
  class MockApplicationService {
    on = jest.fn();
    async init() {}
  }
  return {
    __esModule: true,
    default: {
      ApplicationService: MockApplicationService,
      entities: jest.fn(() => ({
        Role: "Role",
        UserRole: "UserRole",
        User: "User",
        RolePermission: "RolePermission",
        Permission: "Permission",
      })),
      run: jest.fn(),
      utils: { uuid: jest.fn(() => "test-uuid-rbac") },
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require("@sap/cds").default;
const mockRun = cds.run as jest.Mock;
const mockLogAudit = logAudit as jest.Mock;

// Mock CDS query builders
(global as any).SELECT = {
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("select-query"),
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

(global as any).DELETE = {
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("delete-query"),
  }),
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RbacService = require("../../../srv/handlers/rbac-handler").default;

describe("RbacService handler", () => {
  let service: any;
  let registeredHandlers: Record<string, Function>;

  beforeEach(async () => {
    mockRun.mockReset();
    mockLogAudit.mockClear();

    registeredHandlers = {};
    service = new RbacService();
    service.on = jest.fn((event: string, entityOrHandler: any, handler?: any) => {
      const key = handler ? `${event}:${entityOrHandler}` : event;
      registeredHandlers[key] = handler || entityOrHandler;
    });
    await service.init();
  });

  it("should register assignRole, removeRole, and getUserPermissions handlers", () => {
    expect(service.on).toHaveBeenCalledWith("assignRole", expect.any(Function));
    expect(service.on).toHaveBeenCalledWith("removeRole", expect.any(Function));
    expect(service.on).toHaveBeenCalledWith("getUserPermissions", expect.any(Function));
  });

  describe("assignRole", () => {
    const mockReq = (data: any, roles: string[] = ["administrator"]) => ({
      data,
      user: { id: "admin-id", roles },
      headers: { "x-forwarded-for": "127.0.0.1" },
      reject: jest.fn((code: number, msg: string) => {
        const err: any = new Error(msg);
        err.code = code;
        throw err;
      }),
    });

    it("should assign role successfully", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1" }) // User exists
        .mockResolvedValueOnce({ ID: "role-1", code: "seller" }) // Role exists
        .mockResolvedValueOnce(null) // No existing assignment
        .mockResolvedValueOnce(undefined); // INSERT

      const req = mockReq({ userId: "user-1", roleCode: "seller" });
      const handler = registeredHandlers["assignRole"];
      const result = await handler(req);

      expect(result).toEqual({
        success: true,
        message: "Role 'seller' assigned",
      });
      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "role.assign",
          resource: "user/user-1",
        }),
      );
    });

    it("should reject non-admin callers with 403", async () => {
      const req = mockReq({ userId: "user-1", roleCode: "seller" }, ["buyer"]);
      const handler = registeredHandlers["assignRole"];

      await expect(handler(req)).rejects.toThrow("Only administrators can assign roles");
      expect(req.reject).toHaveBeenCalledWith(403, "Only administrators can assign roles");
    });

    it("should reject 404 when user not found", async () => {
      mockRun.mockResolvedValueOnce(null); // No user

      const req = mockReq({ userId: "no-user", roleCode: "seller" });
      const handler = registeredHandlers["assignRole"];

      await expect(handler(req)).rejects.toThrow("User not found");
      expect(req.reject).toHaveBeenCalledWith(404, "User not found");
    });

    it("should reject 400 for invalid role code", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1" }) // User exists
        .mockResolvedValueOnce(null); // Role not found

      const req = mockReq({ userId: "user-1", roleCode: "invalid" });
      const handler = registeredHandlers["assignRole"];

      await expect(handler(req)).rejects.toThrow("Invalid role code: invalid");
    });

    it("should return message when user already has role", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1" }) // User exists
        .mockResolvedValueOnce({ ID: "role-1", code: "seller" }) // Role exists
        .mockResolvedValueOnce({ ID: "existing" }); // Already assigned

      const req = mockReq({ userId: "user-1", roleCode: "seller" });
      const handler = registeredHandlers["assignRole"];
      const result = await handler(req);

      expect(result).toEqual({
        success: false,
        message: "User already has this role",
      });
    });
  });

  describe("removeRole", () => {
    const mockReq = (data: any, roles: string[] = ["administrator"]) => ({
      data,
      user: { id: "admin-id", roles },
      headers: { "x-forwarded-for": "127.0.0.1" },
      reject: jest.fn((code: number, msg: string) => {
        const err: any = new Error(msg);
        err.code = code;
        throw err;
      }),
    });

    it("should remove role successfully", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1" }) // User exists
        .mockResolvedValueOnce({ ID: "role-1", code: "seller" }) // Role exists
        .mockResolvedValueOnce({ ID: "assignment-1" }) // Assignment found
        .mockResolvedValueOnce(undefined) // DELETE
        .mockResolvedValueOnce([{ ID: "a2" }]); // Remaining roles after delete (safe)

      const req = mockReq({ userId: "user-1", roleCode: "seller" });
      const handler = registeredHandlers["removeRole"];
      const result = await handler(req);

      expect(result).toEqual({
        success: true,
        message: "Role 'seller' removed",
      });
      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "role.remove",
          resource: "user/user-1",
        }),
      );
    });

    it("should reject non-admin callers with 403", async () => {
      const req = mockReq({ userId: "user-1", roleCode: "seller" }, ["buyer"]);
      const handler = registeredHandlers["removeRole"];

      await expect(handler(req)).rejects.toThrow("Only administrators can remove roles");
    });

    it("should prevent removing last role", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1" }) // User exists
        .mockResolvedValueOnce({ ID: "role-1", code: "buyer" }) // Role exists
        .mockResolvedValueOnce({ ID: "assignment-1" }) // Assignment found
        .mockResolvedValueOnce(undefined) // DELETE
        .mockResolvedValueOnce([]); // No remaining roles after delete

      const req = mockReq({ userId: "user-1", roleCode: "buyer" });
      const handler = registeredHandlers["removeRole"];

      await expect(handler(req)).rejects.toThrow("Cannot remove user's last role");
      expect(req.reject).toHaveBeenCalledWith(400, "Cannot remove user's last role");
    });

    it("should return message when user does not have role", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "user-1" }) // User exists
        .mockResolvedValueOnce({ ID: "role-1", code: "seller" }) // Role exists
        .mockResolvedValueOnce(null); // No assignment

      const req = mockReq({ userId: "user-1", roleCode: "seller" });
      const handler = registeredHandlers["removeRole"];
      const result = await handler(req);

      expect(result).toEqual({
        success: false,
        message: "User does not have this role",
      });
    });
  });

  describe("getUserPermissions", () => {
    const mockResolve = resolveUserPermissions as jest.Mock;

    const mockReq = (data: any) => ({
      data,
      user: { id: "caller-id", roles: ["administrator"] },
      reject: jest.fn(),
    });

    it("should return all permissions for a user", async () => {
      mockResolve.mockResolvedValueOnce(["listing.view", "listing.create", "listing.edit"]);

      const req = mockReq({ userId: "user-1" });
      const handler = registeredHandlers["getUserPermissions"];
      const result = await handler(req);

      expect(result).toEqual(["listing.view", "listing.create", "listing.edit"]);
      expect(mockResolve).toHaveBeenCalledWith("user-1");
    });

    it("should return empty array for user with no roles", async () => {
      mockResolve.mockResolvedValueOnce([]);

      const req = mockReq({ userId: "user-no-roles" });
      const handler = registeredHandlers["getUserPermissions"];
      const result = await handler(req);

      expect(result).toEqual([]);
    });

    it("should delegate to resolveUserPermissions utility", async () => {
      mockResolve.mockResolvedValueOnce(["listing.view", "listing.create"]);

      const req = mockReq({ userId: "user-1" });
      const handler = registeredHandlers["getUserPermissions"];
      const result = await handler(req);

      expect(result).toEqual(["listing.view", "listing.create"]);
      expect(mockResolve).toHaveBeenCalledWith("user-1");
    });
  });
});
