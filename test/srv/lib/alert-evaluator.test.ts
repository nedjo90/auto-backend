/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

const mockRun = jest.fn();
const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
const mockRefreshTable = jest.fn().mockResolvedValue(undefined);
const mockCacheGet = jest.fn();
const mockCacheGetAll = jest.fn().mockReturnValue([]);
const mockCacheIsReady = jest.fn().mockReturnValue(true);

jest.mock("@sap/cds", () => ({
  __esModule: true,
  default: {
    log: jest.fn(() => mockLog),
    entities: jest.fn(() => ({
      ApiCallLog: "ApiCallLog",
      User: "User",
      AlertEvent: "AlertEvent",
      ConfigAlert: "ConfigAlert",
    })),
    run: mockRun,
    utils: { uuid: jest.fn(() => "test-uuid") },
  },
}));

jest.mock("../../../srv/lib/config-cache", () => ({
  configCache: {
    get: (...args: any[]) => mockCacheGet(...args),
    getAll: (...args: any[]) => mockCacheGetAll(...args),
    invalidate: jest.fn(),
    refresh: jest.fn(),
    refreshTable: mockRefreshTable,
    isReady: () => mockCacheIsReady(),
  },
}));

const mockSendNotification = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../srv/lib/alert-notifier", () => ({
  sendAlertNotification: (...args: any[]) => mockSendNotification(...args),
}));

const mockSelectQuery = {
  where: jest.fn().mockReturnValue("select-query"),
  columns: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("select-one-query"),
  }),
};
(global as any).SELECT = {
  from: jest.fn().mockReturnValue(mockSelectQuery),
  one: {
    from: jest.fn().mockReturnValue({
      columns: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue("select-one-query"),
      }),
    }),
  },
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

import {
  evaluateMetric,
  isThresholdBreached,
  isCooldownActive,
  createAlertEvent,
  runEvaluationCycle,
  startPeriodicEvaluation,
  stopPeriodicEvaluation,
} from "../../../srv/lib/alert-evaluator";

describe("AlertEvaluator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    mockCacheGet.mockReset();
    mockCacheGetAll.mockReset().mockReturnValue([]);
    mockCacheIsReady.mockReturnValue(true);
    mockSendNotification.mockReset().mockResolvedValue(undefined);
    stopPeriodicEvaluation(); // Clean up any running intervals
  });

  describe("evaluateMetric", () => {
    it("should evaluate margin_per_listing from config and API logs", async () => {
      mockCacheGet.mockReturnValue({ value: "15" }); // listing.price.default
      mockRun.mockResolvedValueOnce([{ cost: 2 }, { cost: 3 }]); // API logs

      const result = await evaluateMetric("margin_per_listing");
      expect(result).not.toBeNull();
      expect(result!.metric).toBe("margin_per_listing");
      expect(result!.value).toBe(12.5); // 15 - (2+3)/2 = 15 - 2.5 = 12.5
    });

    it("should return listing price as margin when no API logs", async () => {
      mockCacheGet.mockReturnValue({ value: "15" });
      mockRun.mockResolvedValueOnce([]); // No logs

      const result = await evaluateMetric("margin_per_listing");
      expect(result!.value).toBe(15);
    });

    it("should return 0 margin when no price configured", async () => {
      mockCacheGet.mockReturnValue(undefined);
      mockRun.mockResolvedValueOnce([{ cost: 5 }]);

      const result = await evaluateMetric("margin_per_listing");
      expect(result!.value).toBe(-5);
    });

    it("should evaluate api_availability from success rate", async () => {
      mockRun
        .mockResolvedValueOnce({ cnt: 4 }) // total count
        .mockResolvedValueOnce({ cnt: 3 }); // success count

      const result = await evaluateMetric("api_availability");
      expect(result!.value).toBe(75); // 3/4 = 75%
    });

    it("should return 100% availability when no logs", async () => {
      mockRun.mockResolvedValueOnce({ cnt: 0 }); // total count = 0

      const result = await evaluateMetric("api_availability");
      expect(result!.value).toBe(100);
    });

    it("should evaluate daily_registrations from User count", async () => {
      mockRun.mockResolvedValueOnce({ cnt: 3 }); // 3 users

      const result = await evaluateMetric("daily_registrations");
      expect(result!.value).toBe(3);
    });

    it("should return 0 for daily_listings when entity missing", async () => {
      const cds = require("@sap/cds").default;
      cds.entities.mockReturnValueOnce({}); // No Listing entity

      const result = await evaluateMetric("daily_listings");
      expect(result!.value).toBe(0);
    });

    it("should return 0 for daily_revenue when entity missing", async () => {
      const cds = require("@sap/cds").default;
      cds.entities.mockReturnValueOnce({}); // No Payment entity

      const result = await evaluateMetric("daily_revenue");
      expect(result!.value).toBe(0);
    });

    it("should return null for unknown metric", async () => {
      const result = await evaluateMetric("unknown_metric");
      expect(result).toBeNull();
    });

    it("should return null on error", async () => {
      mockRun.mockRejectedValueOnce(new Error("DB error"));
      mockCacheGet.mockReturnValue({ value: "15" });

      const result = await evaluateMetric("margin_per_listing");
      expect(result).toBeNull();
    });
  });

  describe("isThresholdBreached", () => {
    it("should detect 'above' threshold breach", () => {
      expect(isThresholdBreached(10, 5, "above")).toBe(true);
      expect(isThresholdBreached(5, 10, "above")).toBe(false);
      expect(isThresholdBreached(5, 5, "above")).toBe(false);
    });

    it("should detect 'below' threshold breach", () => {
      expect(isThresholdBreached(3, 5, "below")).toBe(true);
      expect(isThresholdBreached(5, 3, "below")).toBe(false);
      expect(isThresholdBreached(5, 5, "below")).toBe(false);
    });

    it("should detect 'equals' threshold match with epsilon tolerance", () => {
      expect(isThresholdBreached(5, 5, "equals")).toBe(true);
      expect(isThresholdBreached(5, 6, "equals")).toBe(false);
      // Floating-point edge case: 0.1 + 0.2 should equal 0.3
      expect(isThresholdBreached(0.1 + 0.2, 0.3, "equals")).toBe(true);
    });

    it("should return false for unknown operator", () => {
      expect(isThresholdBreached(5, 5, "unknown")).toBe(false);
    });
  });

  describe("isCooldownActive", () => {
    it("should return false when no lastTriggeredAt", () => {
      expect(isCooldownActive(null, 60)).toBe(false);
    });

    it("should return true when within cooldown window", () => {
      const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
      expect(isCooldownActive(recent, 60)).toBe(true); // 60 min cooldown
    });

    it("should return false when cooldown expired", () => {
      const old = new Date(Date.now() - 120 * 60 * 1000).toISOString(); // 120 min ago
      expect(isCooldownActive(old, 60)).toBe(false); // 60 min cooldown
    });
  });

  describe("createAlertEvent", () => {
    const mockAlert = {
      ID: "a1",
      name: "Test Alert",
      metric: "margin_per_listing",
      thresholdValue: 8,
      comparisonOperator: "below",
      notificationMethod: "both",
      severityLevel: "critical",
      enabled: true,
      cooldownMinutes: 30,
      lastTriggeredAt: null,
    };

    it("should create alert event and update lastTriggeredAt", async () => {
      mockRun.mockResolvedValue(undefined);

      const result = await createAlertEvent(mockAlert, 5);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("test-uuid");
      expect(result!.message).toContain("Test Alert");
      expect(mockRun).toHaveBeenCalledTimes(2); // INSERT + UPDATE
      expect(mockRefreshTable).toHaveBeenCalledWith("ConfigAlert");
    });

    it("should skip UPDATE for synthetic auto-alert IDs", async () => {
      mockRun.mockResolvedValue(undefined);
      const syntheticAlert = { ...mockAlert, ID: "auto-test-provider" };

      const result = await createAlertEvent(syntheticAlert, 5);
      expect(result).not.toBeNull();
      expect(mockRun).toHaveBeenCalledTimes(1); // INSERT only, no UPDATE
      expect(mockRefreshTable).not.toHaveBeenCalled();
    });

    it("should return null when AlertEvent entity missing", async () => {
      const cds = require("@sap/cds").default;
      cds.entities.mockReturnValueOnce({});

      const result = await createAlertEvent(mockAlert, 5);
      expect(result).toBeNull();
    });

    it("should return null on error", async () => {
      mockRun.mockRejectedValueOnce(new Error("INSERT failed"));

      const result = await createAlertEvent(mockAlert, 5);
      expect(result).toBeNull();
    });
  });

  describe("runEvaluationCycle", () => {
    it("should skip disabled alerts", async () => {
      mockCacheGetAll.mockReturnValue([
        {
          ID: "a1",
          metric: "margin_per_listing",
          enabled: false,
          cooldownMinutes: 60,
          lastTriggeredAt: null,
          thresholdValue: 8,
          comparisonOperator: "below",
          severityLevel: "critical",
        },
      ]);

      const result = await runEvaluationCycle();
      expect(result).toEqual([]);
      expect(mockRun).not.toHaveBeenCalled();
    });

    it("should skip alerts in cooldown", async () => {
      mockCacheGetAll.mockReturnValue([
        {
          ID: "a1",
          metric: "margin_per_listing",
          enabled: true,
          cooldownMinutes: 60,
          lastTriggeredAt: new Date().toISOString(), // Just triggered
          thresholdValue: 8,
          comparisonOperator: "below",
          severityLevel: "critical",
        },
      ]);

      const result = await runEvaluationCycle();
      expect(result).toEqual([]);
    });

    it("should trigger alert when threshold breached", async () => {
      mockCacheGetAll.mockReturnValue([
        {
          ID: "a1",
          name: "Low Margin",
          metric: "margin_per_listing",
          enabled: true,
          cooldownMinutes: 60,
          lastTriggeredAt: null,
          thresholdValue: 8,
          comparisonOperator: "below",
          severityLevel: "critical",
          notificationMethod: "both",
        },
      ]);
      mockCacheGet.mockReturnValue({ value: "5" }); // Low listing price => margin below 8
      mockRun
        .mockResolvedValueOnce([]) // API logs for margin calc (empty = margin = price)
        .mockResolvedValue(undefined); // INSERT + UPDATE

      const result = await runEvaluationCycle();
      expect(result).toEqual(["test-uuid"]);
    });

    it("should send notification when alert is triggered", async () => {
      mockCacheGetAll.mockReturnValue([
        {
          ID: "a1",
          name: "Low Margin",
          metric: "margin_per_listing",
          enabled: true,
          cooldownMinutes: 60,
          lastTriggeredAt: null,
          thresholdValue: 8,
          comparisonOperator: "below",
          severityLevel: "critical",
          notificationMethod: "both",
        },
      ]);
      mockCacheGet.mockReturnValue({ value: "5" });
      mockRun.mockResolvedValueOnce([]).mockResolvedValue(undefined);

      await runEvaluationCycle();
      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          alertEventId: "test-uuid",
          alertName: "Low Margin",
          notificationMethod: "both",
          severity: "critical",
        }),
      );
    });

    it("should not trigger when threshold not breached", async () => {
      mockCacheGetAll.mockReturnValue([
        {
          ID: "a1",
          name: "High Margin",
          metric: "margin_per_listing",
          enabled: true,
          cooldownMinutes: 60,
          lastTriggeredAt: null,
          thresholdValue: 8,
          comparisonOperator: "below",
          severityLevel: "critical",
          notificationMethod: "both",
        },
      ]);
      mockCacheGet.mockReturnValue({ value: "20" }); // High listing price = margin above 8
      mockRun.mockResolvedValueOnce([]); // API logs

      const result = await runEvaluationCycle();
      expect(result).toEqual([]);
    });
  });

  describe("startPeriodicEvaluation / stopPeriodicEvaluation", () => {
    it("should start and stop without error", () => {
      startPeriodicEvaluation(100000); // Long interval to avoid execution
      stopPeriodicEvaluation();
      // Should not throw
    });

    it("should warn if already running", () => {
      startPeriodicEvaluation(100000);
      startPeriodicEvaluation(100000); // Second call
      expect(mockLog.warn).toHaveBeenCalledWith("Alert evaluation already running");
      stopPeriodicEvaluation();
    });
  });
});
