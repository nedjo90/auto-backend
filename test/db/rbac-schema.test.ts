import * as fs from "fs";
import * as path from "path";

const rootDir = path.resolve(__dirname, "../..");

describe("CDS Schema - Role (Task 1.1)", () => {
  const rbacCds = fs.readFileSync(path.join(rootDir, "db/schema/rbac.cds"), "utf-8");

  it("should use auto namespace", () => {
    expect(rbacCds).toContain("namespace auto;");
  });

  it("should define Role entity with cuid aspect", () => {
    expect(rbacCds).toContain("entity Role : cuid");
  });

  it("should enforce unique code constraint on Role", () => {
    expect(rbacCds).toMatch(/@assert\.unique:\s*\{code\}\s*\n\s*entity Role/);
  });

  it("should have all required Role fields", () => {
    const requiredFields = ["code", "name", "description", "level"];
    for (const field of requiredFields) {
      expect(rbacCds).toContain(field);
    }
  });
});

describe("CDS Schema - UserRole (Task 1.2)", () => {
  const rbacCds = fs.readFileSync(path.join(rootDir, "db/schema/rbac.cds"), "utf-8");

  it("should define UserRole entity with cuid aspect", () => {
    expect(rbacCds).toContain("entity UserRole : cuid");
  });

  it("should have association to User", () => {
    expect(rbacCds).toMatch(/user\s*:\s*Association to User/);
  });

  it("should have association to Role", () => {
    expect(rbacCds).toMatch(/role\s*:\s*Association to Role/);
  });

  it("should have assignedAt timestamp", () => {
    expect(rbacCds).toMatch(/assignedAt\s*:\s*Timestamp/);
  });

  it("should have assignedBy association to User", () => {
    expect(rbacCds).toMatch(/assignedBy\s*:\s*Association to User/);
  });

  it("should NOT be defined in user.cds (moved to rbac.cds)", () => {
    const userCds = fs.readFileSync(path.join(rootDir, "db/schema/user.cds"), "utf-8");
    expect(userCds).not.toContain("entity UserRole");
  });
});

describe("CDS Schema - Permission (Task 1.3)", () => {
  const rbacCds = fs.readFileSync(path.join(rootDir, "db/schema/rbac.cds"), "utf-8");

  it("should define Permission entity with cuid aspect", () => {
    expect(rbacCds).toContain("entity Permission : cuid");
  });

  it("should enforce unique code constraint on Permission", () => {
    expect(rbacCds).toMatch(/@assert\.unique:\s*\{code\}\s*\n\s*entity Permission/);
  });

  it("should have code and description fields", () => {
    // Match Permission entity block specifically
    const permissionBlock = rbacCds.match(/entity Permission : cuid \{[\s\S]*?\}/);
    expect(permissionBlock).not.toBeNull();
    expect(permissionBlock![0]).toContain("code");
    expect(permissionBlock![0]).toContain("description");
  });
});

describe("CDS Schema - RolePermission (Task 1.4)", () => {
  const rbacCds = fs.readFileSync(path.join(rootDir, "db/schema/rbac.cds"), "utf-8");

  it("should define RolePermission entity with cuid aspect", () => {
    expect(rbacCds).toContain("entity RolePermission : cuid");
  });

  it("should have association to Role", () => {
    const rpBlock = rbacCds.match(/entity RolePermission : cuid \{[\s\S]*?\}/);
    expect(rpBlock).not.toBeNull();
    expect(rpBlock![0]).toMatch(/role\s*:\s*Association to Role/);
  });

  it("should have association to Permission", () => {
    const rpBlock = rbacCds.match(/entity RolePermission : cuid \{[\s\S]*?\}/);
    expect(rpBlock).not.toBeNull();
    expect(rpBlock![0]).toMatch(/permission\s*:\s*Association to Permission/);
  });
});

describe("CDS Schema - ConfigFeature (Task 1.5)", () => {
  const configCds = fs.readFileSync(path.join(rootDir, "db/schema/config.cds"), "utf-8");

  it("should define ConfigFeature entity with cuid and managed aspects", () => {
    expect(configCds).toContain("entity ConfigFeature : cuid, managed");
  });

  it("should enforce unique code constraint on ConfigFeature", () => {
    expect(configCds).toMatch(/@assert\.unique:\s*\{code\}\s*\n\s*entity ConfigFeature/);
  });

  it("should have all required ConfigFeature fields", () => {
    const featureBlock = configCds.match(/entity ConfigFeature : cuid, managed \{[\s\S]*?\}/);
    expect(featureBlock).not.toBeNull();
    const block = featureBlock![0];
    expect(block).toContain("code");
    expect(block).toContain("name");
    expect(block).toContain("requiresAuth");
    expect(block).toContain("requiredRole");
    expect(block).toContain("isActive");
  });
});

describe("Seed Data - Role (Task 1.6)", () => {
  const csvPath = path.join(rootDir, "db/data/auto-Role.csv");

  it("should have Role seed data CSV file", () => {
    expect(fs.existsSync(csvPath)).toBe(true);
  });

  it("should contain all 5 role codes", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const expectedRoles = ["visitor", "buyer", "seller", "moderator", "administrator"];
    for (const role of expectedRoles) {
      expect(csv).toContain(role);
    }
  });

  it("should have correct hierarchy levels", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const lines = csv.trim().split("\n").slice(1);
    const roleLevels: Record<string, number> = {};
    for (const line of lines) {
      const parts = line.split(";");
      // columns: ID;code;name;description;level
      roleLevels[parts[1]] = parseInt(parts[4], 10);
    }
    expect(roleLevels["visitor"]).toBe(0);
    expect(roleLevels["buyer"]).toBe(1);
    expect(roleLevels["seller"]).toBe(2);
    expect(roleLevels["moderator"]).toBe(3);
    expect(roleLevels["administrator"]).toBe(4);
  });

  it("should have exactly 5 roles", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const lines = csv.trim().split("\n").slice(1);
    expect(lines).toHaveLength(5);
  });
});

describe("Seed Data - Permission (Task 1.6)", () => {
  const csvPath = path.join(rootDir, "db/data/auto-Permission.csv");

  it("should have Permission seed data CSV file", () => {
    expect(fs.existsSync(csvPath)).toBe(true);
  });

  it("should contain initial permission codes", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const expectedPermissions = [
      "listing.view",
      "listing.create",
      "listing.edit",
      "listing.moderate",
      "user.manage",
      "admin.access",
    ];
    for (const perm of expectedPermissions) {
      expect(csv).toContain(perm);
    }
  });
});

describe("Seed Data - RolePermission (Task 1.6)", () => {
  const csvPath = path.join(rootDir, "db/data/auto-RolePermission.csv");

  it("should have RolePermission seed data CSV file", () => {
    expect(fs.existsSync(csvPath)).toBe(true);
  });

  it("should have CSV header with role_ID and permission_ID", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const header = csv.split("\n")[0];
    expect(header).toContain("ID");
    expect(header).toContain("role_ID");
    expect(header).toContain("permission_ID");
  });
});

describe("Seed Data - ConfigFeature (Task 1.6)", () => {
  const csvPath = path.join(rootDir, "db/data/auto-ConfigFeature.csv");

  it("should have ConfigFeature seed data CSV file", () => {
    expect(fs.existsSync(csvPath)).toBe(true);
  });

  it("should contain auth-required feature entries", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    expect(csv).toContain("true"); // at least one requiresAuth=true
  });

  it("should have CSV header with all entity columns", () => {
    const csv = fs.readFileSync(csvPath, "utf-8");
    const header = csv.split("\n")[0];
    expect(header).toContain("ID");
    expect(header).toContain("code");
    expect(header).toContain("name");
    expect(header).toContain("requiresAuth");
    expect(header).toContain("isActive");
  });
});

describe("Schema Integration - rbac import", () => {
  it("should import rbac schema in db/schema.cds", () => {
    const schemaCds = fs.readFileSync(path.join(rootDir, "db/schema.cds"), "utf-8");
    expect(schemaCds).toContain("./schema/rbac");
  });
});
