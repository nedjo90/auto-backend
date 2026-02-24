/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
export {};

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
});
