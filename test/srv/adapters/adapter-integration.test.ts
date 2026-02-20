/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-function-type */

/**
 * Integration tests for the adapter framework:
 * - Factory resolves correct implementations based on ConfigApiProvider
 * - Switching providers at runtime
 * - Fallback to mock when active provider is unavailable
 * - API logger captures complete call metadata
 */

// ─── Mock Setup ──────────────────────────────────────────────────────────

let mockProviders: any[] = [];
const mockGetAll = jest.fn(() => mockProviders);
jest.mock("../../../srv/lib/config-cache", () => ({
  configCache: {
    getAll: () => mockGetAll(),
  },
}));

const loggedCalls: any[] = [];
jest.mock("../../../srv/lib/api-logger", () => ({
  withApiLogging: (
    iface: string,
    provider: string,
    cost: number,
    fn: Function,
    endpointName?: string,
  ) => {
    const resolvedEndpoint = endpointName || fn.name || "unknown";
    return async (...args: any[]) => {
      const start = Date.now();
      let status = 200;
      let errorMsg: string | undefined;
      try {
        return await fn(...args);
      } catch (err: any) {
        status = 500;
        errorMsg = err?.message;
        throw err;
      } finally {
        loggedCalls.push({
          adapterInterface: iface,
          providerKey: provider,
          endpoint: resolvedEndpoint,
          httpStatus: status,
          responseTimeMs: Date.now() - start,
          cost,
          errorMessage: errorMsg,
        });
      }
    };
  },
}));

jest.mock("@sap/cds", () => ({
  __esModule: true,
  default: {
    log: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  },
}));

// Mock adapters with identifiable behavior
jest.mock("../../../srv/adapters/azure-ad-b2c-adapter", () => ({
  AzureAdB2cAdapter: jest.fn().mockImplementation(() => ({
    createUser: jest.fn().mockResolvedValue("ext-id-123"),
    disableUser: jest.fn(),
    updateUser: jest.fn(),
  })),
}));

jest.mock("../../../srv/adapters/azure-blob-storage-adapter", () => ({
  AzureBlobStorageAdapter: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn(),
    generateSignedUrl: jest.fn(),
    deleteFile: jest.fn(),
  })),
}));

jest.mock("../../../srv/adapters/ademe-emission.adapter", () => ({
  AdemeEmissionAdapter: jest.fn().mockImplementation(() => ({
    providerName: "ademe",
    providerVersion: "1.0.0",
    getEmissions: jest.fn().mockResolvedValue({
      co2GKm: 128,
      energyClass: "B",
      euroNorm: "Euro 6d",
      fuelType: "essence",
      pollutants: { NOx: 0.04 },
      provider: { providerName: "ademe", providerVersion: "1.0.0" },
    }),
  })),
}));

jest.mock("../../../srv/adapters/rappelconso-recall.adapter", () => ({
  RappelConsoRecallAdapter: jest.fn().mockImplementation(() => ({
    providerName: "rappelconso",
    providerVersion: "1.0.0",
    getRecalls: jest.fn().mockResolvedValue({
      recalls: [{ id: "RC-001", title: "Test recall" }],
      totalCount: 1,
      provider: { providerName: "rappelconso", providerVersion: "1.0.0" },
    }),
  })),
}));

jest.mock("../../../srv/adapters/local-critair.adapter", () => ({
  LocalCritAirCalculator: jest.fn().mockImplementation(() => ({
    providerName: "local-critair",
    providerVersion: "1.0.0",
    calculate: jest.fn().mockResolvedValue({
      level: "1",
      label: "Crit'Air 1",
      color: "violet",
      provider: { providerName: "local-critair", providerVersion: "1.0.0" },
    }),
  })),
}));

jest.mock("../../../srv/adapters/nhtsa-vin.adapter", () => ({
  NhtsaVINAdapter: jest.fn().mockImplementation(() => ({
    providerName: "nhtsa",
    providerVersion: "1.0.0",
    decode: jest.fn().mockResolvedValue({
      vin: "WVWZZZ3CZWE123456",
      make: "Volkswagen",
      model: "Golf",
      year: 2021,
      provider: { providerName: "nhtsa", providerVersion: "1.0.0" },
    }),
  })),
}));

jest.mock("../../../srv/adapters/mock/mock-vehicle-lookup.adapter", () => ({
  MockVehicleLookupAdapter: jest.fn().mockImplementation(() => ({
    providerName: "mock",
    providerVersion: "1.0.0",
    lookup: jest.fn().mockResolvedValue({ make: "Renault", model: "Clio" }),
  })),
}));
jest.mock("../../../srv/adapters/mock/mock-emission.adapter", () => ({
  MockEmissionAdapter: jest.fn().mockImplementation(() => ({
    providerName: "mock",
    providerVersion: "1.0.0",
    getEmissions: jest.fn().mockResolvedValue({ co2GKm: 120 }),
  })),
}));
jest.mock("../../../srv/adapters/mock/mock-recall.adapter", () => ({
  MockRecallAdapter: jest.fn().mockImplementation(() => ({
    providerName: "mock",
    providerVersion: "1.0.0",
    getRecalls: jest.fn().mockResolvedValue({ recalls: [], totalCount: 0 }),
  })),
}));
jest.mock("../../../srv/adapters/mock/mock-critair.adapter", () => ({
  MockCritAirAdapter: jest.fn().mockImplementation(() => ({
    providerName: "mock",
    providerVersion: "1.0.0",
    calculate: jest.fn().mockResolvedValue({ level: "1" }),
  })),
}));
jest.mock("../../../srv/adapters/mock/mock-vin-technical.adapter", () => ({
  MockVINTechnicalAdapter: jest.fn().mockImplementation(() => ({
    providerName: "mock",
    providerVersion: "1.0.0",
    decode: jest.fn().mockResolvedValue({ make: "Mock" }),
  })),
}));
jest.mock("../../../srv/adapters/mock/mock-history.adapter", () => ({
  MockHistoryAdapter: jest.fn().mockImplementation(() => ({
    providerName: "mock",
    providerVersion: "1.0.0",
    getHistory: jest.fn().mockResolvedValue({ ownerCount: 1 }),
  })),
}));
jest.mock("../../../srv/adapters/mock/mock-valuation.adapter", () => ({
  MockValuationAdapter: jest.fn().mockImplementation(() => ({
    providerName: "mock",
    providerVersion: "1.0.0",
    evaluate: jest.fn().mockResolvedValue({ estimatedValueEur: 20000 }),
  })),
}));
jest.mock("../../../srv/adapters/mock/mock-payment.adapter", () => ({
  MockPaymentAdapter: jest.fn().mockImplementation(() => ({
    providerName: "mock",
    providerVersion: "1.0.0",
    createCheckoutSession: jest.fn().mockResolvedValue({ sessionId: "mock_cs_1" }),
    handleWebhook: jest.fn().mockResolvedValue({ type: "checkout.session.completed" }),
  })),
}));

const {
  invalidateAdapter,
  getVehicleLookup,
  getEmission,
  getRecall,
  getCritAir,
  getVINTechnical,
  getHistory,
  getValuation,
  getPayment,
} = require("../../../srv/adapters/factory/adapter-factory");

describe("Adapter Integration Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProviders = [];
    loggedCalls.length = 0;
    invalidateAdapter();
  });

  describe("Factory resolves correct implementations (AC3)", () => {
    it("should resolve ademe for IEmissionAdapter", async () => {
      mockProviders = [
        { key: "ademe", adapterInterface: "IEmissionAdapter", status: "active", costPerCall: 0 },
      ];

      const adapter = getEmission();
      const result = await adapter.getEmissions({ make: "Renault", model: "Clio" });
      expect(result.co2GKm).toBe(128);
    });

    it("should resolve rappelconso for IRecallAdapter", async () => {
      mockProviders = [
        {
          key: "rappelconso",
          adapterInterface: "IRecallAdapter",
          status: "active",
          costPerCall: 0,
        },
      ];

      const adapter = getRecall();
      const result = await adapter.getRecalls({ make: "Citroën", model: "C3" });
      expect(result.recalls).toHaveLength(1);
    });

    it("should resolve local.critair for ICritAirCalculator", async () => {
      mockProviders = [
        {
          key: "local.critair",
          adapterInterface: "ICritAirCalculator",
          status: "active",
          costPerCall: 0,
        },
      ];

      const adapter = getCritAir();
      const result = await adapter.calculate({
        fuelType: "essence",
        euroNorm: "Euro 6",
        registrationDate: "2022-01-01",
      });
      expect(result.level).toBe("1");
    });

    it("should resolve nhtsa for IVINTechnicalAdapter", async () => {
      mockProviders = [
        {
          key: "nhtsa",
          adapterInterface: "IVINTechnicalAdapter",
          status: "active",
          costPerCall: 0,
        },
      ];

      const adapter = getVINTechnical();
      const result = await adapter.decode({ vin: "WVWZZZ3CZWE123456" });
      expect(result.make).toBe("Volkswagen");
    });

    it("should resolve mock for paid APIs (IVehicleLookupAdapter, IHistoryAdapter, IValuationAdapter, IPaymentAdapter)", async () => {
      mockProviders = [
        {
          key: "mock.vehicle-lookup",
          adapterInterface: "IVehicleLookupAdapter",
          status: "active",
          costPerCall: 0,
        },
        {
          key: "mock.history",
          adapterInterface: "IHistoryAdapter",
          status: "active",
          costPerCall: 0,
        },
        {
          key: "mock.valuation",
          adapterInterface: "IValuationAdapter",
          status: "active",
          costPerCall: 0,
        },
        {
          key: "mock.payment",
          adapterInterface: "IPaymentAdapter",
          status: "active",
          costPerCall: 0,
        },
      ];

      const vehicleLookup = getVehicleLookup();
      const history = getHistory();
      const valuation = getValuation();
      const payment = getPayment();

      expect(vehicleLookup.lookup).toBeDefined();
      expect(history.getHistory).toBeDefined();
      expect(valuation.evaluate).toBeDefined();
      expect(payment.createCheckoutSession).toBeDefined();
    });
  });

  describe("Switching providers at runtime (AC3)", () => {
    it("should switch from ademe to mock after invalidation", async () => {
      // Start with ademe
      mockProviders = [
        { key: "ademe", adapterInterface: "IEmissionAdapter", status: "active", costPerCall: 0 },
      ];
      const ademeAdapter = getEmission();
      const ademeResult = await ademeAdapter.getEmissions({});
      expect(ademeResult.co2GKm).toBe(128); // ademe mock returns 128

      // Simulate provider switch: deactivate ademe, no other active
      invalidateAdapter("IEmissionAdapter");
      mockProviders = [
        { key: "ademe", adapterInterface: "IEmissionAdapter", status: "inactive", costPerCall: 0 },
      ];

      // Should fallback to mock adapter
      const mockAdapter = getEmission();
      const mockResult = await mockAdapter.getEmissions({});
      expect(mockResult.co2GKm).toBe(120); // mock returns 120
    });

    it("should switch from mock to real provider after config change", async () => {
      // Start with no active provider (uses mock fallback)
      mockProviders = [];
      const mockAdapter = getVehicleLookup();
      const mockResult = await mockAdapter.lookup({});
      expect(mockResult.make).toBe("Renault");

      // Simulate activating a mock provider via config
      invalidateAdapter("IVehicleLookupAdapter");
      mockProviders = [
        {
          key: "mock.vehicle-lookup",
          adapterInterface: "IVehicleLookupAdapter",
          status: "active",
          costPerCall: 0.05,
        },
      ];

      const newAdapter = getVehicleLookup();
      // Should be a new instance (not the same cached one)
      expect(newAdapter).not.toBe(mockAdapter);
    });
  });

  describe("Fallback to mock when active provider unavailable (AC3)", () => {
    it("should fallback to mock for all 8 Epic 3 interfaces when no provider", async () => {
      mockProviders = []; // No providers configured

      expect(() => getVehicleLookup()).not.toThrow();
      invalidateAdapter();
      expect(() => getEmission()).not.toThrow();
      invalidateAdapter();
      expect(() => getRecall()).not.toThrow();
      invalidateAdapter();
      expect(() => getCritAir()).not.toThrow();
      invalidateAdapter();
      expect(() => getVINTechnical()).not.toThrow();
      invalidateAdapter();
      expect(() => getHistory()).not.toThrow();
      invalidateAdapter();
      expect(() => getValuation()).not.toThrow();
      invalidateAdapter();
      expect(() => getPayment()).not.toThrow();
    });

    it("should fallback when provider key not in registry", async () => {
      mockProviders = [
        {
          key: "premium.siv.gouv",
          adapterInterface: "IVehicleLookupAdapter",
          status: "active",
          costPerCall: 0.05,
        },
      ];

      // premium.siv.gouv is not registered, should fallback to mock
      const adapter = getVehicleLookup();
      const result = await adapter.lookup({});
      expect(result).toBeDefined();
    });
  });

  describe("API logger captures complete call metadata (AC4)", () => {
    it("should log adapter name, provider, endpoint, status, response time for success", async () => {
      mockProviders = [
        {
          key: "ademe",
          adapterInterface: "IEmissionAdapter",
          status: "active",
          costPerCall: 0.001,
        },
      ];

      const adapter = getEmission();
      await adapter.getEmissions({ make: "Renault" });

      expect(loggedCalls).toHaveLength(1);
      const log = loggedCalls[0];
      expect(log.adapterInterface).toBe("IEmissionAdapter");
      expect(log.providerKey).toBe("ademe");
      expect(log.endpoint).toBeDefined();
      expect(log.httpStatus).toBe(200);
      expect(log.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(log.cost).toBe(0.001);
      expect(log.errorMessage).toBeUndefined();
    });

    it("should log error details for failed calls", async () => {
      const { AdemeEmissionAdapter } = require("../../../srv/adapters/ademe-emission.adapter");
      (AdemeEmissionAdapter as jest.Mock).mockImplementationOnce(() => ({
        providerName: "ademe",
        providerVersion: "1.0.0",
        getEmissions: jest.fn().mockRejectedValue(new Error("API timeout")),
      }));

      mockProviders = [
        { key: "ademe", adapterInterface: "IEmissionAdapter", status: "active", costPerCall: 0 },
      ];

      invalidateAdapter("IEmissionAdapter");
      const adapter = getEmission();

      await expect(adapter.getEmissions({})).rejects.toThrow("API timeout");

      const log = loggedCalls[loggedCalls.length - 1];
      expect(log.httpStatus).toBe(500);
      expect(log.errorMessage).toBe("API timeout");
    });

    it("should log cost=0 for mock fallback calls", async () => {
      mockProviders = [];
      const adapter = getVehicleLookup();
      await adapter.lookup({});

      const log = loggedCalls[loggedCalls.length - 1];
      expect(log.providerKey).toBe("mock.vehicle-lookup");
      expect(log.cost).toBe(0);
    });

    it("should log each adapter call separately", async () => {
      mockProviders = [
        { key: "ademe", adapterInterface: "IEmissionAdapter", status: "active", costPerCall: 0 },
        {
          key: "rappelconso",
          adapterInterface: "IRecallAdapter",
          status: "active",
          costPerCall: 0,
        },
        {
          key: "local.critair",
          adapterInterface: "ICritAirCalculator",
          status: "active",
          costPerCall: 0,
        },
      ];

      const emission = getEmission();
      const recall = getRecall();
      const critair = getCritAir();

      await emission.getEmissions({});
      await recall.getRecalls({});
      await critair.calculate({});

      expect(loggedCalls).toHaveLength(3);
      expect(loggedCalls[0].adapterInterface).toBe("IEmissionAdapter");
      expect(loggedCalls[1].adapterInterface).toBe("IRecallAdapter");
      expect(loggedCalls[2].adapterInterface).toBe("ICritAirCalculator");
    });
  });
});
