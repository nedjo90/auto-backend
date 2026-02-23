import * as fs from "fs";
import * as path from "path";

const rootDir = path.resolve(__dirname, "../..");
const listingCds = fs.readFileSync(path.join(rootDir, "db/schema/listing.cds"), "utf-8");

describe("CDS Schema - Listing (Story 3-3, Task 1)", () => {
  it("should use auto namespace", () => {
    expect(listingCds).toContain("namespace auto;");
  });

  it("should define Listing entity with cuid and managed aspects", () => {
    expect(listingCds).toContain("entity Listing : cuid, managed");
  });

  it("should have sellerId field", () => {
    expect(listingCds).toContain("sellerId");
  });

  it("should have vehicle identity fields", () => {
    const fields = [
      "plate",
      "vin",
      "make",
      "model",
      "variant",
      "year",
      "registrationDate",
      "fuelType",
    ];
    for (const field of fields) {
      expect(listingCds).toContain(field);
    }
  });

  it("should have technical detail fields", () => {
    const fields = [
      "engineCapacityCc",
      "powerKw",
      "powerHp",
      "gearbox",
      "bodyType",
      "doors",
      "seats",
      "color",
      "co2GKm",
      "euroNorm",
    ];
    for (const field of fields) {
      expect(listingCds).toContain(field);
    }
  });

  it("should have declared-only fields", () => {
    const fields = [
      "price",
      "mileage",
      "description",
      "condition",
      "options",
      "interiorColor",
      "exteriorColor",
      "numberOfDoors",
      "transmission",
      "driveType",
    ];
    for (const field of fields) {
      expect(listingCds).toContain(field);
    }
  });

  it("should have status and visibility score", () => {
    expect(listingCds).toContain("status");
    expect(listingCds).toContain("visibilityScore");
  });

  it("should define default status as draft", () => {
    expect(listingCds).toContain("default 'draft'");
  });

  it("should have composition of CertifiedField", () => {
    expect(listingCds).toContain("Composition of many CertifiedField");
  });
});

describe("CDS Schema - CertifiedField (Story 3-3 extensions)", () => {
  it("should have isOverridden field", () => {
    expect(listingCds).toContain("isOverridden");
  });
});

describe("CDS Schema - CertifiedFieldHistory (Story 3-3, Task 2)", () => {
  it("should define CertifiedFieldHistory entity", () => {
    expect(listingCds).toContain("entity CertifiedFieldHistory : cuid");
  });

  it("should have required fields", () => {
    const fields = [
      "listingId",
      "fieldName",
      "originalValue",
      "originalSource",
      "overriddenAt",
      "overriddenBy",
    ];
    for (const field of fields) {
      expect(listingCds).toContain(field);
    }
  });
});
