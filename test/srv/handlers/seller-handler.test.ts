/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "test-listing-uuid");

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        CertifiedField: "CertifiedField",
        ApiCachedData: "ApiCachedData",
        AuditTrailEntry: "AuditTrailEntry",
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

const mockLookup = jest.fn();
const mockGetEmissions = jest.fn();
const mockGetRecalls = jest.fn();
const mockCalculate = jest.fn();
const mockDecode = jest.fn();

jest.mock("../../../srv/adapters/factory/adapter-factory", () => ({
  getVehicleLookup: () => ({
    providerName: "mock",
    providerVersion: "1.0.0",
    lookup: (...args: any[]) => mockLookup(...args),
  }),
  getEmission: () => ({
    providerName: "ademe",
    providerVersion: "1.0.0",
    getEmissions: (...args: any[]) => mockGetEmissions(...args),
  }),
  getRecall: () => ({
    providerName: "rappelconso",
    providerVersion: "1.0.0",
    getRecalls: (...args: any[]) => mockGetRecalls(...args),
  }),
  getCritAir: () => ({
    providerName: "local.critair",
    providerVersion: "1.0.0",
    calculate: (...args: any[]) => mockCalculate(...args),
  }),
  getVINTechnical: () => ({
    providerName: "nhtsa",
    providerVersion: "1.0.0",
    decode: (...args: any[]) => mockDecode(...args),
  }),
}));

const mockMarkFieldCertified = jest.fn().mockResolvedValue({ ID: "cert-1" });
jest.mock("../../../srv/lib/certification", () => ({
  markFieldCertified: (...args: any[]) => mockMarkFieldCertified(...args),
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

// Global CDS query helpers
(global as any).SELECT = {
  one: { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }) },
  from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }),
};
(global as any).INSERT = {
  into: jest.fn().mockReturnValue({ entries: jest.fn().mockReturnValue("q") }),
};
(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }),
});

// ─── Import the handler ──────────────────────────────────────────────────────

const SellerServiceHandler = require("../../../srv/seller-service").default;

// ─── Mock Request Builder ────────────────────────────────────────────────────

function createMockRequest(data: Record<string, any>): any {
  const errors: any[] = [];
  return {
    data,
    user: { id: "test-user-1" },
    error: jest.fn((status: number, msg: string) => {
      errors.push({ status, msg });
    }),
    _errors: errors,
  };
}

// ─── Mock adapter responses ──────────────────────────────────────────────────

const MOCK_VEHICLE_RESPONSE = {
  plate: "AB-123-CD",
  vin: "VF1RFB00X56789012",
  make: "Renault",
  model: "Clio V",
  variant: "RS Line",
  year: 2022,
  registrationDate: "2022-03-15",
  fuelType: "essence",
  engineCapacityCc: 1333,
  powerKw: 96,
  powerHp: 131,
  gearbox: "EDC",
  bodyType: "berline",
  doors: 5,
  seats: 5,
  color: "Rouge Flamme",
  co2GKm: 128,
  euroNorm: "Euro 6d",
  provider: { providerName: "mock", providerVersion: "1.0.0" },
};

const MOCK_EMISSION_RESPONSE = {
  co2GKm: 128,
  energyClass: "C",
  euroNorm: "Euro 6d",
  fuelType: "essence",
  pollutants: null,
  provider: { providerName: "ademe", providerVersion: "1.0.0" },
};

const MOCK_RECALL_RESPONSE = {
  recalls: [],
  totalCount: 0,
  provider: { providerName: "rappelconso", providerVersion: "1.0.0" },
};

const MOCK_CRITAIR_RESPONSE = {
  level: "1",
  label: "Crit'Air 1",
  color: "violet",
  provider: { providerName: "local.critair", providerVersion: "1.0.0" },
};

const MOCK_VIN_TECHNICAL_RESPONSE = {
  vin: "VF1RFB00X56789012",
  make: "Renault",
  model: "Clio",
  year: 2022,
  bodyClass: "Hatchback",
  driveType: "FWD",
  engineCylinders: 4,
  engineCapacityCc: 1333,
  fuelType: "Gasoline",
  gvwr: null,
  plantCountry: "France",
  manufacturer: "Renault SAS",
  vehicleType: "Passenger Car",
  provider: { providerName: "nhtsa", providerVersion: "1.0.0" },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SellerService - autoFillByPlate", () => {
  let handler: any;
  let handleAutoFill: any;

  beforeAll(() => {
    handler = new SellerServiceHandler();
    // Extract the registered handler function
    const originalOn = handler.on;
    handler.on = (event: string, fn: any) => {
      if (event === "autoFillByPlate") {
        handleAutoFill = fn;
      }
    };
    handler.init();
    handler.on = originalOn;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCachedResponse.mockResolvedValue(null);
    mockSetCachedResponse.mockResolvedValue(undefined);
    mockMarkFieldCertified.mockResolvedValue({ ID: "cert-1" });
    mockLogAudit.mockResolvedValue(undefined);
    mockRun.mockResolvedValue(undefined);
  });

  describe("input validation", () => {
    it("should reject invalid plate format", async () => {
      const req = createMockRequest({
        identifier: "INVALID",
        identifierType: "plate",
      });
      await handleAutoFill(req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("Invalid plate format"));
    });

    it("should reject invalid VIN format", async () => {
      const req = createMockRequest({
        identifier: "SHORT",
        identifierType: "vin",
      });
      await handleAutoFill(req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("Invalid VIN format"));
    });

    it("should reject VIN containing I, O, or Q", async () => {
      const req = createMockRequest({
        identifier: "VF1RFB00I56789012", // contains 'I'
        identifierType: "vin",
      });
      await handleAutoFill(req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("Invalid VIN format"));
    });

    it("should reject invalid identifierType", async () => {
      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "invalid",
      });
      await handleAutoFill(req);
      expect(req.error).toHaveBeenCalledWith(
        400,
        expect.stringContaining("Invalid identifierType"),
      );
    });

    it("should accept valid plate format", async () => {
      mockLookup.mockResolvedValue(MOCK_VEHICLE_RESPONSE);
      mockGetEmissions.mockResolvedValue(MOCK_EMISSION_RESPONSE);
      mockGetRecalls.mockResolvedValue(MOCK_RECALL_RESPONSE);
      mockCalculate.mockResolvedValue(MOCK_CRITAIR_RESPONSE);
      mockDecode.mockResolvedValue(MOCK_VIN_TECHNICAL_RESPONSE);

      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      const result = await handleAutoFill(req);
      expect(req.error).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should accept valid VIN format", async () => {
      mockLookup.mockResolvedValue(MOCK_VEHICLE_RESPONSE);
      mockGetEmissions.mockResolvedValue(MOCK_EMISSION_RESPONSE);
      mockGetRecalls.mockResolvedValue(MOCK_RECALL_RESPONSE);
      mockCalculate.mockResolvedValue(MOCK_CRITAIR_RESPONSE);
      mockDecode.mockResolvedValue(MOCK_VIN_TECHNICAL_RESPONSE);

      const req = createMockRequest({
        identifier: "VF1RFB00X56789012",
        identifierType: "vin",
      });
      const result = await handleAutoFill(req);
      expect(req.error).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe("successful auto-fill", () => {
    beforeEach(() => {
      mockLookup.mockResolvedValue(MOCK_VEHICLE_RESPONSE);
      mockGetEmissions.mockResolvedValue(MOCK_EMISSION_RESPONSE);
      mockGetRecalls.mockResolvedValue(MOCK_RECALL_RESPONSE);
      mockCalculate.mockResolvedValue(MOCK_CRITAIR_RESPONSE);
      mockDecode.mockResolvedValue(MOCK_VIN_TECHNICAL_RESPONSE);
    });

    it("should return fields and sources as JSON strings", async () => {
      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      const result = await handleAutoFill(req);

      expect(result).toHaveProperty("fields");
      expect(result).toHaveProperty("sources");
      const fields = JSON.parse(result.fields);
      const sources = JSON.parse(result.sources);
      expect(Array.isArray(fields)).toBe(true);
      expect(Array.isArray(sources)).toBe(true);
    });

    it("should extract vehicle lookup fields", async () => {
      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      const result = await handleAutoFill(req);
      const fields = JSON.parse(result.fields);

      const makeField = fields.find((f: any) => f.fieldName === "make");
      expect(makeField).toBeDefined();
      expect(makeField.fieldValue).toBe("Renault");
      expect(makeField.isCertified).toBe(true);
    });

    it("should extract emission fields", async () => {
      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      const result = await handleAutoFill(req);
      const fields = JSON.parse(result.fields);

      const energyClass = fields.find((f: any) => f.fieldName === "energyClass");
      expect(energyClass).toBeDefined();
      expect(energyClass.fieldValue).toBe("C");
    });

    it("should extract critair fields", async () => {
      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      const result = await handleAutoFill(req);
      const fields = JSON.parse(result.fields);

      const critAir = fields.find((f: any) => f.fieldName === "critAirLevel");
      expect(critAir).toBeDefined();
      expect(critAir.fieldValue).toBe("1");
    });

    it("should extract VIN technical fields", async () => {
      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      const result = await handleAutoFill(req);
      const fields = JSON.parse(result.fields);

      const bodyClass = fields.find((f: any) => f.fieldName === "bodyClass");
      expect(bodyClass).toBeDefined();
      expect(bodyClass.fieldValue).toBe("Hatchback");
    });

    it("should call all 5 adapter interfaces", async () => {
      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      const result = await handleAutoFill(req);
      const sources = JSON.parse(result.sources);

      expect(sources).toHaveLength(5);
      expect(sources.map((s: any) => s.adapterInterface)).toEqual([
        "IVehicleLookupAdapter",
        "IEmissionAdapter",
        "IRecallAdapter",
        "ICritAirCalculator",
        "IVINTechnicalAdapter",
      ]);
    });

    it("should mark all sources as success", async () => {
      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      const result = await handleAutoFill(req);
      const sources = JSON.parse(result.sources);

      expect(sources.every((s: any) => s.status === "success")).toBe(true);
    });

    it("should call markFieldCertified for each field", async () => {
      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      await handleAutoFill(req);

      // Should have called markFieldCertified multiple times (once per extracted field)
      expect(mockMarkFieldCertified.mock.calls.length).toBeGreaterThan(0);
    });

    it("should cache adapter responses via setCachedResponse", async () => {
      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      await handleAutoFill(req);

      // 5 adapters called = 5 cache writes
      expect(mockSetCachedResponse).toHaveBeenCalledTimes(5);
    });

    it("should call logAudit with correct data", async () => {
      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      await handleAutoFill(req);

      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "test-user-1",
          action: "listing.autofill",
          resource: "Vehicle",
        }),
      );
    });
  });

  describe("partial failure handling", () => {
    it("should handle VehicleLookup failure gracefully", async () => {
      mockLookup.mockRejectedValue(new Error("API unavailable"));
      mockGetEmissions.mockResolvedValue(MOCK_EMISSION_RESPONSE);
      mockGetRecalls.mockResolvedValue(MOCK_RECALL_RESPONSE);
      mockCalculate.mockResolvedValue(MOCK_CRITAIR_RESPONSE);
      mockDecode.mockResolvedValue(MOCK_VIN_TECHNICAL_RESPONSE);

      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      const result = await handleAutoFill(req);
      const sources = JSON.parse(result.sources);

      const vehicleSource = sources.find(
        (s: any) => s.adapterInterface === "IVehicleLookupAdapter",
      );
      expect(vehicleSource.status).toBe("failed");
      expect(vehicleSource.errorMessage).toBe("API unavailable");
    });

    it("should handle emission adapter failure gracefully", async () => {
      mockLookup.mockResolvedValue(MOCK_VEHICLE_RESPONSE);
      mockGetEmissions.mockRejectedValue(new Error("ADEME down"));
      mockGetRecalls.mockResolvedValue(MOCK_RECALL_RESPONSE);
      mockCalculate.mockResolvedValue(MOCK_CRITAIR_RESPONSE);
      mockDecode.mockResolvedValue(MOCK_VIN_TECHNICAL_RESPONSE);

      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      const result = await handleAutoFill(req);
      const sources = JSON.parse(result.sources);

      const emissionSource = sources.find((s: any) => s.adapterInterface === "IEmissionAdapter");
      expect(emissionSource.status).toBe("failed");

      // Other sources should still succeed
      const successSources = sources.filter((s: any) => s.status === "success");
      expect(successSources.length).toBeGreaterThanOrEqual(3);
    });

    it("should still return results even if all secondary adapters fail", async () => {
      mockLookup.mockResolvedValue(MOCK_VEHICLE_RESPONSE);
      mockGetEmissions.mockRejectedValue(new Error("fail"));
      mockGetRecalls.mockRejectedValue(new Error("fail"));
      mockCalculate.mockRejectedValue(new Error("fail"));
      mockDecode.mockRejectedValue(new Error("fail"));

      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      const result = await handleAutoFill(req);
      const fields = JSON.parse(result.fields);
      const sources = JSON.parse(result.sources);

      // Vehicle lookup fields should still be present
      expect(fields.length).toBeGreaterThan(0);
      expect(sources).toHaveLength(5);
    });
  });

  describe("caching", () => {
    it("should use cached response when available", async () => {
      // Return cached vehicle data
      mockGetCachedResponse.mockResolvedValueOnce(MOCK_VEHICLE_RESPONSE);
      // No cache for others
      mockGetCachedResponse.mockResolvedValue(null);
      mockGetEmissions.mockResolvedValue(MOCK_EMISSION_RESPONSE);
      mockGetRecalls.mockResolvedValue(MOCK_RECALL_RESPONSE);
      mockCalculate.mockResolvedValue(MOCK_CRITAIR_RESPONSE);
      mockDecode.mockResolvedValue(MOCK_VIN_TECHNICAL_RESPONSE);

      const req = createMockRequest({
        identifier: "AB-123-CD",
        identifierType: "plate",
      });
      const result = await handleAutoFill(req);
      const sources = JSON.parse(result.sources);

      const vehicleSource = sources.find(
        (s: any) => s.adapterInterface === "IVehicleLookupAdapter",
      );
      expect(vehicleSource.status).toBe("cached");

      // Vehicle lookup should NOT have been called
      expect(mockLookup).not.toHaveBeenCalled();
    });
  });
});
