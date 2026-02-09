/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

const mockGetAll = jest.fn();
jest.mock("../../../srv/lib/config-cache", () => ({
  configCache: {
    getAll: (...args: any[]) => mockGetAll(...args),
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

const {
  getActiveProvider,
  invalidateAdapter,
  getIdentityProvider,
  getBlobStorage,
  setIdentityProvider,
  setBlobStorage,
  resetIdentityProvider,
  resetBlobStorage,
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

    it("should throw when no active provider configured", () => {
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

    it("should throw when no active provider configured", () => {
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
    it("should throw when provider key has no registered adapter", () => {
      mockGetAll.mockReturnValue([
        { key: "unknown.provider", adapterInterface: "IIdentityProviderAdapter", status: "active" },
      ]);
      expect(() => getIdentityProvider()).toThrow("No adapter implementation registered");
    });
  });
});
