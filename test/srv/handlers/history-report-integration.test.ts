/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "integration-uuid");

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        CertifiedField: "CertifiedField",
        ApiCachedData: "ApiCachedData",
        AuditTrailEntry: "AuditTrailEntry",
        Listing: "Listing",
        ListingPhoto: "ListingPhoto",
        Declaration: "Declaration",
        ConfigDeclarationTemplate: "ConfigDeclarationTemplate",
        HistoryReport: "HistoryReport",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => mockUuid() },
      ApplicationService: class {
        async init() {}
        on(_event: string, _handler: any) {}
        before(_event: string, _entity: string, _handler: any) {}
        after(_event: string, _entity: string, _handler: any) {}
      },
    },
  };
});

const mockMarkFieldCertified = jest.fn().mockResolvedValue({ ID: "cert-1" });
const mockGetCertifiedFields = jest.fn().mockResolvedValue([]);
const mockOverrideCertifiedField = jest.fn();
jest.mock("../../../srv/lib/certification", () => ({
  markFieldCertified: (...args: any[]) => mockMarkFieldCertified(...args),
  getCertifiedFields: (...args: any[]) => mockGetCertifiedFields(...args),
  overrideCertifiedField: (...args: any[]) => mockOverrideCertifiedField(...args),
}));

const mockGetCachedResponse = jest.fn().mockResolvedValue(null);
const mockSetCachedResponse = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../srv/lib/api-cache", () => ({
  getCachedResponse: (...args: any[]) => mockGetCachedResponse(...args),
  setCachedResponse: (...args: any[]) => mockSetCachedResponse(...args),
}));

const mockLogAudit = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../srv/lib/audit-logger", () => ({
  logAudit: (...args: any[]) => mockLogAudit(...args),
}));

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../srv/middleware/audit-trail", () => ({
  auditLog: (...args: any[]) => mockAuditLog(...args),
}));

jest.mock("../../../srv/lib/signalr-client", () => ({
  signalrClient: {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    isConfigured: jest.fn(() => false),
  },
  SIGNALR_HUBS: { admin: "admin", liveScore: "live-score" },
}));

const mockCalculateVisibilityScore = jest
  .fn()
  .mockReturnValue({ score: 50, label: "Bien documenté", suggestions: [] });
jest.mock("../../../srv/lib/visibility-score", () => ({
  calculateVisibilityScore: (...args: any[]) => mockCalculateVisibilityScore(...args),
  getFilledFieldsFromListing: jest.fn().mockReturnValue({}),
}));

const mockGetHistory = jest.fn();
jest.mock("../../../srv/adapters/factory/adapter-factory", () => ({
  getVehicleLookup: () => ({ lookup: jest.fn() }),
  getEmission: () => ({ getEmissions: jest.fn() }),
  getRecall: () => ({ getRecalls: jest.fn() }),
  getCritAir: () => ({ calculate: jest.fn() }),
  getVINTechnical: () => ({ decode: jest.fn() }),
  getHistory: () => ({
    providerName: "mock",
    providerVersion: "1.0.0",
    getHistory: (...args: any[]) => mockGetHistory(...args),
  }),
}));

jest.mock("@auto/shared", () => ({
  validateListingField: jest.fn().mockReturnValue(null),
  CERTIFIABLE_FIELDS: ["make", "model", "year", "plate", "vin", "fuelType"],
  LISTING_FIELDS: [{ fieldName: "make" }, { fieldName: "model" }, { fieldName: "price" }],
  PHOTO_ALLOWED_MIME_TYPES: ["image/jpeg", "image/png"],
  calculateCompletionPercentage: jest.fn().mockReturnValue(35),
}));

jest.mock("../../../srv/lib/photo-storage", () => ({
  validateMimeType: jest.fn().mockReturnValue(true),
  validateFileSize: jest.fn().mockReturnValue(true),
  canUploadPhoto: jest.fn().mockResolvedValue(true),
  uploadPhotoBlob: jest.fn().mockResolvedValue({
    blobUrl: "https://storage/blob",
    cdnUrl: "https://cdn/photo.jpg",
    blobPath: "path/photo.jpg",
  }),
  deletePhotoBlob: jest.fn().mockResolvedValue(undefined),
  deleteAllPhotosForListing: jest.fn().mockResolvedValue(undefined),
  getNextSortOrder: jest.fn().mockResolvedValue(0),
  getMaxPhotos: jest.fn().mockReturnValue(20),
}));

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
(global as any).INSERT = {
  into: jest.fn().mockReturnValue({ entries: jest.fn().mockReturnValue("q") }),
};
(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }),
});
(global as any).DELETE = {
  from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }),
};

// ─── Import handlers ────────────────────────────────────────────────────────

const SellerServiceHandler = require("../../../srv/seller-service").default;
const BuyerServiceHandler = require("../../../srv/buyer-service").default;

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockRequest(data: Record<string, any>, userId = "seller-1"): any {
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

const MOCK_HISTORY_RESPONSE = {
  vin: "VF1RFB00X56789012",
  ownerCount: 2,
  firstRegistrationDate: "2018-06-01",
  lastRegistrationDate: "2022-03-15",
  mileageRecords: [
    { date: "2020-06-01", mileageKm: 25000, source: "controle_technique" },
    { date: "2022-06-01", mileageKm: 52000, source: "controle_technique" },
  ],
  accidents: [],
  registrationHistory: [
    { date: "2018-06-01", department: "75", region: "Île-de-France" },
    { date: "2022-03-15", department: "69", region: "Auvergne-Rhône-Alpes" },
  ],
  outstandingFinance: false,
  stolen: false,
  totalDamageCount: 0,
  provider: { providerName: "mock", providerVersion: "1.0.0" },
};

// ─── Integration Tests ──────────────────────────────────────────────────────

describe("History Report - Integration Flow", () => {
  let sellerFetchHistoryReport: any;
  let buyerGetHistoryReport: any;

  beforeAll(() => {
    // Initialize seller handler
    const sellerHandler = new SellerServiceHandler();
    sellerHandler.on = (event: string, fn: any) => {
      if (event === "fetchHistoryReport") sellerFetchHistoryReport = fn;
    };
    sellerHandler.before = jest.fn();
    sellerHandler.init();

    // Initialize buyer handler
    const buyerHandler = new BuyerServiceHandler();
    buyerHandler.on = (event: string, fn: any) => {
      if (event === "getHistoryReport") buyerGetHistoryReport = fn;
    };
    buyerHandler.before = jest.fn();
    buyerHandler.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    mockGetHistory.mockReset();
    mockGetCachedResponse.mockReset();
    mockSetCachedResponse.mockReset();
    mockAuditLog.mockReset();
    mockUuid.mockReturnValue("integration-uuid");
  });

  // ─── 7.1: Full seller flow ──────────────────────────────────────────────

  describe("7.1: Seller creates listing and triggers history report", () => {
    it("should fetch, cache, store report, and log audit in one flow", async () => {
      // Simulate: listing exists with VIN, no existing report, no cache
      mockRun.mockResolvedValueOnce({
        ID: "listing-1",
        sellerId: "seller-1",
        vin: "VF1RFB00X56789012",
        plate: "AB-123-CD",
      });
      mockRun.mockResolvedValueOnce(null); // no existing report
      mockRun.mockResolvedValueOnce(undefined); // INSERT report

      mockGetCachedResponse.mockResolvedValueOnce(null);
      mockGetHistory.mockResolvedValueOnce(MOCK_HISTORY_RESPONSE);

      const req = createMockRequest({ listingId: "listing-1" });
      const result = await sellerFetchHistoryReport(req);

      // Verify report was returned
      expect(result.reportId).toBe("integration-uuid");
      expect(result.source).toBe("mock");
      expect(result.reportVersion).toBe("1.0.0");

      // Verify adapter was called
      expect(mockGetHistory).toHaveBeenCalledWith({
        vin: "VF1RFB00X56789012",
        plate: "AB-123-CD",
      });

      // Verify cached in ApiCachedData
      expect(mockSetCachedResponse).toHaveBeenCalledWith(
        "VF1RFB00X56789012",
        "vin",
        "IHistoryAdapter",
        MOCK_HISTORY_RESPONSE,
      );

      // Verify audit logged
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "listing.updated",
          actorId: "seller-1",
          targetType: "HistoryReport",
          targetId: "integration-uuid",
        }),
      );

      // Verify report data is stored as JSON
      const reportData = JSON.parse(result.reportData);
      expect(reportData.vin).toBe("VF1RFB00X56789012");
      expect(reportData.ownerCount).toBe(2);
    });
  });

  // ─── 7.2: Buyer access to published listing ────────────────────────────

  describe("7.2: Authenticated buyer accesses history report", () => {
    it("should return full report for published listing", async () => {
      // listing is published
      mockRun.mockResolvedValueOnce({
        ID: "listing-1",
        status: "published",
      });
      // report exists
      mockRun.mockResolvedValueOnce({
        ID: "report-1",
        source: "mock",
        fetchedAt: "2026-02-24T10:00:00.000Z",
        reportVersion: "1.0.0",
        reportData: JSON.stringify(MOCK_HISTORY_RESPONSE),
      });

      const req = createMockRequest({ listingId: "listing-1" }, "buyer-1");
      const result = await buyerGetHistoryReport(req);

      expect(result.reportId).toBe("report-1");
      expect(result.source).toBe("mock");
      expect(result.fetchedAt).toBe("2026-02-24T10:00:00.000Z");
      expect(result.reportVersion).toBe("1.0.0");
      expect(result.isMockData).toBe(true);
      expect(req.error).not.toHaveBeenCalled();
    });
  });

  // ─── 7.3: Anonymous access ─────────────────────────────────────────────

  describe("7.3: Anonymous user sees login prompt", () => {
    it("should return 401 with French message for unauthenticated user", async () => {
      const req = createMockRequest({ listingId: "listing-1" });
      req.user = { id: undefined };

      await buyerGetHistoryReport(req);

      expect(req.error).toHaveBeenCalledWith(
        401,
        "Rapport disponible - connectez-vous pour consulter",
      );
    });

    it("should return 401 with French message for null user id", async () => {
      const req = createMockRequest({ listingId: "listing-1" });
      req.user = { id: null };

      await buyerGetHistoryReport(req);

      expect(req.error).toHaveBeenCalledWith(
        401,
        "Rapport disponible - connectez-vous pour consulter",
      );
    });
  });

  // ─── 7.4: Provider swap readiness ──────────────────────────────────────

  describe("7.4: Provider swap readiness", () => {
    it("should resolve adapter via factory (getHistory returns adapter with getHistory method)", () => {
      const adapterFactory = require("../../../srv/adapters/factory/adapter-factory");
      const adapter = adapterFactory.getHistory();

      expect(adapter).toBeDefined();
      expect(typeof adapter.getHistory).toBe("function");
      expect(adapter.providerName).toBe("mock");
    });

    it("should correctly flag mock vs real provider in buyer response", async () => {
      // Real provider scenario
      mockRun.mockResolvedValueOnce({ ID: "listing-1", status: "published" });
      mockRun.mockResolvedValueOnce({
        ID: "report-1",
        source: "carvertical",
        fetchedAt: "2026-02-24T10:00:00.000Z",
        reportVersion: "2.0.0",
        reportData: JSON.stringify(MOCK_HISTORY_RESPONSE),
      });

      const req = createMockRequest({ listingId: "listing-1" }, "buyer-1");
      const result = await buyerGetHistoryReport(req);

      expect(result.isMockData).toBe(false);
    });
  });

  // ─── 7.5: Cache behavior ──────────────────────────────────────────────

  describe("7.5: Cache behavior - second fetch uses cache", () => {
    it("should use cached adapter response on second call", async () => {
      // First call: no cache, adapter called
      mockRun.mockResolvedValueOnce({
        ID: "listing-1",
        sellerId: "seller-1",
        vin: "VF1RFB00X56789012",
        plate: "AB-123-CD",
      });
      mockRun.mockResolvedValueOnce(null); // no existing report
      mockRun.mockResolvedValueOnce(undefined); // INSERT

      mockGetCachedResponse.mockResolvedValueOnce(null);
      mockGetHistory.mockResolvedValueOnce(MOCK_HISTORY_RESPONSE);

      const req1 = createMockRequest({ listingId: "listing-1" });
      await sellerFetchHistoryReport(req1);

      expect(mockGetHistory).toHaveBeenCalledTimes(1);
      expect(mockSetCachedResponse).toHaveBeenCalledTimes(1);

      // Second call: report already exists → returns existing without adapter call
      jest.clearAllMocks();
      mockRun.mockResolvedValueOnce({
        ID: "listing-1",
        sellerId: "seller-1",
        vin: "VF1RFB00X56789012",
        plate: "AB-123-CD",
      });
      mockRun.mockResolvedValueOnce({
        ID: "integration-uuid",
        source: "mock",
        fetchedAt: "2026-02-24T10:00:00.000Z",
        reportVersion: "1.0.0",
        reportData: JSON.stringify(MOCK_HISTORY_RESPONSE),
      });

      const req2 = createMockRequest({ listingId: "listing-1" });
      const result2 = await sellerFetchHistoryReport(req2);

      expect(result2.reportId).toBe("integration-uuid");
      expect(mockGetHistory).not.toHaveBeenCalled();
      expect(mockGetCachedResponse).not.toHaveBeenCalled();
    });

    it("should use adapter cache when report not in DB but response is cached", async () => {
      mockRun.mockResolvedValueOnce({
        ID: "listing-1",
        sellerId: "seller-1",
        vin: "VF1RFB00X56789012",
        plate: "AB-123-CD",
      });
      mockRun.mockResolvedValueOnce(null); // no existing report
      mockRun.mockResolvedValueOnce(undefined); // INSERT

      mockGetCachedResponse.mockResolvedValueOnce(MOCK_HISTORY_RESPONSE); // cache hit

      const req = createMockRequest({ listingId: "listing-1" });
      const result = await sellerFetchHistoryReport(req);

      expect(result.reportId).toBe("integration-uuid");
      expect(mockGetHistory).not.toHaveBeenCalled();
      expect(mockSetCachedResponse).not.toHaveBeenCalled();
    });
  });

  // ─── Cross-service: seller fetch then buyer read ──────────────────────

  describe("End-to-end: seller fetches, buyer reads", () => {
    it("should allow buyer to read report that seller created", async () => {
      // Step 1: Seller fetches history report
      mockRun.mockResolvedValueOnce({
        ID: "listing-1",
        sellerId: "seller-1",
        vin: "VF1RFB00X56789012",
        plate: "AB-123-CD",
      });
      mockRun.mockResolvedValueOnce(null);
      mockRun.mockResolvedValueOnce(undefined);

      mockGetCachedResponse.mockResolvedValueOnce(null);
      mockGetHistory.mockResolvedValueOnce(MOCK_HISTORY_RESPONSE);

      const sellerReq = createMockRequest({ listingId: "listing-1" });
      const sellerResult = await sellerFetchHistoryReport(sellerReq);

      expect(sellerResult.reportId).toBe("integration-uuid");

      // Step 2: Buyer reads the same report
      jest.clearAllMocks();
      mockRun.mockResolvedValueOnce({ ID: "listing-1", status: "published" });
      mockRun.mockResolvedValueOnce({
        ID: "integration-uuid",
        source: "mock",
        fetchedAt: sellerResult.fetchedAt,
        reportVersion: "1.0.0",
        reportData: sellerResult.reportData,
      });

      const buyerReq = createMockRequest({ listingId: "listing-1" }, "buyer-1");
      const buyerResult = await buyerGetHistoryReport(buyerReq);

      expect(buyerResult.reportId).toBe("integration-uuid");
      expect(buyerResult.isMockData).toBe(true);
      expect(buyerResult.reportData).toBe(sellerResult.reportData);
    });

    it("should deny buyer access to draft listing report", async () => {
      // Listing is a draft, not published
      mockRun.mockResolvedValueOnce({ ID: "listing-1", status: "draft" });

      const buyerReq = createMockRequest({ listingId: "listing-1" }, "buyer-1");
      await buyerGetHistoryReport(buyerReq);

      expect(buyerReq.error).toHaveBeenCalledWith(
        403,
        "History report is only available for published or sold listings",
      );
    });
  });
});
