/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock @sap/cds
jest.mock("@sap/cds", () => ({
  log: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Mock adapter factory
const mockEvaluate = jest.fn();
jest.mock("../../../srv/adapters/factory/adapter-factory", () => ({
  getValuation: jest.fn(() => ({
    evaluate: mockEvaluate,
  })),
}));

import {
  computeMarketComparison,
  classifyPosition,
  formatDisplayText,
  clearMarketPriceCache,
  getMarketPriceCacheSize,
} from "../../../srv/lib/market-price";
import type { MarketPriceInput } from "../../../srv/lib/market-price";
import type { ValuationResponse } from "@auto/shared";

const baseListing: MarketPriceInput = {
  make: "Peugeot",
  model: "3008",
  year: 2020,
  mileage: 60000,
  fuelType: "Diesel",
  price: 20000,
};

function mockValuation(estimated: number): ValuationResponse {
  return {
    estimatedValueEur: estimated,
    minValueEur: Math.round(estimated * 0.88),
    maxValueEur: Math.round(estimated * 1.12),
    confidence: 0.85,
    valuationDate: "2026-02-25",
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  };
}

describe("market-price", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearMarketPriceCache();
  });

  describe("classifyPosition", () => {
    it("returns 'below' when diff <= -5%", () => {
      expect(classifyPosition(-5)).toBe("below");
      expect(classifyPosition(-10)).toBe("below");
      expect(classifyPosition(-50)).toBe("below");
    });

    it("returns 'aligned' when -5% < diff < 5%", () => {
      expect(classifyPosition(-4.9)).toBe("aligned");
      expect(classifyPosition(0)).toBe("aligned");
      expect(classifyPosition(4.9)).toBe("aligned");
    });

    it("returns 'above' when diff >= 5%", () => {
      expect(classifyPosition(5)).toBe("above");
      expect(classifyPosition(10)).toBe("above");
      expect(classifyPosition(50)).toBe("above");
    });

    it("handles exact boundary at -5%", () => {
      expect(classifyPosition(-5)).toBe("below");
    });

    it("handles exact boundary at 5%", () => {
      expect(classifyPosition(5)).toBe("above");
    });
  });

  describe("formatDisplayText", () => {
    it("formats below market text with percentage", () => {
      expect(formatDisplayText("below", -8.3)).toBe("8% en dessous du marché");
    });

    it("formats above market text with percentage", () => {
      expect(formatDisplayText("above", 12.7)).toBe("13% au-dessus du marché");
    });

    it("formats aligned text", () => {
      expect(formatDisplayText("aligned", 2.1)).toBe("Prix aligné");
    });

    it("formats unavailable text", () => {
      expect(formatDisplayText("unavailable", 0)).toBe("Estimation non disponible");
    });

    it("rounds percentage to integer", () => {
      expect(formatDisplayText("below", -15.9)).toBe("16% en dessous du marché");
      expect(formatDisplayText("above", 7.1)).toBe("7% au-dessus du marché");
    });
  });

  describe("cache", () => {
    beforeEach(() => {
      clearMarketPriceCache();
    });

    it("should cache results and not call adapter on second call", async () => {
      mockEvaluate.mockResolvedValue(mockValuation(25000));
      await computeMarketComparison(baseListing);
      expect(mockEvaluate).toHaveBeenCalledTimes(1);

      // Second call with same input — should use cache
      const result = await computeMarketComparison(baseListing);
      expect(mockEvaluate).toHaveBeenCalledTimes(1); // not called again
      expect(result.position).toBe("below");
    });

    it("should not use cache for different inputs", async () => {
      mockEvaluate.mockResolvedValue(mockValuation(25000));
      await computeMarketComparison(baseListing);
      await computeMarketComparison({ ...baseListing, price: 30000 });
      expect(mockEvaluate).toHaveBeenCalledTimes(2);
    });

    it("should cache unavailable results from adapter returning null", async () => {
      mockEvaluate.mockResolvedValue(null);
      await computeMarketComparison(baseListing);
      expect(mockEvaluate).toHaveBeenCalledTimes(1);

      const result = await computeMarketComparison(baseListing);
      expect(mockEvaluate).toHaveBeenCalledTimes(1);
      expect(result.position).toBe("unavailable");
    });

    it("should not cache errors (adapter throws)", async () => {
      mockEvaluate.mockRejectedValueOnce(new Error("fail"));
      await computeMarketComparison(baseListing);
      expect(mockEvaluate).toHaveBeenCalledTimes(1);

      // Second call should retry
      mockEvaluate.mockResolvedValue(mockValuation(20000));
      const result = await computeMarketComparison(baseListing);
      expect(mockEvaluate).toHaveBeenCalledTimes(2);
      expect(result.position).toBe("aligned");
    });

    it("should not cache results for incomplete listings", async () => {
      const result = await computeMarketComparison({ ...baseListing, make: null });
      expect(result.position).toBe("unavailable");
      expect(getMarketPriceCacheSize()).toBe(0);
    });

    it("clearMarketPriceCache should empty the cache", async () => {
      mockEvaluate.mockResolvedValue(mockValuation(25000));
      await computeMarketComparison(baseListing);
      expect(getMarketPriceCacheSize()).toBe(1);

      clearMarketPriceCache();
      expect(getMarketPriceCacheSize()).toBe(0);

      // Next call should hit adapter again
      await computeMarketComparison(baseListing);
      expect(mockEvaluate).toHaveBeenCalledTimes(2);
    });
  });

  describe("computeMarketComparison", () => {
    it("returns 'below' when listing price is significantly below market", async () => {
      mockEvaluate.mockResolvedValue(mockValuation(25000));
      // price=20000, market=25000 → diff = (20000-25000)/25000*100 = -20%
      const result = await computeMarketComparison(baseListing);
      expect(result.position).toBe("below");
      expect(result.percentageDiff).toBe(-20);
      expect(result.displayText).toBe("20% en dessous du marché");
    });

    it("returns 'aligned' when listing price is near market value", async () => {
      mockEvaluate.mockResolvedValue(mockValuation(20000));
      // price=20000, market=20000 → diff = 0%
      const result = await computeMarketComparison(baseListing);
      expect(result.position).toBe("aligned");
      expect(result.percentageDiff).toBe(0);
      expect(result.displayText).toBe("Prix aligné");
    });

    it("returns 'above' when listing price is significantly above market", async () => {
      mockEvaluate.mockResolvedValue(mockValuation(15000));
      // price=20000, market=15000 → diff = (20000-15000)/15000*100 = 33.33%
      const result = await computeMarketComparison(baseListing);
      expect(result.position).toBe("above");
      expect(result.percentageDiff).toBe(33);
      expect(result.displayText).toBe("33% au-dessus du marché");
    });

    it("returns 'unavailable' when adapter returns null", async () => {
      mockEvaluate.mockResolvedValue(null);
      const result = await computeMarketComparison(baseListing);
      expect(result.position).toBe("unavailable");
      expect(result.percentageDiff).toBeNull();
      expect(result.displayText).toBe("Estimation non disponible");
    });

    it("returns 'unavailable' when adapter returns 0 estimated value", async () => {
      mockEvaluate.mockResolvedValue(mockValuation(0));
      const result = await computeMarketComparison(baseListing);
      expect(result.position).toBe("unavailable");
      expect(result.percentageDiff).toBeNull();
    });

    it("returns 'unavailable' when adapter throws an error", async () => {
      mockEvaluate.mockRejectedValue(new Error("Provider unavailable"));
      const result = await computeMarketComparison(baseListing);
      expect(result.position).toBe("unavailable");
      expect(result.percentageDiff).toBeNull();
      expect(result.displayText).toBe("Estimation non disponible");
    });

    it("returns 'unavailable' when listing has no make", async () => {
      const result = await computeMarketComparison({ ...baseListing, make: null });
      expect(result.position).toBe("unavailable");
      expect(mockEvaluate).not.toHaveBeenCalled();
    });

    it("returns 'unavailable' when listing has no model", async () => {
      const result = await computeMarketComparison({ ...baseListing, model: null });
      expect(result.position).toBe("unavailable");
      expect(mockEvaluate).not.toHaveBeenCalled();
    });

    it("returns 'unavailable' when listing has no year", async () => {
      const result = await computeMarketComparison({ ...baseListing, year: null });
      expect(result.position).toBe("unavailable");
      expect(mockEvaluate).not.toHaveBeenCalled();
    });

    it("returns 'unavailable' when listing has no mileage", async () => {
      const result = await computeMarketComparison({ ...baseListing, mileage: null });
      expect(result.position).toBe("unavailable");
      expect(mockEvaluate).not.toHaveBeenCalled();
    });

    it("returns 'unavailable' when listing has no fuelType", async () => {
      const result = await computeMarketComparison({ ...baseListing, fuelType: null });
      expect(result.position).toBe("unavailable");
      expect(mockEvaluate).not.toHaveBeenCalled();
    });

    it("returns 'unavailable' when listing has no price", async () => {
      const result = await computeMarketComparison({ ...baseListing, price: null });
      expect(result.position).toBe("unavailable");
      expect(mockEvaluate).not.toHaveBeenCalled();
    });

    it("handles boundary at exactly -5% difference", async () => {
      // price=19000, market=20000 → diff = -5%
      mockEvaluate.mockResolvedValue(mockValuation(20000));
      const result = await computeMarketComparison({ ...baseListing, price: 19000 });
      expect(result.position).toBe("below");
      expect(result.percentageDiff).toBe(-5);
    });

    it("handles boundary at exactly +5% difference", async () => {
      // price=21000, market=20000 → diff = 5%
      mockEvaluate.mockResolvedValue(mockValuation(20000));
      const result = await computeMarketComparison({ ...baseListing, price: 21000 });
      expect(result.position).toBe("above");
      expect(result.percentageDiff).toBe(5);
    });

    it("handles small percentage just inside aligned range", async () => {
      // price=20999, market=20000 → diff = 4.995%
      mockEvaluate.mockResolvedValue(mockValuation(20000));
      const result = await computeMarketComparison({ ...baseListing, price: 20999 });
      expect(result.position).toBe("aligned");
    });

    it("passes correct parameters to the valuation adapter", async () => {
      mockEvaluate.mockResolvedValue(mockValuation(20000));
      await computeMarketComparison(baseListing);
      expect(mockEvaluate).toHaveBeenCalledWith({
        make: "Peugeot",
        model: "3008",
        year: 2020,
        mileageKm: 60000,
        fuelType: "Diesel",
      });
    });
  });
});
