/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

const mockRun = jest.fn();
jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        ApiCallLog: "ApiCallLog",
      })),
      run: mockRun,
      log: jest.fn(() => mockLog),
    },
  };
});

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-query"),
  }),
};

const { logApiCall, withApiLogging } = require("../../../srv/lib/api-logger");

describe("api-logger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  describe("logApiCall", () => {
    it("should insert entry into ApiCallLog", async () => {
      mockRun.mockResolvedValueOnce(undefined);
      await logApiCall({
        adapterInterface: "ITestAdapter",
        providerKey: "test-provider",
        endpoint: "/api/test",
        httpMethod: "GET",
        httpStatus: 200,
        responseTimeMs: 150,
        cost: 0.01,
      });
      expect(mockRun).toHaveBeenCalled();
      expect((global as any).INSERT.into).toHaveBeenCalledWith("ApiCallLog");
    });

    it("should include optional fields when provided", async () => {
      mockRun.mockResolvedValueOnce(undefined);
      await logApiCall({
        adapterInterface: "ITestAdapter",
        providerKey: "test-provider",
        endpoint: "/api/test",
        httpMethod: "POST",
        httpStatus: 201,
        responseTimeMs: 200,
        cost: 0.02,
        listingId: "listing-123",
        requestId: "req-456",
      });
      expect(mockRun).toHaveBeenCalled();
    });

    it("should not throw when ApiCallLog entity is not found", async () => {
      const cds = require("@sap/cds").default;
      (cds.entities as jest.Mock).mockReturnValueOnce({});
      await expect(
        logApiCall({
          adapterInterface: "ITestAdapter",
          providerKey: "test-provider",
          endpoint: "/test",
          httpMethod: "GET",
          httpStatus: 200,
          responseTimeMs: 100,
          cost: 0,
        }),
      ).resolves.not.toThrow();
      expect(mockRun).not.toHaveBeenCalled();
    });

    it("should not throw when INSERT fails", async () => {
      mockRun.mockRejectedValueOnce(new Error("DB error"));
      await expect(
        logApiCall({
          adapterInterface: "ITestAdapter",
          providerKey: "test-provider",
          endpoint: "/test",
          httpMethod: "GET",
          httpStatus: 200,
          responseTimeMs: 100,
          cost: 0,
        }),
      ).resolves.not.toThrow();
    });
  });

  describe("withApiLogging", () => {
    it("should wrap a function and return its result", async () => {
      mockRun.mockResolvedValue(undefined);
      const fn = jest.fn().mockResolvedValueOnce("result-data");
      const wrapped = withApiLogging("ITestAdapter", "test-provider", 0.01, fn);
      const result = await wrapped("arg1", "arg2");
      expect(result).toBe("result-data");
      expect(fn).toHaveBeenCalledWith("arg1", "arg2");
    });

    it("should log successful call via INSERT", async () => {
      mockRun.mockResolvedValue(undefined);
      const fn = jest.fn().mockResolvedValueOnce("ok");
      const wrapped = withApiLogging("ITestAdapter", "test-provider", 0.05, fn);
      await wrapped();
      expect(mockRun).toHaveBeenCalled();
    });

    it("should log failed call and rethrow the error", async () => {
      mockRun.mockResolvedValue(undefined);
      const fn = jest.fn().mockRejectedValueOnce(new Error("API failed"));
      const wrapped = withApiLogging("ITestAdapter", "test-provider", 0.01, fn);
      await expect(wrapped()).rejects.toThrow("API failed");
      // logApiCall should still be called (in finally block)
      expect(mockRun).toHaveBeenCalled();
    });

    it("should pass arguments through to the wrapped function", async () => {
      mockRun.mockResolvedValue(undefined);
      const fn = jest.fn().mockResolvedValueOnce(42);
      const wrapped = withApiLogging("ITestAdapter", "test-provider", 0, fn);
      const result = await wrapped("a", "b", "c");
      expect(fn).toHaveBeenCalledWith("a", "b", "c");
      expect(result).toBe(42);
    });
  });
});
