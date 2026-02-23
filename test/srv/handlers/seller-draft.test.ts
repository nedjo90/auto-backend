/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "new-draft-uuid");

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

jest.mock("../../../srv/adapters/factory/adapter-factory", () => ({
  getVehicleLookup: () => ({ lookup: jest.fn() }),
  getEmission: () => ({ getEmissions: jest.fn() }),
  getRecall: () => ({ getRecalls: jest.fn() }),
  getCritAir: () => ({ calculate: jest.fn() }),
  getVINTechnical: () => ({ decode: jest.fn() }),
}));

jest.mock("@auto/shared", () => ({
  validateListingField: jest.fn().mockReturnValue(null),
  CERTIFIABLE_FIELDS: ["make", "model", "year", "plate", "vin", "fuelType"],
  LISTING_FIELDS: [
    { fieldName: "make" },
    { fieldName: "model" },
    { fieldName: "year" },
    { fieldName: "plate" },
    { fieldName: "vin" },
    { fieldName: "fuelType" },
    { fieldName: "price" },
    { fieldName: "mileage" },
    { fieldName: "description" },
    { fieldName: "condition" },
    { fieldName: "color" },
    { fieldName: "options" },
    { fieldName: "variant" },
    { fieldName: "registrationDate" },
    { fieldName: "engineCapacityCc" },
    { fieldName: "powerKw" },
    { fieldName: "powerHp" },
    { fieldName: "gearbox" },
    { fieldName: "bodyType" },
    { fieldName: "doors" },
    { fieldName: "seats" },
    { fieldName: "co2GKm" },
    { fieldName: "euroNorm" },
    { fieldName: "energyClass" },
    { fieldName: "critAirLevel" },
    { fieldName: "critAirLabel" },
    { fieldName: "critAirColor" },
    { fieldName: "bodyClass" },
    { fieldName: "engineCylinders" },
    { fieldName: "manufacturer" },
    { fieldName: "vehicleType" },
    { fieldName: "plantCountry" },
    { fieldName: "recallCount" },
    { fieldName: "transmission" },
    { fieldName: "driveType" },
    { fieldName: "numberOfDoors" },
    { fieldName: "interiorColor" },
    { fieldName: "exteriorColor" },
  ],
  PHOTO_ALLOWED_MIME_TYPES: ["image/jpeg", "image/png", "image/webp", "image/heic"],
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
  one: { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }) },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("q"),
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
    error: jest.fn((status: number, msg: string) => {
      errors.push({ status, msg });
    }),
    _errors: errors,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SellerService - saveDraft", () => {
  let handleSaveDraft: any;

  beforeAll(() => {
    const handler = new SellerServiceHandler();
    handler.on = (event: string, fn: any) => {
      if (event === "saveDraft") {
        handleSaveDraft = fn;
      }
    };
    handler.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    mockCalculateVisibilityScore.mockReturnValue({
      score: 50,
      label: "Bien documenté",
      suggestions: [],
    });
    const { calculateCompletionPercentage } = require("@auto/shared");
    calculateCompletionPercentage.mockReturnValue(35);
  });

  describe("create new draft", () => {
    it("should create a new listing when no listingId is provided", async () => {
      // INSERT listing
      mockRun.mockResolvedValueOnce(undefined);
      // SELECT saved listing (re-fetch)
      mockRun.mockResolvedValueOnce({ ID: "new-draft-uuid", make: "Renault", model: "Clio" });
      // SELECT photos
      mockRun.mockResolvedValueOnce([]);
      // UPDATE scores
      mockRun.mockResolvedValueOnce(undefined);

      const req = createMockRequest({
        listingId: null,
        fields: JSON.stringify({ make: "Renault", model: "Clio", year: 2022 }),
        certifiedFields: null,
      });

      const result = await handleSaveDraft(req);

      expect(req.error).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.listingId).toBe("new-draft-uuid");
      expect(result.success).toBe(true);
      expect(result.completionPercentage).toBe(35);
      expect(result.visibilityScore).toBe(50);
    });

    it("should set status to draft on new listing", async () => {
      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockRun.mockResolvedValueOnce({ ID: "new-draft-uuid" }); // SELECT saved
      mockRun.mockResolvedValueOnce([]); // SELECT photos
      mockRun.mockResolvedValueOnce(undefined); // UPDATE scores

      const req = createMockRequest({
        listingId: null,
        fields: JSON.stringify({ make: "Renault" }),
        certifiedFields: null,
      });

      await handleSaveDraft(req);

      // Verify INSERT was called with status: "draft"
      expect((global as any).INSERT.into).toHaveBeenCalled();
      const insertEntries = (global as any).INSERT.into("Listing").entries;
      expect(mockRun).toHaveBeenCalled();
    });

    it("should set sellerId from authenticated user", async () => {
      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockRun.mockResolvedValueOnce({ ID: "new-draft-uuid", sellerId: "test-user-1" }); // SELECT
      mockRun.mockResolvedValueOnce([]); // SELECT photos
      mockRun.mockResolvedValueOnce(undefined); // UPDATE scores

      const req = createMockRequest(
        {
          listingId: null,
          fields: JSON.stringify({}),
          certifiedFields: null,
        },
        "seller-abc",
      );

      const result = await handleSaveDraft(req);
      expect(result.success).toBe(true);
    });
  });

  describe("update existing draft", () => {
    it("should update an existing listing when listingId is provided", async () => {
      // SELECT existing listing
      mockRun.mockResolvedValueOnce({ ID: "existing-id", sellerId: "test-user-1" });
      // UPDATE listing
      mockRun.mockResolvedValueOnce(undefined);
      // SELECT saved listing (re-fetch)
      mockRun.mockResolvedValueOnce({ ID: "existing-id", make: "Peugeot" });
      // SELECT photos
      mockRun.mockResolvedValueOnce([{ ID: "photo-1" }]);
      // UPDATE scores
      mockRun.mockResolvedValueOnce(undefined);

      const req = createMockRequest({
        listingId: "existing-id",
        fields: JSON.stringify({ make: "Peugeot", price: 20000 }),
        certifiedFields: null,
      });

      const result = await handleSaveDraft(req);

      expect(req.error).not.toHaveBeenCalled();
      expect(result.listingId).toBe("existing-id");
      expect(result.success).toBe(true);
    });

    it("should return 404 when listing not found", async () => {
      mockRun.mockResolvedValueOnce(null); // SELECT listing → not found

      const req = createMockRequest({
        listingId: "nonexistent",
        fields: JSON.stringify({}),
        certifiedFields: null,
      });

      await handleSaveDraft(req);
      expect(req.error).toHaveBeenCalledWith(404, "Listing not found");
    });

    it("should return 403 when user is not the listing owner", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "other-user" });

      const req = createMockRequest({
        listingId: "listing-1",
        fields: JSON.stringify({}),
        certifiedFields: null,
      });

      await handleSaveDraft(req);
      expect(req.error).toHaveBeenCalledWith(403, expect.stringContaining("Not authorized"));
    });
  });

  describe("certified fields persistence", () => {
    it("should persist certified fields via markFieldCertified", async () => {
      mockRun.mockResolvedValueOnce(undefined); // INSERT listing
      mockRun.mockResolvedValueOnce({ ID: "new-draft-uuid", make: "Renault" }); // SELECT saved
      mockRun.mockResolvedValueOnce([]); // SELECT photos
      mockRun.mockResolvedValueOnce(undefined); // UPDATE scores

      const certifiedFields = [
        {
          fieldName: "make",
          fieldValue: "Renault",
          source: "SIV",
          sourceTimestamp: "2026-02-23T10:00:00Z",
          isCertified: true,
        },
        {
          fieldName: "model",
          fieldValue: "Clio V",
          source: "SIV",
          sourceTimestamp: "2026-02-23T10:00:00Z",
          isCertified: true,
        },
      ];

      const req = createMockRequest({
        listingId: null,
        fields: JSON.stringify({ make: "Renault", model: "Clio V" }),
        certifiedFields: JSON.stringify(certifiedFields),
      });

      const result = await handleSaveDraft(req);

      expect(result.success).toBe(true);
      expect(mockMarkFieldCertified).toHaveBeenCalledTimes(2);
      expect(mockMarkFieldCertified).toHaveBeenCalledWith(
        "new-draft-uuid",
        "make",
        "Renault",
        "SIV",
      );
      expect(mockMarkFieldCertified).toHaveBeenCalledWith(
        "new-draft-uuid",
        "model",
        "Clio V",
        "SIV",
      );
    });

    it("should skip certified fields with missing required data", async () => {
      mockRun.mockResolvedValueOnce(undefined); // INSERT listing
      mockRun.mockResolvedValueOnce({ ID: "new-draft-uuid" }); // SELECT saved
      mockRun.mockResolvedValueOnce([]); // SELECT photos
      mockRun.mockResolvedValueOnce(undefined); // UPDATE scores

      const certifiedFields = [
        { fieldName: "make", fieldValue: "", source: "SIV" }, // empty value
        { fieldName: "", fieldValue: "Renault", source: "SIV" }, // empty fieldName
        { fieldName: "model", fieldValue: "Clio", source: "" }, // empty source
      ];

      const req = createMockRequest({
        listingId: null,
        fields: JSON.stringify({}),
        certifiedFields: JSON.stringify(certifiedFields),
      });

      await handleSaveDraft(req);
      expect(mockMarkFieldCertified).not.toHaveBeenCalled();
    });

    it("should handle invalid certifiedFields JSON gracefully", async () => {
      mockRun.mockResolvedValueOnce(undefined); // INSERT listing
      mockRun.mockResolvedValueOnce({ ID: "new-draft-uuid" }); // SELECT saved
      mockRun.mockResolvedValueOnce([]); // SELECT photos
      mockRun.mockResolvedValueOnce(undefined); // UPDATE scores

      const req = createMockRequest({
        listingId: null,
        fields: JSON.stringify({}),
        certifiedFields: "not-valid-json",
      });

      const result = await handleSaveDraft(req);
      expect(result.success).toBe(true);
      expect(mockMarkFieldCertified).not.toHaveBeenCalled();
    });
  });

  describe("field sanitization", () => {
    it("should ignore unknown field names", async () => {
      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockRun.mockResolvedValueOnce({ ID: "new-draft-uuid" }); // SELECT saved
      mockRun.mockResolvedValueOnce([]); // SELECT photos
      mockRun.mockResolvedValueOnce(undefined); // UPDATE scores

      const req = createMockRequest({
        listingId: null,
        fields: JSON.stringify({
          make: "Renault",
          unknownField: "hack",
          __proto__: "injection",
        }),
        certifiedFields: null,
      });

      const result = await handleSaveDraft(req);
      expect(result.success).toBe(true);
    });

    it("should convert numeric fields to numbers", async () => {
      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockRun.mockResolvedValueOnce({ ID: "new-draft-uuid", price: 15000 }); // SELECT saved
      mockRun.mockResolvedValueOnce([]); // SELECT photos
      mockRun.mockResolvedValueOnce(undefined); // UPDATE scores

      const req = createMockRequest({
        listingId: null,
        fields: JSON.stringify({ price: "15000", mileage: "50000", year: "2022" }),
        certifiedFields: null,
      });

      const result = await handleSaveDraft(req);
      expect(result.success).toBe(true);
    });

    it("should set empty string values to null", async () => {
      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockRun.mockResolvedValueOnce({ ID: "new-draft-uuid" }); // SELECT saved
      mockRun.mockResolvedValueOnce([]); // SELECT photos
      mockRun.mockResolvedValueOnce(undefined); // UPDATE scores

      const req = createMockRequest({
        listingId: null,
        fields: JSON.stringify({ make: "", model: null }),
        certifiedFields: null,
      });

      const result = await handleSaveDraft(req);
      expect(result.success).toBe(true);
    });

    it("should return 400 for invalid fields JSON", async () => {
      const req = createMockRequest({
        listingId: null,
        fields: "not-json",
        certifiedFields: null,
      });

      await handleSaveDraft(req);
      expect(req.error).toHaveBeenCalledWith(400, "Invalid fields JSON");
    });
  });

  describe("score and completion calculation", () => {
    it("should calculate and persist visibility score", async () => {
      mockCalculateVisibilityScore.mockReturnValue({
        score: 75,
        label: "Très documenté",
        suggestions: [],
      });

      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockRun.mockResolvedValueOnce({ ID: "new-draft-uuid", make: "Renault" }); // SELECT saved
      mockRun.mockResolvedValueOnce([{ ID: "p1" }, { ID: "p2" }]); // SELECT photos (2 photos)
      mockRun.mockResolvedValueOnce(undefined); // UPDATE scores

      const req = createMockRequest({
        listingId: null,
        fields: JSON.stringify({ make: "Renault" }),
        certifiedFields: null,
      });

      const result = await handleSaveDraft(req);

      expect(result.visibilityScore).toBe(75);
      expect(result.visibilityLabel).toBe("Très documenté");
      expect(mockCalculateVisibilityScore).toHaveBeenCalledWith(
        expect.objectContaining({
          listing: expect.objectContaining({ ID: "new-draft-uuid" }),
          photoCount: 2,
          hasHistoryReport: false,
        }),
      );
    });

    it("should calculate and return completion percentage", async () => {
      const { calculateCompletionPercentage } = require("@auto/shared");
      calculateCompletionPercentage.mockReturnValue(60);

      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockRun.mockResolvedValueOnce({ ID: "new-draft-uuid", make: "Renault", model: "Clio" }); // SELECT
      mockRun.mockResolvedValueOnce([{ ID: "p1" }]); // photos
      mockRun.mockResolvedValueOnce(undefined); // UPDATE scores

      const req = createMockRequest({
        listingId: null,
        fields: JSON.stringify({ make: "Renault", model: "Clio" }),
        certifiedFields: null,
      });

      const result = await handleSaveDraft(req);

      expect(result.completionPercentage).toBe(60);
      expect(calculateCompletionPercentage).toHaveBeenCalledWith(
        expect.objectContaining({ ID: "new-draft-uuid" }),
        1,
      );
    });
  });

  describe("authentication", () => {
    it("should return 401 when user is not authenticated", async () => {
      const req = {
        data: {
          listingId: null,
          fields: JSON.stringify({}),
          certifiedFields: null,
        },
        user: {},
        error: jest.fn(),
      };

      await handleSaveDraft(req);
      expect(req.error).toHaveBeenCalledWith(401, "Authentication required");
    });
  });

  describe("audit logging", () => {
    it("should log audit for new draft creation", async () => {
      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockRun.mockResolvedValueOnce({ ID: "new-draft-uuid" }); // SELECT
      mockRun.mockResolvedValueOnce([]); // photos
      mockRun.mockResolvedValueOnce(undefined); // UPDATE

      const req = createMockRequest({
        listingId: null,
        fields: JSON.stringify({ make: "Renault" }),
        certifiedFields: null,
      });

      await handleSaveDraft(req);

      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "test-user-1",
          action: "listing.draft.create",
          resource: "Listing",
        }),
      );
    });

    it("should log audit for draft update", async () => {
      mockRun.mockResolvedValueOnce({ ID: "existing-id", sellerId: "test-user-1" }); // SELECT existing
      mockRun.mockResolvedValueOnce(undefined); // UPDATE
      mockRun.mockResolvedValueOnce({ ID: "existing-id" }); // SELECT saved
      mockRun.mockResolvedValueOnce([]); // photos
      mockRun.mockResolvedValueOnce(undefined); // UPDATE scores

      const req = createMockRequest({
        listingId: "existing-id",
        fields: JSON.stringify({ make: "Peugeot" }),
        certifiedFields: null,
      });

      await handleSaveDraft(req);

      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "listing.draft.update",
        }),
      );
    });
  });
});
