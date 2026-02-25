import { generateListingSlug, extractIdFromSlug } from "@auto/shared";
import { generateCanonicalUrl, generateStructuredData } from "../../../srv/lib/seo";

describe("seo utility library", () => {
  describe("generateListingSlug (from @auto/shared)", () => {
    it("should generate a slug from listing data", () => {
      const slug = generateListingSlug({
        ID: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        make: "Peugeot",
        model: "3008",
        year: 2022,
        city: "Marseille",
      });
      expect(slug).toBe("peugeot-3008-2022-marseille-a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    });

    it("should remove diacritics/accents", () => {
      const slug = generateListingSlug({
        ID: "abc123",
        make: "Citroën",
        model: "C3",
        year: 2021,
        city: "Béziers",
      });
      expect(slug).toBe("citroen-c3-2021-beziers-abc123");
    });

    it("should handle special characters", () => {
      const slug = generateListingSlug({
        ID: "abc123",
        make: "Mercedes-Benz",
        model: "Classe A (W177)",
        year: 2020,
        city: "Paris",
      });
      expect(slug).toBe("mercedes-benz-classe-a-w177-2020-paris-abc123");
    });

    it("should handle null/missing fields", () => {
      const slug = generateListingSlug({
        ID: "abc123",
        make: null,
        model: null,
        year: null,
        city: null,
      });
      expect(slug).toBe("abc123");
    });

    it("should handle empty string fields", () => {
      const slug = generateListingSlug({
        ID: "abc123",
        make: "",
        model: "",
        year: null,
        city: "",
      });
      expect(slug).toBe("abc123");
    });

    it("should convert to lowercase", () => {
      const slug = generateListingSlug({
        ID: "ABC123",
        make: "BMW",
        model: "X5",
        year: 2023,
        city: "PARIS",
      });
      expect(slug).toBe("bmw-x5-2023-paris-abc123");
    });

    it("should handle multiple spaces and special chars", () => {
      const slug = generateListingSlug({
        ID: "abc123",
        make: "  Alfa   Romeo  ",
        model: "Giulia",
        year: 2019,
        city: "Saint-Étienne",
      });
      expect(slug).toBe("alfa-romeo-giulia-2019-saint-etienne-abc123");
    });

    it("should handle long brand/model names", () => {
      const slug = generateListingSlug({
        ID: "abc123",
        make: "Volkswagen",
        model: "Transporter T6.1 Multivan",
        year: 2021,
        city: "Aix-en-Provence",
      });
      expect(slug).toBe("volkswagen-transporter-t6-1-multivan-2021-aix-en-provence-abc123");
    });
  });

  describe("extractIdFromSlug (from @auto/shared)", () => {
    it("should extract UUID from a slug", () => {
      const id = extractIdFromSlug(
        "peugeot-3008-2022-marseille-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      );
      expect(id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    });

    it("should extract short ID as fallback", () => {
      const id = extractIdFromSlug("peugeot-3008-2022-marseille-abc123");
      expect(id).toBe("abc123");
    });

    it("should return null for empty slug", () => {
      expect(extractIdFromSlug("")).toBeNull();
    });

    it("should handle UUID-only slug", () => {
      const id = extractIdFromSlug("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      expect(id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    });

    it("should handle slug with many segments before UUID", () => {
      const id = extractIdFromSlug(
        "mercedes-benz-classe-a-w177-2020-paris-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      );
      expect(id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    });
  });

  describe("generateCanonicalUrl", () => {
    it("should sort parameters alphabetically", () => {
      const url = generateCanonicalUrl("/search", {
        maxPrice: "15000",
        brand: "peugeot",
      });
      expect(url).toBe("/search?brand=peugeot&maxPrice=15000");
    });

    it("should return base path when no params", () => {
      const url = generateCanonicalUrl("/search", {});
      expect(url).toBe("/search");
    });

    it("should omit undefined/empty values", () => {
      const url = generateCanonicalUrl("/search", {
        brand: "peugeot",
        model: undefined,
        city: "",
      });
      expect(url).toBe("/search?brand=peugeot");
    });

    it("should sort array values", () => {
      const url = generateCanonicalUrl("/search", {
        fuel: ["diesel", "essence", "hybride"],
      });
      expect(url).toBe("/search?fuel=diesel&fuel=essence&fuel=hybride");
    });

    it("should produce same URL regardless of input order", () => {
      const url1 = generateCanonicalUrl("/search", {
        maxPrice: "15000",
        brand: "peugeot",
        fuel: ["diesel", "essence"],
      });
      const url2 = generateCanonicalUrl("/search", {
        fuel: ["essence", "diesel"],
        brand: "peugeot",
        maxPrice: "15000",
      });
      expect(url1).toBe(url2);
    });

    it("should filter out empty array values", () => {
      const url = generateCanonicalUrl("/search", {
        fuel: ["diesel", "", "essence"],
      });
      expect(url).toBe("/search?fuel=diesel&fuel=essence");
    });
  });

  describe("generateStructuredData", () => {
    it("should generate complete structured data with all fields", () => {
      const result = generateStructuredData({
        ID: "abc123",
        make: "Peugeot",
        model: "3008",
        year: 2022,
        mileage: 45000,
        fuelType: "Diesel",
        gearbox: "Automatique",
        color: "Gris",
        price: 25000,
        description: "Superbe SUV en excellent état",
        status: "published",
        primaryPhotoUrl: "https://cdn.example.com/photo.jpg",
      });

      expect(result["@context"]).toBe("https://schema.org");
      expect(result["@graph"]).toHaveLength(2);

      const [vehicle, product] = result["@graph"] as Record<string, unknown>[];

      expect(vehicle["@type"]).toBe("Vehicle");
      expect(vehicle.manufacturer).toBe("Peugeot");
      expect(vehicle.model).toBe("3008");
      expect(vehicle.vehicleModelDate).toBe("2022");
      expect(vehicle.fuelType).toBe("Diesel");
      expect(vehicle.vehicleTransmission).toBe("Automatique");
      expect(vehicle.color).toBe("Gris");
      expect(vehicle.mileageFromOdometer).toEqual({
        "@type": "QuantitativeValue",
        value: 45000,
        unitCode: "KMT",
      });

      expect(product["@type"]).toBe("Product");
      expect(product.name).toBe("Peugeot 3008 2022");
      expect(product.description).toBe("Superbe SUV en excellent état");
      expect(product.image).toBe("https://cdn.example.com/photo.jpg");
      expect(product.brand).toEqual({ "@type": "Brand", name: "Peugeot" });

      const offer = product.offers as Record<string, unknown>;
      expect(offer["@type"]).toBe("Offer");
      expect(offer.price).toBe(25000);
      expect(offer.priceCurrency).toBe("EUR");
      expect(offer.availability).toBe("https://schema.org/InStock");
    });

    it("should set availability to SoldOut for sold listings", () => {
      const result = generateStructuredData({
        ID: "abc123",
        make: "Peugeot",
        model: "3008",
        price: 25000,
        status: "sold",
      });

      const [, product] = result["@graph"] as Record<string, unknown>[];
      const offer = product.offers as Record<string, unknown>;
      expect(offer.availability).toBe("https://schema.org/SoldOut");
    });

    it("should handle minimal data", () => {
      const result = generateStructuredData({ ID: "abc123" });

      expect(result["@context"]).toBe("https://schema.org");
      expect(result["@graph"]).toHaveLength(2);

      const [vehicle, product] = result["@graph"] as Record<string, unknown>[];
      expect(vehicle["@type"]).toBe("Vehicle");
      expect(product["@type"]).toBe("Product");
      expect(product.name).toBe("Annonce");
    });

    it("should include VIN when available", () => {
      const result = generateStructuredData({
        ID: "abc123",
        vin: "VF3MCBHXHJS123456",
      });

      const [vehicle] = result["@graph"] as Record<string, unknown>[];
      expect(vehicle.vehicleIdentificationNumber).toBe("VF3MCBHXHJS123456");
    });

    it("should omit null/undefined fields from vehicle schema", () => {
      const result = generateStructuredData({
        ID: "abc123",
        make: "BMW",
        mileage: null,
        fuelType: null,
        color: null,
      });

      const [vehicle] = result["@graph"] as Record<string, unknown>[];
      expect(vehicle.manufacturer).toBe("BMW");
      expect(vehicle).not.toHaveProperty("mileageFromOdometer");
      expect(vehicle).not.toHaveProperty("fuelType");
      expect(vehicle).not.toHaveProperty("color");
    });

    it("should omit photo/description from product when missing", () => {
      const result = generateStructuredData({
        ID: "abc123",
        make: "BMW",
        description: null,
        primaryPhotoUrl: null,
      });

      const [, product] = result["@graph"] as Record<string, unknown>[];
      expect(product).not.toHaveProperty("description");
      expect(product).not.toHaveProperty("image");
    });
  });
});
