/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        Notification: "Notification",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      ApplicationService: class {
        async init() {}
        on(_event: string, _handler: any) {}
        before(_event: string | string[], _entity: string, _handler: any) {}
        after(_event: string | string[], _entity: string, _handler: any) {}
      },
    },
  };
});

// Global CDS query helpers
(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("q"),
      columns: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue("q"),
      }),
    }),
  },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue("q"),
      }),
    }),
  }),
};

(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("update-q"),
  }),
});

// ─── Import handlers ────────────────────────────────────────────────────────

const {
  handleGetNotifications,
  handleMarkNotificationsRead,
  handleGetUnreadCount,
} = require("../../../srv/handlers/notification-handler");

// ─── Mock Request Builder ────────────────────────────────────────────────────

function createMockRequest(data: Record<string, any>, userId = "user-1"): any {
  const errors: any[] = [];
  return {
    data,
    user: { id: userId },
    headers: {},
    error: jest.fn((status: number, msg: string) => {
      errors.push({ status, msg });
    }),
    _errors: errors,
  };
}

// ─── Tests: getNotifications ────────────────────────────────────────────────

describe("handleGetNotifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return empty when no notifications", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 0 }); // total count
    mockRun.mockResolvedValueOnce({ cnt: 0 }); // unread count

    const req = createMockRequest({});
    const result = await handleGetNotifications(req);

    expect(result.total).toBe(0);
    expect(result.unreadCount).toBe(0);
    expect(JSON.parse(result.items)).toHaveLength(0);
  });

  it("should return notifications with pagination", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 2 }); // total count
    mockRun.mockResolvedValueOnce({ cnt: 1 }); // unread count
    mockRun.mockResolvedValueOnce([
      {
        ID: "notif-1",
        userId: "user-1",
        type: "price_change",
        message: "Le prix du Renault Clio a baissé de 15000€ à 14000€",
        listingId: "listing-1",
        isRead: false,
        createdAt: "2026-02-20T10:00:00Z",
      },
      {
        ID: "notif-2",
        userId: "user-1",
        type: "sold",
        message: "Le Peugeot 308 que vous suivez a été vendu",
        listingId: "listing-2",
        isRead: true,
        createdAt: "2026-02-19T10:00:00Z",
      },
    ]);

    const req = createMockRequest({});
    const result = await handleGetNotifications(req);

    const items = JSON.parse(result.items);
    expect(items).toHaveLength(2);
    expect(items[0].type).toBe("price_change");
    expect(items[1].type).toBe("sold");
    expect(result.total).toBe(2);
    expect(result.unreadCount).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({});
    req.user = { id: undefined };

    await handleGetNotifications(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });
});

// ─── Tests: markNotificationsRead ───────────────────────────────────────────

describe("handleMarkNotificationsRead", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should mark all notifications as read", async () => {
    mockRun.mockResolvedValueOnce(5); // 5 updated

    const req = createMockRequest({ notificationIds: "all" });
    const result = await handleMarkNotificationsRead(req);

    expect(result.success).toBe(true);
    expect(result.updated).toBe(5);
  });

  it("should mark specific notifications as read", async () => {
    mockRun.mockResolvedValueOnce(2); // 2 updated

    const req = createMockRequest({
      notificationIds: JSON.stringify(["notif-1", "notif-2"]),
    });
    const result = await handleMarkNotificationsRead(req);

    expect(result.success).toBe(true);
    expect(result.updated).toBe(2);
  });

  it("should return 0 for empty array", async () => {
    const req = createMockRequest({ notificationIds: "[]" });
    const result = await handleMarkNotificationsRead(req);

    expect(result.success).toBe(true);
    expect(result.updated).toBe(0);
  });

  it("should return 400 for invalid JSON", async () => {
    const req = createMockRequest({ notificationIds: "not-json" });

    await handleMarkNotificationsRead(req);

    expect(req.error).toHaveBeenCalledWith(400, "Format de notificationIds invalide");
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({ notificationIds: "all" });
    req.user = { id: undefined };

    await handleMarkNotificationsRead(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });
});

// ─── Tests: getUnreadCount ──────────────────────────────────────────────────

describe("handleGetUnreadCount", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return unread count", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 3 });

    const req = createMockRequest({});
    const result = await handleGetUnreadCount(req);

    expect(result.count).toBe(3);
  });

  it("should return 0 when no unread notifications", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 0 });

    const req = createMockRequest({});
    const result = await handleGetUnreadCount(req);

    expect(result.count).toBe(0);
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({});
    req.user = { id: undefined };

    await handleGetUnreadCount(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });
});
