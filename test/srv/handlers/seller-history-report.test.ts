/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "new-report-uuid");

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
const mockOverrideCertifiedField = jest.fn().mockResolvedValue({
  previousValue: "OldValue",
  previousSource: "SIV",
  newRecord: {},
});
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
  getHistory: () => ({ getHistory: (...args: any[]) => mockGetHistory(...args) }),
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

// ─── Import the handler ──────────────────────────────────────────────────────

const SellerServiceHandler = require("../../../srv/seller-service").default;

// ─── Mock Request Builder ────────────────────────────────────────────────────

function createMockRequest(data: Record<string, any>, userId = "test-user-1"): any {
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SellerService - fetchHistoryReport", () => {
  let handleFetchHistoryReport: any;

  beforeAll(() => {
    const handler = new SellerServiceHandler();
    handler.on = (event: string, fn: any) => {
      if (event === "fetchHistoryReport") {
        handleFetchHistoryReport = fn;
      }
    };
    handler.before = jest.fn();
    handler.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    mockGetHistory.mockReset();
    mockGetCachedResponse.mockReset();
    mockSetCachedResponse.mockReset();
    mockAuditLog.mockReset();
    mockUuid.mockReturnValue("new-report-uuid");
  });

  it("should fetch history report and store it for a valid listing", async () => {
    // SELECT listing
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "test-user-1",
      vin: "VF1RFB00X56789012",
      plate: "AB-123-CD",
    });
    // SELECT existing report (none)
    mockRun.mockResolvedValueOnce(null);
    // INSERT report
    mockRun.mockResolvedValueOnce(undefined);

    mockGetCachedResponse.mockResolvedValueOnce(null);
    mockGetHistory.mockResolvedValueOnce(MOCK_HISTORY_RESPONSE);

    const req = createMockRequest({ listingId: "listing-1" });
    const result = await handleFetchHistoryReport(req);

    expect(result.reportId).toBe("new-report-uuid");
    expect(result.source).toBe("mock");
    expect(result.reportVersion).toBe("1.0.0");
    expect(result.fetchedAt).toBeDefined();
    expect(JSON.parse(result.reportData)).toEqual(MOCK_HISTORY_RESPONSE);
  });

  it("should use cached response when available", async () => {
    // SELECT listing
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "test-user-1",
      vin: "VF1RFB00X56789012",
      plate: "AB-123-CD",
    });
    // SELECT existing report (none)
    mockRun.mockResolvedValueOnce(null);
    // INSERT report
    mockRun.mockResolvedValueOnce(undefined);

    mockGetCachedResponse.mockResolvedValueOnce(MOCK_HISTORY_RESPONSE);

    const req = createMockRequest({ listingId: "listing-1" });
    const result = await handleFetchHistoryReport(req);

    expect(result.reportId).toBe("new-report-uuid");
    expect(result.source).toBe("mock");
    // getHistory should NOT have been called since cache was used
    expect(mockGetHistory).not.toHaveBeenCalled();
    // setCachedResponse should NOT have been called since we used cache
    expect(mockSetCachedResponse).not.toHaveBeenCalled();
  });

  it("should cache the response after fetching from adapter", async () => {
    // SELECT listing
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "test-user-1",
      vin: "VF1RFB00X56789012",
      plate: null,
    });
    // SELECT existing report (none)
    mockRun.mockResolvedValueOnce(null);
    // INSERT report
    mockRun.mockResolvedValueOnce(undefined);

    mockGetCachedResponse.mockResolvedValueOnce(null);
    mockGetHistory.mockResolvedValueOnce(MOCK_HISTORY_RESPONSE);

    const req = createMockRequest({ listingId: "listing-1" });
    await handleFetchHistoryReport(req);

    expect(mockSetCachedResponse).toHaveBeenCalledWith(
      "VF1RFB00X56789012",
      "vin",
      "IHistoryAdapter",
      MOCK_HISTORY_RESPONSE,
    );
  });

  it("should return existing report when already fetched", async () => {
    // SELECT listing
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "test-user-1",
      vin: "VF1RFB00X56789012",
      plate: "AB-123-CD",
    });
    // SELECT existing report (found)
    mockRun.mockResolvedValueOnce({
      ID: "existing-report-id",
      source: "mock",
      fetchedAt: "2026-02-24T10:00:00.000Z",
      reportVersion: "1.0.0",
      reportData: JSON.stringify(MOCK_HISTORY_RESPONSE),
    });

    const req = createMockRequest({ listingId: "listing-1" });
    const result = await handleFetchHistoryReport(req);

    expect(result.reportId).toBe("existing-report-id");
    expect(result.source).toBe("mock");
    // Should not call adapter or cache
    expect(mockGetHistory).not.toHaveBeenCalled();
    expect(mockGetCachedResponse).not.toHaveBeenCalled();
  });

  it("should return 404 when listing does not exist", async () => {
    mockRun.mockResolvedValueOnce(null);

    const req = createMockRequest({ listingId: "nonexistent" });
    await handleFetchHistoryReport(req);

    expect(req.error).toHaveBeenCalledWith(
      404,
      "Listing not found or does not belong to current seller",
    );
  });

  it("should return 404 when listing belongs to a different seller", async () => {
    // SELECT listing returns null because WHERE includes sellerId = userId
    mockRun.mockResolvedValueOnce(null);

    const req = createMockRequest({ listingId: "listing-1" }, "different-user");
    await handleFetchHistoryReport(req);

    expect(req.error).toHaveBeenCalledWith(
      404,
      "Listing not found or does not belong to current seller",
    );
  });

  it("should return 400 when listing has no VIN", async () => {
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "test-user-1",
      vin: null,
      plate: "AB-123-CD",
    });

    const req = createMockRequest({ listingId: "listing-1" });
    await handleFetchHistoryReport(req);

    expect(req.error).toHaveBeenCalledWith(
      400,
      "Listing has no VIN - auto-fill must be completed before fetching history report",
    );
  });

  it("should log an audit trail entry after successful fetch", async () => {
    // SELECT listing
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "test-user-1",
      vin: "VF1RFB00X56789012",
      plate: "AB-123-CD",
    });
    // SELECT existing report (none)
    mockRun.mockResolvedValueOnce(null);
    // INSERT report
    mockRun.mockResolvedValueOnce(undefined);

    mockGetCachedResponse.mockResolvedValueOnce(null);
    mockGetHistory.mockResolvedValueOnce(MOCK_HISTORY_RESPONSE);

    const req = createMockRequest({ listingId: "listing-1" });
    await handleFetchHistoryReport(req);

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "listing.updated",
        actorId: "test-user-1",
        targetType: "HistoryReport",
        targetId: "new-report-uuid",
      }),
    );
  });

  it("should pass plate as undefined when listing has no plate", async () => {
    // SELECT listing
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "test-user-1",
      vin: "VF1RFB00X56789012",
      plate: null,
    });
    // SELECT existing report (none)
    mockRun.mockResolvedValueOnce(null);
    // INSERT report
    mockRun.mockResolvedValueOnce(undefined);

    mockGetCachedResponse.mockResolvedValueOnce(null);
    mockGetHistory.mockResolvedValueOnce(MOCK_HISTORY_RESPONSE);

    const req = createMockRequest({ listingId: "listing-1" });
    await handleFetchHistoryReport(req);

    expect(mockGetHistory).toHaveBeenCalledWith({
      vin: "VF1RFB00X56789012",
      plate: undefined,
    });
  });

  it("should pass plate when listing has a plate", async () => {
    // SELECT listing
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "test-user-1",
      vin: "VF1RFB00X56789012",
      plate: "AB-123-CD",
    });
    // SELECT existing report (none)
    mockRun.mockResolvedValueOnce(null);
    // INSERT report
    mockRun.mockResolvedValueOnce(undefined);

    mockGetCachedResponse.mockResolvedValueOnce(null);
    mockGetHistory.mockResolvedValueOnce(MOCK_HISTORY_RESPONSE);

    const req = createMockRequest({ listingId: "listing-1" });
    await handleFetchHistoryReport(req);

    expect(mockGetHistory).toHaveBeenCalledWith({
      vin: "VF1RFB00X56789012",
      plate: "AB-123-CD",
    });
  });

  it("should store report with correct fields in HistoryReport entity", async () => {
    // SELECT listing
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "test-user-1",
      vin: "VF1RFB00X56789012",
      plate: "AB-123-CD",
    });
    // SELECT existing report (none)
    mockRun.mockResolvedValueOnce(null);
    // INSERT report
    mockRun.mockResolvedValueOnce(undefined);

    mockGetCachedResponse.mockResolvedValueOnce(null);
    mockGetHistory.mockResolvedValueOnce(MOCK_HISTORY_RESPONSE);

    const req = createMockRequest({ listingId: "listing-1" });
    await handleFetchHistoryReport(req);

    // Third cds.run call is INSERT
    expect(mockRun).toHaveBeenCalledTimes(3);
  });
});
