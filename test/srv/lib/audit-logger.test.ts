/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock("@sap/cds", () => ({
  __esModule: true,
  default: {
    entities: jest.fn(() => ({
      AuditLog: "AuditLog",
    })),
    run: jest.fn(),
    utils: { uuid: jest.fn(() => "audit-uuid-123") },
  },
}));

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-audit-query"),
  }),
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require("@sap/cds").default;
const mockRun = cds.run as jest.Mock;

import { logAudit } from "../../../srv/lib/audit-logger";

describe("audit-logger", () => {
  beforeEach(() => {
    mockRun.mockReset();
  });

  it("should insert audit record with all fields", async () => {
    mockRun.mockResolvedValueOnce(undefined);

    await logAudit({
      userId: "user-123",
      action: "role.assign",
      resource: "user/user-456",
      details: "Assigned seller role",
      ipAddress: "192.168.1.1",
    });

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect((global as any).INSERT.into).toHaveBeenCalledWith("AuditLog");
  });

  it("should insert audit record without optional fields", async () => {
    mockRun.mockResolvedValueOnce(undefined);

    await logAudit({
      userId: "user-123",
      action: "permission.denied",
      resource: "/api/admin",
    });

    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("should not throw on database error (best-effort logging)", async () => {
    mockRun.mockRejectedValueOnce(new Error("DB connection failed"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    await expect(
      logAudit({
        userId: "user-123",
        action: "role.assign",
        resource: "user/user-456",
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      "[audit-logger] Failed to log audit event:",
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it("should generate UUID for audit log entry", async () => {
    mockRun.mockResolvedValueOnce(undefined);

    await logAudit({
      userId: "user-123",
      action: "test",
      resource: "test",
    });

    expect(cds.utils.uuid).toHaveBeenCalled();
  });
});
