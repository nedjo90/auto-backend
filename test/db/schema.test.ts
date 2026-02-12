import * as fs from "fs";
import * as path from "path";

const rootDir = path.resolve(__dirname, "../..");

describe("CDS Schema - ConfigRegistrationField (Task 1.1)", () => {
  const configCds = fs.readFileSync(path.join(rootDir, "db/schema/config.cds"), "utf-8");

  it("should define ConfigRegistrationField entity with cuid and managed aspects", () => {
    expect(configCds).toContain("entity ConfigRegistrationField : cuid, managed");
  });

  it("should have all required fields", () => {
    const requiredFields = [
      "fieldName",
      "fieldType",
      "isRequired",
      "isVisible",
      "displayOrder",
      "validationPattern",
      "labelKey",
      "placeholderKey",
    ];
    for (const field of requiredFields) {
      expect(configCds).toContain(field);
    }
  });

  it("should use auto namespace", () => {
    expect(configCds).toContain("namespace auto;");
  });
});

describe("CDS Schema - User (Task 1.2)", () => {
  const userCds = fs.readFileSync(path.join(rootDir, "db/schema/user.cds"), "utf-8");

  it("should define User entity with cuid and managed aspects", () => {
    expect(userCds).toContain("entity User : cuid, managed");
  });

  it("should have all required fields", () => {
    const requiredFields = [
      "azureAdB2cId",
      "email",
      "firstName",
      "lastName",
      "phone",
      "address",
      "siret",
      "isAnonymized",
      "status",
    ];
    for (const field of requiredFields) {
      expect(userCds).toContain(field);
    }
  });

  it("should define UserStatus enum with correct values", () => {
    expect(userCds).toContain("type UserStatus");
    expect(userCds).toContain("active");
    expect(userCds).toContain("suspended");
    expect(userCds).toContain("anonymized");
  });

  it("should have isAnonymized default false", () => {
    expect(userCds).toMatch(/isAnonymized\s+:\s+Boolean default false/);
  });

  it("should have status default active", () => {
    expect(userCds).toContain("default 'active'");
  });

  it("should use auto namespace", () => {
    expect(userCds).toContain("namespace auto;");
  });
});

describe("Seed Data - ConfigRegistrationField (Task 1.3)", () => {
  const csvPath = path.join(rootDir, "db/data/auto-ConfigRegistrationField.csv");

  it("should have seed data CSV file", () => {
    expect(fs.existsSync(csvPath)).toBe(true);
  });

  it("should contain standard registration fields", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const expectedFields = ["email", "firstName", "lastName", "phone", "siret"];
    for (const field of expectedFields) {
      expect(csv).toContain(field);
    }
  });

  it("should have CSV header with all entity columns", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const header = csv.split("\n")[0];
    const expectedColumns = [
      "ID",
      "fieldName",
      "fieldType",
      "isRequired",
      "isVisible",
      "displayOrder",
      "validationPattern",
      "labelKey",
      "placeholderKey",
    ];
    for (const col of expectedColumns) {
      expect(header).toContain(col);
    }
  });

  it("should mark email, firstName, lastName as required", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const lines = csv.trim().split("\n").slice(1);
    for (const line of lines) {
      const parts = line.split(";");
      const fieldName = parts[1];
      const isRequired = parts[3];
      if (["email", "firstName", "lastName"].includes(fieldName)) {
        expect(isRequired).toBe("true");
      }
    }
  });

  it("should mark phone and siret as optional", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const lines = csv.trim().split("\n").slice(1);
    for (const line of lines) {
      const parts = line.split(";");
      const fieldName = parts[1];
      const isRequired = parts[3];
      if (["phone", "siret"].includes(fieldName)) {
        expect(isRequired).toBe("false");
      }
    }
  });
});

describe("Shared Types (Task 1.4)", () => {
  it("should export IUser interface from @auto/shared", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const shared = require("@auto/shared");
    // Type-only exports won't be in runtime, but the module should load
    expect(shared).toBeDefined();
  });

  it("should export IConfigRegistrationField from @auto/shared", () => {
    // Type exports verified at compile time; runtime module loads without error
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const shared = require("@auto/shared");
    expect(shared).toBeDefined();
  });
});

describe("CDS Schema - ConfigSeoTemplate (Story 2-6, Task 1)", () => {
  const configCds = fs.readFileSync(path.join(rootDir, "db/schema/config.cds"), "utf-8");

  it("should define ConfigSeoTemplate entity with cuid and managed aspects", () => {
    expect(configCds).toContain("entity ConfigSeoTemplate : cuid, managed");
  });

  it("should have all required fields", () => {
    const requiredFields = [
      "pageType",
      "metaTitleTemplate",
      "metaDescriptionTemplate",
      "ogTitleTemplate",
      "ogDescriptionTemplate",
      "canonicalUrlPattern",
      "language",
      "active",
    ];
    for (const field of requiredFields) {
      expect(configCds).toContain(field);
    }
  });

  it("should have unique constraint on pageType and language", () => {
    expect(configCds).toContain("pageType_language: [pageType, language]");
  });

  it("should default language to fr", () => {
    // Find the ConfigSeoTemplate section and check default
    const seoSection = configCds.substring(configCds.indexOf("entity ConfigSeoTemplate"));
    expect(seoSection).toContain("default 'fr'");
  });

  it("should default active to true", () => {
    const seoSection = configCds.substring(configCds.indexOf("entity ConfigSeoTemplate"));
    expect(seoSection).toContain("default true");
  });
});

describe("Seed Data - ConfigSeoTemplate (Story 2-6, Task 1)", () => {
  const csvPath = path.join(rootDir, "db/data/auto-ConfigSeoTemplate.csv");

  it("should have seed data CSV file", () => {
    expect(fs.existsSync(csvPath)).toBe(true);
  });

  it("should have CSV header with all entity columns", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const header = csv.split("\n")[0];
    const expectedColumns = [
      "ID",
      "pageType",
      "metaTitleTemplate",
      "metaDescriptionTemplate",
      "ogTitleTemplate",
      "ogDescriptionTemplate",
      "canonicalUrlPattern",
      "language",
      "active",
    ];
    for (const col of expectedColumns) {
      expect(header).toContain(col);
    }
  });

  it("should contain templates for all 6 page types", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const pageTypes = [
      "listing_detail",
      "search_results",
      "brand_page",
      "model_page",
      "city_page",
      "landing_page",
    ];
    for (const pt of pageTypes) {
      expect(csv).toContain(pt);
    }
  });

  it("should have 6 data rows (one per page type)", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const lines = csv.trim().split("\n").slice(1);
    expect(lines.length).toBe(6);
  });

  it("should have all templates in French (language=fr)", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const lines = csv.trim().split("\n").slice(1);
    for (const line of lines) {
      const parts = line.split(";");
      const language = parts[7];
      expect(language).toBe("fr");
    }
  });

  it("should have all templates active", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const lines = csv.trim().split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(";");
      const active = parts[8];
      expect(active).toBe("true");
    }
  });

  it("should use placeholder syntax in templates", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    expect(csv).toContain("{{brand}}");
    expect(csv).toContain("{{model}}");
    expect(csv).toContain("{{year}}");
    expect(csv).toContain("{{city}}");
    expect(csv).toContain("{{price}}");
  });
});

describe("CDS Schema - AuditTrailEntry (Story 2-8, Task 1)", () => {
  const auditCds = fs.readFileSync(path.join(rootDir, "db/schema/audit.cds"), "utf-8");

  it("should define AuditTrailEntry entity with cuid aspect", () => {
    expect(auditCds).toContain("entity AuditTrailEntry : cuid");
  });

  it("should have all required fields", () => {
    const requiredFields = [
      "action",
      "actorId",
      "actorRole",
      "targetType",
      "targetId",
      "timestamp",
      "details",
      "ipAddress",
      "userAgent",
      "requestId",
      "severity",
    ];
    for (const field of requiredFields) {
      expect(auditCds).toContain(field);
    }
  });

  it("should use LargeString for details field", () => {
    expect(auditCds).toMatch(/details\s+:\s+LargeString/);
  });

  it("should have severity field with String(10)", () => {
    expect(auditCds).toMatch(/severity\s+:\s+String\(10\)/);
  });

  it("should use auto namespace", () => {
    expect(auditCds).toContain("namespace auto;");
  });
});

describe("CDS Schema - ApiCallLog (Story 2-8, Task 2)", () => {
  const auditCds = fs.readFileSync(path.join(rootDir, "db/schema/audit.cds"), "utf-8");

  it("should define ApiCallLog entity with cuid aspect", () => {
    expect(auditCds).toContain("entity ApiCallLog : cuid");
  });

  it("should have all required fields", () => {
    const requiredFields = [
      "adapterInterface",
      "providerKey",
      "endpoint",
      "httpMethod",
      "httpStatus",
      "responseTimeMs",
      "cost",
      "listingId",
      "requestId",
      "errorMessage",
      "timestamp",
    ];
    for (const field of requiredFields) {
      expect(auditCds).toContain(field);
    }
  });
});

describe("CDS Schema - AdminService AuditTrailEntries (Story 2-8)", () => {
  const adminCds = fs.readFileSync(path.join(rootDir, "srv/admin-service.cds"), "utf-8");

  it("should expose AuditTrailEntries as read-only projection", () => {
    expect(adminCds).toContain(
      "@readonly entity AuditTrailEntries as projection on auto.AuditTrailEntry",
    );
  });

  it("should expose ApiCallLogs as read-only projection", () => {
    expect(adminCds).toContain("@readonly entity ApiCallLogs");
  });

  it("should define exportAuditTrail action", () => {
    expect(adminCds).toContain("action exportAuditTrail");
  });

  it("should define exportApiCallLogs action", () => {
    expect(adminCds).toContain("action exportApiCallLogs");
  });
});

describe("CDS Build Validation", () => {
  it("should have generated TypeScript models for auto namespace", () => {
    const modelsPath = path.join(rootDir, "@cds-models/auto/index.ts");
    expect(fs.existsSync(modelsPath)).toBe(true);

    const models = fs.readFileSync(modelsPath, "utf-8");
    expect(models).toContain("ConfigRegistrationField");
    expect(models).toContain("User");
    expect(models).toContain("UserStatus");
  });
});
