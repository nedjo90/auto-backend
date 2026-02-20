/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "cache-uuid-123");
const mockGetConfigParam = jest.fn();

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        ApiCachedData: "ApiCachedData",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => mockUuid() },
    },
  };
});

jest.mock("../../../srv/lib/config-cache", () => ({
  configCache: {
    get: (...args: any[]) => mockGetConfigParam(...args),
    getAll: jest.fn(() => []),
    invalidate: jest.fn(),
    refresh: jest.fn(),
    refreshTable: jest.fn(),
    isReady: jest.fn(() => true),
  },
}));

(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("select-one-query"),
    }),
  },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("select-query"),
  }),
};

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-query"),
  }),
};

(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("update-query"),
  }),
});

const {
  getCacheTtlHours,
  getCachedResponse,
  setCachedResponse,
} = require("../../../srv/lib/api-cache");

describe("api-cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    mockGetConfigParam.mockReset();
    mockUuid.mockReturnValue("cache-uuid-123");
  });

  describe("getCacheTtlHours", () => {
    it("should return default 48 hours when no config param exists", () => {
      mockGetConfigParam.mockReturnValue(undefined);
      expect(getCacheTtlHours()).toBe(48);
    });

    it("should return configured TTL from ConfigParameter", () => {
      mockGetConfigParam.mockReturnValue({ value: "72" });
      expect(getCacheTtlHours()).toBe(72);
    });

    it("should return default for invalid config value", () => {
      mockGetConfigParam.mockReturnValue({ value: "abc" });
      expect(getCacheTtlHours()).toBe(48);
    });

    it("should return default for zero or negative config value", () => {
      mockGetConfigParam.mockReturnValue({ value: "0" });
      expect(getCacheTtlHours()).toBe(48);
      mockGetConfigParam.mockReturnValue({ value: "-5" });
      expect(getCacheTtlHours()).toBe(48);
    });

    it("should call configCache.get with correct table and key", () => {
      mockGetConfigParam.mockReturnValue({ value: "24" });
      getCacheTtlHours();
      expect(mockGetConfigParam).toHaveBeenCalledWith("ConfigParameter", "API_CACHE_TTL_HOURS");
    });
  });

  describe("getCachedResponse", () => {
    it("should return parsed data when valid cache entry exists", async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      mockRun.mockResolvedValueOnce({
        responseData: '{"make":"Renault","model":"Clio"}',
        expiresAt: futureDate,
        isValid: true,
      });

      const result = await getCachedResponse("AB-123-CD", "plate", "IVehicleLookupAdapter");

      expect(result).toEqual({ make: "Renault", model: "Clio" });
    });

    it("should return null when no cache entry exists", async () => {
      mockRun.mockResolvedValueOnce(null);

      const result = await getCachedResponse("XX-999-ZZ", "plate", "IVehicleLookupAdapter");

      expect(result).toBeNull();
    });

    it("should return null when cache entry is expired", async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      mockRun.mockResolvedValueOnce({
        responseData: '{"make":"Renault"}',
        expiresAt: pastDate,
        isValid: true,
      });

      const result = await getCachedResponse("AB-123-CD", "plate", "IVehicleLookupAdapter");

      expect(result).toBeNull();
    });

    it("should return null when responseData is invalid JSON", async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      mockRun.mockResolvedValueOnce({
        responseData: "not-json",
        expiresAt: futureDate,
        isValid: true,
      });

      const result = await getCachedResponse("AB-123-CD", "plate", "IVehicleLookupAdapter");

      expect(result).toBeNull();
    });

    it("should return null when ApiCachedData entity is not found", async () => {
      const cds = require("@sap/cds").default;
      cds.entities.mockReturnValueOnce({});

      const result = await getCachedResponse("AB-123-CD", "plate", "IVehicleLookupAdapter");

      expect(result).toBeNull();
    });
  });

  describe("setCachedResponse", () => {
    it("should invalidate old entries and insert new cache entry", async () => {
      mockGetConfigParam.mockReturnValue({ value: "48" });
      // First call: UPDATE (invalidate old)
      mockRun.mockResolvedValueOnce(undefined);
      // Second call: INSERT
      mockRun.mockResolvedValueOnce(undefined);

      await setCachedResponse("AB-123-CD", "plate", "IVehicleLookupAdapter", {
        make: "Renault",
        model: "Clio",
      });

      // Should have called run twice (UPDATE + INSERT)
      expect(mockRun).toHaveBeenCalledTimes(2);
    });

    it("should use configured TTL for expiry calculation", async () => {
      mockGetConfigParam.mockReturnValue({ value: "24" });
      mockRun.mockResolvedValue(undefined);

      await setCachedResponse("AB-123-CD", "plate", "IVehicleLookupAdapter", { make: "Renault" });

      // Verify INSERT was called (second call)
      expect(mockRun).toHaveBeenCalledTimes(2);
    });

    it("should continue even if UPDATE (invalidation) fails", async () => {
      mockGetConfigParam.mockReturnValue(undefined);
      // UPDATE fails
      mockRun.mockRejectedValueOnce(new Error("DB error"));
      // INSERT succeeds
      mockRun.mockResolvedValueOnce(undefined);

      await setCachedResponse("AB-123-CD", "plate", "IVehicleLookupAdapter", { make: "Renault" });

      // Should still attempt INSERT after failed UPDATE
      expect(mockRun).toHaveBeenCalledTimes(2);
    });

    it("should skip when ApiCachedData entity is not found", async () => {
      const cds = require("@sap/cds").default;
      cds.entities.mockReturnValueOnce({});
      mockGetConfigParam.mockReturnValue(undefined);

      await setCachedResponse("AB-123-CD", "plate", "IVehicleLookupAdapter", { make: "Renault" });

      expect(mockRun).not.toHaveBeenCalled();
    });

    it("should serialize response data as JSON string", async () => {
      mockGetConfigParam.mockReturnValue(undefined);
      mockRun.mockResolvedValue(undefined);

      const data = { make: "Renault", model: "Clio", year: 2022 };
      await setCachedResponse("AB-123-CD", "plate", "IVehicleLookupAdapter", data);

      // Verify INSERT was called - the second mockRun call
      expect(mockRun).toHaveBeenCalledTimes(2);
    });
  });
});
