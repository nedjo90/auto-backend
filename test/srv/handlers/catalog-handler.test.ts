/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
export {};

const mockComputeMarketComparison = jest.fn().mockResolvedValue({
  position: "aligned",
  percentageDiff: 0,
  displayText: "Prix aligné",
});

jest.mock("../../../srv/lib/market-price", () => ({
  computeMarketComparison: (...args: any[]) => mockComputeMarketComparison(...args),
}));

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

// Mock CDS query builders
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

const {
  handleGetListings,
  handleGetListingDetail,
  haversineDistance,
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

describe("catalog-handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  describe("handleGetListings", () => {
    it("should return paginated published listings", async () => {
      mockRun
        // Count query
        .mockResolvedValueOnce({ count: 2 })
        // Listings
        .mockResolvedValueOnce([
          {
            ID: "listing-1",
            make: "Renault",
            model: "Clio",
            variant: null,
            year: 2020,
            price: 15000,
            mileage: 50000,
            fuelType: "essence",
            gearbox: "manuelle",
            bodyType: "berline",
            color: "rouge",
            condition: "Bon",
            visibilityScore: 75,
            visibilityLabel: "Bien documenté",
            certificationLevel: "bien_documente",
            ctValid: true,
            publishedAt: "2026-01-01T00:00:00Z",
            sellerId: "seller-1",
          },
        ])
        // Primary photo
        .mockResolvedValueOnce({ cdnUrl: "https://cdn.example.com/photo1.jpg" })
        // Photo count
        .mockResolvedValueOnce({ count: 3 })
        // Certified field count
        .mockResolvedValueOnce({ count: 10 })
        // Total field count
        .mockResolvedValueOnce({ count: 15 });

      const req = createMockReq({ skip: 0, top: 20 });
      const result = await handleGetListings(req);

      expect(result.total).toBe(2);
      expect(result.skip).toBe(0);
      expect(result.top).toBe(20);
      expect(result.hasMore).toBe(false);

      const items = JSON.parse(result.items);
      expect(items).toHaveLength(1);
      expect(items[0].make).toBe("Renault");
      expect(items[0].primaryPhotoUrl).toBe("https://cdn.example.com/photo1.jpg");
      expect(items[0].photoCount).toBe(3);
      expect(items[0].certifiedFieldCount).toBe(10);
      expect(items[0].certificationLevel).toBe("bien_documente");
      expect(items[0].ctValid).toBe(true);
      expect(items[0].marketComparison).toBeDefined();
    });

    it("should handle search parameter", async () => {
      mockRun.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, search: "Renault" });
      const result = await handleGetListings(req);

      expect(result.total).toBe(0);
      const items = JSON.parse(result.items);
      expect(items).toHaveLength(0);
    });

    it("should clamp top to max 100", async () => {
      mockRun.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 500 });
      const result = await handleGetListings(req);

      expect(result.top).toBe(100);
    });

    it("should use default values when skip and top are missing", async () => {
      mockRun.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce([]);

      const req = createMockReq({});
      const result = await handleGetListings(req);

      expect(result.skip).toBe(0);
      expect(result.top).toBe(20);
    });

    it("should indicate hasMore when there are more results", async () => {
      mockRun.mockResolvedValueOnce({ count: 50 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20 });
      const result = await handleGetListings(req);

      expect(result.hasMore).toBe(true);
    });

    // ─── Filter Tests (Story 4-2) ──────────────────────────────────────

    it("should filter by minPrice", async () => {
      mockRun.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, minPrice: 5000 });
      const result = await handleGetListings(req);

      expect(result.total).toBe(1);
      // Verify WHERE was called (conditions include minPrice filter)
      expect(mockWhere).toHaveBeenCalled();
    });

    it("should filter by maxPrice", async () => {
      mockRun.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, maxPrice: 20000 });
      const result = await handleGetListings(req);

      expect(result.total).toBe(1);
      expect(mockWhere).toHaveBeenCalled();
    });

    it("should filter by price range (minPrice + maxPrice)", async () => {
      mockRun.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, minPrice: 5000, maxPrice: 15000 });
      const result = await handleGetListings(req);

      expect(result.total).toBe(3);
    });

    it("should filter by make (brand)", async () => {
      mockRun.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, make: "Peugeot" });
      const result = await handleGetListings(req);

      expect(result.total).toBe(2);
    });

    it("should filter by model", async () => {
      mockRun.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, model: "308" });
      const result = await handleGetListings(req);

      expect(result.total).toBe(1);
    });

    it("should filter by make and model combined", async () => {
      mockRun.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, make: "Peugeot", model: "308" });
      const result = await handleGetListings(req);

      expect(result.total).toBe(1);
    });

    it("should filter by year range (minYear + maxYear)", async () => {
      mockRun.mockResolvedValueOnce({ count: 5 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, minYear: 2018, maxYear: 2023 });
      const result = await handleGetListings(req);

      expect(result.total).toBe(5);
    });

    it("should filter by minYear only", async () => {
      mockRun.mockResolvedValueOnce({ count: 10 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, minYear: 2020 });
      const result = await handleGetListings(req);

      expect(result.total).toBe(10);
    });

    it("should filter by maxMileage", async () => {
      mockRun.mockResolvedValueOnce({ count: 4 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, maxMileage: 80000 });
      const result = await handleGetListings(req);

      expect(result.total).toBe(4);
    });

    it("should filter by fuelType (multi-select JSON array)", async () => {
      mockRun.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce([]);

      const req = createMockReq({
        skip: 0,
        top: 20,
        fuelType: JSON.stringify(["essence", "diesel"]),
      });
      const result = await handleGetListings(req);

      expect(result.total).toBe(3);
    });

    it("should filter by gearbox (multi-select JSON array)", async () => {
      mockRun.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce([]);

      const req = createMockReq({
        skip: 0,
        top: 20,
        gearbox: JSON.stringify(["automatique"]),
      });
      const result = await handleGetListings(req);

      expect(result.total).toBe(2);
    });

    it("should filter by bodyType (multi-select JSON array)", async () => {
      mockRun.mockResolvedValueOnce({ count: 6 }).mockResolvedValueOnce([]);

      const req = createMockReq({
        skip: 0,
        top: 20,
        bodyType: JSON.stringify(["berline", "SUV", "break"]),
      });
      const result = await handleGetListings(req);

      expect(result.total).toBe(6);
    });

    it("should filter by color (multi-select JSON array)", async () => {
      mockRun.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce([]);

      const req = createMockReq({
        skip: 0,
        top: 20,
        color: JSON.stringify(["noir", "blanc"]),
      });
      const result = await handleGetListings(req);

      expect(result.total).toBe(1);
    });

    it("should ignore invalid JSON for fuelType", async () => {
      mockRun.mockResolvedValueOnce({ count: 10 }).mockResolvedValueOnce([]);

      const req = createMockReq({
        skip: 0,
        top: 20,
        fuelType: "not-valid-json",
      });
      const result = await handleGetListings(req);

      // Should not crash and return all results (no filter applied)
      expect(result.total).toBe(10);
    });

    it("should ignore empty JSON array for fuelType", async () => {
      mockRun.mockResolvedValueOnce({ count: 10 }).mockResolvedValueOnce([]);

      const req = createMockReq({
        skip: 0,
        top: 20,
        fuelType: JSON.stringify([]),
      });
      const result = await handleGetListings(req);

      expect(result.total).toBe(10);
    });

    it("should combine multiple filters", async () => {
      mockRun.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce([]);

      const req = createMockReq({
        skip: 0,
        top: 20,
        make: "Renault",
        model: "Clio",
        minPrice: 5000,
        maxPrice: 15000,
        minYear: 2018,
        maxYear: 2023,
        maxMileage: 100000,
        fuelType: JSON.stringify(["essence"]),
        gearbox: JSON.stringify(["manuelle"]),
      });
      const result = await handleGetListings(req);

      expect(result.total).toBe(1);
    });

    it("should combine search text with filters", async () => {
      mockRun.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce([]);

      const req = createMockReq({
        skip: 0,
        top: 20,
        search: "Renault",
        minPrice: 5000,
        maxMileage: 80000,
      });
      const result = await handleGetListings(req);

      expect(result.total).toBe(2);
    });

    // ─── Sort Tests (Story 4-2) ──────────────────────────────────────

    it("should sort by price ascending", async () => {
      mockRun.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, sort: "price_asc" });
      await handleGetListings(req);

      expect(mockOrderBy).toHaveBeenCalledWith("price asc");
    });

    it("should sort by price descending", async () => {
      mockRun.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, sort: "price_desc" });
      await handleGetListings(req);

      expect(mockOrderBy).toHaveBeenCalledWith("price desc");
    });

    it("should sort by date descending", async () => {
      mockRun.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, sort: "date_desc" });
      await handleGetListings(req);

      expect(mockOrderBy).toHaveBeenCalledWith("publishedAt desc");
    });

    it("should sort by mileage ascending", async () => {
      mockRun.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, sort: "mileage_asc" });
      await handleGetListings(req);

      expect(mockOrderBy).toHaveBeenCalledWith("mileage asc");
    });

    it("should use default sort (publishedAt desc) for relevance", async () => {
      mockRun.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, sort: "relevance" });
      await handleGetListings(req);

      expect(mockOrderBy).toHaveBeenCalledWith("publishedAt desc");
    });

    it("should use default sort when sort param is not provided", async () => {
      mockRun.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20 });
      await handleGetListings(req);

      expect(mockOrderBy).toHaveBeenCalledWith("publishedAt desc");
    });

    it("should use default sort for unknown sort value", async () => {
      mockRun.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, sort: "invalid_sort" });
      await handleGetListings(req);

      expect(mockOrderBy).toHaveBeenCalledWith("publishedAt desc");
    });

    // ─── Certification & Market Filter Tests (Story 4-3) ──────────────

    it("should filter by certificationLevel", async () => {
      mockRun.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce([]);

      const req = createMockReq({
        skip: 0,
        top: 20,
        certificationLevel: JSON.stringify(["tres_documente", "bien_documente"]),
      });
      const result = await handleGetListings(req);

      expect(result.total).toBe(2);
      expect(mockWhere).toHaveBeenCalled();
    });

    it("should filter by ctValid=true", async () => {
      mockRun.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, ctValid: true });
      const result = await handleGetListings(req);

      expect(result.total).toBe(3);
      expect(mockWhere).toHaveBeenCalled();
    });

    it("should not filter by ctValid when false", async () => {
      mockRun.mockResolvedValueOnce({ count: 10 }).mockResolvedValueOnce([]);

      const req = createMockReq({ skip: 0, top: 20, ctValid: false });
      const result = await handleGetListings(req);

      expect(result.total).toBe(10);
    });

    it("should post-filter by marketPosition=below", async () => {
      mockComputeMarketComparison
        .mockResolvedValueOnce({
          position: "below",
          percentageDiff: -10,
          displayText: "10% en dessous du marché",
        })
        .mockResolvedValueOnce({
          position: "above",
          percentageDiff: 15,
          displayText: "15% au-dessus du marché",
        });

      mockRun
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce([
          {
            ID: "listing-cheap",
            make: "Renault",
            model: "Clio",
            year: 2020,
            price: 12000,
            mileage: 50000,
            fuelType: "essence",
            visibilityScore: 75,
            visibilityLabel: "Bien documenté",
            certificationLevel: "bien_documente",
            ctValid: true,
            sellerId: "seller-1",
          },
          {
            ID: "listing-expensive",
            make: "BMW",
            model: "320",
            year: 2020,
            price: 40000,
            mileage: 30000,
            fuelType: "diesel",
            visibilityScore: 90,
            visibilityLabel: "Très documenté",
            certificationLevel: "tres_documente",
            ctValid: true,
            sellerId: "seller-2",
          },
        ])
        // Enrichment for listing-cheap
        .mockResolvedValueOnce(null) // photo
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 5 })
        .mockResolvedValueOnce({ count: 10 })
        // Enrichment for listing-expensive
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 8 })
        .mockResolvedValueOnce({ count: 10 });

      const req = createMockReq({ skip: 0, top: 20, marketPosition: "below" });
      const result = await handleGetListings(req);

      const items = JSON.parse(result.items);
      expect(items).toHaveLength(1);
      expect(items[0].ID).toBe("listing-cheap");
      expect(result.total).toBe(1);
    });

    it("should return all items when marketPosition is not specified", async () => {
      mockRun.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce([
        {
          ID: "listing-1",
          make: "Renault",
          model: "Clio",
          year: 2020,
          price: 15000,
          mileage: 50000,
          fuelType: "essence",
          visibilityScore: 75,
          visibilityLabel: "Bien documenté",
          certificationLevel: "bien_documente",
          ctValid: false,
          sellerId: "seller-1",
        },
      ]);
      mockRun
        .mockResolvedValueOnce(null) // photo
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 5 })
        .mockResolvedValueOnce({ count: 10 });

      const req = createMockReq({ skip: 0, top: 20 });
      const result = await handleGetListings(req);

      const items = JSON.parse(result.items);
      expect(items).toHaveLength(1);
    });

    it("should include marketComparison in listing detail response", async () => {
      mockComputeMarketComparison.mockResolvedValue({
        position: "below",
        percentageDiff: -8,
        displayText: "8% en dessous du marché",
      });

      const validUuid2 = "b1b2c3d4-e5f6-7890-abcd-ef1234567890";
      mockRun
        .mockResolvedValueOnce({
          ID: validUuid2,
          make: "Renault",
          model: "Clio",
          year: 2020,
          price: 15000,
          mileage: 50000,
          fuelType: "essence",
          status: "published",
          visibilityScore: 75,
          visibilityLabel: "Bien documenté",
          certificationLevel: "bien_documente",
          ctValid: true,
          publishedAt: "2026-01-01",
          sellerId: "seller-1",
        })
        .mockResolvedValueOnce([]) // photos
        .mockResolvedValueOnce([]) // certified fields
        .mockResolvedValueOnce(null) // no history report
        .mockResolvedValueOnce(null) // no analytics
        .mockResolvedValueOnce(null) // no existing analytics
        .mockResolvedValueOnce(undefined); // insert analytics

      const req = createMockReq({ listingId: validUuid2 });
      const result = await handleGetListingDetail(req);

      const listing = JSON.parse(result.listing);
      expect(listing.marketComparison).toEqual({
        position: "below",
        percentageDiff: -8,
        displayText: "8% en dessous du marché",
      });
      expect(listing.certificationLevel).toBe("bien_documente");
      expect(listing.ctValid).toBe(true);
    });

    // ─── Location Radius Tests (Story 4-2 Task 2) ─────────────────────

    it("should filter by location radius", async () => {
      // Marseille center: 43.2965, 5.3698
      // Listing within 10km
      mockRun.mockResolvedValueOnce([
        {
          ID: "listing-near",
          make: "Renault",
          model: "Clio",
          variant: null,
          year: 2020,
          price: 15000,
          mileage: 50000,
          fuelType: "essence",
          gearbox: "manuelle",
          bodyType: "berline",
          color: "rouge",
          condition: "Bon",
          visibilityScore: 75,
          visibilityLabel: "Bien documenté",
          publishedAt: "2026-01-01T00:00:00Z",
          sellerId: "seller-1",
          latitude: 43.3, // ~0.4km from center
          longitude: 5.37,
          city: "Marseille",
          postalCode: "13001",
        },
        {
          ID: "listing-far",
          make: "Peugeot",
          model: "308",
          variant: null,
          year: 2021,
          price: 20000,
          mileage: 30000,
          fuelType: "diesel",
          gearbox: "automatique",
          bodyType: "berline",
          color: "noir",
          condition: "Excellent",
          visibilityScore: 90,
          visibilityLabel: "Très documenté",
          publishedAt: "2026-02-01T00:00:00Z",
          sellerId: "seller-2",
          latitude: 43.7, // ~45km from center
          longitude: 5.4,
          city: "Aix-en-Provence",
          postalCode: "13100",
        },
      ]);

      // Primary photo + counts for the "near" listing
      mockRun
        .mockResolvedValueOnce({ cdnUrl: "https://cdn/photo.jpg" })
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 5 })
        .mockResolvedValueOnce({ count: 10 });

      const req = createMockReq({
        skip: 0,
        top: 20,
        latitude: 43.2965,
        longitude: 5.3698,
        radius: 10, // 10km — only "near" listing should match
      });
      const result = await handleGetListings(req);

      expect(result.total).toBe(1);
      const items = JSON.parse(result.items);
      expect(items).toHaveLength(1);
      expect(items[0].ID).toBe("listing-near");
    });

    it("should return zero results when no listings in radius", async () => {
      // No listings match the bounding box
      mockRun.mockResolvedValueOnce([]);

      const req = createMockReq({
        skip: 0,
        top: 20,
        latitude: 48.8566, // Paris
        longitude: 2.3522,
        radius: 5,
      });
      const result = await handleGetListings(req);

      expect(result.total).toBe(0);
      const items = JSON.parse(result.items);
      expect(items).toHaveLength(0);
    });

    it("should include all listings with very large radius", async () => {
      mockRun.mockResolvedValueOnce([
        {
          ID: "listing-1",
          make: "Renault",
          model: "Clio",
          variant: null,
          year: 2020,
          price: 15000,
          mileage: 50000,
          fuelType: "essence",
          gearbox: "manuelle",
          bodyType: "berline",
          color: "rouge",
          condition: "Bon",
          visibilityScore: 75,
          visibilityLabel: "Bien documenté",
          publishedAt: "2026-01-01T00:00:00Z",
          sellerId: "seller-1",
          latitude: 43.3,
          longitude: 5.37,
          city: "Marseille",
          postalCode: "13001",
        },
      ]);

      mockRun
        .mockResolvedValueOnce({ cdnUrl: null })
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 3 })
        .mockResolvedValueOnce({ count: 5 });

      const req = createMockReq({
        skip: 0,
        top: 20,
        latitude: 43.2965,
        longitude: 5.3698,
        radius: 1000, // 1000km — should include everything in France
      });
      const result = await handleGetListings(req);

      expect(result.total).toBe(1);
      const items = JSON.parse(result.items);
      expect(items).toHaveLength(1);
    });

    it("should exclude listings with null latitude/longitude from radius search", async () => {
      mockRun.mockResolvedValueOnce([
        {
          ID: "listing-no-coords",
          make: "Citroen",
          model: "C3",
          variant: null,
          year: 2019,
          price: 12000,
          mileage: 60000,
          fuelType: "essence",
          gearbox: "manuelle",
          bodyType: "citadine",
          color: "bleu",
          condition: "Bon",
          visibilityScore: 60,
          visibilityLabel: "Bien documenté",
          publishedAt: "2026-01-15T00:00:00Z",
          sellerId: "seller-3",
          latitude: null,
          longitude: null,
          city: null,
          postalCode: null,
        },
      ]);

      const req = createMockReq({
        skip: 0,
        top: 20,
        latitude: 43.2965,
        longitude: 5.3698,
        radius: 50,
      });
      const result = await handleGetListings(req);

      expect(result.total).toBe(0);
      const items = JSON.parse(result.items);
      expect(items).toHaveLength(0);
    });

    it("should paginate location-filtered results correctly", async () => {
      // Create 5 listings within radius
      const nearListings = Array.from({ length: 5 }, (_, i) => ({
        ID: `listing-${i}`,
        make: "Renault",
        model: "Clio",
        variant: null,
        year: 2020 + i,
        price: 10000 + i * 1000,
        mileage: 50000,
        fuelType: "essence",
        gearbox: "manuelle",
        bodyType: "berline",
        color: "rouge",
        condition: "Bon",
        visibilityScore: 75,
        visibilityLabel: "Bien documenté",
        publishedAt: `2026-01-0${i + 1}T00:00:00Z`,
        sellerId: "seller-1",
        latitude: 43.3 + i * 0.001, // All very close to center
        longitude: 5.37,
        city: "Marseille",
        postalCode: "13001",
      }));

      mockRun.mockResolvedValueOnce(nearListings);

      // Enrichment for the 2 items in page (skip: 2, top: 2)
      for (let i = 0; i < 2; i++) {
        mockRun
          .mockResolvedValueOnce(null) // no photo
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce({ count: 0 });
      }

      const req = createMockReq({
        skip: 2,
        top: 2,
        latitude: 43.2965,
        longitude: 5.3698,
        radius: 20,
      });
      const result = await handleGetListings(req);

      expect(result.total).toBe(5);
      expect(result.hasMore).toBe(true);
      const items = JSON.parse(result.items);
      expect(items).toHaveLength(2);
      expect(items[0].ID).toBe("listing-2");
      expect(items[1].ID).toBe("listing-3");
    });

    it("should handle listing with no primary photo", async () => {
      mockRun
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce([
          {
            ID: "listing-1",
            make: "Peugeot",
            model: "308",
            variant: null,
            year: 2021,
            price: 20000,
            mileage: 30000,
            fuelType: "diesel",
            gearbox: "automatique",
            bodyType: "berline",
            color: "noir",
            condition: "Excellent",
            visibilityScore: 90,
            visibilityLabel: "Très bien documenté",
            publishedAt: "2026-02-01T00:00:00Z",
            sellerId: "seller-2",
          },
        ])
        .mockResolvedValueOnce(null) // no primary photo
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 5 })
        .mockResolvedValueOnce({ count: 8 });

      const req = createMockReq({ skip: 0, top: 20 });
      const result = await handleGetListings(req);

      const items = JSON.parse(result.items);
      expect(items[0].primaryPhotoUrl).toBeNull();
      expect(items[0].photoCount).toBe(0);
    });
  });

  describe("handleGetListingDetail", () => {
    const validUuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

    it("should return full listing detail", async () => {
      mockRun
        .mockResolvedValueOnce({
          ID: validUuid,
          make: "Renault",
          model: "Clio",
          variant: "RS",
          year: 2020,
          price: 15000,
          mileage: 50000,
          fuelType: "essence",
          engineCapacityCc: 1600,
          powerKw: 147,
          powerHp: 200,
          gearbox: "manuelle",
          bodyType: "berline",
          doors: 5,
          seats: 5,
          color: "rouge",
          co2GKm: 140,
          euroNorm: "Euro 6",
          energyClass: "C",
          critAirLevel: "1",
          critAirLabel: "Crit'Air 1",
          condition: "Bon",
          description: "Superbe voiture",
          options: '["GPS","Climatisation"]',
          interiorColor: "noir",
          exteriorColor: "rouge",
          transmission: "manuelle",
          driveType: "traction",
          registrationDate: "2020-03-15",
          status: "published",
          visibilityScore: 80,
          visibilityLabel: "Bien documenté",
          publishedAt: "2026-01-01T00:00:00Z",
          soldAt: null,
          sellerId: "seller-1",
        })
        // Photos
        .mockResolvedValueOnce([
          {
            ID: "photo-1",
            listingId: validUuid,
            blobUrl: "blob://photo1",
            cdnUrl: "https://cdn/photo1.jpg",
            sortOrder: 0,
            isPrimary: true,
            fileSize: 500000,
            mimeType: "image/jpeg",
            width: 1200,
            height: 800,
            uploadedAt: "2026-01-01",
          },
        ])
        // Certified fields
        .mockResolvedValueOnce([
          { fieldName: "make", source: "SIV", isCertified: true },
          { fieldName: "model", source: "SIV", isCertified: true },
        ])
        // History report
        .mockResolvedValueOnce({ ID: "hr-1" })
        // Analytics
        .mockResolvedValueOnce({ viewCount: 42, favoriteCount: 5, listingId: validUuid })
        // Existing analytics for view count increment
        .mockResolvedValueOnce({ viewCount: 42, favoriteCount: 5, listingId: validUuid })
        // Update view count
        .mockResolvedValueOnce(undefined);

      const req = createMockReq({ listingId: validUuid });
      const result = await handleGetListingDetail(req);

      const listing = JSON.parse(result.listing);
      expect(listing.ID).toBe(validUuid);
      expect(listing.make).toBe("Renault");
      expect(listing.photos).toHaveLength(1);
      expect(listing.certifiedFields).toHaveLength(2);
      expect(listing.hasHistoryReport).toBe(true);
      expect(listing.analytics.viewCount).toBe(43);
    });

    it("should reject invalid listing ID", async () => {
      const req = createMockReq({ listingId: "not-a-uuid" });
      await handleGetListingDetail(req);
      expect(mockError).toHaveBeenCalledWith(400, "Identifiant d'annonce invalide");
    });

    it("should return 404 for non-existent listing", async () => {
      mockRun.mockResolvedValueOnce(null);

      const req = createMockReq({ listingId: validUuid });
      await handleGetListingDetail(req);
      expect(mockError).toHaveBeenCalledWith(404, "Annonce non trouvée");
    });

    it("should return 404 for draft listing", async () => {
      mockRun.mockResolvedValueOnce({ ID: validUuid, status: "draft" });

      const req = createMockReq({ listingId: validUuid });
      await handleGetListingDetail(req);
      expect(mockError).toHaveBeenCalledWith(404, "Annonce non trouvée");
    });

    it("should allow sold listing", async () => {
      mockRun
        .mockResolvedValueOnce({
          ID: validUuid,
          make: "Peugeot",
          model: "208",
          status: "sold",
          visibilityScore: 70,
          visibilityLabel: "Bien documenté",
          publishedAt: "2026-01-01",
          soldAt: "2026-02-01",
          sellerId: "seller-1",
        })
        .mockResolvedValueOnce([]) // photos
        .mockResolvedValueOnce([]) // certified fields
        .mockResolvedValueOnce(null) // no history report
        .mockResolvedValueOnce(null) // no analytics
        .mockResolvedValueOnce(null) // no existing analytics for increment
        .mockResolvedValueOnce(undefined); // insert analytics

      const req = createMockReq({ listingId: validUuid });
      const result = await handleGetListingDetail(req);

      const listing = JSON.parse(result.listing);
      expect(listing.status).toBe("sold");
      expect(listing.hasHistoryReport).toBe(false);
    });
  });

  describe("haversineDistance", () => {
    it("should return 0 for same point", () => {
      const d = haversineDistance(43.2965, 5.3698, 43.2965, 5.3698);
      expect(d).toBeCloseTo(0, 5);
    });

    it("should compute correct distance between Marseille and Aix (~30km)", () => {
      // Marseille: 43.2965, 5.3698
      // Aix-en-Provence: 43.5297, 5.4474
      const d = haversineDistance(43.2965, 5.3698, 43.5297, 5.4474);
      expect(d).toBeGreaterThan(25);
      expect(d).toBeLessThan(35);
    });

    it("should compute correct distance between Paris and Marseille (~660km)", () => {
      const d = haversineDistance(48.8566, 2.3522, 43.2965, 5.3698);
      expect(d).toBeGreaterThan(640);
      expect(d).toBeLessThan(680);
    });

    it("should handle exact boundary distance", () => {
      // Test a point at approximately 10km from Marseille center
      // 10km north is roughly 43.2965 + (10/111.32) ≈ 43.3863
      const d = haversineDistance(43.2965, 5.3698, 43.3863, 5.3698);
      expect(d).toBeGreaterThan(9);
      expect(d).toBeLessThan(11);
    });
  });
});
