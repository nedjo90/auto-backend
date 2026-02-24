/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
export {};

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "uuid-1");
const mockIsCallAllowed = jest.fn();
const mockWithResilience = jest.fn();
const mockSetCachedResponse = jest.fn();
const mockMarkFieldCertified = jest.fn();
const mockCalculateVisibilityScore = jest.fn();
const mockAuditLog = jest.fn();
const mockGetVehicleLookup = jest.fn();
const mockGetEmission = jest.fn();
const mockGetRecall = jest.fn();
const mockGetCritAir = jest.fn();
const mockGetVINTechnical = jest.fn();

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        Listing: "Listing",
        CertifiedField: "CertifiedField",
        ListingPhoto: "ListingPhoto",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => mockUuid() },
    },
  };
});

jest.mock("../../../srv/lib/circuit-breaker", () => ({
  isCallAllowed: (...args: any[]) => mockIsCallAllowed(...args),
  recordSuccess: jest.fn(),
  recordFailure: jest.fn(),
}));

jest.mock("../../../srv/lib/adapter-resilience", () => ({
  withResilience: (...args: any[]) => mockWithResilience(...args),
  classifyError: jest.fn(() => "response"),
}));

jest.mock("../../../srv/lib/api-cache", () => ({
  setCachedResponse: (...args: any[]) => mockSetCachedResponse(...args),
  getCachedResponse: jest.fn(),
  getCachedResponseWithStatus: jest.fn(),
}));

jest.mock("../../../srv/lib/certification", () => ({
  markFieldCertified: (...args: any[]) => mockMarkFieldCertified(...args),
}));

jest.mock("../../../srv/lib/visibility-score", () => ({
  calculateVisibilityScore: (...args: any[]) => mockCalculateVisibilityScore(...args),
}));

jest.mock("../../../srv/middleware/audit-trail", () => ({
  auditLog: (...args: any[]) => mockAuditLog(...args),
}));

jest.mock("../../../srv/adapters/factory/adapter-factory", () => ({
  getVehicleLookup: () => mockGetVehicleLookup(),
  getEmission: () => mockGetEmission(),
  getRecall: () => mockGetRecall(),
  getCritAir: () => mockGetCritAir(),
  getVINTechnical: () => mockGetVINTechnical(),
}));

(global as any).SELECT = {
  one: { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("select-one") }) },
  from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("select-query") }),
};
(global as any).INSERT = {
  into: jest.fn().mockReturnValue({ entries: jest.fn().mockReturnValue("insert") }),
};
(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("update") }),
});

const LISTING_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const SELLER_ID = "11111111-2222-3333-4444-555555555555";

const {
  handleCheckResyncAvailability,
  handleResyncListing,
} = require("../../../srv/handlers/resync-handler");

function makeReq(data: any, userId: string = SELLER_ID) {
  return {
    data,
    user: { id: userId },
    error: jest.fn((code: number, msg: string) => {
      const err = new Error(msg);
      (err as any).code = code;
      throw err;
    }),
  };
}

describe("resync-handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsCallAllowed.mockReturnValue(true);
    mockAuditLog.mockResolvedValue(undefined);
    mockSetCachedResponse.mockResolvedValue(undefined);
    mockMarkFieldCertified.mockResolvedValue(undefined);
    mockCalculateVisibilityScore.mockResolvedValue({ score: 75 });
  });

  describe("handleCheckResyncAvailability", () => {
    it("should return available adapters for declared fields", async () => {
      // SELECT listing
      mockRun.mockResolvedValueOnce({
        ID: LISTING_ID,
        sellerId: SELLER_ID,
      });
      // SELECT certified fields
      mockRun.mockResolvedValueOnce([
        { fieldName: "co2GKm", isCertified: false },
        { fieldName: "energyClass", isCertified: false },
        { fieldName: "make", isCertified: true },
      ]);

      const req = makeReq({ listingId: LISTING_ID });
      const result = await handleCheckResyncAvailability(req);

      expect(result.hasResyncableFields).toBe(true);
      const adapters = JSON.parse(result.availableAdapters);
      expect(adapters.length).toBeGreaterThan(0);
      // IEmissionAdapter should be in the list
      const emissionAdapter = adapters.find((a: any) => a.adapterInterface === "IEmissionAdapter");
      expect(emissionAdapter).toBeDefined();
      expect(emissionAdapter.isAvailable).toBe(true);
      expect(emissionAdapter.certifiableFields).toContain("co2GKm");
    });

    it("should reject unauthenticated requests", async () => {
      const req = makeReq({ listingId: LISTING_ID }, "");
      (req as any).user = {};
      await expect(handleCheckResyncAvailability(req)).rejects.toThrow("Authentication required");
    });

    it("should reject invalid listing ID", async () => {
      const req = makeReq({ listingId: "not-a-uuid" });
      await expect(handleCheckResyncAvailability(req)).rejects.toThrow("invalide");
    });

    it("should report unavailable adapters when circuit is open", async () => {
      mockIsCallAllowed.mockReturnValue(false);
      mockRun.mockResolvedValueOnce({
        ID: LISTING_ID,
        sellerId: SELLER_ID,
      });
      mockRun.mockResolvedValueOnce([{ fieldName: "co2GKm", isCertified: false }]);

      const req = makeReq({ listingId: LISTING_ID });
      const result = await handleCheckResyncAvailability(req);

      const adapters = JSON.parse(result.availableAdapters);
      const emissionAdapter = adapters.find((a: any) => a.adapterInterface === "IEmissionAdapter");
      expect(emissionAdapter.isAvailable).toBe(false);
    });
  });

  describe("handleResyncListing", () => {
    it("should re-sync fields from a successful adapter call", async () => {
      // SELECT listing
      mockRun.mockResolvedValueOnce({
        ID: LISTING_ID,
        sellerId: SELLER_ID,
        plate: "AB-123-CD",
        vin: "VF1RFB00X56789012",
        make: "Renault",
        model: "Clio",
      });

      // withResilience returns emission data
      mockWithResilience.mockImplementation(async () => {
        return {
          co2GKm: 128,
          energyClass: "A",
          euroNorm: "Euro 6d",
          provider: { providerName: "ADEME" },
        };
      });

      // markFieldCertified calls
      mockMarkFieldCertified.mockResolvedValue(undefined);
      // UPDATE listing fields
      mockRun.mockResolvedValue(1);
      // SELECT updated listing for score
      mockRun.mockResolvedValue({ ID: LISTING_ID });
      // SELECT certified fields for score
      mockRun.mockResolvedValue([]);
      // SELECT photos for score
      mockRun.mockResolvedValue([]);

      const req = makeReq({
        listingId: LISTING_ID,
        adapterNames: JSON.stringify(["IEmissionAdapter"]),
      });

      const result = await handleResyncListing(req);
      expect(result.success).toBe(true);
      expect(result.listingId).toBe(LISTING_ID);
    });

    it("should reject invalid adapter names JSON", async () => {
      mockRun.mockResolvedValueOnce({
        ID: LISTING_ID,
        sellerId: SELLER_ID,
        plate: "AB-123-CD",
      });

      const req = makeReq({
        listingId: LISTING_ID,
        adapterNames: "not-json",
      });

      await expect(handleResyncListing(req)).rejects.toThrow("invalide");
    });

    it("should report failed adapters", async () => {
      mockRun.mockResolvedValueOnce({
        ID: LISTING_ID,
        sellerId: SELLER_ID,
        plate: "AB-123-CD",
      });

      mockWithResilience.mockRejectedValue(new Error("Timeout"));
      mockRun.mockResolvedValue(undefined);

      const req = makeReq({
        listingId: LISTING_ID,
        adapterNames: JSON.stringify(["IEmissionAdapter"]),
      });

      const result = await handleResyncListing(req);
      const failedAdapters = JSON.parse(result.failedAdapters);
      expect(failedAdapters).toContain("IEmissionAdapter");
    });

    it("should reject unauthorized access", async () => {
      mockRun.mockResolvedValueOnce({
        ID: LISTING_ID,
        sellerId: "other-user-id",
      });

      const req = makeReq({
        listingId: LISTING_ID,
        adapterNames: JSON.stringify(["IEmissionAdapter"]),
      });

      await expect(handleResyncListing(req)).rejects.toThrow("autorise");
    });
  });
});
