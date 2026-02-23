/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock configCache before import
jest.mock("../../../srv/lib/config-cache", () => ({
  configCache: {
    isReady: jest.fn(() => false),
    get: jest.fn(() => undefined),
    getAll: jest.fn(() => []),
  },
}));

// Mock @auto/shared before import
jest.mock("@auto/shared", () => {
  const LISTING_FIELDS = [
    {
      fieldName: "make",
      fieldType: "certifiable",
      category: "vehicle_identity",
      labelFr: "Marque",
      required: true,
    },
    {
      fieldName: "model",
      fieldType: "certifiable",
      category: "vehicle_identity",
      labelFr: "Modèle",
      required: true,
    },
    {
      fieldName: "year",
      fieldType: "certifiable",
      category: "vehicle_identity",
      labelFr: "Année",
      required: true,
    },
    {
      fieldName: "fuelType",
      fieldType: "certifiable",
      category: "technical_details",
      labelFr: "Carburant",
      required: true,
    },
    {
      fieldName: "plate",
      fieldType: "certifiable",
      category: "vehicle_identity",
      labelFr: "Plaque",
      required: false,
    },
    {
      fieldName: "vin",
      fieldType: "certifiable",
      category: "vehicle_identity",
      labelFr: "VIN",
      required: false,
    },
    {
      fieldName: "color",
      fieldType: "certifiable",
      category: "technical_details",
      labelFr: "Couleur",
      required: false,
    },
    {
      fieldName: "mileage",
      fieldType: "declaredOnly",
      category: "technical_details",
      labelFr: "Kilométrage",
      required: true,
    },
    {
      fieldName: "price",
      fieldType: "declaredOnly",
      category: "pricing",
      labelFr: "Prix",
      required: true,
    },
    {
      fieldName: "condition",
      fieldType: "declaredOnly",
      category: "condition_description",
      labelFr: "État",
      required: true,
    },
    {
      fieldName: "description",
      fieldType: "declaredOnly",
      category: "condition_description",
      labelFr: "Description",
      required: true,
    },
    {
      fieldName: "options",
      fieldType: "declaredOnly",
      category: "options_equipment",
      labelFr: "Options",
      required: false,
    },
  ];
  return {
    LISTING_FIELDS,
    CERTIFIABLE_FIELDS: LISTING_FIELDS.filter((f: any) => f.fieldType === "certifiable").map(
      (f: any) => f.fieldName,
    ),
    DECLARED_ONLY_FIELDS: LISTING_FIELDS.filter((f: any) => f.fieldType === "declaredOnly").map(
      (f: any) => f.fieldName,
    ),
    DEFAULT_VISIBILITY_WEIGHTS: {
      certifiedFieldWeight: 5,
      declaredFieldWeight: 2,
      photoWeight: 3,
      photoMax: 10,
      historyReportWeight: 10,
      descriptionBonusWeight: 5,
      descriptionMinLength: 100,
      ageThreshold: 15,
      ageNormalizationFactor: 0.8,
      labelThresholdLow: 34,
      labelThresholdHigh: 67,
    },
    VISIBILITY_LABELS: {
      low: "Partiellement documenté",
      medium: "Bien documenté",
      high: "Très documenté",
    },
    VISIBILITY_SUGGESTIONS: {
      make: "Indiquez la marque du véhicule",
      model: "Renseignez le modèle",
      price: "Indiquez le prix",
      photo: "Ajoutez des photos",
      historyReport: "Ajoutez un rapport d'historique",
      descriptionBonus: "Enrichissez votre description",
    },
    VISIBILITY_CONFIG_KEYS: {
      certifiedFieldWeight: "visibility.certifiedField",
      declaredFieldWeight: "visibility.declaredField",
      photoWeight: "visibility.photo",
      photoMax: "visibility.photoMax",
      historyReportWeight: "visibility.historyReport",
      descriptionBonusWeight: "visibility.descriptionBonus",
      descriptionMinLength: "visibility.descriptionMinLength",
      ageThreshold: "visibility.ageThreshold",
      ageNormalizationFactor: "visibility.ageNormFactor",
      labelThresholdLow: "visibility.labelThresholdLow",
      labelThresholdHigh: "visibility.labelThresholdHigh",
    },
    validateListingField: jest.fn(() => null),
  };
});

import {
  calculateVisibilityScore,
  getFilledFieldsFromListing,
  loadWeightsFromConfig,
} from "../../../srv/lib/visibility-score";
import type { VisibilityScoreInput, VisibilityScoreWeights } from "@auto/shared";
import { configCache } from "../../../srv/lib/config-cache";

// Default weights for tests (matching mock)
const defaultWeights: VisibilityScoreWeights = {
  certifiedFieldWeight: 5,
  declaredFieldWeight: 2,
  photoWeight: 3,
  photoMax: 10,
  historyReportWeight: 10,
  descriptionBonusWeight: 5,
  descriptionMinLength: 100,
  ageThreshold: 15,
  ageNormalizationFactor: 0.8,
  labelThresholdLow: 34,
  labelThresholdHigh: 67,
};

describe("visibility-score", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("calculateVisibilityScore", () => {
    it("should return 0 with empty listing and no photos", () => {
      const input: VisibilityScoreInput = {
        listing: {},
        photoCount: 0,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      expect(result.score).toBe(0);
      expect(result.label).toBe("Partiellement documenté");
    });

    it("should return higher score with more fields filled", () => {
      const fewFields: VisibilityScoreInput = {
        listing: { make: "Renault" },
        photoCount: 0,
        hasHistoryReport: false,
      };
      const manyFields: VisibilityScoreInput = {
        listing: { make: "Renault", model: "Clio", price: 15000, mileage: 50000 },
        photoCount: 0,
        hasHistoryReport: false,
      };
      const fewResult = calculateVisibilityScore(fewFields, defaultWeights);
      const manyResult = calculateVisibilityScore(manyFields, defaultWeights);
      expect(manyResult.score).toBeGreaterThan(fewResult.score);
    });

    it("should include photo points in score", () => {
      const noPhotos: VisibilityScoreInput = {
        listing: { make: "Renault" },
        photoCount: 0,
        hasHistoryReport: false,
      };
      const withPhotos: VisibilityScoreInput = {
        listing: { make: "Renault" },
        photoCount: 5,
        hasHistoryReport: false,
      };
      const noPhotoResult = calculateVisibilityScore(noPhotos, defaultWeights);
      const withPhotoResult = calculateVisibilityScore(withPhotos, defaultWeights);
      expect(withPhotoResult.score).toBeGreaterThan(noPhotoResult.score);
    });

    it("should cap photo points at photoMax", () => {
      const maxPhotos: VisibilityScoreInput = {
        listing: {},
        photoCount: 10,
        hasHistoryReport: false,
      };
      const overMax: VisibilityScoreInput = {
        listing: {},
        photoCount: 20,
        hasHistoryReport: false,
      };
      const maxResult = calculateVisibilityScore(maxPhotos, defaultWeights);
      const overResult = calculateVisibilityScore(overMax, defaultWeights);
      expect(overResult.score).toBe(maxResult.score);
    });

    it("should add history report bonus", () => {
      const noHistory: VisibilityScoreInput = {
        listing: {},
        photoCount: 0,
        hasHistoryReport: false,
      };
      const withHistory: VisibilityScoreInput = {
        listing: {},
        photoCount: 0,
        hasHistoryReport: true,
      };
      const noResult = calculateVisibilityScore(noHistory, defaultWeights);
      const withResult = calculateVisibilityScore(withHistory, defaultWeights);
      expect(withResult.score).toBeGreaterThan(noResult.score);
    });

    it("should add description length bonus when description is long enough", () => {
      const shortDesc: VisibilityScoreInput = {
        listing: { description: "Short" },
        photoCount: 0,
        hasHistoryReport: false,
      };
      const longDesc: VisibilityScoreInput = {
        listing: { description: "A".repeat(150) },
        photoCount: 0,
        hasHistoryReport: false,
      };
      const shortResult = calculateVisibilityScore(shortDesc, defaultWeights);
      const longResult = calculateVisibilityScore(longDesc, defaultWeights);
      // Long description gets both the declared field points AND the description bonus
      expect(longResult.score).toBeGreaterThan(shortResult.score);
    });

    it("should return score between 0 and 100", () => {
      const input: VisibilityScoreInput = {
        listing: { make: "Renault", model: "Clio" },
        photoCount: 3,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it("should return integer score", () => {
      const input: VisibilityScoreInput = {
        listing: { make: "Renault" },
        photoCount: 1,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      expect(Number.isInteger(result.score)).toBe(true);
    });

    it("should return correct label for low score", () => {
      const input: VisibilityScoreInput = {
        listing: { make: "Renault" },
        photoCount: 0,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      expect(result.label).toBe("Partiellement documenté");
    });

    it("should return correct label for medium score", () => {
      // Fill enough fields to get 34-66 range
      const input: VisibilityScoreInput = {
        listing: {
          make: "Renault",
          model: "Clio",
          year: 2020,
          fuelType: "essence",
          price: 15000,
          mileage: 50000,
          condition: "Bon",
        },
        photoCount: 3,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      expect(result.score).toBeGreaterThanOrEqual(34);
      expect(result.label).toBe("Bien documenté");
    });

    it("should return correct label for high score", () => {
      // Fill all fields + photos + history
      const input: VisibilityScoreInput = {
        listing: {
          make: "Renault",
          model: "Clio",
          year: 2020,
          fuelType: "essence",
          plate: "AB-123-CD",
          vin: "12345678901234567",
          color: "rouge",
          mileage: 50000,
          price: 15000,
          condition: "Bon",
          description: "A".repeat(200),
          options: "GPS, clim",
        },
        photoCount: 10,
        hasHistoryReport: true,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      expect(result.score).toBeGreaterThanOrEqual(67);
      expect(result.label).toBe("Très documenté");
    });
  });

  describe("age normalization", () => {
    it("should normalize score for vehicles older than age threshold", () => {
      const oldVehicle: VisibilityScoreInput = {
        listing: { make: "Renault", model: "Clio", year: 2000 },
        photoCount: 0,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(oldVehicle, defaultWeights);
      expect(result.normalizedScore).toBeDefined();
      expect(result.normalizedScore!).toBeGreaterThan(result.score);
      expect(result.normalizationMessage).toBe("Bon score pour un véhicule de 2000");
    });

    it("should not normalize for recent vehicles", () => {
      const recentVehicle: VisibilityScoreInput = {
        listing: { make: "Renault", model: "Clio", year: 2023 },
        photoCount: 0,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(recentVehicle, defaultWeights);
      expect(result.normalizedScore).toBeUndefined();
      expect(result.normalizationMessage).toBeUndefined();
    });

    it("should cap normalized score at 100", () => {
      // Fill many fields for an old vehicle
      const input: VisibilityScoreInput = {
        listing: {
          make: "Renault",
          model: "Clio",
          year: 1990,
          fuelType: "essence",
          plate: "AB-123-CD",
          vin: "12345678901234567",
          color: "rouge",
          mileage: 150000,
          price: 3000,
          condition: "Correct",
          description: "A".repeat(200),
          options: "basique",
        },
        photoCount: 10,
        hasHistoryReport: true,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      expect(result.normalizedScore).toBeDefined();
      expect(result.normalizedScore!).toBeLessThanOrEqual(100);
    });
  });

  describe("suggestions", () => {
    it("should suggest missing fields", () => {
      const input: VisibilityScoreInput = {
        listing: { make: "Renault" },
        photoCount: 0,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      expect(result.suggestions.length).toBeGreaterThan(0);
      // Should suggest model (missing)
      expect(result.suggestions.some((s) => s.field === "model")).toBe(true);
      // Should not suggest make (already filled)
      expect(result.suggestions.some((s) => s.field === "make")).toBe(false);
    });

    it("should suggest photos when below max", () => {
      const input: VisibilityScoreInput = {
        listing: { make: "Renault" },
        photoCount: 2,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      expect(result.suggestions.some((s) => s.field === "photo")).toBe(true);
    });

    it("should not suggest photos when at max", () => {
      const input: VisibilityScoreInput = {
        listing: { make: "Renault" },
        photoCount: 10,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      expect(result.suggestions.some((s) => s.field === "photo")).toBe(false);
    });

    it("should suggest history report when missing", () => {
      const input: VisibilityScoreInput = {
        listing: {},
        photoCount: 0,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      expect(result.suggestions.some((s) => s.field === "historyReport")).toBe(true);
    });

    it("should not suggest history report when present", () => {
      const input: VisibilityScoreInput = {
        listing: {},
        photoCount: 0,
        hasHistoryReport: true,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      expect(result.suggestions.some((s) => s.field === "historyReport")).toBe(false);
    });

    it("should suggest description bonus when description is short", () => {
      const input: VisibilityScoreInput = {
        listing: { description: "Short" },
        photoCount: 0,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      expect(result.suggestions.some((s) => s.field === "descriptionBonus")).toBe(true);
    });

    it("should not suggest description bonus when description is long enough", () => {
      const input: VisibilityScoreInput = {
        listing: { description: "A".repeat(200) },
        photoCount: 0,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      expect(result.suggestions.some((s) => s.field === "descriptionBonus")).toBe(false);
    });

    it("should sort suggestions by highest boost first", () => {
      const input: VisibilityScoreInput = {
        listing: {},
        photoCount: 0,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      for (let i = 1; i < result.suggestions.length; i++) {
        expect(result.suggestions[i].boost).toBeLessThanOrEqual(result.suggestions[i - 1].boost);
      }
    });

    it("should include boost value in each suggestion", () => {
      const input: VisibilityScoreInput = {
        listing: {},
        photoCount: 0,
        hasHistoryReport: false,
      };
      const result = calculateVisibilityScore(input, defaultWeights);
      for (const suggestion of result.suggestions) {
        expect(suggestion.boost).toBeGreaterThanOrEqual(0);
        expect(typeof suggestion.boost).toBe("number");
        expect(suggestion.message).toBeTruthy();
        expect(suggestion.field).toBeTruthy();
      }
    });
  });

  describe("loadWeightsFromConfig", () => {
    it("should return defaults when config cache is not ready", () => {
      (configCache.isReady as jest.Mock).mockReturnValue(false);
      const weights = loadWeightsFromConfig();
      expect(weights).toEqual(defaultWeights);
    });

    it("should load weights from config cache when ready", () => {
      (configCache.isReady as jest.Mock).mockReturnValue(true);
      (configCache.get as jest.Mock).mockImplementation((_table: string, key: string) => {
        if (key === "visibility.certifiedField") return { factor: 8 };
        if (key === "visibility.photo") return { factor: 5 };
        return undefined;
      });
      const weights = loadWeightsFromConfig();
      expect(weights.certifiedFieldWeight).toBe(8);
      expect(weights.photoWeight).toBe(5);
      // Non-overridden values should remain default
      expect(weights.declaredFieldWeight).toBe(2);
    });
  });

  describe("getFilledFieldsFromListing", () => {
    it("should mark fields as filled when they have values", () => {
      const listing = { make: "Renault", model: "Clio", year: 2022, price: 15000 };
      const filled = getFilledFieldsFromListing(listing);
      expect(filled.make).toBe(true);
      expect(filled.model).toBe(true);
      expect(filled.year).toBe(true);
      expect(filled.price).toBe(true);
    });

    it("should mark fields as not filled when null or empty string", () => {
      const listing = { make: null, model: "", price: undefined };
      const filled = getFilledFieldsFromListing(listing);
      expect(filled.make).toBe(false);
      expect(filled.model).toBe(false);
      expect(filled.price).toBe(false);
    });

    it("should treat 0 as filled", () => {
      const listing = { year: 0, mileage: 0 };
      const filled = getFilledFieldsFromListing(listing);
      expect(filled.year).toBe(true);
      expect(filled.mileage).toBe(true);
    });

    it("should handle missing fields as not filled", () => {
      const listing = {};
      const filled = getFilledFieldsFromListing(listing);
      expect(filled.make).toBe(false);
      expect(filled.price).toBe(false);
    });
  });
});
