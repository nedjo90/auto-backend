/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

const mockGetConfigParam = jest.fn();
const mockIsCallAllowed = jest.fn();
const mockRecordSuccess = jest.fn();
const mockRecordFailure = jest.fn();

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      log: jest.fn(() => mockLog),
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

jest.mock("../../../srv/lib/circuit-breaker", () => ({
  isCallAllowed: (...args: any[]) => mockIsCallAllowed(...args),
  recordSuccess: (...args: any[]) => mockRecordSuccess(...args),
  recordFailure: (...args: any[]) => mockRecordFailure(...args),
}));

jest.mock("../../../srv/lib/async-utils", () => ({
  delay: jest.fn().mockResolvedValue(undefined),
}));

const {
  classifyError,
  extractHttpStatus,
  createTypedError,
  withResilience,
} = require("../../../srv/lib/adapter-resilience");

describe("adapter-resilience", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsCallAllowed.mockReturnValue(true);
    mockGetConfigParam.mockReturnValue(undefined);
  });

  describe("classifyError", () => {
    it("should classify timeout errors", () => {
      expect(classifyError(new Error("Request timeout"))).toBe("timeout");
      expect(classifyError(new Error("The operation was aborted"))).toBe("timeout");
      expect(classifyError(new Error("timed out after 10000ms"))).toBe("timeout");
    });

    it("should classify connection errors", () => {
      expect(classifyError(new Error("ECONNREFUSED"))).toBe("connection");
      expect(classifyError(new Error("ENOTFOUND"))).toBe("connection");
      expect(classifyError(new Error("network error"))).toBe("connection");
      expect(classifyError(new Error("fetch failed"))).toBe("connection");
      expect(classifyError(new Error("ECONNRESET"))).toBe("connection");
    });

    it("should classify rate limit errors", () => {
      expect(classifyError(new Error("429 Too Many Requests"))).toBe("rate_limit");
      expect(classifyError(new Error("Rate limit exceeded"))).toBe("rate_limit");
    });

    it("should classify other errors as response", () => {
      expect(classifyError(new Error("Internal Server Error"))).toBe("response");
      expect(classifyError(new Error("Bad Request"))).toBe("response");
      expect(classifyError("string error")).toBe("response");
    });
  });

  describe("extractHttpStatus", () => {
    it("should extract status property", () => {
      expect(extractHttpStatus({ status: 404 })).toBe(404);
    });

    it("should extract statusCode property", () => {
      expect(extractHttpStatus({ statusCode: 500 })).toBe(500);
    });

    it("should return undefined for non-object errors", () => {
      expect(extractHttpStatus("string")).toBeUndefined();
      expect(extractHttpStatus(null)).toBeUndefined();
    });
  });

  describe("createTypedError", () => {
    it("should create a timeout error", () => {
      const err = createTypedError(new Error("Request timeout"), "ademe");
      expect(err.errorType).toBe("timeout");
      expect(err.retryable).toBe(true);
      expect(err.code).toBe("ADAPTER_TIMEOUT");
      expect(err.provider).toBe("ademe");
    });

    it("should create a connection error", () => {
      const err = createTypedError(new Error("ECONNREFUSED"), "nhtsa");
      expect(err.errorType).toBe("connection");
      expect(err.retryable).toBe(true);
    });

    it("should create a response error (non-retryable)", () => {
      const err = createTypedError(new Error("Bad Request"), "ademe");
      expect(err.errorType).toBe("response");
      expect(err.retryable).toBe(false);
    });

    it("should create a rate limit error with retryAfterMs", () => {
      const err = createTypedError(new Error("429 Too Many Requests"), "ademe");
      expect(err.errorType).toBe("rate_limit");
      expect(err.retryable).toBe(true);
      expect(err.retryAfterMs).toBe(60000);
    });
  });

  describe("withResilience", () => {
    it("should return result on success", async () => {
      const fn = jest.fn().mockResolvedValue({ make: "Renault" });

      const result = await withResilience("IVehicleLookupAdapter", "mock", fn);

      expect(result).toEqual({ make: "Renault" });
      expect(mockRecordSuccess).toHaveBeenCalledWith("IVehicleLookupAdapter");
    });

    it("should throw when circuit breaker is open", async () => {
      mockIsCallAllowed.mockReturnValue(false);
      const fn = jest.fn();

      await expect(withResilience("IEmissionAdapter", "ademe", fn)).rejects.toThrow(
        "Circuit breaker open",
      );

      expect(fn).not.toHaveBeenCalled();
    });

    it("should retry on timeout errors", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("Request timeout"))
        .mockRejectedValueOnce(new Error("Request timeout"))
        .mockResolvedValue({ co2: 128 });

      // Default retry count is 2
      const result = await withResilience("IEmissionAdapter", "ademe", fn);

      expect(result).toEqual({ co2: 128 });
      expect(fn).toHaveBeenCalledTimes(3);
      expect(mockRecordSuccess).toHaveBeenCalledWith("IEmissionAdapter");
    });

    it("should retry on connection errors", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValue({ co2: 128 });

      const result = await withResilience("IEmissionAdapter", "ademe", fn);

      expect(result).toEqual({ co2: 128 });
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should NOT retry on response errors (non-retryable)", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("Bad Request"));

      await expect(withResilience("IEmissionAdapter", "ademe", fn)).rejects.toThrow();

      // Should only try once (no retry for response errors)
      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockRecordFailure).toHaveBeenCalledWith("IEmissionAdapter", "response");
    });

    it("should record failure after all retries exhausted", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("Request timeout"));

      await expect(withResilience("IEmissionAdapter", "ademe", fn)).rejects.toThrow();

      // 1 initial + 2 retries = 3 calls
      expect(fn).toHaveBeenCalledTimes(3);
      expect(mockRecordFailure).toHaveBeenCalledWith("IEmissionAdapter", "timeout");
    });

    it("should use configured retry count", async () => {
      mockGetConfigParam.mockImplementation((table: string, key: string) => {
        if (key === "ADAPTER_RETRY_COUNT") return { value: "1" };
        return undefined;
      });

      const fn = jest.fn().mockRejectedValue(new Error("Request timeout"));

      await expect(withResilience("IEmissionAdapter", "ademe", fn)).rejects.toThrow();

      // 1 initial + 1 retry = 2 calls
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should throw AdapterTypedError with correct fields", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("Request timeout"));

      try {
        await withResilience("IEmissionAdapter", "ademe", fn);
        fail("Should have thrown");
      } catch (err: any) {
        expect(err.errorType).toBe("timeout");
        expect(err.provider).toBe("ademe");
        expect(err.retryable).toBe(true);
        expect(err.code).toBe("ADAPTER_TIMEOUT");
      }
    });
  });
});
