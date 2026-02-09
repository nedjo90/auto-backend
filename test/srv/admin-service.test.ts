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
  from: jest.fn().mockReturnValue("select-query"),
};

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
});
