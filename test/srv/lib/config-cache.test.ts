/* eslint-disable @typescript-eslint/no-explicit-any */

const mockEntities: Record<string, string> = {
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
  ConfigRegistrationField: "ConfigRegistrationField",
  ConfigProfileField: "ConfigProfileField",
  ConfigAlert: "ConfigAlert",
  ConfigSeoTemplate: "ConfigSeoTemplate",
};

const mockRun = jest.fn();
const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.mock("@sap/cds", () => ({
  __esModule: true,
  default: {
    log: jest.fn(() => mockLog),
    entities: jest.fn(() => mockEntities),
    run: mockRun,
  },
}));

// Mock CDS query builder
(global as any).SELECT = {
  from: jest.fn().mockReturnValue("select-query"),
};

import { configCache } from "../../../srv/lib/config-cache";

describe("InMemoryConfigCache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    configCache.invalidate(); // Reset cache state between tests
  });

  it("should export a singleton configCache with IConfigCache interface", () => {
    expect(configCache).toBeDefined();
    expect(configCache.get).toBeInstanceOf(Function);
    expect(configCache.getAll).toBeInstanceOf(Function);
    expect(configCache.invalidate).toBeInstanceOf(Function);
    expect(configCache.refresh).toBeInstanceOf(Function);
    expect(configCache.refreshTable).toBeInstanceOf(Function);
    expect(configCache.isReady).toBeInstanceOf(Function);
  });

  it("should not be ready before refresh", () => {
    expect(configCache.isReady()).toBe(false);
  });

  it("should be ready after refresh", async () => {
    mockRun.mockResolvedValue([]);
    await configCache.refresh();
    expect(configCache.isReady()).toBe(true);
  });

  it("should load data from all 14 config tables on refresh", async () => {
    mockRun.mockResolvedValue([]);
    await configCache.refresh();
    // 14 tables: 10 original + ConfigRegistrationField + ConfigProfileField + ConfigAlert + ConfigSeoTemplate
    expect(mockRun).toHaveBeenCalledTimes(14);
  });

  it("should return cached items by key after refresh", async () => {
    // First call (ConfigParameter)
    mockRun.mockResolvedValueOnce([
      { ID: "p1", key: "session.timeout", value: "30" },
      { ID: "p2", key: "listing.price", value: "15" },
    ]);
    // Remaining 13 tables return empty
    for (let i = 0; i < 13; i++) {
      mockRun.mockResolvedValueOnce([]);
    }

    await configCache.refresh();

    const result = configCache.get<{ ID: string; key: string; value: string }>(
      "ConfigParameter",
      "session.timeout",
    );
    expect(result).toEqual({ ID: "p1", key: "session.timeout", value: "30" });
  });

  it("should return all items for a table", async () => {
    mockRun.mockResolvedValueOnce([
      { ID: "p1", key: "a", value: "1" },
      { ID: "p2", key: "b", value: "2" },
    ]);
    for (let i = 0; i < 12; i++) {
      mockRun.mockResolvedValueOnce([]);
    }

    await configCache.refresh();

    const all = configCache.getAll<{ ID: string; key: string }>("ConfigParameter");
    expect(all).toHaveLength(2);
  });

  it("should return undefined for non-existent key", async () => {
    mockRun.mockResolvedValue([]);
    await configCache.refresh();
    expect(configCache.get("ConfigParameter", "nonexistent")).toBeUndefined();
  });

  it("should return empty array for non-existent table", () => {
    expect(configCache.getAll("NonExistent")).toEqual([]);
  });

  it("should invalidate a specific table", async () => {
    mockRun.mockResolvedValueOnce([{ ID: "p1", key: "a", value: "1" }]);
    for (let i = 0; i < 12; i++) {
      mockRun.mockResolvedValueOnce([]);
    }

    await configCache.refresh();
    expect(configCache.get("ConfigParameter", "a")).toBeDefined();

    configCache.invalidate("ConfigParameter");
    expect(configCache.get("ConfigParameter", "a")).toBeUndefined();
    expect(configCache.getAll("ConfigParameter")).toEqual([]);
    // Cache is still marked ready (only one table was invalidated)
    expect(configCache.isReady()).toBe(true);
  });

  it("should invalidate all tables and reset ready state", async () => {
    mockRun.mockResolvedValue([]);
    await configCache.refresh();
    expect(configCache.isReady()).toBe(true);

    configCache.invalidate();
    expect(configCache.isReady()).toBe(false);
  });

  it("should refresh a single table", async () => {
    mockRun.mockResolvedValue([]);
    await configCache.refresh();
    mockRun.mockClear();

    mockRun.mockResolvedValueOnce([{ ID: "new1", key: "new.param", value: "test" }]);
    await configCache.refreshTable("ConfigParameter");

    expect(mockRun).toHaveBeenCalledTimes(1);
    const result = configCache.get<{ value: string }>("ConfigParameter", "new.param");
    expect(result?.value).toBe("test");
  });

  it("should use 'code' as key field for ConfigFeature", async () => {
    // ConfigParameter
    mockRun.mockResolvedValueOnce([]);
    // ConfigText
    mockRun.mockResolvedValueOnce([]);
    // ConfigFeature
    mockRun.mockResolvedValueOnce([
      { ID: "f1", code: "favorites", name: "Favorites", isActive: true },
    ]);
    // Remaining 11 tables
    for (let i = 0; i < 12; i++) {
      mockRun.mockResolvedValueOnce([]);
    }

    await configCache.refresh();

    const feature = configCache.get<{ code: string; name: string }>("ConfigFeature", "favorites");
    expect(feature?.name).toBe("Favorites");
  });

  it("should use composite key (key:language) for ConfigText", async () => {
    // ConfigParameter
    mockRun.mockResolvedValueOnce([]);
    // ConfigText - two rows with same key but different languages
    mockRun.mockResolvedValueOnce([
      { ID: "t1", key: "home.title", language: "fr", value: "Bienvenue" },
      { ID: "t2", key: "home.title", language: "en", value: "Welcome" },
    ]);
    // Remaining 11 tables
    for (let i = 0; i < 12; i++) {
      mockRun.mockResolvedValueOnce([]);
    }

    await configCache.refresh();

    // Both language variants must be accessible
    const fr = configCache.get<{ value: string }>("ConfigText", "home.title:fr");
    expect(fr?.value).toBe("Bienvenue");

    const en = configCache.get<{ value: string }>("ConfigText", "home.title:en");
    expect(en?.value).toBe("Welcome");

    // All rows should be in the list
    const allTexts = configCache.getAll("ConfigText");
    expect(allTexts).toHaveLength(2);
  });

  it("should NOT mark cache as ready when ALL tables fail to load (F5)", async () => {
    mockRun.mockRejectedValue(new Error("DB connection failed"));
    await configCache.refresh();

    // Cache should NOT be ready when all tables fail
    expect(configCache.isReady()).toBe(false);
    expect(configCache.getAll("ConfigParameter")).toEqual([]);
  });

  it("should mark cache as ready when at least some tables succeed", async () => {
    // First table succeeds
    mockRun.mockResolvedValueOnce([]);
    // Rest fail
    for (let i = 0; i < 13; i++) {
      mockRun.mockRejectedValueOnce(new Error("DB error"));
    }
    await configCache.refresh();
    expect(configCache.isReady()).toBe(true);
  });

  it("should atomically swap table data during refreshTable (F4)", async () => {
    // Initial load
    mockRun.mockResolvedValue([]);
    await configCache.refresh();
    mockRun.mockClear();

    // Load initial data for ConfigParameter
    mockRun.mockResolvedValueOnce([{ ID: "p1", key: "old", value: "1" }]);
    await configCache.refreshTable("ConfigParameter");
    expect(configCache.get("ConfigParameter", "old")).toBeDefined();

    // Refresh with new data - old data should be replaced atomically
    mockRun.mockResolvedValueOnce([{ ID: "p2", key: "new", value: "2" }]);
    await configCache.refreshTable("ConfigParameter");
    expect(configCache.get("ConfigParameter", "new")).toBeDefined();
    expect(configCache.get("ConfigParameter", "old")).toBeUndefined();
  });

  it("should use composite key (pageType:language) for ConfigSeoTemplate", async () => {
    mockRun.mockResolvedValue([]);
    await configCache.refresh();
    mockRun.mockClear();

    mockRun.mockResolvedValueOnce([
      {
        ID: "s1",
        pageType: "listing_detail",
        language: "fr",
        metaTitleTemplate: "Titre FR",
        active: true,
      },
      {
        ID: "s2",
        pageType: "listing_detail",
        language: "en",
        metaTitleTemplate: "Title EN",
        active: true,
      },
    ]);
    await configCache.refreshTable("ConfigSeoTemplate");

    const fr = configCache.get<{ metaTitleTemplate: string }>(
      "ConfigSeoTemplate",
      "listing_detail:fr",
    );
    expect(fr?.metaTitleTemplate).toBe("Titre FR");

    const en = configCache.get<{ metaTitleTemplate: string }>(
      "ConfigSeoTemplate",
      "listing_detail:en",
    );
    expect(en?.metaTitleTemplate).toBe("Title EN");

    const all = configCache.getAll("ConfigSeoTemplate");
    expect(all).toHaveLength(2);
  });

  it("should be a singleton (same reference on re-import)", () => {
    const cache2 = jest.requireActual("../../../srv/lib/config-cache").configCache;
    expect(cache2).toBe(configCache);
  });
});
