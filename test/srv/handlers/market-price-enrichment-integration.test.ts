/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

/**
 * Market Price Enrichment Integration Tests (Story 4-3, Task 5.5)
 * Tests that getListings and getListingDetail enrich responses with marketComparison,
 * and that market position post-filtering works end-to-end.
 */
export {};

// ─── Mock the valuation adapter (NOT market-price module) ───────────────
const mockEvaluate = jest.fn();
jest.mock("../../../srv/adapters/factory/adapter-factory", () => ({
  getValuation: jest.fn(() => ({
    evaluate: mockEvaluate,
  })),
}));

// ─── Mock @sap/cds ─────────────────────────────────────────────────────
const mockRun = jest.fn();
const mockEntities = jest.fn();
const mockUuid = jest.fn().mockReturnValue("new-uuid-1234");

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      log: jest.fn(() => mockLog),
      run: (...args: any[]) => mockRun(...args),
      entities: (...args: any[]) => mockEntities(...args),
      utils: { uuid: () => mockUuid() },
    },
  };
});

// ─── Mock CDS query builders ────────────────────────────────────────────
const mockWhere = jest.fn().mockReturnThis();
const mockColumns = jest.fn().mockReturnThis();
const mockOrderBy = jest.fn().mockReturnThis();
const mockLimit = jest.fn().mockReturnThis();
const mockSet = jest.fn().mockReturnThis();
const mockEntries = jest.fn().mockReturnThis();

(global as any).SELECT = {
  from: jest.fn().mockReturnValue({
    columns: mockColumns,
    where: mockWhere,
    orderBy: mockOrderBy,
    limit: mockLimit,
  }),
  one: {
    from: jest.fn().mockReturnValue({
      columns: mockColumns,
      where: mockWhere,
    }),
  },
};

(global as any).UPDATE = jest.fn().mockReturnValue({
  set: mockSet,
  where: mockWhere,
});

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: mockEntries,
  }),
};

// Re-wire chain returns
mockColumns.mockReturnValue({
  where: mockWhere,
  orderBy: mockOrderBy,
  limit: mockLimit,
});
mockWhere.mockReturnValue({
  orderBy: mockOrderBy,
  limit: mockLimit,
});
mockOrderBy.mockReturnValue({
  limit: mockLimit,
});
mockSet.mockReturnValue({
  where: mockWhere,
});

import { clearMarketPriceCache } from "../../../srv/lib/market-price";

const {
  handleGetListings,
  handleGetListingDetail,
} = require("../../../srv/handlers/catalog-handler");

const mockError = jest.fn();

function createMockReq(data: Record<string, unknown>): any {
  return { data, error: mockError };
}

function makeEntities() {
  return {
    Listing: "auto.Listing",
    ListingPhoto: "auto.ListingPhoto",
    CertifiedField: "auto.CertifiedField",
    HistoryReport: "auto.HistoryReport",
    ListingAnalytics: "auto.ListingAnalytics",
  };
}

/** Builds a mock listing row. */
function makeListing(overrides: Record<string, unknown> = {}) {
  return {
    ID: "listing-1",
    make: "Peugeot",
    model: "3008",
    variant: null,
    year: 2020,
    price: 20000,
    mileage: 60000,
    fuelType: "Diesel",
    gearbox: "automatique",
    bodyType: "SUV",
    color: "Noir",
    condition: "Bon",
    visibilityScore: 80,
    visibilityLabel: "Très documenté",
    certificationLevel: "tres_documente",
    ctValid: true,
    publishedAt: "2026-01-01T00:00:00Z",
    sellerId: "seller-1",
    status: "published",
    ...overrides,
  };
}

/** Standard DB mock sequence for handleGetListings with a single listing. */
function mockDbForGetListings(listing: any = makeListing()) {
  mockRun
    // 1. Count query
    .mockResolvedValueOnce({ count: 1 })
    // 2. Listings
    .mockResolvedValueOnce([listing])
    // 3. Primary photo
    .mockResolvedValueOnce({ cdnUrl: "https://cdn.example.com/photo.jpg" })
    // 4. Photo count
    .mockResolvedValueOnce({ count: 5 })
    // 5. Certified field count
    .mockResolvedValueOnce({ count: 6 })
    // 6. Total field count
    .mockResolvedValueOnce({ count: 8 });
}

/** Standard DB mock sequence for handleGetListings with multiple listings. */
function mockDbForGetListingsMulti(listings: any[]) {
  mockRun
    // 1. Count query
    .mockResolvedValueOnce({ count: listings.length });
  // 2. Listings
  mockRun.mockResolvedValueOnce(listings);
  // For each listing: primary photo, photo count, certified count, total count
  for (let i = 0; i < listings.length; i++) {
    mockRun
      .mockResolvedValueOnce({ cdnUrl: "https://cdn.example.com/photo.jpg" })
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 4 })
      .mockResolvedValueOnce({ count: 6 });
  }
}

/** Standard DB mock sequence for handleGetListingDetail. */
function mockDbForGetDetail(listing: any = makeListing()) {
  mockRun
    // 1. Listing
    .mockResolvedValueOnce(listing)
    // 2. Photos
    .mockResolvedValueOnce([
      {
        ID: "photo-1",
        listingId: listing.ID,
        blobUrl: "b",
        cdnUrl: "c",
        sortOrder: 0,
        isPrimary: true,
        fileSize: 100,
        mimeType: "image/jpeg",
        width: 800,
        height: 600,
        uploadedAt: "2026-01-01",
      },
    ])
    // 3. Certified fields
    .mockResolvedValueOnce([
      { fieldName: "make", source: "api", isCertified: true },
      { fieldName: "model", source: "api", isCertified: true },
    ])
    // 4. History report
    .mockResolvedValueOnce({ ID: "hr-1" })
    // 5. Analytics
    .mockResolvedValueOnce({ viewCount: 10, favoriteCount: 2 })
    // 6. Existing analytics for update
    .mockResolvedValueOnce({ viewCount: 10, favoriteCount: 2 })
    // 7. Analytics update
    .mockResolvedValueOnce(undefined);
}

describe("Market Price Enrichment Integration (Story 4-3)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearMarketPriceCache();
    mockEntities.mockReturnValue(makeEntities());
    // Reset chain mocks
    mockColumns.mockReturnValue({
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit,
    });
    mockWhere.mockReturnValue({
      orderBy: mockOrderBy,
      limit: mockLimit,
    });
    mockOrderBy.mockReturnValue({
      limit: mockLimit,
    });
    mockSet.mockReturnValue({
      where: mockWhere,
    });
  });

  // ─── getListings enrichment ──────────────────────────────────────────

  describe("getListings - market comparison enrichment", () => {
    it("should enrich each listing card with marketComparison from adapter", async () => {
      mockDbForGetListings();
      // Adapter returns estimated value of 25000 → listing price 20000 → -20% → below
      mockEvaluate.mockResolvedValue({
        estimatedValueEur: 25000,
        minValueEur: 22000,
        maxValueEur: 28000,
        confidence: 0.85,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const req = createMockReq({});
      const result = await handleGetListings(req);
      const items = JSON.parse(result.items);

      expect(items).toHaveLength(1);
      expect(items[0].marketComparison).toBeDefined();
      expect(items[0].marketComparison.position).toBe("below");
      expect(items[0].marketComparison.percentageDiff).toBe(-20);
      expect(items[0].marketComparison.displayText).toBe("20% en dessous du marché");
    });

    it("should return aligned when listing price matches market", async () => {
      mockDbForGetListings();
      mockEvaluate.mockResolvedValue({
        estimatedValueEur: 20000,
        minValueEur: 17600,
        maxValueEur: 22400,
        confidence: 0.9,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const result = await handleGetListings(createMockReq({}));
      const items = JSON.parse(result.items);

      expect(items[0].marketComparison.position).toBe("aligned");
      expect(items[0].marketComparison.displayText).toBe("Prix aligné");
    });

    it("should return above when listing price exceeds market", async () => {
      mockDbForGetListings(makeListing({ price: 30000 }));
      mockEvaluate.mockResolvedValue({
        estimatedValueEur: 20000,
        minValueEur: 17600,
        maxValueEur: 22400,
        confidence: 0.8,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const result = await handleGetListings(createMockReq({}));
      const items = JSON.parse(result.items);

      expect(items[0].marketComparison.position).toBe("above");
      expect(items[0].marketComparison.percentageDiff).toBe(50);
      expect(items[0].marketComparison.displayText).toBe("50% au-dessus du marché");
    });

    it("should return unavailable when adapter returns null", async () => {
      mockDbForGetListings();
      mockEvaluate.mockResolvedValue(null);

      const result = await handleGetListings(createMockReq({}));
      const items = JSON.parse(result.items);

      expect(items[0].marketComparison.position).toBe("unavailable");
      expect(items[0].marketComparison.percentageDiff).toBeNull();
      expect(items[0].marketComparison.displayText).toBe("Estimation non disponible");
    });

    it("should return unavailable when adapter throws an error", async () => {
      mockDbForGetListings();
      mockEvaluate.mockRejectedValue(new Error("Provider down"));

      const result = await handleGetListings(createMockReq({}));
      const items = JSON.parse(result.items);

      expect(items[0].marketComparison.position).toBe("unavailable");
    });

    it("should include certificationLevel and ctValid in enriched listing", async () => {
      mockDbForGetListings();
      mockEvaluate.mockResolvedValue({
        estimatedValueEur: 20000,
        minValueEur: 17600,
        maxValueEur: 22400,
        confidence: 0.9,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const result = await handleGetListings(createMockReq({}));
      const items = JSON.parse(result.items);

      expect(items[0].certificationLevel).toBe("tres_documente");
      expect(items[0].ctValid).toBe(true);
    });
  });

  // ─── getListings market position post-filter ─────────────────────────

  describe("getListings - market position post-filtering", () => {
    it("should filter to only 'below' listings when marketPosition=below", async () => {
      const listings = [
        makeListing({ ID: "cheap", price: 18000 }),
        makeListing({ ID: "expensive", price: 30000 }),
      ];
      mockDbForGetListingsMulti(listings);

      // First listing: price=18000, market=25000 → -28% → below
      mockEvaluate.mockResolvedValueOnce({
        estimatedValueEur: 25000,
        minValueEur: 22000,
        maxValueEur: 28000,
        confidence: 0.85,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });
      // Second listing: price=30000, market=25000 → +20% → above
      mockEvaluate.mockResolvedValueOnce({
        estimatedValueEur: 25000,
        minValueEur: 22000,
        maxValueEur: 28000,
        confidence: 0.85,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const result = await handleGetListings(createMockReq({ marketPosition: "below" }));
      const items = JSON.parse(result.items);

      expect(items).toHaveLength(1);
      expect(items[0].ID).toBe("cheap");
      expect(items[0].marketComparison.position).toBe("below");
      expect(result.total).toBe(1);
    });

    it("should filter to only 'above' listings when marketPosition=above", async () => {
      const listings = [
        makeListing({ ID: "cheap", price: 18000 }),
        makeListing({ ID: "expensive", price: 30000 }),
      ];
      mockDbForGetListingsMulti(listings);

      mockEvaluate.mockResolvedValueOnce({
        estimatedValueEur: 25000,
        minValueEur: 22000,
        maxValueEur: 28000,
        confidence: 0.85,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });
      mockEvaluate.mockResolvedValueOnce({
        estimatedValueEur: 25000,
        minValueEur: 22000,
        maxValueEur: 28000,
        confidence: 0.85,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const result = await handleGetListings(createMockReq({ marketPosition: "above" }));
      const items = JSON.parse(result.items);

      expect(items).toHaveLength(1);
      expect(items[0].ID).toBe("expensive");
      expect(items[0].marketComparison.position).toBe("above");
    });

    it("should return all listings when no marketPosition filter", async () => {
      const listings = [
        makeListing({ ID: "cheap", price: 18000 }),
        makeListing({ ID: "expensive", price: 30000 }),
      ];
      mockDbForGetListingsMulti(listings);

      mockEvaluate.mockResolvedValueOnce({
        estimatedValueEur: 25000,
        minValueEur: 22000,
        maxValueEur: 28000,
        confidence: 0.85,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });
      mockEvaluate.mockResolvedValueOnce({
        estimatedValueEur: 25000,
        minValueEur: 22000,
        maxValueEur: 28000,
        confidence: 0.85,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const result = await handleGetListings(createMockReq({}));
      const items = JSON.parse(result.items);

      expect(items).toHaveLength(2);
    });

    it("should return empty array when no listings match market position filter", async () => {
      mockDbForGetListingsMulti([makeListing({ price: 20000 })]);
      // Aligned: 0%
      mockEvaluate.mockResolvedValueOnce({
        estimatedValueEur: 20000,
        minValueEur: 17600,
        maxValueEur: 22400,
        confidence: 0.9,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const result = await handleGetListings(createMockReq({ marketPosition: "below" }));
      const items = JSON.parse(result.items);

      expect(items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // ─── getListingDetail enrichment ─────────────────────────────────────

  describe("getListingDetail - market comparison enrichment", () => {
    it("should include marketComparison in detail response", async () => {
      mockDbForGetDetail();
      mockEvaluate.mockResolvedValue({
        estimatedValueEur: 25000,
        minValueEur: 22000,
        maxValueEur: 28000,
        confidence: 0.85,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const req = createMockReq({ listingId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" });
      const result = await handleGetListingDetail(req);
      const detail = JSON.parse(result.listing);

      expect(detail.marketComparison).toBeDefined();
      expect(detail.marketComparison.position).toBe("below");
      expect(detail.marketComparison.percentageDiff).toBe(-20);
      expect(detail.marketComparison.displayText).toBe("20% en dessous du marché");
    });

    it("should include certificationLevel and ctValid in detail response", async () => {
      mockDbForGetDetail();
      mockEvaluate.mockResolvedValue({
        estimatedValueEur: 20000,
        minValueEur: 17600,
        maxValueEur: 22400,
        confidence: 0.9,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const req = createMockReq({ listingId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" });
      const result = await handleGetListingDetail(req);
      const detail = JSON.parse(result.listing);

      expect(detail.certificationLevel).toBe("tres_documente");
      expect(detail.ctValid).toBe(true);
    });

    it("should handle unavailable market comparison in detail gracefully", async () => {
      mockDbForGetDetail(makeListing({ make: null }));
      // No adapter call expected — missing make

      const req = createMockReq({ listingId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" });
      const result = await handleGetListingDetail(req);
      const detail = JSON.parse(result.listing);

      expect(detail.marketComparison.position).toBe("unavailable");
      expect(detail.marketComparison.displayText).toBe("Estimation non disponible");
      expect(mockEvaluate).not.toHaveBeenCalled();
    });

    it("should compute market comparison for sold listings too", async () => {
      mockDbForGetDetail(makeListing({ status: "sold" }));
      mockEvaluate.mockResolvedValue({
        estimatedValueEur: 22000,
        minValueEur: 19360,
        maxValueEur: 24640,
        confidence: 0.8,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const req = createMockReq({ listingId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" });
      const result = await handleGetListingDetail(req);
      const detail = JSON.parse(result.listing);

      expect(detail.marketComparison).toBeDefined();
      expect(detail.marketComparison.position).toBe("below");
    });
  });

  // ─── Caching behavior across requests ────────────────────────────────

  describe("caching - market price computations", () => {
    it("should call adapter only once for same listing in list + detail", async () => {
      const listing = makeListing();

      // First: getListings
      mockDbForGetListings(listing);
      mockEvaluate.mockResolvedValue({
        estimatedValueEur: 25000,
        minValueEur: 22000,
        maxValueEur: 28000,
        confidence: 0.85,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      await handleGetListings(createMockReq({}));
      expect(mockEvaluate).toHaveBeenCalledTimes(1);

      // Second: getListingDetail for same listing
      mockDbForGetDetail(listing);

      const req = createMockReq({ listingId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" });
      const result = await handleGetListingDetail(req);
      const detail = JSON.parse(result.listing);

      // Should have used cached result — adapter not called again
      expect(mockEvaluate).toHaveBeenCalledTimes(1);
      expect(detail.marketComparison.position).toBe("below");
    });

    it("should call adapter again after cache is cleared", async () => {
      mockDbForGetListings();
      mockEvaluate.mockResolvedValue({
        estimatedValueEur: 25000,
        minValueEur: 22000,
        maxValueEur: 28000,
        confidence: 0.85,
        valuationDate: "2026-02-25",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      await handleGetListings(createMockReq({}));
      expect(mockEvaluate).toHaveBeenCalledTimes(1);

      clearMarketPriceCache();

      mockDbForGetListings();
      await handleGetListings(createMockReq({}));
      expect(mockEvaluate).toHaveBeenCalledTimes(2);
    });
  });
});
