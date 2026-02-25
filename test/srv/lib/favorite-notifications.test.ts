/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockCreateNotification = jest.fn();

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        Favorite: "Favorite",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => "mock-uuid" },
      ApplicationService: class {
        async init() {}
        on(_event: string, _handler: any) {}
        before(_event: string | string[], _entity: string, _handler: any) {}
        after(_event: string | string[], _entity: string, _handler: any) {}
      },
    },
  };
});

jest.mock("../../../srv/lib/notification-emitter", () => ({
  createNotification: (...args: any[]) => mockCreateNotification(...args),
}));

// Global CDS query helpers
(global as any).SELECT = {
  from: jest.fn().mockReturnValue({
    columns: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("q"),
    }),
    where: jest.fn().mockReturnValue("q"),
  }),
};

// ─── Import module ──────────────────────────────────────────────────────────

const { notifyPriceChange, notifySold } = require("../../../srv/lib/favorite-notifications");

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("favorite-notifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    mockCreateNotification.mockReset();
  });

  describe("notifyPriceChange", () => {
    it("should create notifications for all favoriting users on price decrease", async () => {
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }, { userId: "buyer-2" }]);
      mockCreateNotification.mockResolvedValue("notif-id");

      const count = await notifyPriceChange("listing-1", "Renault", "Clio", 15000, 14000);

      expect(count).toBe(2);
      expect(mockCreateNotification).toHaveBeenCalledTimes(2);
      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "buyer-1",
          type: "price_change",
          title: "Changement de prix",
          listingId: "listing-1",
        }),
      );
    });

    it("should create notifications on price increase", async () => {
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }]);
      mockCreateNotification.mockResolvedValue("notif-id");

      const count = await notifyPriceChange("listing-1", "Peugeot", "308", 14000, 16000);

      expect(count).toBe(1);
    });

    it("should include correct body for price decrease", async () => {
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }]);
      mockCreateNotification.mockResolvedValue("notif-id");

      await notifyPriceChange("listing-1", "Renault", "Clio", 15000, 14000);

      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("baissé"),
        }),
      );
      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("15000€"),
        }),
      );
    });

    it("should include correct body for price increase", async () => {
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }]);
      mockCreateNotification.mockResolvedValue("notif-id");

      await notifyPriceChange("listing-1", "Renault", "Clio", 14000, 16000);

      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("augmenté"),
        }),
      );
    });

    it("should return 0 when no users favorited the listing", async () => {
      mockRun.mockResolvedValueOnce([]);

      const count = await notifyPriceChange("listing-1", "Renault", "Clio", 15000, 14000);

      expect(count).toBe(0);
      expect(mockRun).toHaveBeenCalledTimes(1);
      expect(mockCreateNotification).not.toHaveBeenCalled();
    });

    it("should handle null make/model", async () => {
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }]);
      mockCreateNotification.mockResolvedValue("notif-id");

      const count = await notifyPriceChange("listing-1", null, null, 15000, 14000);

      expect(count).toBe(1);
      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("véhicule"),
        }),
      );
    });

    it("should include actionUrl with listing path", async () => {
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }]);
      mockCreateNotification.mockResolvedValue("notif-id");

      await notifyPriceChange("listing-1", "Renault", "Clio", 15000, 14000);

      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          actionUrl: "/listing/listing-1",
        }),
      );
    });

    it("should count only successfully created notifications", async () => {
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }, { userId: "buyer-2" }]);
      mockCreateNotification.mockResolvedValueOnce("notif-id").mockResolvedValueOnce(null); // blocked by preference

      const count = await notifyPriceChange("listing-1", "Renault", "Clio", 15000, 14000);

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
      mockCreateNotification.mockResolvedValue("notif-id");

      const count = await notifySold("listing-1", "Peugeot", "3008");

      expect(count).toBe(3);
      expect(mockCreateNotification).toHaveBeenCalledTimes(3);
    });

    it("should include correct sold message", async () => {
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }]);
      mockCreateNotification.mockResolvedValue("notif-id");

      await notifySold("listing-1", "Peugeot", "3008");

      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "sold",
          title: "Véhicule vendu",
          body: expect.stringContaining("vendu"),
        }),
      );
      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("Peugeot 3008"),
        }),
      );
    });

    it("should return 0 when no users favorited the listing", async () => {
      mockRun.mockResolvedValueOnce([]);

      const count = await notifySold("listing-1", "Renault", "Clio");

      expect(count).toBe(0);
      expect(mockCreateNotification).not.toHaveBeenCalled();
    });

    it("should include actionUrl", async () => {
      mockRun.mockResolvedValueOnce([{ userId: "buyer-1" }]);
      mockCreateNotification.mockResolvedValue("notif-id");

      await notifySold("listing-1", "Renault", "Clio");

      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          actionUrl: "/listing/listing-1",
          listingId: "listing-1",
        }),
      );
    });
  });
});
