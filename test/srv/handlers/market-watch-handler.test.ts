/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "generated-uuid");
const mockCreateNotification = jest.fn();

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        MarketWatch: "MarketWatch",
        Listing: "Listing",
        ListingPhoto: "ListingPhoto",
        ListingPriceHistory: "ListingPriceHistory",
        Notification: "Notification",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => mockUuid() },
      ApplicationService: class {
        async init() {}
        on(_event: string, _handler: any) {}
        before(_event: string | string[], _entity: string, _handler: any) {}
        after(_event: string | string[], _entity: string, _handler: any) {}
      },
    },
  };
});

jest.mock("../../../srv/lib/notification-emitter", () => ({
  createNotification: (...args: any[]) => mockCreateNotification(...args),
}));

jest.mock("@auto/shared", () => ({
  MAX_MARKET_WATCHES_PER_SELLER: 50,
  MARKET_WATCH_PAGE_SIZE: 20,
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
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue("q"),
      }),
    }),
    columns: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        orderBy: jest.fn().mockReturnValue("q"),
      }),
    }),
    orderBy: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue("q"),
    }),
  }),
};

(global as any).DELETE = {
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("delete-q"),
  }),
};

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-q"),
  }),
};

(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("update-q"),
  }),
});

// ─── Import handlers ────────────────────────────────────────────────────────

const {
  handleAddToMarketWatch,
  handleRemoveFromMarketWatch,
  handleGetMarketWatchList,
  handleCheckMarketWatches,
  recordPriceChange,
} = require("../../../srv/handlers/market-watch-handler");

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

// ─── Tests: addToMarketWatch ────────────────────────────────────────────────

describe("handleAddToMarketWatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should add a listing to market watch", async () => {
    // 1. Listing exists and is published
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "other-seller",
      status: "published",
    });
    // 2. No existing watch
    mockRun.mockResolvedValueOnce(null);
    // 3. Count current watches
    mockRun.mockResolvedValueOnce({ cnt: 5 });
    // 4. INSERT watch
    mockRun.mockResolvedValueOnce(undefined);

    const req = createMockRequest({ listingId: "listing-1", notes: "Concurrent intéressant" });
    const result = await handleAddToMarketWatch(req);

    expect(result.watching).toBe(true);
    expect(result.watchId).toBe("generated-uuid");
    expect(req.error).not.toHaveBeenCalled();
  });

  it("should add a listing without notes", async () => {
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "other-seller",
      status: "published",
    });
    mockRun.mockResolvedValueOnce(null);
    mockRun.mockResolvedValueOnce({ cnt: 0 });
    mockRun.mockResolvedValueOnce(undefined);

    const req = createMockRequest({ listingId: "listing-1" });
    const result = await handleAddToMarketWatch(req);

    expect(result.watching).toBe(true);
    expect(result.watchId).toBe("generated-uuid");
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({ listingId: "listing-1" });
    req.user = { id: undefined };

    await handleAddToMarketWatch(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should return 404 when listing does not exist", async () => {
    mockRun.mockResolvedValueOnce(null);

    const req = createMockRequest({ listingId: "listing-1" });
    await handleAddToMarketWatch(req);

    expect(req.error).toHaveBeenCalledWith(404, "Annonce non trouvée ou non publiée");
  });

  it("should return 404 when listing is not published", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "other-seller", status: "draft" });

    const req = createMockRequest({ listingId: "listing-1" });
    await handleAddToMarketWatch(req);

    expect(req.error).toHaveBeenCalledWith(404, "Annonce non trouvée ou non publiée");
  });

  it("should return 400 when trying to watch own listing", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1", status: "published" });

    const req = createMockRequest({ listingId: "listing-1" });
    await handleAddToMarketWatch(req);

    expect(req.error).toHaveBeenCalledWith(400, "Vous ne pouvez pas suivre vos propres annonces");
  });

  it("should return existing watch if already watching", async () => {
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "other-seller",
      status: "published",
    });
    mockRun.mockResolvedValueOnce({
      ID: "watch-existing",
      sellerId: "user-1",
      listingId: "listing-1",
    });

    const req = createMockRequest({ listingId: "listing-1" });
    const result = await handleAddToMarketWatch(req);

    expect(result.watching).toBe(true);
    expect(result.watchId).toBe("watch-existing");
  });

  it("should return 400 when at max watches limit", async () => {
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "other-seller",
      status: "published",
    });
    mockRun.mockResolvedValueOnce(null);
    mockRun.mockResolvedValueOnce({ cnt: 50 });

    const req = createMockRequest({ listingId: "listing-1" });
    await handleAddToMarketWatch(req);

    expect(req.error).toHaveBeenCalledWith(400, "Limite de 50 annonces suivies atteinte");
  });
});

// ─── Tests: removeFromMarketWatch ───────────────────────────────────────────

describe("handleRemoveFromMarketWatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should remove a listing from market watch", async () => {
    mockRun.mockResolvedValueOnce(1); // DELETE

    const req = createMockRequest({ listingId: "listing-1" });
    const result = await handleRemoveFromMarketWatch(req);

    expect(result.success).toBe(true);
    expect(req.error).not.toHaveBeenCalled();
  });

  it("should succeed even if watch did not exist", async () => {
    mockRun.mockResolvedValueOnce(0); // DELETE (nothing deleted)

    const req = createMockRequest({ listingId: "listing-1" });
    const result = await handleRemoveFromMarketWatch(req);

    expect(result.success).toBe(true);
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({ listingId: "listing-1" });
    req.user = { id: undefined };

    await handleRemoveFromMarketWatch(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });
});

// ─── Tests: getMarketWatchList ──────────────────────────────────────────────

describe("handleGetMarketWatchList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return empty when user has no watches", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 0 });

    const req = createMockRequest({});
    const result = await handleGetMarketWatchList(req);

    expect(result.total).toBe(0);
    expect(JSON.parse(result.items)).toHaveLength(0);
  });

  it("should return enriched market watch list", async () => {
    // 1. Count
    mockRun.mockResolvedValueOnce({ cnt: 1 });
    // 2. Watches
    mockRun.mockResolvedValueOnce([
      {
        ID: "watch-1",
        sellerId: "user-1",
        listingId: "listing-1",
        addedAt: "2026-01-10T00:00:00Z",
        notes: "Concurrent direct",
      },
    ]);
    // 3. Listings
    mockRun.mockResolvedValueOnce([
      {
        ID: "listing-1",
        make: "Peugeot",
        model: "308",
        variant: "GT",
        year: 2023,
        price: 25000,
        mileage: 30000,
        fuelType: "Diesel",
        gearbox: "Automatique",
        bodyType: "Berline",
        color: "Noir",
        condition: "Excellent",
        visibilityScore: 85,
        publishedAt: "2026-01-01T00:00:00Z",
        sellerId: "other-seller",
      },
    ]);
    // 4. Photos
    mockRun.mockResolvedValueOnce([
      { listingId: "listing-1", cdnUrl: "https://cdn/photo1.jpg", isPrimary: true, sortOrder: 0 },
      { listingId: "listing-1", cdnUrl: "https://cdn/photo2.jpg", isPrimary: false, sortOrder: 1 },
    ]);
    // 5. Price histories
    mockRun.mockResolvedValueOnce([
      {
        ID: "ph-1",
        listingId: "listing-1",
        price: 25000,
        previousPrice: 27000,
        changedAt: "2026-01-15T00:00:00Z",
      },
    ]);

    const req = createMockRequest({ skip: 0, top: 20 });
    const result = await handleGetMarketWatchList(req);

    const items = JSON.parse(result.items);
    expect(items).toHaveLength(1);
    expect(result.total).toBe(1);

    const item = items[0];
    expect(item.ID).toBe("watch-1");
    expect(item.listingId).toBe("listing-1");
    expect(item.notes).toBe("Concurrent direct");
    expect(item.listing.make).toBe("Peugeot");
    expect(item.listing.model).toBe("308");
    expect(item.listing.price).toBe(25000);
    expect(item.listing.primaryPhotoUrl).toBe("https://cdn/photo1.jpg");
    expect(item.listing.photoCount).toBe(2);
    expect(item.priceHistory).toHaveLength(1);
    expect(item.priceHistory[0].price).toBe(25000);
    expect(item.priceHistory[0].previousPrice).toBe(27000);
    // Price changed after addedAt, so hasChangedSinceLastVisit = true
    expect(item.hasChangedSinceLastVisit).toBe(true);
  });

  it("should set hasChangedSinceLastVisit to false when no price changes after addedAt", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 1 });
    mockRun.mockResolvedValueOnce([
      {
        ID: "watch-1",
        sellerId: "user-1",
        listingId: "listing-1",
        addedAt: "2026-02-01T00:00:00Z",
        notes: null,
      },
    ]);
    mockRun.mockResolvedValueOnce([
      { ID: "listing-1", make: "Renault", model: "Clio", year: 2022, price: 14000, sellerId: "s2" },
    ]);
    mockRun.mockResolvedValueOnce([]); // no photos
    // Price change BEFORE addedAt
    mockRun.mockResolvedValueOnce([
      {
        ID: "ph-1",
        listingId: "listing-1",
        price: 14000,
        previousPrice: 15000,
        changedAt: "2026-01-15T00:00:00Z",
      },
    ]);

    const req = createMockRequest({});
    const result = await handleGetMarketWatchList(req);

    const items = JSON.parse(result.items);
    expect(items[0].hasChangedSinceLastVisit).toBe(false);
  });

  it("should handle missing listing gracefully", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 1 });
    mockRun.mockResolvedValueOnce([
      {
        ID: "watch-1",
        sellerId: "user-1",
        listingId: "deleted-listing",
        addedAt: "2026-01-10T00:00:00Z",
        notes: null,
      },
    ]);
    mockRun.mockResolvedValueOnce([]); // listing not found
    mockRun.mockResolvedValueOnce([]); // no photos
    mockRun.mockResolvedValueOnce([]); // no price history

    const req = createMockRequest({});
    const result = await handleGetMarketWatchList(req);

    const items = JSON.parse(result.items);
    expect(items).toHaveLength(1);
    expect(items[0].listing.ID).toBe("deleted-listing");
    expect(items[0].listing.make).toBeNull();
    expect(items[0].listing.primaryPhotoUrl).toBeNull();
    expect(items[0].listing.photoCount).toBe(0);
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({});
    req.user = { id: undefined };

    await handleGetMarketWatchList(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });
});

// ─── Tests: checkMarketWatches ──────────────────────────────────────────────

describe("handleCheckMarketWatches", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return watch status for multiple listings", async () => {
    mockRun.mockResolvedValueOnce([
      { ID: "watch-1", listingId: "listing-1" },
      { ID: "watch-3", listingId: "listing-3" },
    ]);

    const req = createMockRequest({
      listingIds: JSON.stringify(["listing-1", "listing-2", "listing-3"]),
    });
    const result = await handleCheckMarketWatches(req);

    const parsed = JSON.parse(result.results);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({ listingId: "listing-1", isWatching: true, watchId: "watch-1" });
    expect(parsed[1]).toEqual({ listingId: "listing-2", isWatching: false, watchId: null });
    expect(parsed[2]).toEqual({ listingId: "listing-3", isWatching: true, watchId: "watch-3" });
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({ listingIds: "[]" });
    req.user = { id: undefined };

    await handleCheckMarketWatches(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should return 400 for invalid JSON", async () => {
    const req = createMockRequest({ listingIds: "not-json" });

    await handleCheckMarketWatches(req);

    expect(req.error).toHaveBeenCalledWith(400, "Invalid listingIds JSON");
  });

  it("should return empty for empty array", async () => {
    const req = createMockRequest({ listingIds: "[]" });
    const result = await handleCheckMarketWatches(req);

    expect(JSON.parse(result.results)).toHaveLength(0);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

// ─── Tests: recordPriceChange ───────────────────────────────────────────────

describe("recordPriceChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    mockCreateNotification.mockReset();
  });

  it("should insert price history and notify watchers", async () => {
    // 1. INSERT price history
    mockRun.mockResolvedValueOnce(undefined);
    // 2. SELECT watchers
    mockRun.mockResolvedValueOnce([{ sellerId: "watcher-1" }, { sellerId: "watcher-2" }]);
    // 3. SELECT listing (make/model)
    mockRun.mockResolvedValueOnce({ make: "Peugeot", model: "308" });

    mockCreateNotification.mockResolvedValue({ ID: "notif-1" });

    await recordPriceChange("listing-1", 23000, 25000);

    // INSERT was called for price history
    expect(mockRun).toHaveBeenCalledTimes(3);
    // Notifications created for each watcher
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "watcher-1",
        type: "price_change",
        title: "Changement de prix (suivi marché)",
        body: expect.stringContaining("baissé"),
        listingId: "listing-1",
      }),
    );
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "watcher-2",
        type: "price_change",
      }),
    );
  });

  it("should use 'augmenté' when price increases", async () => {
    mockRun.mockResolvedValueOnce(undefined);
    mockRun.mockResolvedValueOnce([{ sellerId: "watcher-1" }]);
    mockRun.mockResolvedValueOnce({ make: "Renault", model: "Clio" });
    mockCreateNotification.mockResolvedValue({ ID: "notif-1" });

    await recordPriceChange("listing-1", 18000, 15000);

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("augmenté"),
      }),
    );
  });

  it("should handle null previousPrice", async () => {
    mockRun.mockResolvedValueOnce(undefined);
    mockRun.mockResolvedValueOnce([{ sellerId: "watcher-1" }]);
    mockRun.mockResolvedValueOnce({ make: "Toyota", model: "Yaris" });
    mockCreateNotification.mockResolvedValue({ ID: "notif-1" });

    await recordPriceChange("listing-1", 12000, null);

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Le prix du Toyota Yaris est maintenant 12000€",
      }),
    );
  });

  it("should skip notifications when no watchers", async () => {
    mockRun.mockResolvedValueOnce(undefined); // INSERT price history
    mockRun.mockResolvedValueOnce([]); // no watchers

    await recordPriceChange("listing-1", 20000, 22000);

    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("should use 'véhicule' fallback when make/model missing", async () => {
    mockRun.mockResolvedValueOnce(undefined);
    mockRun.mockResolvedValueOnce([{ sellerId: "watcher-1" }]);
    mockRun.mockResolvedValueOnce(null); // listing not found
    mockCreateNotification.mockResolvedValue({ ID: "notif-1" });

    await recordPriceChange("listing-1", 10000, 12000);

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("véhicule"),
      }),
    );
  });
});
