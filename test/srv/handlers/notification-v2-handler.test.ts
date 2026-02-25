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
        PushSubscription: "PushSubscription",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => `uuid-${++uuidCounter}` },
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

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-q"),
  }),
};

(global as any).DELETE = {
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("delete-q"),
  }),
};

// ─── Import handlers ────────────────────────────────────────────────────────

const {
  handleGetNotificationsV2,
  handleMarkNotificationsReadV2,
  handleGetUnreadCountV2,
  handleUpdatePreference,
  handleGetPreferences,
  handleRegisterPushSubscription,
  handleUnregisterPushSubscription,
  handleGetPushSubscriptions,
} = require("../../../srv/handlers/notification-v2-handler");

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

describe("handleGetNotificationsV2", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({});
    req.user = { id: undefined };
    await handleGetNotificationsV2(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should return empty when no notifications", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 0 }); // total
    mockRun.mockResolvedValueOnce({ cnt: 0 }); // unread

    const req = createMockRequest({});
    const result = await handleGetNotificationsV2(req);

    expect(result.total).toBe(0);
    expect(result.unreadCount).toBe(0);
    expect(JSON.parse(result.items)).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });

  it("should return notifications with title, body, and actionUrl", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 1 }); // total
    mockRun.mockResolvedValueOnce({ cnt: 1 }); // unread
    mockRun.mockResolvedValueOnce([
      {
        ID: "notif-1",
        userId: "user-1",
        type: "price_change",
        title: "Changement de prix",
        body: "Le prix a baissé",
        message: "Le prix a baissé",
        actionUrl: "/listing/123",
        listingId: "listing-123",
        isRead: false,
        createdAt: "2026-02-20T10:00:00Z",
      },
    ]);

    const req = createMockRequest({});
    const result = await handleGetNotificationsV2(req);

    const items = JSON.parse(result.items);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Changement de prix");
    expect(items[0].body).toBe("Le prix a baissé");
    expect(items[0].actionUrl).toBe("/listing/123");
    expect(items[0].listingId).toBe("listing-123");
  });

  it("should handle backward compat with message field", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 1 }); // total
    mockRun.mockResolvedValueOnce({ cnt: 1 }); // unread
    mockRun.mockResolvedValueOnce([
      {
        ID: "notif-1",
        userId: "user-1",
        type: "sold",
        title: null,
        body: null,
        message: "Le véhicule a été vendu",
        actionUrl: null,
        listingId: "listing-1",
        isRead: false,
        createdAt: "2026-02-20T10:00:00Z",
      },
    ]);

    const req = createMockRequest({});
    const result = await handleGetNotificationsV2(req);

    const items = JSON.parse(result.items);
    expect(items[0].body).toBe("Le véhicule a été vendu");
    expect(items[0].title).toBe("");
  });

  it("should support pagination with hasMore", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 30 }); // total
    mockRun.mockResolvedValueOnce({ cnt: 5 }); // unread
    mockRun.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({
        ID: `notif-${i}`,
        userId: "user-1",
        type: "new_message",
        title: "Nouveau message",
        body: "Test",
        message: "Test",
        actionUrl: null,
        listingId: null,
        isRead: i > 4,
        createdAt: `2026-02-${20 - i}T10:00:00Z`,
      })),
    );

    const req = createMockRequest({ skip: 0, top: 20 });
    const result = await handleGetNotificationsV2(req);

    expect(result.total).toBe(30);
    expect(result.unreadCount).toBe(5);
    expect(result.hasMore).toBe(true);
  });
});

// ─── Tests: markNotificationsRead ───────────────────────────────────────────

describe("handleMarkNotificationsReadV2", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({ notificationIds: "all" });
    req.user = { id: undefined };
    await handleMarkNotificationsReadV2(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should mark all notifications as read", async () => {
    mockRun.mockResolvedValueOnce(5);
    const req = createMockRequest({ notificationIds: "all" });
    const result = await handleMarkNotificationsReadV2(req);

    expect(result.success).toBe(true);
    expect(result.updated).toBe(5);
  });

  it("should mark specific notifications as read", async () => {
    mockRun.mockResolvedValueOnce(2);
    const req = createMockRequest({
      notificationIds: JSON.stringify(["notif-1", "notif-2"]),
    });
    const result = await handleMarkNotificationsReadV2(req);

    expect(result.success).toBe(true);
    expect(result.updated).toBe(2);
  });

  it("should return 0 for empty array", async () => {
    const req = createMockRequest({ notificationIds: "[]" });
    const result = await handleMarkNotificationsReadV2(req);

    expect(result.success).toBe(true);
    expect(result.updated).toBe(0);
  });

  it("should return 400 for invalid JSON", async () => {
    const req = createMockRequest({ notificationIds: "not-json" });
    await handleMarkNotificationsReadV2(req);
    expect(req.error).toHaveBeenCalledWith(400, "Format de notificationIds invalide");
  });
});

// ─── Tests: getUnreadCount ──────────────────────────────────────────────────

describe("handleGetUnreadCountV2", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({});
    req.user = { id: undefined };
    await handleGetUnreadCountV2(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should return unread count", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 3 });
    const req = createMockRequest({});
    const result = await handleGetUnreadCountV2(req);
    expect(result.count).toBe(3);
  });

  it("should return 0 when no unread", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 0 });
    const req = createMockRequest({});
    const result = await handleGetUnreadCountV2(req);
    expect(result.count).toBe(0);
  });
});

// ─── Tests: updatePreference ────────────────────────────────────────────────

describe("handleUpdatePreference", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    uuidCounter = 0;
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({ type: "price_change", enabled: false });
    req.user = { id: undefined };
    await handleUpdatePreference(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should return 400 for missing type", async () => {
    const req = createMockRequest({ enabled: true });
    await handleUpdatePreference(req);
    expect(req.error).toHaveBeenCalledWith(400, "Paramètres manquants");
  });

  it("should return 400 for non-configurable type", async () => {
    const req = createMockRequest({ type: "system", enabled: true });
    await handleUpdatePreference(req);
    expect(req.error).toHaveBeenCalledWith(400, "Type de notification non configurable");
  });

  it("should update existing preference", async () => {
    mockRun.mockResolvedValueOnce({
      ID: "pref-1",
      userId: "user-1",
      type: "price_change",
      enabled: true,
    });
    mockRun.mockResolvedValueOnce(1); // UPDATE

    const req = createMockRequest({ type: "price_change", enabled: false });
    const result = await handleUpdatePreference(req);

    expect(result.success).toBe(true);
    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it("should create new preference if none exists", async () => {
    mockRun.mockResolvedValueOnce(null); // no existing preference
    mockRun.mockResolvedValueOnce(undefined); // INSERT

    const req = createMockRequest({ type: "new_message", enabled: false });
    const result = await handleUpdatePreference(req);

    expect(result.success).toBe(true);
    expect(mockRun).toHaveBeenCalledTimes(2);
  });
});

// ─── Tests: getPreferences ──────────────────────────────────────────────────

describe("handleGetPreferences", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({});
    req.user = { id: undefined };
    await handleGetPreferences(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should return all preference types with defaults", async () => {
    mockRun.mockResolvedValueOnce([]); // no stored preferences

    const req = createMockRequest({});
    const result = await handleGetPreferences(req);

    const prefs = JSON.parse(result.preferences);
    expect(prefs.length).toBe(8); // PREFERENCE_NOTIFICATION_TYPES count
    // All should default to enabled
    expect(prefs.every((p: any) => p.enabled === true)).toBe(true);
  });

  it("should merge stored preferences with defaults", async () => {
    mockRun.mockResolvedValueOnce([
      { ID: "pref-1", userId: "user-1", type: "price_change", enabled: false },
    ]);

    const req = createMockRequest({});
    const result = await handleGetPreferences(req);

    const prefs = JSON.parse(result.preferences);
    const priceChangePref = prefs.find((p: any) => p.type === "price_change");
    expect(priceChangePref.enabled).toBe(false);

    // Others should be enabled by default
    const newMessagePref = prefs.find((p: any) => p.type === "new_message");
    expect(newMessagePref.enabled).toBe(true);
  });
});

// ─── Tests: registerPushSubscription ────────────────────────────────────────

describe("handleRegisterPushSubscription", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    uuidCounter = 0;
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({
      endpoint: "https://push.example.com/sub",
      p256dhKey: "key",
      authKey: "auth",
    });
    req.user = { id: undefined };
    await handleRegisterPushSubscription(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should return 400 for missing endpoint", async () => {
    const req = createMockRequest({ p256dhKey: "key", authKey: "auth" });
    await handleRegisterPushSubscription(req);
    expect(req.error).toHaveBeenCalledWith(400, "Paramètres manquants");
  });

  it("should create new subscription", async () => {
    mockRun.mockResolvedValueOnce(null); // no existing
    mockRun.mockResolvedValueOnce(undefined); // INSERT

    const req = createMockRequest({
      endpoint: "https://push.example.com/sub",
      p256dhKey: "key123",
      authKey: "auth123",
      deviceLabel: "Chrome Desktop",
    });
    const result = await handleRegisterPushSubscription(req);

    expect(result.subscriptionId).toBe("uuid-1");
  });

  it("should update existing subscription with same endpoint", async () => {
    mockRun.mockResolvedValueOnce({ ID: "existing-sub", endpoint: "https://push.example.com/sub" });
    mockRun.mockResolvedValueOnce(1); // UPDATE

    const req = createMockRequest({
      endpoint: "https://push.example.com/sub",
      p256dhKey: "new-key",
      authKey: "new-auth",
    });
    const result = await handleRegisterPushSubscription(req);

    expect(result.subscriptionId).toBe("existing-sub");
  });
});

// ─── Tests: unregisterPushSubscription ──────────────────────────────────────

describe("handleUnregisterPushSubscription", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({ subscriptionId: "sub-1" });
    req.user = { id: undefined };
    await handleUnregisterPushSubscription(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should return 400 for missing subscriptionId", async () => {
    const req = createMockRequest({});
    await handleUnregisterPushSubscription(req);
    expect(req.error).toHaveBeenCalledWith(400, "Identifiant de souscription requis");
  });

  it("should delete own subscription", async () => {
    mockRun.mockResolvedValueOnce(1); // DELETE count

    const req = createMockRequest({ subscriptionId: "sub-1" });
    const result = await handleUnregisterPushSubscription(req);

    expect(result.success).toBe(true);
  });

  it("should return false if subscription not found", async () => {
    mockRun.mockResolvedValueOnce(0); // nothing deleted

    const req = createMockRequest({ subscriptionId: "not-my-sub" });
    const result = await handleUnregisterPushSubscription(req);

    expect(result.success).toBe(false);
  });
});

// ─── Tests: getPushSubscriptions ────────────────────────────────────────────

describe("handleGetPushSubscriptions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({});
    req.user = { id: undefined };
    await handleGetPushSubscriptions(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should return user subscriptions", async () => {
    mockRun.mockResolvedValueOnce([
      {
        ID: "sub-1",
        userId: "user-1",
        endpoint: "https://push.example.com/1",
        p256dhKey: "key1",
        authKey: "auth1",
        deviceLabel: "Chrome",
        createdAt: "2026-02-20T10:00:00Z",
      },
      {
        ID: "sub-2",
        userId: "user-1",
        endpoint: "https://push.example.com/2",
        p256dhKey: "key2",
        authKey: "auth2",
        deviceLabel: null,
        createdAt: "2026-02-21T10:00:00Z",
      },
    ]);

    const req = createMockRequest({});
    const result = await handleGetPushSubscriptions(req);

    const subs = JSON.parse(result.subscriptions);
    expect(subs).toHaveLength(2);
    expect(subs[0].endpoint).toBe("https://push.example.com/1");
    expect(subs[0].deviceLabel).toBe("Chrome");
    expect(subs[1].deviceLabel).toBeNull();
  });

  it("should return empty array when no subscriptions", async () => {
    mockRun.mockResolvedValueOnce([]);

    const req = createMockRequest({});
    const result = await handleGetPushSubscriptions(req);

    const subs = JSON.parse(result.subscriptions);
    expect(subs).toHaveLength(0);
  });
});
