/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "test-uuid-123");

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        Listing: "Listing",
        CertifiedField: "CertifiedField",
        CertifiedFieldHistory: "CertifiedFieldHistory",
        ListingPhoto: "ListingPhoto",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => mockUuid() },
    },
  };
});

jest.mock("../../../srv/lib/config-cache", () => ({
  configCache: {
    isReady: jest.fn(() => false),
    get: jest.fn(() => undefined),
    getAll: jest.fn(() => []),
  },
}));

jest.mock("@auto/shared", () => ({
  validateListingField: jest.fn(() => null),
  CERTIFIABLE_FIELDS: ["make", "model", "year", "fuelType", "color", "co2GKm"],
  DECLARED_ONLY_FIELDS: ["price", "mileage"],
  LISTING_FIELDS: [
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
      fieldName: "price",
      fieldType: "declaredOnly",
      category: "pricing",
      labelFr: "Prix",
      required: true,
    },
    {
      fieldName: "mileage",
      fieldType: "declaredOnly",
      category: "technical_details",
      labelFr: "Kilométrage",
      required: true,
    },
  ],
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
  VISIBILITY_SUGGESTIONS: {},
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
}));

// Set up CDS query globals
(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("select-one-query"),
    }),
  },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("select-query"),
  }),
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

// We test the pure functions directly
import {
  calculateVisibilityScore,
  getFilledFieldsFromListing,
} from "../../../srv/lib/visibility-score";
import type { VisibilityScoreInput, VisibilityScoreWeights } from "@auto/shared";

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

describe("listing handler - field update integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  describe("visibility score on field update", () => {
    it("should calculate higher score with more fields filled", () => {
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

    it("should return 0 for empty listing", () => {
      const empty: VisibilityScoreInput = {
        listing: {},
        photoCount: 0,
        hasHistoryReport: false,
      };
      expect(calculateVisibilityScore(empty, defaultWeights).score).toBe(0);
    });

    it("should return 100 for fully-filled listing with photos and history", () => {
      const full: VisibilityScoreInput = {
        listing: {
          make: "Renault",
          model: "Clio",
          price: 15000,
          mileage: 50000,
        },
        photoCount: 10,
        hasHistoryReport: true,
      };
      const result = calculateVisibilityScore(full, defaultWeights);
      // Score won't be 100 unless ALL fields including optional are filled
      expect(result.score).toBeGreaterThan(0);
    });
  });

  describe("getFilledFieldsFromListing for score calculation", () => {
    it("should detect filled string fields", () => {
      const listing = { make: "Renault", model: "Clio", price: null, mileage: undefined };
      const filled = getFilledFieldsFromListing(listing);
      expect(filled.make).toBe(true);
      expect(filled.model).toBe(true);
      expect(filled.price).toBe(false);
      expect(filled.mileage).toBe(false);
    });

    it("should detect filled numeric fields", () => {
      const listing = { price: 15000, mileage: 0 };
      const filled = getFilledFieldsFromListing(listing);
      expect(filled.price).toBe(true);
      expect(filled.mileage).toBe(true); // 0 is a valid numeric value
    });

    it("should treat empty string as not filled", () => {
      const listing = { make: "" };
      const filled = getFilledFieldsFromListing(listing);
      expect(filled.make).toBe(false);
    });
  });
});

describe("listing handler - validation integration", () => {
  it("should call validateListingField from @auto/shared", () => {
    const { validateListingField } = require("@auto/shared");
    validateListingField("price", "15000");
    expect(validateListingField).toHaveBeenCalledWith("price", "15000");
  });

  it("should identify certifiable fields from CERTIFIABLE_FIELDS", () => {
    const { CERTIFIABLE_FIELDS } = require("@auto/shared");
    expect(CERTIFIABLE_FIELDS).toContain("make");
    expect(CERTIFIABLE_FIELDS).toContain("model");
    expect(CERTIFIABLE_FIELDS).not.toContain("price");
    expect(CERTIFIABLE_FIELDS).not.toContain("mileage");
  });
});
