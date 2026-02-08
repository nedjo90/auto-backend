import * as fs from "fs";
import * as path from "path";

describe("config-service", () => {
  describe("ConfigParameter entity", () => {
    it("should have ConfigParameter defined in config.cds", () => {
      const schemaPath = path.join(
        __dirname,
        "../../db/schema/config.cds",
      );
      const content = fs.readFileSync(schemaPath, "utf-8");
      expect(content).toContain("entity ConfigParameter");
      expect(content).toContain("key");
      expect(content).toContain("value");
      expect(content).toContain("description");
    });
  });

  describe("ConfigParameter seed data", () => {
    it("should have seed CSV with session timeout parameters", () => {
      const csvPath = path.join(
        __dirname,
        "../../db/data/auto-ConfigParameter.csv",
      );
      const content = fs.readFileSync(csvPath, "utf-8");
      expect(content).toContain("session.inactivity.timeout.minutes");
      expect(content).toContain("session.timeout.warning.minutes");
      expect(content).toContain("30");
      expect(content).toContain("5");
    });
  });

  describe("config-service.cds", () => {
    it("should expose SessionParameters as projection filtered by session.%", () => {
      const cdsPath = path.join(
        __dirname,
        "../../srv/config-service.cds",
      );
      const content = fs.readFileSync(cdsPath, "utf-8");
      expect(content).toContain("SessionParameters");
      expect(content).toContain("ConfigParameter");
      expect(content).toContain("session.%");
      expect(content).toContain("@requires: 'any'");
    });
  });
});
