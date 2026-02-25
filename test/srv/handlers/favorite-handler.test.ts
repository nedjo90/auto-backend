/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "generated-uuid");

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        Favorite: "Favorite",
        Listing: "Listing",
        ListingPhoto: "ListingPhoto",
        CertifiedField: "CertifiedField",
        ListingAnalytics: "ListingAnalytics",
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

jest.mock("../../../srv/lib/market-price", () => ({
  computeMarketComparison: jest.fn().mockResolvedValue({
    position: "aligned",
    percentageDiff: 0,
    displayText: "Prix aligné",
  }),
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
  handleToggleFavorite,
  handleCheckFavorites,
  handleGetMyFavorites,
  handleMarkAllAsSeen,
} = require("../../../srv/handlers/favorite-handler");

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

// ─── Tests: toggleFavorite ───────────────────────────────────────────────────

describe("handleToggleFavorite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should add a favorite for a published listing", async () => {
    // 1. Check existing favorite -> null
    mockRun.mockResolvedValueOnce(null);
    // 2. Listing exists and is published
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      status: "published",
      price: 15000,
      make: "Renault",
      model: "Clio",
    });
    // 3. Count current favorites
    mockRun.mockResolvedValueOnce({ cnt: 5 });
    // 4. Photo count
    mockRun.mockResolvedValueOnce({ count: 3 });
    // 5. Certified field count (certified)
    mockRun.mockResolvedValueOnce({ count: 6 });
    // 6. Total field count
    mockRun.mockResolvedValueOnce({ count: 10 });
    // 7. INSERT favorite
    mockRun.mockResolvedValueOnce(undefined);
    // 8. ListingAnalytics select
    mockRun.mockResolvedValueOnce({ listingId: "listing-1", favoriteCount: 2 });
    // 9. ListingAnalytics update
    mockRun.mockResolvedValueOnce(1);

    const req = createMockRequest({ listingId: "12345678-1234-1234-1234-123456789012" });
    const result = await handleToggleFavorite(req);

    expect(result.favorited).toBe(true);
    expect(result.favoriteId).toBe("generated-uuid");
    expect(req.error).not.toHaveBeenCalled();
  });

  it("should remove a favorite when it already exists", async () => {
    // 1. Check existing -> found
    mockRun.mockResolvedValueOnce({ ID: "fav-1", userId: "user-1", listingId: "listing-1" });
    // 2. DELETE
    mockRun.mockResolvedValueOnce(1);
    // 3. Analytics select for decrement
    mockRun.mockResolvedValueOnce({ listingId: "listing-1", favoriteCount: 3 });
    // 4. Analytics update
    mockRun.mockResolvedValueOnce(1);

    const req = createMockRequest({ listingId: "12345678-1234-1234-1234-123456789012" });
    const result = await handleToggleFavorite(req);

    expect(result.favorited).toBe(false);
    expect(result.favoriteId).toBeNull();
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({ listingId: "12345678-1234-1234-1234-123456789012" });
    req.user = { id: undefined };

    await handleToggleFavorite(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should return 400 for invalid listing ID", async () => {
    const req = createMockRequest({ listingId: "not-a-uuid" });

    await handleToggleFavorite(req);

    expect(req.error).toHaveBeenCalledWith(400, "Identifiant d'annonce invalide");
  });

  it("should return 404 when listing does not exist", async () => {
    mockRun.mockResolvedValueOnce(null); // no existing favorite
    mockRun.mockResolvedValueOnce(null); // listing not found

    const req = createMockRequest({ listingId: "12345678-1234-1234-1234-123456789012" });
    await handleToggleFavorite(req);

    expect(req.error).toHaveBeenCalledWith(404, "Annonce introuvable");
  });

  it("should return 400 when listing is not published", async () => {
    mockRun.mockResolvedValueOnce(null); // no existing favorite
    mockRun.mockResolvedValueOnce({ ID: "listing-1", status: "draft" }); // draft listing

    const req = createMockRequest({ listingId: "12345678-1234-1234-1234-123456789012" });
    await handleToggleFavorite(req);

    expect(req.error).toHaveBeenCalledWith(
      400,
      "Seules les annonces publiées peuvent être ajoutées aux favoris",
    );
  });

  it("should return 400 when at max favorites", async () => {
    mockRun.mockResolvedValueOnce(null); // no existing favorite
    mockRun.mockResolvedValueOnce({ ID: "listing-1", status: "published", price: 10000 }); // listing
    mockRun.mockResolvedValueOnce({ cnt: 100 }); // at max

    const req = createMockRequest({ listingId: "12345678-1234-1234-1234-123456789012" });
    await handleToggleFavorite(req);

    expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("limite de 100 favoris"));
  });
});

// ─── Tests: checkFavorites ──────────────────────────────────────────────────

describe("handleCheckFavorites", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return favorite status for multiple listings", async () => {
    mockRun.mockResolvedValueOnce([
      { ID: "fav-1", listingId: "listing-1" },
      { ID: "fav-3", listingId: "listing-3" },
    ]);

    const req = createMockRequest({
      listingIds: JSON.stringify(["listing-1", "listing-2", "listing-3"]),
    });
    const result = await handleCheckFavorites(req);

    const parsed = JSON.parse(result.results);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({
      listingId: "listing-1",
      isFavorited: true,
      favoriteId: "fav-1",
    });
    expect(parsed[1]).toEqual({
      listingId: "listing-2",
      isFavorited: false,
      favoriteId: null,
    });
    expect(parsed[2]).toEqual({
      listingId: "listing-3",
      isFavorited: true,
      favoriteId: "fav-3",
    });
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({ listingIds: "[]" });
    req.user = { id: undefined };

    await handleCheckFavorites(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should return 400 for invalid JSON", async () => {
    const req = createMockRequest({ listingIds: "not-json" });

    await handleCheckFavorites(req);

    expect(req.error).toHaveBeenCalledWith(400, "Format de listingIds invalide");
  });

  it("should return empty for empty array", async () => {
    const req = createMockRequest({ listingIds: "[]" });
    const result = await handleCheckFavorites(req);

    expect(JSON.parse(result.results)).toHaveLength(0);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

// ─── Tests: getMyFavorites ──────────────────────────────────────────────────

describe("handleGetMyFavorites", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return empty when user has no favorites", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 0 }); // count

    const req = createMockRequest({});
    const result = await handleGetMyFavorites(req);

    expect(result.total).toBe(0);
    expect(JSON.parse(result.items)).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });

  it("should return enriched favorites with change detection", async () => {
    // 1. Count
    mockRun.mockResolvedValueOnce({ cnt: 1 });
    // 2. Favorites
    mockRun.mockResolvedValueOnce([
      {
        ID: "fav-1",
        userId: "user-1",
        listingId: "listing-1",
        createdAt: "2026-01-15T00:00:00Z",
        snapshotPrice: 15000,
        snapshotCertificationLevel: "bien_documente",
        snapshotPhotoCount: 3,
      },
    ]);
    // 3. Listings
    mockRun.mockResolvedValueOnce([
      {
        ID: "listing-1",
        make: "Renault",
        model: "Clio",
        variant: null,
        year: 2022,
        price: 14000, // price changed
        mileage: 50000,
        fuelType: "Essence",
        gearbox: "Manuelle",
        bodyType: "Berline",
        color: "Rouge",
        condition: "Bon",
        visibilityScore: 80,
        visibilityLabel: "Bien documenté",
        publishedAt: "2026-01-01T00:00:00Z",
        sellerId: "seller-1",
        ctValid: true,
        status: "published",
      },
    ]);
    // 4. Photos
    mockRun.mockResolvedValueOnce([
      { listingId: "listing-1", cdnUrl: "https://cdn/photo1.jpg", isPrimary: true, sortOrder: 0 },
      { listingId: "listing-1", cdnUrl: "https://cdn/photo2.jpg", isPrimary: false, sortOrder: 1 },
      { listingId: "listing-1", cdnUrl: "https://cdn/photo3.jpg", isPrimary: false, sortOrder: 2 },
      { listingId: "listing-1", cdnUrl: "https://cdn/photo4.jpg", isPrimary: false, sortOrder: 3 },
    ]);
    // 5. Certified fields
    mockRun.mockResolvedValueOnce([
      { listingId: "listing-1", fieldName: "make", isCertified: true },
      { listingId: "listing-1", fieldName: "model", isCertified: true },
      { listingId: "listing-1", fieldName: "year", isCertified: true },
    ]);

    const req = createMockRequest({});
    const result = await handleGetMyFavorites(req);

    const items = JSON.parse(result.items);
    expect(items).toHaveLength(1);
    expect(items[0].ID).toBe("fav-1");
    expect(items[0].listing.make).toBe("Renault");
    expect(items[0].listing.price).toBe(14000);
    expect(items[0].changes.priceChanged).toBe(true);
    expect(items[0].changes.oldPrice).toBe(15000);
    expect(items[0].changes.newPrice).toBe(14000);
    expect(items[0].changes.photosAdded).toBe(1); // 4 - 3
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({});
    req.user = { id: undefined };

    await handleGetMyFavorites(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });
});

// ─── Tests: markAllAsSeen ───────────────────────────────────────────────────

describe("handleMarkAllAsSeen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should update all favorites to current snapshot values", async () => {
    // 1. Get favorites
    mockRun.mockResolvedValueOnce([{ ID: "fav-1", userId: "user-1", listingId: "listing-1" }]);
    // 2. Get listing
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      price: 14000,
    });
    // 3. Photo count
    mockRun.mockResolvedValueOnce({ count: 5 });
    // 4. Certified count
    mockRun.mockResolvedValueOnce({ count: 4 });
    // 5. Total field count
    mockRun.mockResolvedValueOnce({ count: 8 });
    // 6. UPDATE favorite
    mockRun.mockResolvedValueOnce(1);

    const req = createMockRequest({});
    const result = await handleMarkAllAsSeen(req);

    expect(result.success).toBe(true);
    expect(result.updated).toBe(1);
  });

  it("should return 0 updated when no favorites", async () => {
    mockRun.mockResolvedValueOnce([]); // no favorites

    const req = createMockRequest({});
    const result = await handleMarkAllAsSeen(req);

    expect(result.success).toBe(true);
    expect(result.updated).toBe(0);
  });

  it("should return 401 when not authenticated", async () => {
    const req = createMockRequest({});
    req.user = { id: undefined };

    await handleMarkAllAsSeen(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });
});
