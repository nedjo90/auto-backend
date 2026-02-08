import { ROLES, LISTING_STATUS } from "@auto/shared";
import * as fs from "fs";
import * as path from "path";

describe("Backend project setup", () => {
  it("should have required directory structure", () => {
    const rootDir = path.resolve(__dirname, "..");
    expect(fs.existsSync(path.join(rootDir, "db"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "srv"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "srv", "adapters"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "srv", "middleware"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "srv", "lib"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "test"))).toBe(true);
  });

  it("should have CDS configuration with SQLite for dev", () => {
    const rootDir = path.resolve(__dirname, "..");
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf-8"));
    expect(pkg.cds.requires.db.kind).toBe("sql");
    expect(pkg.cds.requires.db.impl).toBe("@cap-js/sqlite");
  });

  it("should have PostgreSQL configured for production", () => {
    const rootDir = path.resolve(__dirname, "..");
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf-8"));
    expect(pkg.cds["[production]"].requires.db.kind).toBe("postgres");
    expect(pkg.cds["[production]"].requires.db.impl).toBe("@cap-js/postgres");
  });

  it("should import @auto/shared types successfully", () => {
    expect(ROLES).toBeDefined();
    expect(ROLES).toContain("admin");
    expect(LISTING_STATUS).toBeDefined();
    expect(LISTING_STATUS).toContain("published");
  });

  it("should have TypeScript strict mode enabled", () => {
    const rootDir = path.resolve(__dirname, "..");
    const tsconfig = JSON.parse(fs.readFileSync(path.join(rootDir, "tsconfig.json"), "utf-8"));
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });
});
