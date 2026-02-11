/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

const mockRun = jest.fn();
jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        ApiCallLog: "ApiCallLog",
        AlertEvent: "AlertEvent",
        ConfigAlert: "ConfigAlert",
      })),
      run: mockRun,
      log: jest.fn(() => mockLog),
      utils: { uuid: jest.fn(() => "auto-alert-uuid") },
    },
  };
});

const mockCreateAlertEvent = jest
  .fn()
  .mockResolvedValue({ id: "auto-alert-uuid", message: "test alert message" });
jest.mock("../../../srv/lib/alert-evaluator", () => ({
  createAlertEvent: (...args: any[]) => mockCreateAlertEvent(...args),
}));

const mockSendNotification = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../srv/lib/alert-notifier", () => ({
  sendAlertNotification: (...args: any[]) => mockSendNotification(...args),
}));

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-query"),
  }),
};

const {
  logApiCall,
  withApiLogging,
  getFailureState,
  resetFailureCounters,
} = require("../../../srv/lib/api-logger");

describe("api-logger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    mockCreateAlertEvent
      .mockReset()
      .mockResolvedValue({ id: "auto-alert-uuid", message: "test alert message" });
    mockSendNotification.mockReset().mockResolvedValue(undefined);
    resetFailureCounters();
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

  describe("consecutive failure tracking", () => {
    const baseEntry = {
      adapterInterface: "ITestAdapter",
      providerKey: "failing-provider",
      endpoint: "/api/test",
      httpMethod: "GET",
      responseTimeMs: 100,
      cost: 0.01,
    };

    it("should track consecutive failures", async () => {
      mockRun.mockResolvedValue(undefined);
      await logApiCall({ ...baseEntry, httpStatus: 500 });
      const state = getFailureState("failing-provider");
      expect(state?.count).toBe(1);
    });

    it("should reset failure counter on success", async () => {
      mockRun.mockResolvedValue(undefined);
      await logApiCall({ ...baseEntry, httpStatus: 500 });
      await logApiCall({ ...baseEntry, httpStatus: 500 });
      await logApiCall({ ...baseEntry, httpStatus: 200 });
      const state = getFailureState("failing-provider");
      expect(state?.count).toBe(0);
      expect(state?.lastSuccessAt).toBeTruthy();
    });

    it("should trigger auto-alert after 3 consecutive failures", async () => {
      mockRun.mockResolvedValue(undefined);
      await logApiCall({ ...baseEntry, httpStatus: 500 });
      await logApiCall({ ...baseEntry, httpStatus: 500 });
      expect(mockCreateAlertEvent).not.toHaveBeenCalled();

      await logApiCall({ ...baseEntry, httpStatus: 500 });
      expect(mockCreateAlertEvent).toHaveBeenCalledTimes(1);
      expect(mockCreateAlertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          severityLevel: "critical",
          notificationMethod: "both",
        }),
        3,
      );
    });

    it("should send notification when auto-alert is triggered", async () => {
      mockRun.mockResolvedValue(undefined);
      await logApiCall({ ...baseEntry, httpStatus: 500 });
      await logApiCall({ ...baseEntry, httpStatus: 500 });
      await logApiCall({ ...baseEntry, httpStatus: 500 });
      expect(mockSendNotification).toHaveBeenCalledTimes(1);
      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: "critical",
          notificationMethod: "both",
        }),
      );
    });

    it("should only trigger alert once at threshold (not on every subsequent failure)", async () => {
      mockRun.mockResolvedValue(undefined);
      for (let i = 0; i < 5; i++) {
        await logApiCall({ ...baseEntry, httpStatus: 500 });
      }
      // Only triggered at exactly 3
      expect(mockCreateAlertEvent).toHaveBeenCalledTimes(1);
    });

    it("should track failures independently per provider", async () => {
      mockRun.mockResolvedValue(undefined);
      await logApiCall({ ...baseEntry, providerKey: "provider-a", httpStatus: 500 });
      await logApiCall({ ...baseEntry, providerKey: "provider-b", httpStatus: 500 });
      await logApiCall({ ...baseEntry, providerKey: "provider-a", httpStatus: 500 });

      expect(getFailureState("provider-a")?.count).toBe(2);
      expect(getFailureState("provider-b")?.count).toBe(1);
    });

    it("should count 4xx as failures", async () => {
      mockRun.mockResolvedValue(undefined);
      await logApiCall({ ...baseEntry, httpStatus: 400 });
      await logApiCall({ ...baseEntry, httpStatus: 403 });
      await logApiCall({ ...baseEntry, httpStatus: 404 });
      expect(mockCreateAlertEvent).toHaveBeenCalledTimes(1);
    });

    it("should not trigger alert when entity not found for logging", async () => {
      const cds = require("@sap/cds").default;
      (cds.entities as jest.Mock).mockReturnValue({});
      await logApiCall({ ...baseEntry, httpStatus: 500 });
      // No crash, no alert (since logApiCall returned early)
      expect(mockCreateAlertEvent).not.toHaveBeenCalled();
    });
  });
});
