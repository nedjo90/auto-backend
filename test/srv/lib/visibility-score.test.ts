/* eslint-disable @typescript-eslint/no-explicit-any */

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
    validateListingField: jest.fn(() => null),
  };
});

import {
  calculateVisibilityScore,
  getFilledFieldsFromListing,
} from "../../../srv/lib/visibility-score";

describe("visibility-score", () => {
  describe("calculateVisibilityScore", () => {
    it("should return 0 when no fields are filled", () => {
      const filled: Record<string, boolean> = {};
      const score = calculateVisibilityScore(filled);
      expect(score).toBe(0);
    });

    it("should return 100 when all fields are filled", () => {
      const filled: Record<string, boolean> = {
        make: true,
        model: true,
        year: true,
        fuelType: true,
        mileage: true,
        price: true,
        condition: true,
        description: true,
        plate: true,
        vin: true,
        color: true,
        options: true,
      };
      const score = calculateVisibilityScore(filled);
      expect(score).toBe(100);
    });

    it("should return partial score when some fields are filled", () => {
      const filled: Record<string, boolean> = {
        make: true,
        model: true,
        year: true,
        price: true,
      };
      const score = calculateVisibilityScore(filled);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(100);
    });

    it("should weight required fields higher", () => {
      // Only fill required fields
      const requiredOnly: Record<string, boolean> = {
        make: true,
        model: true,
        year: true,
        fuelType: true,
        mileage: true,
        price: true,
        condition: true,
        description: true,
      };

      // Only fill optional fields
      const optionalOnly: Record<string, boolean> = {
        plate: true,
        vin: true,
        color: true,
        options: true,
      };

      const requiredScore = calculateVisibilityScore(requiredOnly);
      const optionalScore = calculateVisibilityScore(optionalOnly);

      // Required fields should give a higher score than optional
      expect(requiredScore).toBeGreaterThan(optionalScore);
    });

    it("should return an integer", () => {
      const filled: Record<string, boolean> = { make: true };
      const score = calculateVisibilityScore(filled);
      expect(Number.isInteger(score)).toBe(true);
    });
  });

  describe("getFilledFieldsFromListing", () => {
    it("should mark fields as filled when they have values", () => {
      const listing = {
        make: "Renault",
        model: "Clio",
        year: 2022,
        price: 15000,
        mileage: null,
        description: "",
        condition: undefined,
      };

      const filled = getFilledFieldsFromListing(listing);
      expect(filled.make).toBe(true);
      expect(filled.model).toBe(true);
      expect(filled.year).toBe(true);
      expect(filled.price).toBe(true);
    });

    it("should mark fields as not filled when null/empty/0", () => {
      const listing = {
        make: null,
        model: "",
        year: 0,
        price: undefined,
      };

      const filled = getFilledFieldsFromListing(listing);
      expect(filled.make).toBe(false);
      expect(filled.model).toBe(false);
      expect(filled.year).toBe(false);
      expect(filled.price).toBe(false);
    });

    it("should handle missing fields as not filled", () => {
      const listing = {};
      const filled = getFilledFieldsFromListing(listing);
      expect(filled.make).toBe(false);
      expect(filled.price).toBe(false);
    });
  });
});
