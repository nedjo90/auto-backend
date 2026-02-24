/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

/**
 * Unit tests for lifecycle handler functions:
 * - markAsSold, archiveListing, getSellerListings, getListingHistory
 */

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "test-uuid-lifecycle");

// Valid UUID for test data
const LISTING_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const SELLER_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_SELLER_ID = "99999999-8888-7777-6666-555544443333";

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        Listing: "Listing",
        ListingAnalytics: "ListingAnalytics",
        ListingPhoto: "ListingPhoto",
        AuditTrailEntry: "AuditTrailEntry",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => mockUuid() },
    },
  };
});

jest.mock("@auto/shared", () => ({
  isValidListingTransition: jest.fn((from: string, to: string) => {
    const transitions: Record<string, string[]> = {
      draft: ["published"],
      published: ["sold", "archived"],
      sold: ["archived"],
      archived: [],
    };
    return (transitions[from] || []).includes(to);
  }),
}));

jest.mock("../../../srv/middleware/audit-trail", () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  extractAuditContext: jest.fn().mockReturnValue({
    actorId: SELLER_ID,
    actorRole: "seller",
    ipAddress: "127.0.0.1",
    userAgent: "test",
    requestId: "req-1",
  }),
}));

// Global CDS query helpers
(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("select-one-query"),
    }),
  },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue("select-query"),
    }),
    columns: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        orderBy: jest.fn().mockReturnValue("select-photo-query"),
      }),
    }),
    orderBy: jest.fn().mockReturnValue("select-query"),
  }),
};

(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("update-query"),
  }),
});

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-query"),
  }),
};

// Import handlers
const {
  handleMarkAsSold,
  handleArchiveListing,
  handleGetSellerListings,
  handleGetListingHistory,
  onListingStatusChange,
} = require("../../../srv/handlers/lifecycle-handler");

// Mock request builder
function createMockRequest(data: Record<string, any>, userId = SELLER_ID): any {
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

// ─── markAsSold ─────────────────────────────────────────────────────────────

describe("handleMarkAsSold", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should mark a published listing as sold", async () => {
    mockRun.mockResolvedValueOnce({
      ID: LISTING_ID,
      sellerId: SELLER_ID,
      status: "published",
    });
    mockRun.mockResolvedValueOnce(1); // UPDATE affected 1 row

    const req = createMockRequest({ listingId: LISTING_ID });
    const result = await handleMarkAsSold(req);

    expect(result.success).toBe(true);
    expect(result.newStatus).toBe("sold");
    expect(result.listingId).toBe(LISTING_ID);
    expect(result.timestamp).toBeTruthy();
  });

  it("should reject invalid UUID format", async () => {
    const req = createMockRequest({ listingId: "not-a-uuid" });
    await handleMarkAsSold(req);
    expect(req.error).toHaveBeenCalledWith(400, "Identifiant d'annonce invalide");
  });

  it("should return 409 on concurrent modification", async () => {
    mockRun.mockResolvedValueOnce({
      ID: LISTING_ID,
      sellerId: SELLER_ID,
      status: "published",
    });
    mockRun.mockResolvedValueOnce(0); // UPDATE affected 0 rows (concurrent change)

    const req = createMockRequest({ listingId: LISTING_ID });
    await handleMarkAsSold(req);
    expect(req.error).toHaveBeenCalledWith(
      409,
      "L'annonce a ete modifiee entre-temps, veuillez reessayer",
    );
  });

  it("should return 401 when user is not authenticated", async () => {
    const req = createMockRequest({ listingId: LISTING_ID });
    req.user = { id: undefined };

    await handleMarkAsSold(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should return 404 when listing does not exist", async () => {
    mockRun.mockResolvedValueOnce(null);

    const req = createMockRequest({ listingId: "00000000-0000-0000-0000-000000000000" });
    await handleMarkAsSold(req);

    expect(req.error).toHaveBeenCalledWith(404, "Annonce introuvable");
  });

  it("should return 403 when seller does not own the listing", async () => {
    mockRun.mockResolvedValueOnce({
      ID: LISTING_ID,
      sellerId: OTHER_SELLER_ID,
      status: "published",
    });

    const req = createMockRequest({ listingId: LISTING_ID });
    await handleMarkAsSold(req);

    expect(req.error).toHaveBeenCalledWith(403, "Vous n'êtes pas le propriétaire de cette annonce");
  });

  it("should return 400 for invalid transition (draft -> sold)", async () => {
    mockRun.mockResolvedValueOnce({
      ID: LISTING_ID,
      sellerId: SELLER_ID,
      status: "draft",
    });

    const req = createMockRequest({ listingId: LISTING_ID });
    await handleMarkAsSold(req);

    expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("Transition invalide"));
  });

  it("should return 400 for invalid transition (archived -> sold)", async () => {
    mockRun.mockResolvedValueOnce({
      ID: LISTING_ID,
      sellerId: SELLER_ID,
      status: "archived",
    });

    const req = createMockRequest({ listingId: LISTING_ID });
    await handleMarkAsSold(req);

    expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("Transition invalide"));
  });

  it("should call auditLog on successful transition", async () => {
    const { auditLog } = require("../../../srv/middleware/audit-trail");

    mockRun.mockResolvedValueOnce({
      ID: LISTING_ID,
      sellerId: SELLER_ID,
      status: "published",
    });
    mockRun.mockResolvedValueOnce(1);

    const req = createMockRequest({ listingId: LISTING_ID });
    await handleMarkAsSold(req);

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "listing.sold",
        targetType: "Listing",
        targetId: LISTING_ID,
      }),
    );
  });
});

// ─── archiveListing ─────────────────────────────────────────────────────────

describe("handleArchiveListing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should archive a published listing", async () => {
    mockRun.mockResolvedValueOnce({
      ID: LISTING_ID,
      sellerId: SELLER_ID,
      status: "published",
    });
    mockRun.mockResolvedValueOnce(1);

    const req = createMockRequest({ listingId: LISTING_ID });
    const result = await handleArchiveListing(req);

    expect(result.success).toBe(true);
    expect(result.newStatus).toBe("archived");
    expect(result.listingId).toBe(LISTING_ID);
  });

  it("should reject invalid UUID format", async () => {
    const req = createMockRequest({ listingId: "not-a-uuid" });
    await handleArchiveListing(req);
    expect(req.error).toHaveBeenCalledWith(400, "Identifiant d'annonce invalide");
  });

  it("should archive a sold listing", async () => {
    mockRun.mockResolvedValueOnce({
      ID: LISTING_ID,
      sellerId: SELLER_ID,
      status: "sold",
    });
    mockRun.mockResolvedValueOnce(1);

    const req = createMockRequest({ listingId: LISTING_ID });
    const result = await handleArchiveListing(req);

    expect(result.success).toBe(true);
    expect(result.newStatus).toBe("archived");
  });

  it("should return 401 when user is not authenticated", async () => {
    const req = createMockRequest({ listingId: LISTING_ID });
    req.user = { id: undefined };

    await handleArchiveListing(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should return 404 when listing does not exist", async () => {
    mockRun.mockResolvedValueOnce(null);

    const req = createMockRequest({ listingId: "00000000-0000-0000-0000-000000000000" });
    await handleArchiveListing(req);

    expect(req.error).toHaveBeenCalledWith(404, "Annonce introuvable");
  });

  it("should return 403 when seller does not own the listing", async () => {
    mockRun.mockResolvedValueOnce({
      ID: LISTING_ID,
      sellerId: OTHER_SELLER_ID,
      status: "published",
    });

    const req = createMockRequest({ listingId: LISTING_ID });
    await handleArchiveListing(req);

    expect(req.error).toHaveBeenCalledWith(403, "Vous n'êtes pas le propriétaire de cette annonce");
  });

  it("should return 400 for invalid transition (draft -> archived)", async () => {
    mockRun.mockResolvedValueOnce({
      ID: LISTING_ID,
      sellerId: SELLER_ID,
      status: "draft",
    });

    const req = createMockRequest({ listingId: LISTING_ID });
    await handleArchiveListing(req);

    expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("Transition invalide"));
  });

  it("should call auditLog on successful archive", async () => {
    const { auditLog } = require("../../../srv/middleware/audit-trail");

    mockRun.mockResolvedValueOnce({
      ID: LISTING_ID,
      sellerId: SELLER_ID,
      status: "published",
    });
    mockRun.mockResolvedValueOnce(1);

    const req = createMockRequest({ listingId: LISTING_ID });
    await handleArchiveListing(req);

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "listing.archived",
        targetType: "Listing",
        targetId: LISTING_ID,
      }),
    );
  });
});

// ─── getSellerListings ──────────────────────────────────────────────────────

describe("handleGetSellerListings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return published listings with analytics", async () => {
    // Listings query
    mockRun.mockResolvedValueOnce([
      {
        ID: LISTING_ID,
        make: "Renault",
        model: "Clio",
        year: 2022,
        price: 15000,
        status: "published",
        visibilityScore: 80,
        publishedAt: "2026-02-01T08:00:00Z",
        soldAt: null,
        archivedAt: null,
        modifiedAt: "2026-02-01T08:00:00Z",
      },
    ]);
    // Analytics query
    mockRun.mockResolvedValueOnce([
      { listingId: LISTING_ID, viewCount: 100, favoriteCount: 10, chatCount: 3 },
    ]);
    // Photos query
    mockRun.mockResolvedValueOnce([
      {
        listingId: LISTING_ID,
        cdnUrl: "https://cdn.example.com/photo.jpg",
        isPrimary: true,
        sortOrder: 0,
      },
    ]);

    const req = createMockRequest({});
    const result = await handleGetSellerListings(req);

    const listings = JSON.parse(result.listings);
    expect(listings).toHaveLength(1);
    expect(listings[0].make).toBe("Renault");
    expect(listings[0].viewCount).toBe(100);
    expect(listings[0].photoCount).toBe(1);
    expect(listings[0].daysOnMarket).toBeGreaterThanOrEqual(0);
  });

  it("should return empty array when no published listings", async () => {
    mockRun.mockResolvedValueOnce([]);

    const req = createMockRequest({});
    const result = await handleGetSellerListings(req);

    const listings = JSON.parse(result.listings);
    expect(listings).toHaveLength(0);
  });

  it("should return 401 when user is not authenticated", async () => {
    const req = createMockRequest({});
    req.user = { id: undefined };

    await handleGetSellerListings(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });
});

// ─── getListingHistory ──────────────────────────────────────────────────────

describe("handleGetListingHistory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return all non-draft listings with metrics", async () => {
    mockRun.mockResolvedValueOnce([
      {
        ID: LISTING_ID,
        make: "Peugeot",
        model: "308",
        year: 2023,
        price: 22000,
        status: "sold",
        visibilityScore: 90,
        publishedAt: "2026-01-10T08:00:00Z",
        soldAt: "2026-02-10T14:00:00Z",
        archivedAt: null,
        modifiedAt: "2026-02-10T14:00:00Z",
      },
      {
        ID: "listing-2",
        make: "Citroen",
        model: "C3",
        year: 2021,
        price: 12000,
        status: "archived",
        visibilityScore: 60,
        publishedAt: "2026-01-01T08:00:00Z",
        soldAt: null,
        archivedAt: "2026-02-01T08:00:00Z",
        modifiedAt: "2026-02-01T08:00:00Z",
      },
    ]);
    // Analytics
    mockRun.mockResolvedValueOnce([
      { listingId: LISTING_ID, viewCount: 320, favoriteCount: 25, chatCount: 8 },
      { listingId: "listing-2", viewCount: 50, favoriteCount: 2, chatCount: 1 },
    ]);
    // Photos
    mockRun.mockResolvedValueOnce([
      {
        listingId: LISTING_ID,
        cdnUrl: "https://cdn.example.com/1.jpg",
        isPrimary: true,
        sortOrder: 0,
      },
      {
        listingId: LISTING_ID,
        cdnUrl: "https://cdn.example.com/2.jpg",
        isPrimary: false,
        sortOrder: 1,
      },
    ]);

    const req = createMockRequest({});
    const result = await handleGetListingHistory(req);

    const listings = JSON.parse(result.listings);
    expect(listings).toHaveLength(2);

    // Sold listing
    expect(listings[0].status).toBe("sold");
    expect(listings[0].viewCount).toBe(320);
    expect(listings[0].daysOnMarket).toBe(31); // Jan 10 to Feb 10 = 31 days
    expect(listings[0].photoCount).toBe(2);

    // Archived listing
    expect(listings[1].status).toBe("archived");
    expect(listings[1].viewCount).toBe(50);
    expect(listings[1].daysOnMarket).toBe(31); // Jan 1 to Feb 1 = 31 days
    expect(listings[1].photoCount).toBe(0);
  });

  it("should return 401 when user is not authenticated", async () => {
    const req = createMockRequest({});
    req.user = { id: undefined };

    await handleGetListingHistory(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("should handle listings without analytics records", async () => {
    mockRun.mockResolvedValueOnce([
      {
        ID: LISTING_ID,
        make: "Renault",
        model: "Megane",
        year: 2020,
        price: 18000,
        status: "published",
        visibilityScore: 70,
        publishedAt: "2026-02-20T08:00:00Z",
        soldAt: null,
        archivedAt: null,
        modifiedAt: "2026-02-20T08:00:00Z",
      },
    ]);
    mockRun.mockResolvedValueOnce([]); // No analytics
    mockRun.mockResolvedValueOnce([]); // No photos

    const req = createMockRequest({});
    const result = await handleGetListingHistory(req);

    const listings = JSON.parse(result.listings);
    expect(listings[0].viewCount).toBe(0);
    expect(listings[0].favoriteCount).toBe(0);
    expect(listings[0].chatCount).toBe(0);
    expect(listings[0].photoCount).toBe(0);
    expect(listings[0].primaryPhotoUrl).toBeNull();
  });
});

// ─── Event hooks ────────────────────────────────────────────────────────────

describe("onListingStatusChange", () => {
  it("should call registered handlers on status change", async () => {
    const handler = jest.fn();
    onListingStatusChange(handler);

    // Trigger a markAsSold to fire the event
    mockRun.mockResolvedValueOnce({
      ID: LISTING_ID,
      sellerId: SELLER_ID,
      status: "published",
    });
    mockRun.mockResolvedValueOnce(1);

    const req = createMockRequest({ listingId: LISTING_ID });
    await handleMarkAsSold(req);

    expect(handler).toHaveBeenCalledWith(LISTING_ID, SELLER_ID, "sold");
  });
});
