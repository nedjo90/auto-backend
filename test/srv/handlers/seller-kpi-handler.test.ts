/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

/**
 * Unit tests for seller KPI handler functions:
 * - getAggregateKPIs, getListingPerformance, getMetricDrilldown
 */

const mockRun = jest.fn();
const SELLER_ID = "11111111-2222-3333-4444-555555555555";
const LISTING_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const LISTING_ID_2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        Listing: "Listing",
        ListingAnalytics: "ListingAnalytics",
        ListingPhoto: "ListingPhoto",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
    },
  };
});

jest.mock("@auto/shared", () => ({
  SELLER_KPI_METRICS: ["activeListings", "totalViews", "totalContacts", "avgDaysOnline"],
  SELLER_KPI_PERIOD_DAYS: 30,
  SELLER_LISTINGS_PAGE_SIZE: 20,
  SELLER_LISTING_SORT_COLUMNS: [
    "title",
    "price",
    "viewCount",
    "chatCount",
    "daysOnMarket",
    "visibilityScore",
  ],
  SELLER_DRILLDOWN_PERIODS: [7, 30, 90],
  VISIBILITY_LABELS: {
    low: "Partiellement documenté",
    medium: "Bien documenté",
    high: "Très documenté",
  },
  DEFAULT_VISIBILITY_WEIGHTS: {
    labelThresholdLow: 34,
    labelThresholdHigh: 67,
  },
}));

jest.mock("../../../srv/lib/market-price", () => ({
  computeMarketComparison: jest.fn().mockResolvedValue({
    position: "aligned",
    percentageDiff: 2.5,
    displayText: "Prix aligné",
  }),
}));

// CDS query builder globals
const mockWhere = jest.fn().mockReturnThis();
const mockOrderBy = jest.fn().mockReturnThis();
const mockLimit = jest.fn().mockReturnThis();
const mockColumns = jest.fn().mockReturnThis();

(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({
      columns: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue("select-count-query"),
      }),
      where: jest.fn().mockReturnValue("select-one-query"),
    }),
  },
  from: jest.fn().mockReturnValue({
    columns: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        orderBy: jest.fn().mockReturnValue("select-photo-query"),
      }),
    }),
    where: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue("select-listings-query"),
      }),
    }),
    orderBy: jest.fn().mockReturnValue("select-query"),
  }),
};

function makeReq(data: Record<string, unknown> = {}, userId: string | null = SELLER_ID): any {
  const errors: any[] = [];
  return {
    data,
    user: userId ? { id: userId } : undefined,
    error: jest.fn((code: number, msg: string) => {
      errors.push({ code, msg });
    }),
    _errors: errors,
  };
}

import {
  handleGetAggregateKPIs,
  handleGetListingPerformance,
  handleGetMetricDrilldown,
} from "../../../srv/handlers/seller-kpi-handler";

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── getAggregateKPIs ─────────────────────────────────────────────────────

describe("handleGetAggregateKPIs", () => {
  it("returns 401 when not authenticated", async () => {
    const req = makeReq({}, null);
    await handleGetAggregateKPIs(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("returns zero KPIs when seller has no listings", async () => {
    mockRun.mockResolvedValueOnce([]); // listings query
    const req = makeReq();
    const result: any = await handleGetAggregateKPIs(req);
    const kpis = JSON.parse(result.kpis);
    expect(kpis.activeListings.current).toBe(0);
    expect(kpis.totalViews.current).toBe(0);
    expect(kpis.totalContacts.current).toBe(0);
    expect(kpis.avgDaysOnline.current).toBe(0);
  });

  it("returns correct aggregate KPIs for seller with published listings", async () => {
    const pastDate = new Date(Date.now() - 15 * 86400000).toISOString(); // 15 days ago
    mockRun
      .mockResolvedValueOnce([
        // listings
        { ID: LISTING_ID, publishedAt: pastDate, status: "published" },
        { ID: LISTING_ID_2, publishedAt: pastDate, status: "published" },
      ])
      .mockResolvedValueOnce([
        // analytics
        { listingId: LISTING_ID, viewCount: 50, favoriteCount: 5, chatCount: 10 },
        { listingId: LISTING_ID_2, viewCount: 30, favoriteCount: 3, chatCount: 5 },
      ]);

    const req = makeReq();
    const result: any = await handleGetAggregateKPIs(req);
    const kpis = JSON.parse(result.kpis);

    expect(kpis.activeListings.current).toBe(2);
    expect(kpis.totalViews.current).toBe(80);
    expect(kpis.totalContacts.current).toBe(15);
    expect(kpis.avgDaysOnline.current).toBeGreaterThanOrEqual(14);
  });

  it("counts sold listings as inactive in activeListings", async () => {
    const pastDate = new Date(Date.now() - 10 * 86400000).toISOString();
    mockRun
      .mockResolvedValueOnce([
        { ID: LISTING_ID, publishedAt: pastDate, status: "published" },
        { ID: LISTING_ID_2, publishedAt: pastDate, status: "sold" },
      ])
      .mockResolvedValueOnce([
        { listingId: LISTING_ID, viewCount: 20, favoriteCount: 2, chatCount: 3 },
        { listingId: LISTING_ID_2, viewCount: 10, favoriteCount: 1, chatCount: 1 },
      ]);

    const req = makeReq();
    const result: any = await handleGetAggregateKPIs(req);
    const kpis = JSON.parse(result.kpis);

    expect(kpis.activeListings.current).toBe(1); // only published
    expect(kpis.totalViews.current).toBe(30); // both
    expect(kpis.totalContacts.current).toBe(4);
  });
});

// ─── getListingPerformance ────────────────────────────────────────────────

describe("handleGetListingPerformance", () => {
  it("returns 401 when not authenticated", async () => {
    const req = makeReq({}, null);
    await handleGetListingPerformance(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("returns empty array when no published listings", async () => {
    mockRun.mockResolvedValueOnce({ cnt: 0 }); // count query
    const req = makeReq();
    const result: any = await handleGetListingPerformance(req);
    expect(JSON.parse(result.listings)).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("returns listing performance data with analytics and photos", async () => {
    const pastDate = new Date(Date.now() - 5 * 86400000).toISOString();
    mockRun
      .mockResolvedValueOnce({ cnt: 1 }) // count
      .mockResolvedValueOnce([
        // listings
        {
          ID: LISTING_ID,
          make: "Renault",
          model: "Clio",
          year: 2020,
          price: 15000,
          status: "published",
          visibilityScore: 75,
          publishedAt: pastDate,
          mileage: 50000,
          fuelType: "essence",
        },
      ])
      .mockResolvedValueOnce([
        // analytics
        { listingId: LISTING_ID, viewCount: 42, favoriteCount: 8, chatCount: 6 },
      ])
      .mockResolvedValueOnce([
        // photos
        {
          listingId: LISTING_ID,
          cdnUrl: "https://cdn.example.com/photo1.jpg",
          isPrimary: true,
          sortOrder: 0,
        },
      ]);

    const req = makeReq({ sortBy: "price", sortDir: "desc" });
    const result: any = await handleGetListingPerformance(req);
    const listings = JSON.parse(result.listings);

    expect(listings).toHaveLength(1);
    expect(listings[0].make).toBe("Renault");
    expect(listings[0].viewCount).toBe(42);
    expect(listings[0].chatCount).toBe(6);
    expect(listings[0].photoCount).toBe(1);
    expect(listings[0].primaryPhotoUrl).toBe("https://cdn.example.com/photo1.jpg");
    expect(listings[0].visibilityLabel).toBe("Très documenté");
    expect(listings[0].marketPosition).toBe("aligned");
    expect(listings[0].daysOnMarket).toBeGreaterThanOrEqual(4);
    expect((result as any).total).toBe(1);
  });

  it("uses default sort when invalid sortBy provided", async () => {
    mockRun
      .mockResolvedValueOnce({ cnt: 1 })
      .mockResolvedValueOnce([
        {
          ID: LISTING_ID,
          make: "Peugeot",
          model: "208",
          year: 2021,
          price: 18000,
          status: "published",
          visibilityScore: 50,
          publishedAt: new Date().toISOString(),
          mileage: 20000,
          fuelType: "diesel",
        },
      ])
      .mockResolvedValueOnce([]) // analytics
      .mockResolvedValueOnce([]); // photos

    const req = makeReq({ sortBy: "INVALID_COLUMN", sortDir: "asc" });
    const result: any = await handleGetListingPerformance(req);
    const listings = JSON.parse(result.listings);

    expect(listings).toHaveLength(1);
    expect(listings[0].viewCount).toBe(0);
    expect(listings[0].photoCount).toBe(0);
    expect(listings[0].primaryPhotoUrl).toBeNull();
  });

  it("handles market comparison failure gracefully", async () => {
    const { computeMarketComparison } = require("../../../srv/lib/market-price");
    computeMarketComparison.mockRejectedValueOnce(new Error("Market API down"));

    mockRun
      .mockResolvedValueOnce({ cnt: 1 })
      .mockResolvedValueOnce([
        {
          ID: LISTING_ID,
          make: "BMW",
          model: "Serie 3",
          year: 2019,
          price: 25000,
          status: "published",
          visibilityScore: 30,
          publishedAt: new Date().toISOString(),
          mileage: 60000,
          fuelType: "diesel",
        },
      ])
      .mockResolvedValueOnce([]) // analytics
      .mockResolvedValueOnce([]); // photos

    const req = makeReq();
    const result: any = await handleGetListingPerformance(req);
    const listings = JSON.parse(result.listings);

    expect(listings[0].marketPosition).toBeNull();
    expect(listings[0].visibilityLabel).toBe("Partiellement documenté");
  });
});

// ─── getMetricDrilldown ───────────────────────────────────────────────────

describe("handleGetMetricDrilldown", () => {
  it("returns 401 when not authenticated", async () => {
    const req = makeReq({ metric: "totalViews" }, null);
    await handleGetMetricDrilldown(req);
    expect(req.error).toHaveBeenCalledWith(401, "Authentification requise");
  });

  it("returns 400 for invalid metric", async () => {
    const req = makeReq({ metric: "invalidMetric" });
    await handleGetMetricDrilldown(req);
    expect(req.error).toHaveBeenCalledWith(400, "Métrique invalide");
  });

  it("returns activeListings drilldown with time series", async () => {
    const pastDate = new Date(Date.now() - 5 * 86400000).toISOString();
    mockRun.mockResolvedValueOnce([
      { publishedAt: pastDate, soldAt: null, archivedAt: null, status: "published" },
    ]);

    const req = makeReq({ metric: "activeListings", periodDays: 7 });
    const result: any = await handleGetMetricDrilldown(req);
    const drilldown = JSON.parse(result.drilldown);

    expect(drilldown.metric).toBe("activeListings");
    expect(drilldown.points.length).toBeGreaterThanOrEqual(7);
    expect(drilldown.points[0]).toHaveProperty("date");
    expect(drilldown.points[0]).toHaveProperty("value");
  });

  it("returns totalViews drilldown for aggregate", async () => {
    mockRun
      .mockResolvedValueOnce([{ ID: LISTING_ID }]) // listings
      .mockResolvedValueOnce([{ listingId: LISTING_ID, viewCount: 100, chatCount: 20 }]); // analytics

    const req = makeReq({ metric: "totalViews", periodDays: 30 });
    const result: any = await handleGetMetricDrilldown(req);
    const drilldown = JSON.parse(result.drilldown);

    expect(drilldown.metric).toBe("totalViews");
    expect(drilldown.points.length).toBeGreaterThanOrEqual(1);
    expect(drilldown.insights.length).toBeGreaterThanOrEqual(1);
  });

  it("returns totalContacts drilldown for single listing", async () => {
    mockRun
      .mockResolvedValueOnce([{ ID: LISTING_ID }]) // listings
      .mockResolvedValueOnce({ listingId: LISTING_ID, viewCount: 50, chatCount: 10 }); // analytics

    const req = makeReq({ metric: "totalContacts", listingId: LISTING_ID, periodDays: 30 });
    const result: any = await handleGetMetricDrilldown(req);
    const drilldown = JSON.parse(result.drilldown);

    expect(drilldown.metric).toBe("totalContacts");
    expect(drilldown.listingId).toBe(LISTING_ID);
    expect(drilldown.points.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 403 for drilldown on listing not owned by seller", async () => {
    mockRun.mockResolvedValueOnce([{ ID: LISTING_ID_2 }]); // Different listing only

    const req = makeReq({ metric: "totalViews", listingId: LISTING_ID, periodDays: 30 });
    await handleGetMetricDrilldown(req);
    expect(req.error).toHaveBeenCalledWith(403, "Annonce non trouvée ou non autorisée");
  });

  it("returns avgDaysOnline drilldown", async () => {
    const pastDate = new Date(Date.now() - 10 * 86400000).toISOString();
    mockRun.mockResolvedValueOnce([{ publishedAt: pastDate }]);

    const req = makeReq({ metric: "avgDaysOnline", periodDays: 7 });
    const result: any = await handleGetMetricDrilldown(req);
    const drilldown = JSON.parse(result.drilldown);

    expect(drilldown.metric).toBe("avgDaysOnline");
    expect(drilldown.points.length).toBeGreaterThanOrEqual(7);
  });

  it("defaults to 30-day period for invalid periodDays", async () => {
    mockRun.mockResolvedValueOnce([]);

    const req = makeReq({ metric: "activeListings", periodDays: 999 });
    const result: any = await handleGetMetricDrilldown(req);
    const drilldown = JSON.parse(result.drilldown);

    // 30 days + 1 (today) = 31 points
    expect(drilldown.points.length).toBeGreaterThanOrEqual(30);
  });
});
