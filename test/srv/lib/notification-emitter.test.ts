/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
let uuidCounter = 0;

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        Notification: "Notification",
        NotificationPreference: "NotificationPreference",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => `notif-uuid-${++uuidCounter}` },
      ApplicationService: class {
        async init() {}
        on(_event: string, _handler: any) {}
        before(_event: string | string[], _entity: string, _handler: any) {}
        after(_event: string | string[], _entity: string, _handler: any) {}
      },
    },
  };
});

const mockSendToUser = jest.fn();
jest.mock("../../../srv/lib/signalr-client", () => ({
  signalrClient: {
    sendToUser: (...args: any[]) => mockSendToUser(...args),
  },
}));

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
};

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-q"),
  }),
};

// ─── Import module ──────────────────────────────────────────────────────────

const { createNotification } = require("../../../srv/lib/notification-emitter");

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("notification-emitter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    mockSendToUser.mockReset();
    uuidCounter = 0;
  });

  describe("createNotification", () => {
    const baseInput = {
      userId: "user-1",
      type: "price_change" as const,
      title: "Changement de prix",
      body: "Le prix a baissé",
      actionUrl: "/listing/123",
      listingId: "listing-123",
    };

    it("should persist notification and return ID", async () => {
      // preference check
      mockRun.mockResolvedValueOnce(null);
      // INSERT
      mockRun.mockResolvedValueOnce(undefined);
      // unread count
      mockRun.mockResolvedValueOnce({ cnt: 5 });
      mockSendToUser.mockResolvedValue(undefined);

      const result = await createNotification(baseInput);

      expect(result).toBe("notif-uuid-1");
      expect(mockRun).toHaveBeenCalledTimes(3);
    });

    it("should check user preference before creating", async () => {
      mockRun.mockResolvedValueOnce(null); // no preference = enabled
      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockRun.mockResolvedValueOnce({ cnt: 1 }); // unread count
      mockSendToUser.mockResolvedValue(undefined);

      await createNotification(baseInput);

      // First call should be preference check
      expect(mockRun).toHaveBeenCalledTimes(3);
    });

    it("should block notification if user disabled the type", async () => {
      mockRun.mockResolvedValueOnce({ enabled: false }); // preference disabled

      const result = await createNotification(baseInput);

      expect(result).toBeNull();
      expect(mockRun).toHaveBeenCalledTimes(1); // only preference check
    });

    it("should allow notification if user has preference enabled", async () => {
      mockRun.mockResolvedValueOnce({ enabled: true }); // preference enabled
      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockRun.mockResolvedValueOnce({ cnt: 2 }); // unread count
      mockSendToUser.mockResolvedValue(undefined);

      const result = await createNotification(baseInput);

      expect(result).toBe("notif-uuid-1");
    });

    it("should skip preference check for system notifications", async () => {
      mockRun.mockResolvedValueOnce(undefined); // INSERT (no preference check)
      mockRun.mockResolvedValueOnce({ cnt: 1 }); // unread count
      mockSendToUser.mockResolvedValue(undefined);

      const result = await createNotification({
        ...baseInput,
        type: "system",
      });

      expect(result).toBe("notif-uuid-1");
      // No preference check means INSERT is the first call
      expect(mockRun).toHaveBeenCalledTimes(2);
    });

    it("should emit SignalR new notification event", async () => {
      mockRun.mockResolvedValueOnce(null); // preference
      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockRun.mockResolvedValueOnce({ cnt: 3 }); // unread count
      mockSendToUser.mockResolvedValue(undefined);

      await createNotification(baseInput);

      expect(mockSendToUser).toHaveBeenCalledWith(
        "notifications",
        "user-1",
        "notification:new",
        expect.objectContaining({
          notificationId: "notif-uuid-1",
          type: "price_change",
          title: "Changement de prix",
          body: "Le prix a baissé",
          actionUrl: "/listing/123",
          listingId: "listing-123",
        }),
      );
    });

    it("should emit SignalR unread count event", async () => {
      mockRun.mockResolvedValueOnce(null); // preference
      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockRun.mockResolvedValueOnce({ cnt: 7 }); // unread count
      mockSendToUser.mockResolvedValue(undefined);

      await createNotification(baseInput);

      expect(mockSendToUser).toHaveBeenCalledWith(
        "notifications",
        "user-1",
        "notification:unread-count",
        expect.objectContaining({ count: 7 }),
      );
    });

    it("should handle SignalR failure gracefully", async () => {
      mockRun.mockResolvedValueOnce(null); // preference
      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockSendToUser.mockRejectedValue(new Error("SignalR down"));

      const result = await createNotification(baseInput);

      // Notification should still be created even if SignalR fails
      expect(result).toBe("notif-uuid-1");
    });

    it("should handle null actionUrl and listingId", async () => {
      mockRun.mockResolvedValueOnce(null); // preference
      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockRun.mockResolvedValueOnce({ cnt: 1 }); // unread count
      mockSendToUser.mockResolvedValue(undefined);

      const result = await createNotification({
        userId: "user-1",
        type: "new_message" as const,
        title: "Nouveau message",
        body: "Vous avez un nouveau message",
      });

      expect(result).toBe("notif-uuid-1");
    });
  });
});
