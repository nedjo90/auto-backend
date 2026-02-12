import * as fs from "fs";
import * as path from "path";

const rootDir = path.resolve(__dirname, "../..");

describe("CDS Schema - LegalDocument", () => {
  const legalCds = fs.readFileSync(path.join(rootDir, "db/schema/legal.cds"), "utf-8");

  it("should define LegalDocument entity with cuid and managed aspects", () => {
    expect(legalCds).toContain("entity LegalDocument : cuid, managed");
  });

  it("should have all required fields", () => {
    const requiredFields = [
      "key",
      "title",
      "currentVersion",
      "requiresReacceptance",
      "active",
      "versions",
    ];
    for (const field of requiredFields) {
      expect(legalCds).toContain(field);
    }
  });

  it("should have unique constraint on key", () => {
    expect(legalCds).toContain("@assert.unique");
    expect(legalCds).toContain("configKey");
  });

  it("should have composition to LegalDocumentVersion", () => {
    expect(legalCds).toContain("Composition of many LegalDocumentVersion");
  });

  it("should use auto namespace", () => {
    expect(legalCds).toContain("namespace auto;");
  });
});

describe("CDS Schema - LegalDocumentVersion", () => {
  const legalCds = fs.readFileSync(path.join(rootDir, "db/schema/legal.cds"), "utf-8");

  it("should define LegalDocumentVersion entity with cuid and managed aspects", () => {
    expect(legalCds).toContain("entity LegalDocumentVersion : cuid, managed");
  });

  it("should have all required fields", () => {
    const requiredFields = [
      "document",
      "version",
      "content",
      "summary",
      "publishedAt",
      "publishedBy",
      "archived",
    ];
    for (const field of requiredFields) {
      expect(legalCds).toContain(field);
    }
  });

  it("should have association to LegalDocument", () => {
    expect(legalCds).toContain("Association to LegalDocument");
  });
});

describe("CDS Schema - LegalAcceptance", () => {
  const legalCds = fs.readFileSync(path.join(rootDir, "db/schema/legal.cds"), "utf-8");

  it("should define LegalAcceptance entity with cuid and managed aspects", () => {
    expect(legalCds).toContain("entity LegalAcceptance : cuid, managed");
  });

  it("should have all required fields", () => {
    const requiredFields = [
      "user",
      "document",
      "documentKey",
      "version",
      "acceptedAt",
      "ipAddress",
      "userAgent",
    ];
    for (const field of requiredFields) {
      expect(legalCds).toContain(field);
    }
  });

  it("should have associations to User and LegalDocument", () => {
    expect(legalCds).toContain("Association to User");
    expect(legalCds).toContain("Association to LegalDocument");
  });
});

describe("Seed Data - LegalDocument", () => {
  const csvPath = path.join(rootDir, "db/data/auto-LegalDocument.csv");

  it("should have a CSV seed file", () => {
    expect(fs.existsSync(csvPath)).toBe(true);
  });

  it("should have correct headers", () => {
    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.trim().split("\n");
    const headers = lines[0].trim().split(";");
    expect(headers).toContain("ID");
    expect(headers).toContain("key");
    expect(headers).toContain("title");
    expect(headers).toContain("currentVersion");
    expect(headers).toContain("requiresReacceptance");
    expect(headers).toContain("active");
  });

  it("should have 4 legal documents (cgu, cgv, privacy_policy, legal_notices)", () => {
    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.trim().split("\n");
    const dataLines = lines.slice(1).filter((l) => l.trim());
    expect(dataLines).toHaveLength(4);

    const keys = dataLines.map((line) => line.trim().split(";")[1]);
    expect(keys).toContain("cgu");
    expect(keys).toContain("cgv");
    expect(keys).toContain("privacy_policy");
    expect(keys).toContain("legal_notices");
  });

  it("should have all documents active and version 1", () => {
    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.trim().split("\n");
    const headers = lines[0].trim().split(";");
    const versionIdx = headers.indexOf("currentVersion");
    const activeIdx = headers.indexOf("active");

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(";");
      expect(parts[versionIdx]).toBe("1");
      expect(parts[activeIdx].trim()).toBe("true");
    }
  });
});

describe("Seed Data - LegalDocumentVersion", () => {
  const csvPath = path.join(rootDir, "db/data/auto-LegalDocumentVersion.csv");

  it("should have a CSV seed file", () => {
    expect(fs.existsSync(csvPath)).toBe(true);
  });

  it("should have correct headers", () => {
    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.trim().split("\n");
    const headers = lines[0].trim().split(";");
    expect(headers).toContain("ID");
    expect(headers).toContain("document_ID");
    expect(headers).toContain("version");
    expect(headers).toContain("content");
    expect(headers).toContain("summary");
    expect(headers).toContain("publishedAt");
    expect(headers).toContain("publishedBy");
    expect(headers).toContain("archived");
  });

  it("should have 4 version records", () => {
    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.trim().split("\n");
    const dataLines = lines.slice(1).filter((l) => l.trim());
    expect(dataLines).toHaveLength(4);
  });

  it("should all be placeholder content", () => {
    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.trim().split("\n");
    const headers = lines[0].trim().split(";");
    const contentIdx = headers.indexOf("content");

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(";");
      expect(parts[contentIdx]).toContain("[PLACEHOLDER]");
    }
  });
});
