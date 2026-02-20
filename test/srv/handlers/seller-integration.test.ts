/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Integration Tests for Auto-Fill Flow ─────────────────────────────────

const mockRun = jest.fn();
const mockIntegrationUuid = jest.fn(() => "integration-uuid");

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
      utils: { uuid: () => mockIntegrationUuid() },
      ApplicationService: class {
        async init() {}
        on(_event: string, _handler: any) {}
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

const SellerServiceHandler = require("../../../srv/seller-service").default;

function createMockRequest(data: Record<string, any>): any {
  return {
    data,
    user: { id: "test-user-1" },
    error: jest.fn(),
  };
}

const MOCK_VEHICLE = {
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

describe("Auto-Fill Integration Tests", () => {
  let handleAutoFill: any;

  beforeAll(() => {
    const handler = new SellerServiceHandler();
    handler.on = (event: string, fn: any) => {
      if (event === "autoFillByPlate") handleAutoFill = fn;
    };
    handler.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCachedResponse.mockResolvedValue(null);
    mockSetCachedResponse.mockResolvedValue(undefined);
    mockMarkFieldCertified.mockResolvedValue({ ID: "cert-1" });
    mockLogAudit.mockResolvedValue(undefined);
    mockRun.mockResolvedValue(undefined);
  });

  it("should complete full auto-fill flow: plate -> all adapters -> certified fields created", async () => {
    mockLookup.mockResolvedValue(MOCK_VEHICLE);
    mockGetEmissions.mockResolvedValue({
      co2GKm: 128,
      energyClass: "C",
      euroNorm: "Euro 6d",
      fuelType: "essence",
      pollutants: null,
      provider: { providerName: "ademe", providerVersion: "1.0.0" },
    });
    mockGetRecalls.mockResolvedValue({
      recalls: [],
      totalCount: 0,
      provider: { providerName: "rappelconso", providerVersion: "1.0.0" },
    });
    mockCalculate.mockResolvedValue({
      level: "1",
      label: "Crit'Air 1",
      color: "violet",
      provider: { providerName: "local.critair", providerVersion: "1.0.0" },
    });
    mockDecode.mockResolvedValue({
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
    });

    const req = createMockRequest({
      identifier: "AB-123-CD",
      identifierType: "plate",
    });

    const result = await handleAutoFill(req);
    const fields = JSON.parse(result.fields);
    const sources = JSON.parse(result.sources);

    // All 5 adapters should be called
    expect(sources).toHaveLength(5);
    expect(sources.every((s: any) => s.status === "success")).toBe(true);

    // Vehicle lookup fields
    expect(fields.find((f: any) => f.fieldName === "make")?.fieldValue).toBe("Renault");
    expect(fields.find((f: any) => f.fieldName === "model")?.fieldValue).toBe("Clio V");
    expect(fields.find((f: any) => f.fieldName === "year")?.fieldValue).toBe("2022");

    // Emission fields
    expect(fields.find((f: any) => f.fieldName === "energyClass")?.fieldValue).toBe("C");

    // CritAir fields
    expect(fields.find((f: any) => f.fieldName === "critAirLevel")?.fieldValue).toBe("1");

    // VIN technical fields
    expect(fields.find((f: any) => f.fieldName === "bodyClass")?.fieldValue).toBe("Hatchback");
    expect(fields.find((f: any) => f.fieldName === "manufacturer")?.fieldValue).toBe("Renault SAS");

    // All fields should be certified
    expect(fields.every((f: any) => f.isCertified === true)).toBe(true);

    // markFieldCertified should have been called for each field
    expect(mockMarkFieldCertified.mock.calls.length).toBe(fields.length);

    // Cache should have been written for each adapter
    expect(mockSetCachedResponse).toHaveBeenCalledTimes(5);

    // Audit log should have been called
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
  });

  it("should handle parallel adapter execution with partial failures", async () => {
    mockLookup.mockResolvedValue(MOCK_VEHICLE);
    mockGetEmissions.mockRejectedValue(new Error("ADEME timeout"));
    mockGetRecalls.mockRejectedValue(new Error("RappelConso down"));
    mockCalculate.mockResolvedValue({
      level: "1",
      label: "Crit'Air 1",
      color: "violet",
      provider: { providerName: "local.critair", providerVersion: "1.0.0" },
    });
    mockDecode.mockRejectedValue(new Error("NHTSA unavailable"));

    const req = createMockRequest({
      identifier: "AB-123-CD",
      identifierType: "plate",
    });

    const result = await handleAutoFill(req);
    const fields = JSON.parse(result.fields);
    const sources = JSON.parse(result.sources);

    // Vehicle lookup + CritAir should succeed
    const successSources = sources.filter((s: any) => s.status === "success");
    expect(successSources).toHaveLength(2);

    // 3 failures
    const failedSources = sources.filter((s: any) => s.status === "failed");
    expect(failedSources).toHaveLength(3);

    // Vehicle and CritAir fields should still be present
    expect(fields.find((f: any) => f.fieldName === "make")).toBeDefined();
    expect(fields.find((f: any) => f.fieldName === "critAirLevel")).toBeDefined();
  });

  it("should use cache hit for second lookup of same vehicle", async () => {
    // First call: return cached vehicle data
    mockGetCachedResponse.mockResolvedValueOnce(MOCK_VEHICLE);
    // Others: no cache
    mockGetCachedResponse.mockResolvedValue(null);
    mockGetEmissions.mockResolvedValue({
      co2GKm: 128,
      energyClass: "C",
      euroNorm: "Euro 6d",
      fuelType: "essence",
      pollutants: null,
      provider: { providerName: "ademe", providerVersion: "1.0.0" },
    });
    mockGetRecalls.mockResolvedValue({
      recalls: [],
      totalCount: 0,
      provider: { providerName: "rappelconso", providerVersion: "1.0.0" },
    });
    mockCalculate.mockResolvedValue({
      level: "1",
      label: "Crit'Air 1",
      color: "violet",
      provider: { providerName: "local.critair", providerVersion: "1.0.0" },
    });
    mockDecode.mockResolvedValue({
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
    });

    const req = createMockRequest({
      identifier: "AB-123-CD",
      identifierType: "plate",
    });

    const result = await handleAutoFill(req);
    const sources = JSON.parse(result.sources);

    // Vehicle lookup should come from cache
    const vehicleSource = sources.find((s: any) => s.adapterInterface === "IVehicleLookupAdapter");
    expect(vehicleSource.status).toBe("cached");

    // Vehicle lookup adapter should NOT have been called
    expect(mockLookup).not.toHaveBeenCalled();

    // Vehicle data should still be used for secondary adapter calls
    expect(mockGetEmissions).toHaveBeenCalled();
  });

  it("should complete auto-fill within reasonable time with mocks (NFR2)", async () => {
    mockLookup.mockResolvedValue(MOCK_VEHICLE);
    mockGetEmissions.mockResolvedValue({
      co2GKm: 128,
      energyClass: "C",
      euroNorm: "Euro 6d",
      fuelType: "essence",
      pollutants: null,
      provider: { providerName: "ademe", providerVersion: "1.0.0" },
    });
    mockGetRecalls.mockResolvedValue({
      recalls: [],
      totalCount: 0,
      provider: { providerName: "rappelconso", providerVersion: "1.0.0" },
    });
    mockCalculate.mockResolvedValue({
      level: "1",
      label: "Crit'Air 1",
      color: "violet",
      provider: { providerName: "local.critair", providerVersion: "1.0.0" },
    });
    mockDecode.mockResolvedValue({
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
    });

    const req = createMockRequest({
      identifier: "AB-123-CD",
      identifierType: "plate",
    });

    const start = Date.now();
    await handleAutoFill(req);
    const elapsed = Date.now() - start;

    // With mocks, should complete well within 3 seconds (NFR2 aspiration)
    expect(elapsed).toBeLessThan(3000);
  });

  it("should handle VIN-based lookup correctly", async () => {
    const vinVehicle = { ...MOCK_VEHICLE };
    mockLookup.mockResolvedValue(vinVehicle);
    mockGetEmissions.mockResolvedValue({
      co2GKm: 128,
      energyClass: "C",
      euroNorm: "Euro 6d",
      fuelType: "essence",
      pollutants: null,
      provider: { providerName: "ademe", providerVersion: "1.0.0" },
    });
    mockGetRecalls.mockResolvedValue({
      recalls: [],
      totalCount: 0,
      provider: { providerName: "rappelconso", providerVersion: "1.0.0" },
    });
    mockCalculate.mockResolvedValue({
      level: "1",
      label: "Crit'Air 1",
      color: "violet",
      provider: { providerName: "local.critair", providerVersion: "1.0.0" },
    });
    mockDecode.mockResolvedValue({
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
    });

    const req = createMockRequest({
      identifier: "VF1RFB00X56789012",
      identifierType: "vin",
    });

    const result = await handleAutoFill(req);
    const fields = JSON.parse(result.fields);

    // Should call vehicle lookup with vin
    expect(mockLookup).toHaveBeenCalledWith({ vin: "VF1RFB00X56789012" });

    // VIN fields should be present
    expect(fields.find((f: any) => f.fieldName === "vin")?.fieldValue).toBe("VF1RFB00X56789012");
  });
});
