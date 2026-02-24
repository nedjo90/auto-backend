import * as fs from "fs";
import * as path from "path";

const rootDir = path.resolve(__dirname, "../..");
const declarationCds = fs.readFileSync(path.join(rootDir, "db/schema/declaration.cds"), "utf-8");
const listingCds = fs.readFileSync(path.join(rootDir, "db/schema/listing.cds"), "utf-8");
const schemaCds = fs.readFileSync(path.join(rootDir, "db/schema.cds"), "utf-8");

describe("CDS Schema - Declaration (Story 3-7, Task 1)", () => {
  it("should use auto namespace", () => {
    expect(declarationCds).toContain("namespace auto;");
  });

  it("should define Declaration entity with cuid aspect", () => {
    expect(declarationCds).toContain("entity Declaration : cuid");
  });

  it("should have all required Declaration fields", () => {
    const fields = [
      "listingId",
      "sellerId",
      "declarationVersion",
      "checkboxStates",
      "ipAddress",
      "signedAt",
      "createdAt",
    ];
    for (const field of fields) {
      expect(declarationCds).toContain(field);
    }
  });

  it("should have listingId as String(36) not null", () => {
    expect(declarationCds).toMatch(/listingId\s+:\s+String\(36\)\s+not\s+null/);
  });

  it("should have sellerId as String(36) not null", () => {
    expect(declarationCds).toMatch(/sellerId\s+:\s+String\(36\)\s+not\s+null/);
  });

  it("should have signedAt as Timestamp not null", () => {
    expect(declarationCds).toMatch(/signedAt\s+:\s+Timestamp\s+not\s+null/);
  });

  it("should have checkboxStates as LargeString for JSON storage", () => {
    expect(declarationCds).toMatch(/checkboxStates\s+:\s+LargeString\s+not\s+null/);
  });

  it("should NOT use managed aspect (immutable - no updatedAt needed)", () => {
    expect(declarationCds).not.toMatch(/entity Declaration : cuid, managed/);
  });
});

describe("CDS Schema - ConfigDeclarationTemplate (Story 3-7, Task 1)", () => {
  it("should define ConfigDeclarationTemplate entity with cuid and managed aspects", () => {
    expect(declarationCds).toContain("entity ConfigDeclarationTemplate : cuid, managed");
  });

  it("should have all required template fields", () => {
    const fields = ["version", "isActive", "checkboxItems", "introText", "legalNotice"];
    for (const field of fields) {
      expect(declarationCds).toContain(field);
    }
  });

  it("should have version as String(20) not null", () => {
    expect(declarationCds).toMatch(/version\s+:\s+String\(20\)\s+not\s+null/);
  });

  it("should have isActive with default true", () => {
    expect(declarationCds).toContain("isActive       : Boolean default true");
  });

  it("should have unique constraint on version", () => {
    expect(declarationCds).toContain("@(assert.unique: [{version}])");
  });
});

describe("CDS Schema - Listing declarationId (Story 3-7, Task 1)", () => {
  it("should have declarationId field on Listing entity", () => {
    expect(listingCds).toContain("declarationId");
  });
});

describe("CDS Schema - Declaration registration (Story 3-7, Task 1)", () => {
  it("should be imported in main schema.cds", () => {
    expect(schemaCds).toContain("using from './schema/declaration'");
  });
});

describe("CDS Seed Data - ConfigDeclarationTemplate (Story 3-7, Task 1)", () => {
  const csvPath = path.join(rootDir, "db/data/auto-ConfigDeclarationTemplate.csv");

  it("should have seed data CSV file", () => {
    expect(fs.existsSync(csvPath)).toBe(true);
  });

  it("should contain initial template with v1.0", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    expect(csv).toContain("v1.0");
    expect(csv).toContain("true");
  });

  it("should contain all attestation checkbox items", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    expect(csv).toContain("informations declarees sont exactes");
    expect(csv).toContain("proprietaire ou mandataire autorise");
    expect(csv).toContain("gage ni d'opposition");
    expect(csv).toContain("conditions generales de vente");
  });

  it("should contain intro text and legal notice", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    expect(csv).toContain("introText");
    expect(csv).toContain("legalNotice");
  });
});
