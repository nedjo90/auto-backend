/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock("@sap/cds", () => ({
  __esModule: true,
  default: {
    entities: jest.fn(() => ({
      AuditTrailEntry: "AuditTrailEntry",
    })),
    run: jest.fn(),
    log: jest.fn(() => ({
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    })),
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

describe("audit-logger (backward-compatible re-export)", () => {
  beforeEach(() => {
    mockRun.mockReset();
  });

  it("should insert audit record via AuditTrailEntry entity", async () => {
    mockRun.mockResolvedValueOnce(undefined);

    await logAudit({
      userId: "user-123",
      action: "role.assign",
      resource: "user/user-456",
      details: "Assigned seller role",
      ipAddress: "192.168.1.1",
    });

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect((global as any).INSERT.into).toHaveBeenCalledWith("AuditTrailEntry");
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

    await expect(
      logAudit({
        userId: "user-123",
        action: "role.assign",
        resource: "user/user-456",
      }),
    ).resolves.toBeUndefined();
  });
});
