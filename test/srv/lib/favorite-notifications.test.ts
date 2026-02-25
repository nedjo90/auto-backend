/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
let uuidCounter = 0;

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        Favorite: "Favorite",
        Notification: "Notification",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => `uuid-${++uuidCounter}` },
      ApplicationService: class {
        async init() {}
        on(_event: string, _handler: any) {}
        before(_event: string | string[], _entity: string, _handler: any) {}
        after(_event: string | string[], _entity: string, _handler: any) {}
      },
    },
  };
});

// Global CDS query helpers
(global as any).SELECT = {
  from: jest.fn().mockReturnValue({
    columns: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("q"),
    }),
    where: jest.fn().mockReturnValue("q"),
  }),
};

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-q"),
  }),
};

// ─── Import module ──────────────────────────────────────────────────────────

const { notifyPriceChange, notifySold } = require("../../../srv/lib/favorite-notifications");

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("favorite-notifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    uuidCounter = 0;
  });

  describe("notifyPriceChange", () => {
    it("should create notifications for all favoriting users on price decrease", async () => {
      // Users who favorited
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }, { userId: "buyer-2" }]);
      // INSERT notifications
      mockRun.mockResolvedValueOnce(undefined);

      const count = await notifyPriceChange("listing-1", "Renault", "Clio", 15000, 14000);

      expect(count).toBe(2);
      expect(mockRun).toHaveBeenCalledTimes(2);
    });

    it("should create notifications on price increase", async () => {
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }]);
      mockRun.mockResolvedValueOnce(undefined);

      const count = await notifyPriceChange("listing-1", "Peugeot", "308", 14000, 16000);

      expect(count).toBe(1);
    });

    it("should include correct message for price decrease", async () => {
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }]);
      mockRun.mockResolvedValueOnce(undefined);

      await notifyPriceChange("listing-1", "Renault", "Clio", 15000, 14000);

      // Verify the INSERT call contains correct message
      const insertCall = (INSERT.into as jest.Mock).mock.results[0]?.value;
      const entriesCall = insertCall?.entries as jest.Mock;
      if (entriesCall) {
        const entries = entriesCall.mock.calls[0][0];
        expect(entries[0].type).toBe("price_change");
        expect(entries[0].message).toContain("baissé");
        expect(entries[0].message).toContain("15000€");
        expect(entries[0].message).toContain("14000€");
      }
    });

    it("should include correct message for price increase", async () => {
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }]);
      mockRun.mockResolvedValueOnce(undefined);

      await notifyPriceChange("listing-1", "Renault", "Clio", 14000, 16000);

      const insertCall = (INSERT.into as jest.Mock).mock.results[0]?.value;
      const entriesCall = insertCall?.entries as jest.Mock;
      if (entriesCall) {
        const entries = entriesCall.mock.calls[0][0];
        expect(entries[0].message).toContain("augmenté");
      }
    });

    it("should return 0 when no users favorited the listing", async () => {
      mockRun.mockResolvedValueOnce([]); // no favorites

      const count = await notifyPriceChange("listing-1", "Renault", "Clio", 15000, 14000);

      expect(count).toBe(0);
      expect(mockRun).toHaveBeenCalledTimes(1); // only the select
    });

    it("should handle null make/model", async () => {
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }]);
      mockRun.mockResolvedValueOnce(undefined);

      const count = await notifyPriceChange("listing-1", null, null, 15000, 14000);

      expect(count).toBe(1);
    });
  });

  describe("notifySold", () => {
    it("should create sold notifications for all favoriting users", async () => {
      mockRun.mockResolvedValueOnce([
        { userId: "buyer-1" },
        { userId: "buyer-2" },
        { userId: "buyer-3" },
      ]);
      mockRun.mockResolvedValueOnce(undefined);

      const count = await notifySold("listing-1", "Peugeot", "3008");

      expect(count).toBe(3);
    });

    it("should include correct sold message", async () => {
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }]);
      mockRun.mockResolvedValueOnce(undefined);

      await notifySold("listing-1", "Peugeot", "3008");

      const insertCall = (INSERT.into as jest.Mock).mock.results[0]?.value;
      const entriesCall = insertCall?.entries as jest.Mock;
      if (entriesCall) {
        const entries = entriesCall.mock.calls[0][0];
        expect(entries[0].type).toBe("sold");
        expect(entries[0].message).toContain("vendu");
        expect(entries[0].message).toContain("Peugeot 3008");
      }
    });

    it("should return 0 when no users favorited the listing", async () => {
      mockRun.mockResolvedValueOnce([]);

      const count = await notifySold("listing-1", "Renault", "Clio");

      expect(count).toBe(0);
    });
  });
});
