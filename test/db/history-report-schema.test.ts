import * as fs from "fs";
import * as path from "path";

const rootDir = path.resolve(__dirname, "../..");
const listingCds = fs.readFileSync(path.join(rootDir, "db/schema/listing.cds"), "utf-8");

describe("CDS Schema - HistoryReport (Story 3-8, Task 1)", () => {
  it("should define HistoryReport entity with cuid", () => {
    expect(listingCds).toContain("entity HistoryReport : cuid");
  });

  it("should have all required fields", () => {
    const fields = ["listingId", "reportData", "source", "fetchedAt", "reportVersion"];
    for (const field of fields) {
      expect(listingCds).toContain(field);
    }
  });

  it("should have listingId as String(36) not null", () => {
    // Match within HistoryReport entity context
    const historySection = listingCds.substring(listingCds.indexOf("entity HistoryReport"));
    expect(historySection).toMatch(/listingId\s+:\s+String\(36\)\s+not\s+null/);
  });

  it("should have reportData as LargeString for JSON storage", () => {
    const historySection = listingCds.substring(listingCds.indexOf("entity HistoryReport"));
    expect(historySection).toContain("reportData");
    expect(historySection).toContain("LargeString");
  });

  it("should have source as String(100)", () => {
    const historySection = listingCds.substring(listingCds.indexOf("entity HistoryReport"));
    expect(historySection).toMatch(/source\s+:\s+String\(100\)/);
  });

  it("should have fetchedAt as Timestamp", () => {
    const historySection = listingCds.substring(listingCds.indexOf("entity HistoryReport"));
    expect(historySection).toMatch(/fetchedAt\s+:\s+Timestamp/);
  });

  it("should have reportVersion as String(20)", () => {
    const historySection = listingCds.substring(listingCds.indexOf("entity HistoryReport"));
    expect(historySection).toMatch(/reportVersion\s+:\s+String\(20\)/);
  });

  it("should have uniqueness constraint on listingId", () => {
    expect(listingCds).toContain("annotate HistoryReport with @(assert.unique");
    expect(listingCds).toContain("listingReport: [listingId]");
  });

  it("should have composition from Listing to HistoryReport", () => {
    expect(listingCds).toContain("Composition of one HistoryReport");
  });
});
