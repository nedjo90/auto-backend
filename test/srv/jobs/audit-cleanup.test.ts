/* eslint-disable @typescript-eslint/no-explicit-any */

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../srv/middleware/audit-trail", () => ({
  auditLog: (...args: any[]) => mockAuditLog(...args),
}));

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        AuditTrailEntry: "AuditTrailEntry",
        ApiCallLog: "ApiCallLog",
        ConfigParameter: "ConfigParameter",
      })),
      run: jest.fn(),
      log: jest.fn(() => mockLog),
    },
  };
});

(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("select-one-query"),
    }),
  },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("select-from-query"),
  }),
};

(global as any).DELETE = {
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("delete-query"),
  }),
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require("@sap/cds").default;
const mockRun = cds.run as jest.Mock;

import {
  getRetentionDays,
  calculateCutoffDate,
  deleteOldRecords,
  runAuditCleanup,
} from "../../../srv/jobs/audit-cleanup";

describe("audit-cleanup job", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    mockAuditLog.mockReset().mockResolvedValue(undefined);
  });

  describe("getRetentionDays", () => {
    it("should return configured value from ConfigParameter", async () => {
      mockRun.mockResolvedValueOnce({ value: "180" });
      const days = await getRetentionDays("audit_trail_retention_days", 365);
      expect(days).toBe(180);
    });

    it("should return default when config not found", async () => {
      mockRun.mockResolvedValueOnce(null);
      const days = await getRetentionDays("audit_trail_retention_days", 365);
      expect(days).toBe(365);
    });

    it("should return default when config value is invalid", async () => {
      mockRun.mockResolvedValueOnce({ value: "not-a-number" });
      const days = await getRetentionDays("audit_trail_retention_days", 365);
      expect(days).toBe(365);
    });

    it("should return default on error", async () => {
      mockRun.mockRejectedValueOnce(new Error("DB error"));
      const days = await getRetentionDays("audit_trail_retention_days", 365);
      expect(days).toBe(365);
    });
  });

  describe("calculateCutoffDate", () => {
    it("should return ISO date string", () => {
      const cutoff = calculateCutoffDate(30);
      expect(new Date(cutoff).toISOString()).toBe(cutoff);
    });

    it("should be in the past", () => {
      const cutoff = calculateCutoffDate(1);
      expect(new Date(cutoff).getTime()).toBeLessThan(Date.now());
    });

    it("should be approximately N days ago", () => {
      const days = 90;
      const cutoff = calculateCutoffDate(days);
      const cutoffDate = new Date(cutoff);
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() - days);
      // Allow 1 second tolerance
      expect(Math.abs(cutoffDate.getTime() - expectedDate.getTime())).toBeLessThan(1000);
    });
  });

  describe("deleteOldRecords", () => {
    it("should delete records older than cutoff", async () => {
      const oldRecords = Array(5).fill({ ID: "old" });
      mockRun
        .mockResolvedValueOnce(oldRecords) // SELECT count
        .mockResolvedValueOnce(undefined); // DELETE

      const count = await deleteOldRecords(
        "AuditTrailEntry",
        "timestamp",
        "2025-01-01T00:00:00.000Z",
      );
      expect(count).toBe(5);
      expect(mockRun).toHaveBeenCalledTimes(2);
    });

    it("should return 0 when no old records", async () => {
      mockRun.mockResolvedValueOnce([]); // SELECT returns empty

      const count = await deleteOldRecords(
        "AuditTrailEntry",
        "timestamp",
        "2025-01-01T00:00:00.000Z",
      );
      expect(count).toBe(0);
      expect(mockRun).toHaveBeenCalledTimes(1); // Only SELECT, no DELETE
    });

    it("should return 0 when entity not found", async () => {
      (cds.entities as jest.Mock).mockReturnValueOnce({});

      const count = await deleteOldRecords(
        "NonExistentEntity",
        "timestamp",
        "2025-01-01T00:00:00.000Z",
      );
      expect(count).toBe(0);
    });
  });

  describe("runAuditCleanup", () => {
    it("should clean up both audit trail and API call logs", async () => {
      mockRun
        // getRetentionDays for audit trail
        .mockResolvedValueOnce({ value: "365" })
        // getRetentionDays for API call log
        .mockResolvedValueOnce({ value: "90" })
        // deleteOldRecords: SELECT AuditTrailEntry
        .mockResolvedValueOnce(Array(3).fill({ ID: "old" }))
        // deleteOldRecords: DELETE AuditTrailEntry
        .mockResolvedValueOnce(undefined)
        // deleteOldRecords: SELECT ApiCallLog
        .mockResolvedValueOnce(Array(7).fill({ ID: "old" }))
        // deleteOldRecords: DELETE ApiCallLog
        .mockResolvedValueOnce(undefined);

      const result = await runAuditCleanup();
      expect(result.auditTrailDeleted).toBe(3);
      expect(result.apiCallLogDeleted).toBe(7);

      // Should log the cleanup as an audit event
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "audit.cleanup",
          actorId: "system",
          targetType: "AuditTrailEntry",
        }),
      );
    });

    it("should handle no records to clean up", async () => {
      mockRun
        .mockResolvedValueOnce({ value: "365" })
        .mockResolvedValueOnce({ value: "90" })
        .mockResolvedValueOnce([]) // No audit entries to delete
        .mockResolvedValueOnce([]); // No API call logs to delete

      const result = await runAuditCleanup();
      expect(result.auditTrailDeleted).toBe(0);
      expect(result.apiCallLogDeleted).toBe(0);
    });
  });
});
