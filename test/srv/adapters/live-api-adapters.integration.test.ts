/**
 * Live API integration tests for free adapters.
 * These tests hit actual external APIs and are slow.
 *
 * Run with: npx jest --testPathPattern=live-api-adapters.integration
 *
 * Skipped in CI by default — set RUN_LIVE_API_TESTS=true to enable.
 */

const SKIP = !process.env.RUN_LIVE_API_TESTS;

const describeIf = SKIP ? describe.skip : describe;

describeIf("Live API Integration Tests", () => {
  jest.setTimeout(30000); // 30s timeout for real network calls

  describe("AdemeEmissionAdapter (live)", () => {
    it("should fetch emission data for a known French vehicle", async () => {
      const { AdemeEmissionAdapter } = await import("../../../srv/adapters/ademe-emission.adapter");
      const adapter = new AdemeEmissionAdapter();

      const result = await adapter.getEmissions({
        make: "RENAULT",
        model: "CLIO",
        year: 2022,
        fuelType: "essence",
      });

      expect(result.co2GKm).toBeGreaterThan(0);
      expect(result.provider.providerName).toBe("ademe");
      expect(result.euroNorm).toBeDefined();
      expect(result.energyClass).toBeDefined();
    });
  });

  describe("RappelConsoRecallAdapter (live)", () => {
    it("should fetch recall data for automobiles", async () => {
      const { RappelConsoRecallAdapter } =
        await import("../../../srv/adapters/rappelconso-recall.adapter");
      const adapter = new RappelConsoRecallAdapter();

      const result = await adapter.getRecalls({
        make: "Citroën",
        model: "C3",
      });

      // May or may not have recalls, but shape should be valid
      expect(result.recalls).toBeDefined();
      expect(Array.isArray(result.recalls)).toBe(true);
      expect(typeof result.totalCount).toBe("number");
      expect(result.provider.providerName).toBe("rappelconso");
    });
  });

  describe("NhtsaVINAdapter (live)", () => {
    it("should decode a known VIN from NHTSA vPIC API", async () => {
      const { NhtsaVINAdapter } = await import("../../../srv/adapters/nhtsa-vin.adapter");
      const adapter = new NhtsaVINAdapter();

      // Public test VIN for a 2021 Toyota Camry
      const result = await adapter.decode({ vin: "4T1G11AK5MU571490" });

      expect(result.vin).toBe("4T1G11AK5MU571490");
      expect(result.make).toBeDefined();
      expect(result.model).toBeDefined();
      expect(result.year).toBeGreaterThan(2000);
      expect(result.provider.providerName).toBe("nhtsa");
    });
  });

  describe("LocalCritAirCalculator (no network, pure computation)", () => {
    it("should classify a French vehicle correctly", async () => {
      const { LocalCritAirCalculator } =
        await import("../../../srv/adapters/local-critair.adapter");
      const adapter = new LocalCritAirCalculator();

      const result = await adapter.calculate({
        fuelType: "essence",
        euroNorm: "Euro 6d",
        registrationDate: "2022-01-01",
      });

      expect(result.level).toBe("1");
      expect(result.label).toBe("Crit'Air 1");
      expect(result.color).toBe("violet");
      expect(result.provider.providerName).toBe("local-critair");
    });
  });
});
