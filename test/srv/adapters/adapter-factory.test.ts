/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-function-type */

const mockGetAll = jest.fn();
jest.mock("../../../srv/lib/config-cache", () => ({
  configCache: {
    getAll: (...args: any[]) => mockGetAll(...args),
  },
}));

const mockLogApiCall = jest.fn().mockResolvedValue(undefined);
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
        await mockLogApiCall({
          adapterInterface: iface,
          providerKey: provider,
          endpoint: resolvedEndpoint,
          httpMethod: "POST",
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

jest.mock("../../../srv/adapters/azure-ad-b2c-adapter", () => ({
  AzureAdB2cAdapter: jest.fn().mockImplementation(() => ({
    createUser: jest.fn(),
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

// Mock free API adapters
jest.mock("../../../srv/adapters/ademe-emission.adapter", () => ({
  AdemeEmissionAdapter: jest.fn().mockImplementation(() => ({
    providerName: "ademe",
    providerVersion: "1.0.0",
    getEmissions: jest.fn().mockResolvedValue({ co2GKm: 128 }),
  })),
}));

jest.mock("../../../srv/adapters/rappelconso-recall.adapter", () => ({
  RappelConsoRecallAdapter: jest.fn().mockImplementation(() => ({
    providerName: "rappelconso",
    providerVersion: "1.0.0",
    getRecalls: jest.fn().mockResolvedValue({ recalls: [], totalCount: 0 }),
  })),
}));

jest.mock("../../../srv/adapters/local-critair.adapter", () => ({
  LocalCritAirCalculator: jest.fn().mockImplementation(() => ({
    providerName: "local-critair",
    providerVersion: "1.0.0",
    calculate: jest.fn().mockResolvedValue({ level: "1" }),
  })),
}));

jest.mock("../../../srv/adapters/nhtsa-vin.adapter", () => ({
  NhtsaVINAdapter: jest.fn().mockImplementation(() => ({
    providerName: "nhtsa",
    providerVersion: "1.0.0",
    decode: jest.fn().mockResolvedValue({ make: "Renault" }),
  })),
}));

// Mock all mock adapters
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
  getActiveProvider,
  invalidateAdapter,
  getIdentityProvider,
  getBlobStorage,
  setIdentityProvider,
  setBlobStorage,
  resetIdentityProvider,
  resetBlobStorage,
  getVehicleLookup,
  getEmission,
  getRecall,
  getCritAir,
  getVINTechnical,
  getHistory,
  getValuation,
  getPayment,
} = require("../../../srv/adapters/factory/adapter-factory");

describe("adapter-factory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAll.mockReset();
    invalidateAdapter(); // clear cached instances
  });

  describe("getActiveProvider", () => {
    it("should return active provider for given interface", () => {
      mockGetAll.mockReturnValueOnce([
        { key: "azure.adb2c", adapterInterface: "IIdentityProviderAdapter", status: "active" },
        { key: "other.idp", adapterInterface: "IIdentityProviderAdapter", status: "inactive" },
      ]);
      const result = getActiveProvider("IIdentityProviderAdapter");
      expect(result).toEqual(expect.objectContaining({ key: "azure.adb2c", status: "active" }));
      expect(mockGetAll).toHaveBeenCalledWith("ConfigApiProvider");
    });

    it("should return undefined when no active provider", () => {
      mockGetAll.mockReturnValueOnce([
        { key: "azure.adb2c", adapterInterface: "IIdentityProviderAdapter", status: "inactive" },
      ]);
      const result = getActiveProvider("IIdentityProviderAdapter");
      expect(result).toBeUndefined();
    });

    it("should return undefined when no providers for interface", () => {
      mockGetAll.mockReturnValueOnce([]);
      const result = getActiveProvider("NonExistentAdapter");
      expect(result).toBeUndefined();
    });
  });

  describe("getIdentityProvider", () => {
    it("should resolve and cache identity provider adapter", () => {
      mockGetAll.mockReturnValue([
        { key: "azure.adb2c", adapterInterface: "IIdentityProviderAdapter", status: "active" },
      ]);
      const adapter = getIdentityProvider();
      expect(adapter).toBeDefined();
      expect(adapter.createUser).toBeDefined();

      // Second call should return cached instance
      const adapter2 = getIdentityProvider();
      expect(adapter2).toBe(adapter);
    });

    it("should throw when no active provider configured (no mock fallback for IIdentityProviderAdapter)", () => {
      mockGetAll.mockReturnValue([]);
      expect(() => getIdentityProvider()).toThrow("No active provider found");
    });
  });

  describe("getBlobStorage", () => {
    it("should resolve and cache blob storage adapter", () => {
      mockGetAll.mockReturnValue([
        { key: "azure.blob", adapterInterface: "IBlobStorageAdapter", status: "active" },
      ]);
      const adapter = getBlobStorage();
      expect(adapter).toBeDefined();
      expect(adapter.uploadFile).toBeDefined();
    });

    it("should throw when no active provider configured (no mock fallback for IBlobStorageAdapter)", () => {
      mockGetAll.mockReturnValue([]);
      expect(() => getBlobStorage()).toThrow("No active provider found");
    });
  });

  describe("invalidateAdapter", () => {
    it("should clear specific interface cache", () => {
      mockGetAll.mockReturnValue([
        { key: "azure.adb2c", adapterInterface: "IIdentityProviderAdapter", status: "active" },
      ]);
      const adapter1 = getIdentityProvider();
      invalidateAdapter("IIdentityProviderAdapter");
      const adapter2 = getIdentityProvider();
      expect(adapter2).not.toBe(adapter1);
    });

    it("should clear all caches when no argument", () => {
      mockGetAll.mockReturnValue([
        { key: "azure.adb2c", adapterInterface: "IIdentityProviderAdapter", status: "active" },
        { key: "azure.blob", adapterInterface: "IBlobStorageAdapter", status: "active" },
      ]);
      const idp = getIdentityProvider();
      const blob = getBlobStorage();
      invalidateAdapter();
      const idp2 = getIdentityProvider();
      const blob2 = getBlobStorage();
      expect(idp2).not.toBe(idp);
      expect(blob2).not.toBe(blob);
    });
  });

  describe("setIdentityProvider / setBlobStorage", () => {
    it("should override identity provider with custom adapter", () => {
      const custom = { createUser: jest.fn(), disableUser: jest.fn(), updateUser: jest.fn() };
      setIdentityProvider(custom);
      const result = getIdentityProvider();
      expect(result).toBe(custom);
    });

    it("should override blob storage with custom adapter", () => {
      const custom = { uploadFile: jest.fn(), generateSignedUrl: jest.fn(), deleteFile: jest.fn() };
      setBlobStorage(custom);
      const result = getBlobStorage();
      expect(result).toBe(custom);
    });
  });

  describe("resetIdentityProvider / resetBlobStorage", () => {
    it("should clear identity provider cache", () => {
      const custom = { createUser: jest.fn(), disableUser: jest.fn(), updateUser: jest.fn() };
      setIdentityProvider(custom);
      resetIdentityProvider();
      mockGetAll.mockReturnValue([
        { key: "azure.adb2c", adapterInterface: "IIdentityProviderAdapter", status: "active" },
      ]);
      const result = getIdentityProvider();
      expect(result).not.toBe(custom);
    });

    it("should clear blob storage cache", () => {
      const custom = { uploadFile: jest.fn(), generateSignedUrl: jest.fn(), deleteFile: jest.fn() };
      setBlobStorage(custom);
      resetBlobStorage();
      mockGetAll.mockReturnValue([
        { key: "azure.blob", adapterInterface: "IBlobStorageAdapter", status: "active" },
      ]);
      const result = getBlobStorage();
      expect(result).not.toBe(custom);
    });
  });

  describe("unregistered provider key", () => {
    it("should throw when provider key has no registered adapter and no mock fallback", () => {
      mockGetAll.mockReturnValue([
        { key: "unknown.provider", adapterInterface: "IIdentityProviderAdapter", status: "active" },
      ]);
      expect(() => getIdentityProvider()).toThrow("No active provider found");
    });

    it("should fallback to mock when provider key is unregistered for Epic 3 interfaces", () => {
      mockGetAll.mockReturnValue([
        { key: "unknown.provider", adapterInterface: "IVehicleLookupAdapter", status: "active" },
      ]);
      const adapter = getVehicleLookup();
      expect(adapter).toBeDefined();
      expect(adapter.lookup).toBeDefined();
    });
  });

  // ─── Epic 3 adapter accessors ──────────────────────────────────────────

  describe("getVehicleLookup", () => {
    it("should resolve with mock provider", () => {
      mockGetAll.mockReturnValue([
        {
          key: "mock.vehicle-lookup",
          adapterInterface: "IVehicleLookupAdapter",
          status: "active",
          costPerCall: 0,
        },
      ]);
      const adapter = getVehicleLookup();
      expect(adapter).toBeDefined();
      expect(adapter.lookup).toBeDefined();
    });

    it("should fallback to mock when no provider configured", () => {
      mockGetAll.mockReturnValue([]);
      const adapter = getVehicleLookup();
      expect(adapter).toBeDefined();
      expect(adapter.lookup).toBeDefined();
    });
  });

  describe("getEmission", () => {
    it("should resolve with ademe provider", () => {
      mockGetAll.mockReturnValue([
        { key: "ademe", adapterInterface: "IEmissionAdapter", status: "active", costPerCall: 0 },
      ]);
      const adapter = getEmission();
      expect(adapter).toBeDefined();
      expect(adapter.getEmissions).toBeDefined();
    });

    it("should fallback to mock when no provider configured", () => {
      mockGetAll.mockReturnValue([]);
      const adapter = getEmission();
      expect(adapter).toBeDefined();
    });
  });

  describe("getRecall", () => {
    it("should resolve with rappelconso provider", () => {
      mockGetAll.mockReturnValue([
        {
          key: "rappelconso",
          adapterInterface: "IRecallAdapter",
          status: "active",
          costPerCall: 0,
        },
      ]);
      const adapter = getRecall();
      expect(adapter).toBeDefined();
      expect(adapter.getRecalls).toBeDefined();
    });

    it("should fallback to mock when no provider configured", () => {
      mockGetAll.mockReturnValue([]);
      const adapter = getRecall();
      expect(adapter).toBeDefined();
    });
  });

  describe("getCritAir", () => {
    it("should resolve with local critair provider", () => {
      mockGetAll.mockReturnValue([
        {
          key: "local.critair",
          adapterInterface: "ICritAirCalculator",
          status: "active",
          costPerCall: 0,
        },
      ]);
      const adapter = getCritAir();
      expect(adapter).toBeDefined();
      expect(adapter.calculate).toBeDefined();
    });

    it("should fallback to mock when no provider configured", () => {
      mockGetAll.mockReturnValue([]);
      const adapter = getCritAir();
      expect(adapter).toBeDefined();
    });
  });

  describe("getVINTechnical", () => {
    it("should resolve with nhtsa provider", () => {
      mockGetAll.mockReturnValue([
        {
          key: "nhtsa",
          adapterInterface: "IVINTechnicalAdapter",
          status: "active",
          costPerCall: 0,
        },
      ]);
      const adapter = getVINTechnical();
      expect(adapter).toBeDefined();
      expect(adapter.decode).toBeDefined();
    });

    it("should fallback to mock when no provider configured", () => {
      mockGetAll.mockReturnValue([]);
      const adapter = getVINTechnical();
      expect(adapter).toBeDefined();
    });
  });

  describe("getHistory", () => {
    it("should resolve with mock history provider", () => {
      mockGetAll.mockReturnValue([
        {
          key: "mock.history",
          adapterInterface: "IHistoryAdapter",
          status: "active",
          costPerCall: 0,
        },
      ]);
      const adapter = getHistory();
      expect(adapter).toBeDefined();
      expect(adapter.getHistory).toBeDefined();
    });

    it("should fallback to mock when no provider configured", () => {
      mockGetAll.mockReturnValue([]);
      const adapter = getHistory();
      expect(adapter).toBeDefined();
    });
  });

  describe("getValuation", () => {
    it("should resolve with mock valuation provider", () => {
      mockGetAll.mockReturnValue([
        {
          key: "mock.valuation",
          adapterInterface: "IValuationAdapter",
          status: "active",
          costPerCall: 0,
        },
      ]);
      const adapter = getValuation();
      expect(adapter).toBeDefined();
      expect(adapter.evaluate).toBeDefined();
    });

    it("should fallback to mock when no provider configured", () => {
      mockGetAll.mockReturnValue([]);
      const adapter = getValuation();
      expect(adapter).toBeDefined();
    });
  });

  describe("getPayment", () => {
    it("should resolve with mock payment provider", () => {
      mockGetAll.mockReturnValue([
        {
          key: "mock.payment",
          adapterInterface: "IPaymentAdapter",
          status: "active",
          costPerCall: 0,
        },
      ]);
      const adapter = getPayment();
      expect(adapter).toBeDefined();
      expect(adapter.createCheckoutSession).toBeDefined();
    });

    it("should fallback to mock when no provider configured", () => {
      mockGetAll.mockReturnValue([]);
      const adapter = getPayment();
      expect(adapter).toBeDefined();
    });
  });

  // ─── Fallback behavior ─────────────────────────────────────────────────

  describe("mock fallback behavior", () => {
    it("should fallback to mock when active provider has no registered implementation", () => {
      mockGetAll.mockReturnValue([
        {
          key: "siv.gouv",
          adapterInterface: "IVehicleLookupAdapter",
          status: "active",
          costPerCall: 0.05,
        },
      ]);
      // siv.gouv is not in ADAPTER_REGISTRY, should fallback to mock
      const adapter = getVehicleLookup();
      expect(adapter).toBeDefined();
      expect(adapter.lookup).toBeDefined();
    });

    it("should not fallback for interfaces without mock fallback (identity, blob)", () => {
      mockGetAll.mockReturnValue([
        { key: "unknown", adapterInterface: "IIdentityProviderAdapter", status: "active" },
      ]);
      // IIdentityProviderAdapter has no mock fallback
      expect(() => getIdentityProvider()).toThrow("No active provider found");
    });

    it("should cache mock fallback instance", () => {
      mockGetAll.mockReturnValue([]);
      const adapter1 = getVehicleLookup();
      const adapter2 = getVehicleLookup();
      expect(adapter2).toBe(adapter1);
    });
  });

  // ─── API call logging integration ──────────────────────────────────────

  describe("API call logging integration", () => {
    it("should log API calls when adapter methods are invoked", async () => {
      mockGetAll.mockReturnValue([
        {
          key: "azure.adb2c",
          adapterInterface: "IIdentityProviderAdapter",
          status: "active",
          costPerCall: 0.001,
        },
      ]);
      const adapter = getIdentityProvider();
      await adapter.createUser({ email: "test@example.com" });

      expect(mockLogApiCall).toHaveBeenCalledWith(
        expect.objectContaining({
          adapterInterface: "IIdentityProviderAdapter",
          providerKey: "azure.adb2c",
          cost: 0.001,
          httpStatus: 200,
        }),
      );
    });

    it("should log failed API calls with error details", async () => {
      const {
        AzureBlobStorageAdapter,
      } = require("../../../srv/adapters/azure-blob-storage-adapter");
      (AzureBlobStorageAdapter as jest.Mock).mockImplementationOnce(() => ({
        uploadFile: jest.fn(),
        generateSignedUrl: jest.fn().mockRejectedValue(new Error("File not found")),
        deleteFile: jest.fn(),
      }));

      mockGetAll.mockReturnValue([
        {
          key: "azure.blob",
          adapterInterface: "IBlobStorageAdapter",
          status: "active",
          costPerCall: 0.0005,
        },
      ]);
      const adapter = getBlobStorage();

      await expect(adapter.generateSignedUrl("c", "p", 10)).rejects.toThrow("File not found");

      expect(mockLogApiCall).toHaveBeenCalledWith(
        expect.objectContaining({
          adapterInterface: "IBlobStorageAdapter",
          providerKey: "azure.blob",
          httpStatus: 500,
          errorMessage: "File not found",
        }),
      );
    });

    it("should log calls for all adapter methods", async () => {
      mockGetAll.mockReturnValue([
        {
          key: "azure.adb2c",
          adapterInterface: "IIdentityProviderAdapter",
          status: "active",
          costPerCall: 0.001,
        },
      ]);
      const adapter = getIdentityProvider();
      await adapter.createUser({});
      await adapter.disableUser("ext-id");
      await adapter.updateUser("ext-id", {});

      expect(mockLogApiCall).toHaveBeenCalledTimes(3);
    });

    it("should log mock fallback calls with cost=0", async () => {
      mockGetAll.mockReturnValue([]);
      const adapter = getVehicleLookup();
      await adapter.lookup({ plate: "AB-123-CD" });

      expect(mockLogApiCall).toHaveBeenCalledWith(
        expect.objectContaining({
          adapterInterface: "IVehicleLookupAdapter",
          providerKey: "mock.vehicle-lookup",
          cost: 0,
        }),
      );
    });
  });
});
