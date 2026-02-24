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
        Listing: "Listing",
        HistoryReport: "HistoryReport",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      ApplicationService: class {
        async init() {}
        on(_event: string, _handler: any) {}
        before(_event: string, _entity: string, _handler: any) {}
        after(_event: string, _entity: string, _handler: any) {}
      },
    },
  };
});

// Global CDS query helpers
(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("q"),
      columns: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }),
    }),
  },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue("q"),
    }),
    orderBy: jest.fn().mockReturnValue("q"),
  }),
};

// ─── Import the handler ──────────────────────────────────────────────────────

const BuyerServiceHandler = require("../../../srv/buyer-service").default;

// ─── Mock Request Builder ────────────────────────────────────────────────────

function createMockRequest(data: Record<string, any>, userId = "buyer-1"): any {
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

// ─── Mock History Report Data ────────────────────────────────────────────────

const MOCK_REPORT_DATA = JSON.stringify({
  vin: "VF1RFB00X56789012",
  ownerCount: 2,
  firstRegistrationDate: "2018-06-01",
  lastRegistrationDate: "2022-03-15",
  mileageRecords: [],
  accidents: [],
  registrationHistory: [],
  outstandingFinance: false,
  stolen: false,
  totalDamageCount: 0,
  provider: { providerName: "mock", providerVersion: "1.0.0" },
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("BuyerService - getHistoryReport", () => {
  let handleGetHistoryReport: any;

  beforeAll(() => {
    const handler = new BuyerServiceHandler();
    handler.on = (event: string, fn: any) => {
      if (event === "getHistoryReport") {
        handleGetHistoryReport = fn;
      }
    };
    handler.before = jest.fn();
    handler.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return history report for published listing to authenticated buyer", async () => {
    // SELECT listing
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      status: "published",
    });
    // SELECT history report
    mockRun.mockResolvedValueOnce({
      ID: "report-1",
      source: "mock",
      fetchedAt: "2026-02-24T10:00:00.000Z",
      reportVersion: "1.0.0",
      reportData: MOCK_REPORT_DATA,
    });

    const req = createMockRequest({ listingId: "listing-1" });
    const result = await handleGetHistoryReport(req);

    expect(result.reportId).toBe("report-1");
    expect(result.source).toBe("mock");
    expect(result.reportData).toBe(MOCK_REPORT_DATA);
    expect(result.isMockData).toBe(true);
  });

  it("should set isMockData to false for real providers", async () => {
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      status: "published",
    });
    mockRun.mockResolvedValueOnce({
      ID: "report-1",
      source: "carvertical",
      fetchedAt: "2026-02-24T10:00:00.000Z",
      reportVersion: "2.0.0",
      reportData: MOCK_REPORT_DATA,
    });

    const req = createMockRequest({ listingId: "listing-1" });
    const result = await handleGetHistoryReport(req);

    expect(result.isMockData).toBe(false);
  });

  it("should return 401 for unauthenticated user", async () => {
    const req = createMockRequest({ listingId: "listing-1" });
    req.user = { id: undefined };

    await handleGetHistoryReport(req);

    expect(req.error).toHaveBeenCalledWith(
      401,
      "Rapport disponible - connectez-vous pour consulter",
    );
  });

  it("should return 404 when listing does not exist", async () => {
    mockRun.mockResolvedValueOnce(null);

    const req = createMockRequest({ listingId: "nonexistent" });
    await handleGetHistoryReport(req);

    expect(req.error).toHaveBeenCalledWith(404, "Listing not found");
  });

  it("should return 403 when listing is not published or sold (draft)", async () => {
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      status: "draft",
    });

    const req = createMockRequest({ listingId: "listing-1" });
    await handleGetHistoryReport(req);

    expect(req.error).toHaveBeenCalledWith(
      403,
      "History report is only available for published or sold listings",
    );
  });

  it("should return 403 when listing is archived", async () => {
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      status: "archived",
    });

    const req = createMockRequest({ listingId: "listing-1" });
    await handleGetHistoryReport(req);

    expect(req.error).toHaveBeenCalledWith(
      403,
      "History report is only available for published or sold listings",
    );
  });

  it("should return history report for sold listing", async () => {
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      status: "sold",
    });
    mockRun.mockResolvedValueOnce({
      ID: "report-1",
      source: "mock",
      fetchedAt: "2026-02-24T10:00:00.000Z",
      reportVersion: "1.0.0",
      reportData: MOCK_REPORT_DATA,
    });

    const req = createMockRequest({ listingId: "listing-1" });
    const result = await handleGetHistoryReport(req);

    expect(result.reportId).toBe("report-1");
    expect(result.isMockData).toBe(true);
  });

  it("should return 404 when no history report exists for listing", async () => {
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      status: "published",
    });
    mockRun.mockResolvedValueOnce(null);

    const req = createMockRequest({ listingId: "listing-1" });
    await handleGetHistoryReport(req);

    expect(req.error).toHaveBeenCalledWith(404, "No history report available for this listing");
  });

  it("should return full report data with all fields", async () => {
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      status: "published",
    });
    mockRun.mockResolvedValueOnce({
      ID: "report-1",
      source: "mock",
      fetchedAt: "2026-02-24T10:00:00.000Z",
      reportVersion: "1.0.0",
      reportData: MOCK_REPORT_DATA,
    });

    const req = createMockRequest({ listingId: "listing-1" });
    const result = await handleGetHistoryReport(req);

    expect(result).toHaveProperty("reportId");
    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("fetchedAt");
    expect(result).toHaveProperty("reportVersion");
    expect(result).toHaveProperty("reportData");
    expect(result).toHaveProperty("isMockData");
  });
});

describe("BuyerService CDS definition", () => {
  it("should define buyer service at /api/buyer path", () => {
    const fs = require("fs");
    const path = require("path");
    const buyerCds = fs.readFileSync(
      path.resolve(__dirname, "../../../srv/buyer-service.cds"),
      "utf-8",
    );
    expect(buyerCds).toContain("@path    : '/api/buyer'");
    expect(buyerCds).toContain("@requires: 'authenticated-user'");
    expect(buyerCds).toContain("service BuyerService");
  });

  it("should expose Listings as readonly", () => {
    const fs = require("fs");
    const path = require("path");
    const buyerCds = fs.readFileSync(
      path.resolve(__dirname, "../../../srv/buyer-service.cds"),
      "utf-8",
    );
    expect(buyerCds).toContain("@readonly");
    expect(buyerCds).toContain("entity Listings as projection on auto.Listing");
  });

  it("should define getHistoryReport action", () => {
    const fs = require("fs");
    const path = require("path");
    const buyerCds = fs.readFileSync(
      path.resolve(__dirname, "../../../srv/buyer-service.cds"),
      "utf-8",
    );
    expect(buyerCds).toContain("action getHistoryReport");
    expect(buyerCds).toContain("listingId");
    expect(buyerCds).toContain("isMockData");
  });
});
