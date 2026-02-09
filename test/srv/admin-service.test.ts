/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-function-type */

const mockRefreshTable = jest.fn().mockResolvedValue(undefined);
const mockInvalidate = jest.fn();
const mockCacheGet = jest.fn();
jest.mock("../../srv/lib/config-cache", () => ({
  configCache: {
    get: (...args: any[]) => mockCacheGet(...args),
    getAll: jest.fn(() => []),
    invalidate: mockInvalidate,
    refresh: jest.fn().mockResolvedValue(undefined),
    refreshTable: mockRefreshTable,
    isReady: jest.fn(() => true),
  },
}));

const mockLogAudit = jest.fn().mockResolvedValue(undefined);
jest.mock("../../srv/lib/audit-logger", () => ({
  logAudit: (...args: any[]) => mockLogAudit(...args),
}));

const mockInvalidateAdapter = jest.fn();
jest.mock("../../srv/adapters/factory/adapter-factory", () => ({
  invalidateAdapter: (...args: any[]) => mockInvalidateAdapter(...args),
}));

jest.mock("@sap/cds", () => {
  class MockApplicationService {
    on = jest.fn();
    before = jest.fn();
    after = jest.fn();
    async init() {}
  }
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    __esModule: true,
    default: {
      ApplicationService: MockApplicationService,
      entities: jest.fn(() => ({
        ConfigParameter: "ConfigParameter",
        ConfigText: "ConfigText",
        ConfigFeature: "ConfigFeature",
        ConfigBoostFactor: "ConfigBoostFactor",
        ConfigVehicleType: "ConfigVehicleType",
        ConfigListingDuration: "ConfigListingDuration",
        ConfigReportReason: "ConfigReportReason",
        ConfigChatAction: "ConfigChatAction",
        ConfigModerationRule: "ConfigModerationRule",
        ConfigApiProvider: "ConfigApiProvider",
        ApiCallLog: "ApiCallLog",
      })),
      run: jest.fn(),
      log: jest.fn(() => mockLog),
      utils: { uuid: jest.fn(() => "test-uuid") },
    },
  };
});

const cds = require("@sap/cds").default;
const mockRun = cds.run as jest.Mock;

(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("select-one-query"),
    }),
  },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("select-from-where-query"),
  }),
};

(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("update-query"),
  }),
});

const AdminServiceHandler = require("../../srv/admin-service").default;

describe("AdminServiceHandler", () => {
  let service: any;
  let registeredBeforeHandlers: Map<string, Function[]>;
  let registeredAfterHandlers: Map<string, Function[]>;
  let registeredOnHandlers: Map<string, Function[]>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockLogAudit.mockResolvedValue(undefined);
    mockRefreshTable.mockResolvedValue(undefined);
    mockInvalidate.mockReset();
    mockCacheGet.mockReset();
    mockInvalidateAdapter.mockReset();

    registeredBeforeHandlers = new Map();
    registeredAfterHandlers = new Map();
    registeredOnHandlers = new Map();

    service = new AdminServiceHandler();
    service.before = jest.fn((events: string[], entity: string, handler: Function) => {
      for (const event of events) {
        const key = `${event}:${entity}`;
        if (!registeredBeforeHandlers.has(key)) registeredBeforeHandlers.set(key, []);
        registeredBeforeHandlers.get(key)!.push(handler);
      }
    });
    service.after = jest.fn((events: string[], entity: string, handler: Function) => {
      for (const event of events) {
        const key = `${event}:${entity}`;
        if (!registeredAfterHandlers.has(key)) registeredAfterHandlers.set(key, []);
        registeredAfterHandlers.get(key)!.push(handler);
      }
    });
    service.on = jest.fn((actionName: string, handler: Function) => {
      if (!registeredOnHandlers.has(actionName)) registeredOnHandlers.set(actionName, []);
      registeredOnHandlers.get(actionName)!.push(handler);
    });

    await service.init();
  });

  it("should register BEFORE handlers for UPDATE/DELETE on all 10 config entities", () => {
    const configEntities = [
      "ConfigParameters",
      "ConfigTexts",
      "ConfigFeatures",
      "ConfigBoostFactors",
      "ConfigVehicleTypes",
      "ConfigListingDurations",
      "ConfigReportReasons",
      "ConfigChatActions",
      "ConfigModerationRules",
      "ConfigApiProviders",
    ];

    for (const entity of configEntities) {
      expect(registeredBeforeHandlers.has(`UPDATE:${entity}`)).toBe(true);
      expect(registeredBeforeHandlers.has(`DELETE:${entity}`)).toBe(true);
    }
  });

  it("should register AFTER handlers for CREATE/UPDATE/DELETE on all 10 config entities", () => {
    const configEntities = [
      "ConfigParameters",
      "ConfigTexts",
      "ConfigFeatures",
      "ConfigBoostFactors",
      "ConfigVehicleTypes",
      "ConfigListingDurations",
      "ConfigReportReasons",
      "ConfigChatActions",
      "ConfigModerationRules",
      "ConfigApiProviders",
    ];

    for (const entity of configEntities) {
      expect(registeredAfterHandlers.has(`CREATE:${entity}`)).toBe(true);
      expect(registeredAfterHandlers.has(`UPDATE:${entity}`)).toBe(true);
      expect(registeredAfterHandlers.has(`DELETE:${entity}`)).toBe(true);
    }
  });

  describe("captureOldValue (BEFORE handler)", () => {
    it("should capture old value for UPDATE requests", async () => {
      mockRun.mockResolvedValueOnce({ ID: "p1", key: "test", value: "old" });

      const handlers = registeredBeforeHandlers.get("UPDATE:ConfigParameters");
      expect(handlers).toBeDefined();

      const req: any = {
        data: { ID: "p1" },
        target: { name: "AdminService.ConfigParameters" },
      };

      await handlers![0](req);
      expect(req._oldValue).toEqual({ ID: "p1", key: "test", value: "old" });
    });

    it("should skip if no ID in request data", async () => {
      const handlers = registeredBeforeHandlers.get("UPDATE:ConfigParameters");
      const req: any = {
        data: {},
        target: { name: "AdminService.ConfigParameters" },
      };

      await handlers![0](req);
      expect(req._oldValue).toBeUndefined();
      expect(mockRun).not.toHaveBeenCalled();
    });
  });

  describe("onConfigMutation (AFTER handler)", () => {
    it("should register deferred cache refresh and log audit on CREATE", async () => {
      const handlers = registeredAfterHandlers.get("CREATE:ConfigParameters");
      expect(handlers).toBeDefined();

      let succeededCallback: Function | undefined;
      const newData = { ID: "p-new", key: "new.param", value: "42" };
      const req: any = {
        event: "CREATE",
        data: { ID: "p-new" },
        user: { id: "admin-user" },
        on: jest.fn((event: string, cb: Function) => {
          if (event === "succeeded") succeededCallback = cb;
        }),
      };

      await handlers![0](newData, req);

      // Cache refresh should be deferred, not called immediately
      expect(mockRefreshTable).not.toHaveBeenCalled();
      expect(req.on).toHaveBeenCalledWith("succeeded", expect.any(Function));

      // Simulate transaction commit
      expect(succeededCallback).toBeDefined();
      await succeededCallback!();
      expect(mockRefreshTable).toHaveBeenCalledWith("ConfigParameter");

      // Audit should still be logged in the AFTER handler
      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "admin-user",
          action: "CONFIG_CREATED",
          resource: "ConfigParameter",
        }),
      );
    });

    it("should include old and new values in audit for UPDATE", async () => {
      const handlers = registeredAfterHandlers.get("UPDATE:ConfigParameters");
      const newData = { ID: "p1", key: "test", value: "new" };
      const req: any = {
        event: "UPDATE",
        data: { ID: "p1" },
        user: { id: "admin-user" },
        _oldValue: { ID: "p1", key: "test", value: "old" },
        on: jest.fn(),
      };

      await handlers![0](newData, req);

      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "CONFIG_UPDATED",
          resource: "ConfigParameter",
        }),
      );

      const auditDetails = JSON.parse(mockLogAudit.mock.calls[0][0].details);
      expect(auditDetails.oldValue).toEqual({ ID: "p1", key: "test", value: "old" });
      expect(auditDetails.newValue).toEqual(newData);
    });

    it("should log CONFIG_DELETED for DELETE events", async () => {
      const handlers = registeredAfterHandlers.get("DELETE:ConfigParameters");
      const req: any = {
        event: "DELETE",
        data: { ID: "p1" },
        user: { id: "admin-user" },
        _oldValue: { ID: "p1", key: "deleted.param" },
        on: jest.fn(),
      };

      await handlers![0](undefined, req);

      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "CONFIG_DELETED",
          resource: "ConfigParameter",
        }),
      );
    });

    it("should use 'system' as userId when user is not available", async () => {
      const handlers = registeredAfterHandlers.get("CREATE:ConfigParameters");
      const req: any = {
        event: "CREATE",
        data: { ID: "p1" },
        user: {},
        on: jest.fn(),
      };

      await handlers![0]({}, req);

      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "system",
        }),
      );
    });

    it("should handle cache refresh errors gracefully in succeeded callback", async () => {
      mockRefreshTable.mockRejectedValueOnce(new Error("Cache error"));

      let succeededCallback: Function | undefined;
      const handlers = registeredAfterHandlers.get("CREATE:ConfigParameters");
      const req: any = {
        event: "CREATE",
        data: { ID: "p1" },
        user: { id: "admin" },
        on: jest.fn((event: string, cb: Function) => {
          if (event === "succeeded") succeededCallback = cb;
        }),
      };

      // AFTER handler should not throw
      await handlers![0]({}, req);

      // Simulate transaction commit - error should be caught
      await succeededCallback!();

      // Audit should still be logged even if cache refresh would fail
      expect(mockLogAudit).toHaveBeenCalled();
    });

    it("should work when req.on is not available (graceful degradation)", async () => {
      const handlers = registeredAfterHandlers.get("CREATE:ConfigParameters");
      const req: any = {
        event: "CREATE",
        data: { ID: "p1" },
        user: { id: "admin" },
        // No `on` method - simulates older CAP or test environment
      };

      // Should not throw
      await handlers![0]({}, req);

      // Audit should still be logged
      expect(mockLogAudit).toHaveBeenCalled();
    });

    it("should call invalidateAdapter when ConfigApiProvider is mutated", async () => {
      let succeededCallback: Function | undefined;
      const handlers = registeredAfterHandlers.get("CREATE:ConfigApiProviders");
      expect(handlers).toBeDefined();

      const req: any = {
        event: "CREATE",
        data: { ID: "p1" },
        user: { id: "admin" },
        on: jest.fn((event: string, cb: Function) => {
          if (event === "succeeded") succeededCallback = cb;
        }),
      };

      await handlers![0]({}, req);

      // Simulate transaction commit
      expect(succeededCallback).toBeDefined();
      await succeededCallback!();
      expect(mockRefreshTable).toHaveBeenCalledWith("ConfigApiProvider");
      expect(mockInvalidateAdapter).toHaveBeenCalled();
    });

    it("should not call invalidateAdapter for non-provider config tables", async () => {
      let succeededCallback: Function | undefined;
      const handlers = registeredAfterHandlers.get("CREATE:ConfigParameters");

      const req: any = {
        event: "CREATE",
        data: { ID: "p1" },
        user: { id: "admin" },
        on: jest.fn((event: string, cb: Function) => {
          if (event === "succeeded") succeededCallback = cb;
        }),
      };

      await handlers![0]({}, req);
      await succeededCallback!();
      expect(mockRefreshTable).toHaveBeenCalledWith("ConfigParameter");
      expect(mockInvalidateAdapter).not.toHaveBeenCalled();
    });
  });

  describe("estimateConfigImpact action", () => {
    it("should register estimateConfigImpact handler", () => {
      expect(registeredOnHandlers.has("estimateConfigImpact")).toBe(true);
    });

    it("should reject when parameterKey is missing", async () => {
      const handler = registeredOnHandlers.get("estimateConfigImpact")![0];
      const rejectedError = new Error("rejected");
      const req: any = {
        data: {},
        reject: jest.fn(() => {
          throw rejectedError;
        }),
      };
      await expect(handler(req)).rejects.toThrow("rejected");
      expect(req.reject).toHaveBeenCalledWith(400, "parameterKey is required");
      expect(mockCacheGet).not.toHaveBeenCalled();
    });

    it("should reject when parameterKey is whitespace-only", async () => {
      const handler = registeredOnHandlers.get("estimateConfigImpact")![0];
      const req: any = {
        data: { parameterKey: "   " },
        reject: jest.fn(() => {
          throw new Error("rejected");
        }),
      };
      await expect(handler(req)).rejects.toThrow("rejected");
      expect(req.reject).toHaveBeenCalledWith(400, "parameterKey is required");
    });

    it("should return impact message for pricing parameter", async () => {
      mockCacheGet.mockReturnValueOnce({ key: "listing.price", category: "pricing" });
      const handler = registeredOnHandlers.get("estimateConfigImpact")![0];
      const req: any = {
        data: { parameterKey: "listing.price" },
        reject: jest.fn(),
      };
      const result = await handler(req);
      expect(mockCacheGet).toHaveBeenCalledWith("ConfigParameter", "listing.price");
      expect(result.message).toContain("prochaines annonces");
    });

    it("should return generic message for non-pricing parameter", async () => {
      mockCacheGet.mockReturnValueOnce({ key: "session.timeout", category: "system" });
      const handler = registeredOnHandlers.get("estimateConfigImpact")![0];
      const req: any = {
        data: { parameterKey: "session.timeout" },
        reject: jest.fn(),
      };
      const result = await handler(req);
      expect(mockCacheGet).toHaveBeenCalledWith("ConfigParameter", "session.timeout");
      expect(result.message).toContain("immediatement");
    });

    it("should return generic message for parameter with null category", async () => {
      mockCacheGet.mockReturnValueOnce({ key: "misc.param", category: null });
      const handler = registeredOnHandlers.get("estimateConfigImpact")![0];
      const req: any = {
        data: { parameterKey: "misc.param" },
        reject: jest.fn(),
      };
      const result = await handler(req);
      expect(result.message).toContain("immediatement");
    });

    it("should return not found message for unknown parameter", async () => {
      mockCacheGet.mockReturnValueOnce(undefined);
      const handler = registeredOnHandlers.get("estimateConfigImpact")![0];
      const req: any = {
        data: { parameterKey: "unknown.key" },
        reject: jest.fn(),
      };
      const result = await handler(req);
      expect(mockCacheGet).toHaveBeenCalledWith("ConfigParameter", "unknown.key");
      expect(result.message).toContain("non trouve");
    });
  });

  describe("getApiCostSummary action", () => {
    it("should register handler", () => {
      expect(registeredOnHandlers.has("getApiCostSummary")).toBe(true);
    });

    it("should reject when period is missing", async () => {
      const handler = registeredOnHandlers.get("getApiCostSummary")![0];
      const req: any = {
        data: {},
        reject: jest.fn(() => {
          throw new Error("rejected");
        }),
      };
      await expect(handler(req)).rejects.toThrow("rejected");
      expect(req.reject).toHaveBeenCalledWith(400, "period is required");
    });

    it("should reject when period is whitespace-only", async () => {
      const handler = registeredOnHandlers.get("getApiCostSummary")![0];
      const req: any = {
        data: { period: "   " },
        reject: jest.fn(() => {
          throw new Error("rejected");
        }),
      };
      await expect(handler(req)).rejects.toThrow("rejected");
      expect(req.reject).toHaveBeenCalledWith(400, "period is required");
    });

    it("should reject when period is invalid", async () => {
      const handler = registeredOnHandlers.get("getApiCostSummary")![0];
      const req: any = {
        data: { period: "year" },
        reject: jest.fn(() => {
          throw new Error("rejected");
        }),
      };
      await expect(handler(req)).rejects.toThrow("rejected");
      expect(req.reject).toHaveBeenCalledWith(
        400,
        expect.stringContaining("period must be one of"),
      );
    });

    it("should return zero summary when no logs found", async () => {
      mockRun.mockResolvedValueOnce([]);
      const handler = registeredOnHandlers.get("getApiCostSummary")![0];
      const req: any = {
        data: { period: "day" },
        reject: jest.fn(),
      };
      const result = await handler(req);
      expect(result).toEqual({ totalCost: 0, callCount: 0, avgCostPerCall: 0, byProvider: "[]" });
    });

    it("should aggregate costs by provider for valid period", async () => {
      const logs = [
        { providerKey: "providerA", cost: 0.01 },
        { providerKey: "providerA", cost: 0.02 },
        { providerKey: "providerB", cost: 0.05 },
      ];
      mockRun.mockResolvedValueOnce(logs);
      const handler = registeredOnHandlers.get("getApiCostSummary")![0];
      const req: any = {
        data: { period: "week" },
        reject: jest.fn(),
      };
      const result = await handler(req);
      expect(result.totalCost).toBe(0.08);
      expect(result.callCount).toBe(3);
      expect(result.avgCostPerCall).toBeCloseTo(0.0267, 3);
      const byProvider = JSON.parse(result.byProvider);
      expect(byProvider).toHaveLength(2);
      expect(byProvider.find((p: any) => p.providerKey === "providerA").callCount).toBe(2);
      expect(byProvider.find((p: any) => p.providerKey === "providerB").callCount).toBe(1);
    });

    it("should return zero when ApiCallLog entity not found", async () => {
      (cds.entities as jest.Mock).mockReturnValueOnce({});
      const handler = registeredOnHandlers.get("getApiCostSummary")![0];
      const req: any = {
        data: { period: "month" },
        reject: jest.fn(),
      };
      const result = await handler(req);
      expect(result).toEqual({ totalCost: 0, callCount: 0, avgCostPerCall: 0, byProvider: "[]" });
    });

    it("should handle month period", async () => {
      mockRun.mockResolvedValueOnce([{ providerKey: "p1", cost: 1.5 }]);
      const handler = registeredOnHandlers.get("getApiCostSummary")![0];
      const req: any = {
        data: { period: "month" },
        reject: jest.fn(),
      };
      const result = await handler(req);
      expect(result.totalCost).toBe(1.5);
      expect(result.callCount).toBe(1);
    });
  });

  describe("getProviderAnalytics action", () => {
    it("should register handler", () => {
      expect(registeredOnHandlers.has("getProviderAnalytics")).toBe(true);
    });

    it("should reject when providerKey is missing", async () => {
      const handler = registeredOnHandlers.get("getProviderAnalytics")![0];
      const req: any = {
        data: {},
        reject: jest.fn(() => {
          throw new Error("rejected");
        }),
      };
      await expect(handler(req)).rejects.toThrow("rejected");
      expect(req.reject).toHaveBeenCalledWith(400, "providerKey is required");
    });

    it("should reject when providerKey is whitespace-only", async () => {
      const handler = registeredOnHandlers.get("getProviderAnalytics")![0];
      const req: any = {
        data: { providerKey: "  " },
        reject: jest.fn(() => {
          throw new Error("rejected");
        }),
      };
      await expect(handler(req)).rejects.toThrow("rejected");
      expect(req.reject).toHaveBeenCalledWith(400, "providerKey is required");
    });

    it("should return zero analytics when no logs found", async () => {
      mockRun.mockResolvedValueOnce([]);
      const handler = registeredOnHandlers.get("getProviderAnalytics")![0];
      const req: any = {
        data: { providerKey: "unknown" },
        reject: jest.fn(),
      };
      const result = await handler(req);
      expect(result).toEqual({
        avgResponseTimeMs: 0,
        successRate: 0,
        totalCalls: 0,
        totalCost: 0,
        avgCostPerCall: 0,
        lastCallTimestamp: null,
      });
    });

    it("should compute analytics correctly including lastCallTimestamp", async () => {
      const logs = [
        { httpStatus: 200, responseTimeMs: 100, cost: 0.01, timestamp: "2026-02-08T10:00:00Z" },
        { httpStatus: 200, responseTimeMs: 200, cost: 0.02, timestamp: "2026-02-09T14:30:00Z" },
        { httpStatus: 500, responseTimeMs: 5000, cost: 0.01, timestamp: "2026-02-07T08:00:00Z" },
      ];
      mockRun.mockResolvedValueOnce(logs);
      const handler = registeredOnHandlers.get("getProviderAnalytics")![0];
      const req: any = {
        data: { providerKey: "test-provider" },
        reject: jest.fn(),
      };
      const result = await handler(req);
      expect(result.totalCalls).toBe(3);
      expect(result.avgResponseTimeMs).toBe(1767);
      expect(result.successRate).toBe(66.67);
      expect(result.totalCost).toBe(0.04);
      expect(result.avgCostPerCall).toBeCloseTo(0.0133, 3);
      expect(result.lastCallTimestamp).toBe("2026-02-09T14:30:00Z");
    });

    it("should return zero when ApiCallLog entity not found", async () => {
      (cds.entities as jest.Mock).mockReturnValueOnce({});
      const handler = registeredOnHandlers.get("getProviderAnalytics")![0];
      const req: any = {
        data: { providerKey: "test" },
        reject: jest.fn(),
      };
      const result = await handler(req);
      expect(result).toEqual({
        avgResponseTimeMs: 0,
        successRate: 0,
        totalCalls: 0,
        totalCost: 0,
        avgCostPerCall: 0,
        lastCallTimestamp: null,
      });
    });
  });

  describe("switchProvider action", () => {
    it("should register handler", () => {
      expect(registeredOnHandlers.has("switchProvider")).toBe(true);
    });

    it("should reject when parameters are missing", async () => {
      const handler = registeredOnHandlers.get("switchProvider")![0];
      const req: any = {
        data: {},
        reject: jest.fn(() => {
          throw new Error("rejected");
        }),
      };
      await expect(handler(req)).rejects.toThrow("rejected");
      expect(req.reject).toHaveBeenCalledWith(
        400,
        "adapterInterface and newProviderKey are required",
      );
    });

    it("should reject when adapterInterface is whitespace-only", async () => {
      const handler = registeredOnHandlers.get("switchProvider")![0];
      const req: any = {
        data: { adapterInterface: "  ", newProviderKey: "test" },
        reject: jest.fn(() => {
          throw new Error("rejected");
        }),
      };
      await expect(handler(req)).rejects.toThrow("rejected");
      expect(req.reject).toHaveBeenCalledWith(
        400,
        "adapterInterface and newProviderKey are required",
      );
    });

    it("should reject when provider not found", async () => {
      mockRun.mockResolvedValueOnce(null);
      const handler = registeredOnHandlers.get("switchProvider")![0];
      const req: any = {
        data: { adapterInterface: "ITestAdapter", newProviderKey: "missing" },
        reject: jest.fn(() => {
          throw new Error("rejected");
        }),
        user: { id: "admin" },
      };
      await expect(handler(req)).rejects.toThrow("rejected");
      expect(req.reject).toHaveBeenCalledWith(404, expect.stringContaining("not found"));
    });

    it("should return success when provider is already active", async () => {
      mockRun.mockResolvedValueOnce({ ID: "p1", key: "test", status: "active" });
      const handler = registeredOnHandlers.get("switchProvider")![0];
      const req: any = {
        data: { adapterInterface: "ITestAdapter", newProviderKey: "test" },
        reject: jest.fn(),
        user: { id: "admin" },
      };
      const result = await handler(req);
      expect(result).toEqual({ success: true, message: "Provider is already active." });
    });

    it("should switch provider successfully", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "p2", key: "new-provider", status: "inactive" })
        .mockResolvedValueOnce([{ ID: "p1", key: "old-provider" }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const handler = registeredOnHandlers.get("switchProvider")![0];
      const req: any = {
        data: { adapterInterface: "ITestAdapter", newProviderKey: "new-provider" },
        reject: jest.fn(),
        user: { id: "admin-user" },
      };
      const result = await handler(req);

      expect(result.success).toBe(true);
      expect(result.message).toContain("new-provider");
      expect(result.message).toContain("old-provider");
      expect(mockInvalidateAdapter).toHaveBeenCalledWith("ITestAdapter");
      expect(mockRefreshTable).toHaveBeenCalledWith("ConfigApiProvider");
      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "admin-user",
          action: "PROVIDER_SWITCHED",
          resource: "ConfigApiProvider",
        }),
      );
    });

    it("should handle switch when no previous active provider", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "p1", key: "first-provider", status: "inactive" })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(undefined);

      const handler = registeredOnHandlers.get("switchProvider")![0];
      const req: any = {
        data: { adapterInterface: "ITestAdapter", newProviderKey: "first-provider" },
        reject: jest.fn(),
        user: { id: "admin" },
      };
      const result = await handler(req);
      expect(result.success).toBe(true);
      expect(result.message).toContain("(none)");
    });

    it("should reject when ConfigApiProvider entity not found", async () => {
      (cds.entities as jest.Mock).mockReturnValueOnce({});
      const handler = registeredOnHandlers.get("switchProvider")![0];
      const req: any = {
        data: { adapterInterface: "ITestAdapter", newProviderKey: "test" },
        reject: jest.fn(() => {
          throw new Error("rejected");
        }),
        user: { id: "admin" },
      };
      await expect(handler(req)).rejects.toThrow("rejected");
      expect(req.reject).toHaveBeenCalledWith(500, "ConfigApiProvider entity not found");
    });
  });
});
