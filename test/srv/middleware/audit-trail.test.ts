/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        AuditTrailEntry: "AuditTrailEntry",
      })),
      run: jest.fn(),
      log: jest.fn(() => mockLog),
    },
  };
});

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-audit-query"),
  }),
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require("@sap/cds").default;
const mockRun = cds.run as jest.Mock;

import {
  auditLog,
  logAudit,
  extractAuditContext,
  AUDITABLE_ACTIONS,
} from "../../../srv/middleware/audit-trail";

describe("audit-trail middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  describe("AUDITABLE_ACTIONS", () => {
    it("should define all expected action categories", () => {
      const categories = new Set(AUDITABLE_ACTIONS.map((a) => a.split(".")[0]));
      expect(categories).toContain("listing");
      expect(categories).toContain("user");
      expect(categories).toContain("config");
      expect(categories).toContain("payment");
      expect(categories).toContain("moderation");
      expect(categories).toContain("legal");
      expect(categories).toContain("api_provider");
      expect(categories).toContain("permission");
      expect(categories).toContain("alert");
      expect(categories).toContain("data");
      expect(categories).toContain("audit");
    });

    it("should include listing operations", () => {
      expect(AUDITABLE_ACTIONS).toContain("listing.created");
      expect(AUDITABLE_ACTIONS).toContain("listing.published");
      expect(AUDITABLE_ACTIONS).toContain("listing.updated");
      expect(AUDITABLE_ACTIONS).toContain("listing.deleted");
      expect(AUDITABLE_ACTIONS).toContain("listing.moderated");
    });

    it("should include user operations", () => {
      expect(AUDITABLE_ACTIONS).toContain("user.registered");
      expect(AUDITABLE_ACTIONS).toContain("user.updated");
      expect(AUDITABLE_ACTIONS).toContain("user.role_changed");
      expect(AUDITABLE_ACTIONS).toContain("user.deactivated");
    });

    it("should include config operations", () => {
      expect(AUDITABLE_ACTIONS).toContain("config.created");
      expect(AUDITABLE_ACTIONS).toContain("config.updated");
      expect(AUDITABLE_ACTIONS).toContain("config.deleted");
    });
  });

  describe("auditLog", () => {
    it("should insert audit trail entry with all fields", async () => {
      mockRun.mockResolvedValueOnce(undefined);

      await auditLog({
        action: "config.updated",
        actorId: "user-123",
        actorRole: "administrator",
        targetType: "ConfigParameter",
        targetId: "param-456",
        details: { oldValue: "10", newValue: "20" },
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        requestId: "req-789",
        severity: "info",
      });

      expect(mockRun).toHaveBeenCalledTimes(1);
      expect((global as any).INSERT.into).toHaveBeenCalledWith("AuditTrailEntry");
      expect((global as any).INSERT.into("AuditTrailEntry").entries).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "config.updated",
          actorId: "user-123",
          actorRole: "administrator",
          targetType: "ConfigParameter",
          targetId: "param-456",
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0",
          requestId: "req-789",
          severity: "info",
        }),
      );
    });

    it("should serialize object details to JSON string", async () => {
      mockRun.mockResolvedValueOnce(undefined);

      await auditLog({
        action: "config.updated",
        actorId: "user-123",
        targetType: "ConfigParameter",
        details: { key: "test", oldValue: "a", newValue: "b" },
      });

      const entryCall = (global as any).INSERT.into("AuditTrailEntry").entries;
      const lastCallArgs = entryCall.mock.calls[entryCall.mock.calls.length - 1][0];
      expect(typeof lastCallArgs.details).toBe("string");
      expect(JSON.parse(lastCallArgs.details)).toEqual({
        key: "test",
        oldValue: "a",
        newValue: "b",
      });
    });

    it("should pass string details as-is", async () => {
      mockRun.mockResolvedValueOnce(undefined);

      await auditLog({
        action: "config.updated",
        actorId: "user-123",
        targetType: "ConfigParameter",
        details: '{"already": "serialized"}',
      });

      const entryCall = (global as any).INSERT.into("AuditTrailEntry").entries;
      const lastCallArgs = entryCall.mock.calls[entryCall.mock.calls.length - 1][0];
      expect(lastCallArgs.details).toBe('{"already": "serialized"}');
    });

    it("should default severity to info", async () => {
      mockRun.mockResolvedValueOnce(undefined);

      await auditLog({
        action: "config.created",
        actorId: "user-123",
        targetType: "ConfigParameter",
      });

      const entryCall = (global as any).INSERT.into("AuditTrailEntry").entries;
      const lastCallArgs = entryCall.mock.calls[entryCall.mock.calls.length - 1][0];
      expect(lastCallArgs.severity).toBe("info");
    });

    it("should default actorRole to system", async () => {
      mockRun.mockResolvedValueOnce(undefined);

      await auditLog({
        action: "config.created",
        actorId: "system",
        targetType: "ConfigParameter",
      });

      const entryCall = (global as any).INSERT.into("AuditTrailEntry").entries;
      const lastCallArgs = entryCall.mock.calls[entryCall.mock.calls.length - 1][0];
      expect(lastCallArgs.actorRole).toBe("system");
    });

    it("should set null for optional fields when not provided", async () => {
      mockRun.mockResolvedValueOnce(undefined);

      await auditLog({
        action: "config.deleted",
        actorId: "user-123",
        targetType: "ConfigParameter",
      });

      const entryCall = (global as any).INSERT.into("AuditTrailEntry").entries;
      const lastCallArgs = entryCall.mock.calls[entryCall.mock.calls.length - 1][0];
      expect(lastCallArgs.targetId).toBeNull();
      expect(lastCallArgs.details).toBeNull();
      expect(lastCallArgs.ipAddress).toBeNull();
      expect(lastCallArgs.userAgent).toBeNull();
      expect(lastCallArgs.requestId).toBeNull();
    });

    it("should include ISO timestamp", async () => {
      mockRun.mockResolvedValueOnce(undefined);

      await auditLog({
        action: "config.created",
        actorId: "user-123",
        targetType: "ConfigParameter",
      });

      const entryCall = (global as any).INSERT.into("AuditTrailEntry").entries;
      const lastCallArgs = entryCall.mock.calls[entryCall.mock.calls.length - 1][0];
      expect(lastCallArgs.timestamp).toBeDefined();
      expect(new Date(lastCallArgs.timestamp).toISOString()).toBe(lastCallArgs.timestamp);
    });

    it("should not throw on database error (fire-and-forget)", async () => {
      mockRun.mockRejectedValueOnce(new Error("DB error"));

      await expect(
        auditLog({
          action: "config.created",
          actorId: "user-123",
          targetType: "ConfigParameter",
        }),
      ).resolves.toBeUndefined();
    });

    it("should handle missing AuditTrailEntry entity gracefully", async () => {
      (cds.entities as jest.Mock).mockReturnValueOnce({});

      await expect(
        auditLog({
          action: "config.created",
          actorId: "user-123",
          targetType: "ConfigParameter",
        }),
      ).resolves.toBeUndefined();

      expect(mockRun).not.toHaveBeenCalled();
    });

    it("should support critical severity level", async () => {
      mockRun.mockResolvedValueOnce(undefined);

      await auditLog({
        action: "user.deactivated",
        actorId: "admin-123",
        actorRole: "administrator",
        targetType: "User",
        targetId: "user-456",
        severity: "critical",
      });

      const entryCall = (global as any).INSERT.into("AuditTrailEntry").entries;
      const lastCallArgs = entryCall.mock.calls[entryCall.mock.calls.length - 1][0];
      expect(lastCallArgs.severity).toBe("critical");
    });
  });

  describe("logAudit (backward compatibility)", () => {
    it("should map legacy AuditEvent to AuditTrailEvent", async () => {
      mockRun.mockResolvedValueOnce(undefined);

      await logAudit({
        userId: "user-123",
        action: "CONFIG_CREATED",
        resource: "ConfigParameter",
        details: '{"key": "test"}',
        ipAddress: "10.0.0.1",
      });

      expect(mockRun).toHaveBeenCalledTimes(1);
      const entryCall = (global as any).INSERT.into("AuditTrailEntry").entries;
      const lastCallArgs = entryCall.mock.calls[entryCall.mock.calls.length - 1][0];
      expect(lastCallArgs.actorId).toBe("user-123");
      expect(lastCallArgs.action).toBe("CONFIG_CREATED");
      expect(lastCallArgs.targetType).toBe("ConfigParameter");
      expect(lastCallArgs.ipAddress).toBe("10.0.0.1");
    });
  });

  describe("extractAuditContext", () => {
    it("should extract actor info from CDS request", () => {
      const req = {
        user: { id: "user-123", roles: ["administrator"] },
        headers: {
          "x-forwarded-for": "10.0.0.1, 172.16.0.1",
          "user-agent": "Mozilla/5.0",
          "x-request-id": "req-abc",
        },
      };

      const ctx = extractAuditContext(req as any);
      expect(ctx.actorId).toBe("user-123");
      expect(ctx.actorRole).toBe("administrator");
      expect(ctx.ipAddress).toBe("10.0.0.1");
      expect(ctx.userAgent).toBe("Mozilla/5.0");
      expect(ctx.requestId).toBe("req-abc");
    });

    it("should default to system when no user", () => {
      const req = { user: {} };

      const ctx = extractAuditContext(req as any);
      expect(ctx.actorId).toBe("system");
      expect(ctx.actorRole).toBe("system");
    });

    it("should handle missing headers", () => {
      const req = { user: { id: "user-123" } };

      const ctx = extractAuditContext(req as any);
      expect(ctx.ipAddress).toBeUndefined();
      expect(ctx.userAgent).toBeUndefined();
      expect(ctx.requestId).toBeUndefined();
    });
  });
});
