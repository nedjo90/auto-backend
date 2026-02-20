/* eslint-disable @typescript-eslint/no-explicit-any */
import { AdemeEmissionAdapter } from "../../../srv/adapters/ademe-emission.adapter";
import { RappelConsoRecallAdapter } from "../../../srv/adapters/rappelconso-recall.adapter";
import { LocalCritAirCalculator } from "../../../srv/adapters/local-critair.adapter";
import { NhtsaVINAdapter } from "../../../srv/adapters/nhtsa-vin.adapter";

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── ADEME Emission Adapter ────────────────────────────────────────────────

describe("AdemeEmissionAdapter", () => {
  const adapter = new AdemeEmissionAdapter("https://mock-ademe.test/api", 5000);

  it("should have provider metadata", () => {
    expect(adapter.providerName).toBe("ademe");
    expect(adapter.providerVersion).toBe("1.0.0");
  });

  it("should return emission data for known vehicle", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            co2_g_km: 128,
            lib_eg_conso: "B",
            norme_euro: "Euro 6d",
            cod_cbr: "ES",
            co_typ_1: 0.5,
            nox_typ_1: 0.04,
            ptcl_typ_1: null,
          },
        ],
      }),
    });

    const result = await adapter.getEmissions({
      make: "Renault",
      model: "Clio",
      year: 2022,
      fuelType: "essence",
    });

    expect(result.co2GKm).toBe(128);
    expect(result.energyClass).toBe("B");
    expect(result.euroNorm).toBe("Euro 6d");
    expect(result.pollutants).toEqual({ CO: 0.5, NOx: 0.04 });
    expect(result.provider.providerName).toBe("ademe");
  });

  it("should throw when no results found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });

    await expect(adapter.getEmissions({ make: "Unknown", model: "X", year: 2020 })).rejects.toThrow(
      "No emission data found",
    );
  });

  it("should throw on API HTTP error after retries", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: "Server Error" });

    await expect(
      adapter.getEmissions({ make: "Renault", model: "Clio", year: 2022 }),
    ).rejects.toThrow("ADEME API request failed after 3 attempts");

    // 1 initial + 2 retries = 3 calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should build correct query params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ co2_g_km: 100, lib_eg_conso: "A", norme_euro: "Euro 6", cod_cbr: "GO" }],
      }),
    });

    await adapter.getEmissions({ make: "Peugeot", model: "308", year: 2023, fuelType: "diesel" });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("lib_mrq_utf8_eq=PEUGEOT");
    expect(calledUrl).toContain("lib_mod_utf8_eq=308");
    expect(calledUrl).toContain("annee_eq=2023");
    expect(calledUrl).toContain("cod_cbr_eq=GO");
  });

  it("should return null pollutants when none present", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ co2_g_km: 0, lib_eg_conso: "A", norme_euro: "N/A", cod_cbr: "EL" }],
      }),
    });

    const result = await adapter.getEmissions({ fuelType: "electrique" });
    expect(result.pollutants).toBeNull();
  });
});

// ─── RappelConso Recall Adapter ────────────────────────────────────────────

describe("RappelConsoRecallAdapter", () => {
  const adapter = new RappelConsoRecallAdapter("https://mock-rappelconso.test/api", 5000);

  it("should have provider metadata", () => {
    expect(adapter.providerName).toBe("rappelconso");
    expect(adapter.providerVersion).toBe("1.0.0");
  });

  it("should return recall campaigns", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_count: 1,
        results: [
          {
            reference_fiche: "RC-2024-001",
            nom_de_la_marque_du_produit: "Citroën",
            noms_des_modeles_ou_references: "C3 2019",
            nature_du_risque_encouru_par_le_consommateur: "Risque de blessure",
            motif_du_rappel: "Airbag défectueux",
            date_de_publication: "2024-01-15",
            sous_categorie_de_produit: "Automobiles",
          },
        ],
      }),
    });

    const result = await adapter.getRecalls({ make: "Citroën", model: "C3" });
    expect(result.recalls).toHaveLength(1);
    expect(result.recalls[0].id).toBe("RC-2024-001");
    expect(result.recalls[0].title).toBe("Airbag défectueux");
    expect(result.recalls[0].riskLevel).toBe("medium");
    expect(result.totalCount).toBe(1);
  });

  it("should return empty for no recalls", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ total_count: 0, results: [] }),
    });

    const result = await adapter.getRecalls({ make: "Tesla", model: "Model 3" });
    expect(result.recalls).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });

  it("should map high risk correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            reference_fiche: "RC-2024-002",
            nature_du_risque_encouru_par_le_consommateur: "Risque d'incendie du véhicule",
            motif_du_rappel: "Fuite carburant",
            date_de_publication: "2024-02-01",
          },
        ],
      }),
    });

    const result = await adapter.getRecalls({ make: "Ford", model: "Kuga" });
    expect(result.recalls[0].riskLevel).toBe("high");
  });

  it("should throw on API error after retries", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: "Service Unavailable" });

    await expect(adapter.getRecalls({ make: "BMW", model: "X3" })).rejects.toThrow(
      "RappelConso API request failed after 3 attempts",
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

// ─── Local Crit'Air Calculator ─────────────────────────────────────────────

describe("LocalCritAirCalculator", () => {
  const adapter = new LocalCritAirCalculator();

  it("should have provider metadata", () => {
    expect(adapter.providerName).toBe("local-critair");
    expect(adapter.providerVersion).toBe("1.0.0");
  });

  // Electric
  it("should classify electrique as Crit'Air 0", async () => {
    const res = await adapter.calculate({
      fuelType: "electrique",
      euroNorm: "N/A",
      registrationDate: "2023-01-01",
    });
    expect(res.level).toBe("0");
    expect(res.color).toBe("vert");
  });

  it("should classify hydrogen as Crit'Air 0", async () => {
    const res = await adapter.calculate({
      fuelType: "hydrogene",
      euroNorm: "N/A",
      registrationDate: "2023-01-01",
    });
    expect(res.level).toBe("0");
  });

  // Essence
  it("should classify essence Euro 6 as Crit'Air 1", async () => {
    const res = await adapter.calculate({
      fuelType: "essence",
      euroNorm: "Euro 6d",
      registrationDate: "2022-01-01",
    });
    expect(res.level).toBe("1");
    expect(res.color).toBe("violet");
  });

  it("should classify essence Euro 5 as Crit'Air 1", async () => {
    const res = await adapter.calculate({
      fuelType: "essence",
      euroNorm: "Euro 5",
      registrationDate: "2012-01-01",
    });
    expect(res.level).toBe("1");
  });

  it("should classify essence Euro 4 as Crit'Air 2", async () => {
    const res = await adapter.calculate({
      fuelType: "essence",
      euroNorm: "Euro 4",
      registrationDate: "2008-01-01",
    });
    expect(res.level).toBe("2");
    expect(res.color).toBe("jaune");
  });

  it("should classify essence Euro 2 as Crit'Air 3", async () => {
    const res = await adapter.calculate({
      fuelType: "essence",
      euroNorm: "Euro 2",
      registrationDate: "2000-01-01",
    });
    expect(res.level).toBe("3");
    expect(res.color).toBe("orange");
  });

  it("should classify GPL Euro 6 as Crit'Air 1", async () => {
    const res = await adapter.calculate({
      fuelType: "gpl",
      euroNorm: "Euro 6",
      registrationDate: "2020-01-01",
    });
    expect(res.level).toBe("1");
  });

  // Diesel
  it("should classify diesel Euro 6 as Crit'Air 2", async () => {
    const res = await adapter.calculate({
      fuelType: "diesel",
      euroNorm: "Euro 6d-FULL",
      registrationDate: "2023-01-01",
    });
    expect(res.level).toBe("2");
    expect(res.color).toBe("jaune");
  });

  it("should classify diesel Euro 5 as Crit'Air 3", async () => {
    const res = await adapter.calculate({
      fuelType: "diesel",
      euroNorm: "Euro 5",
      registrationDate: "2014-01-01",
    });
    expect(res.level).toBe("3");
    expect(res.color).toBe("orange");
  });

  it("should classify diesel Euro 4 as Crit'Air 3", async () => {
    const res = await adapter.calculate({
      fuelType: "diesel",
      euroNorm: "Euro 4",
      registrationDate: "2008-01-01",
    });
    expect(res.level).toBe("3");
  });

  it("should classify diesel Euro 3 as Crit'Air 4", async () => {
    const res = await adapter.calculate({
      fuelType: "diesel",
      euroNorm: "Euro 3",
      registrationDate: "2004-01-01",
    });
    expect(res.level).toBe("4");
    expect(res.color).toBe("bordeaux");
  });

  it("should classify diesel Euro 2 as Crit'Air 5", async () => {
    const res = await adapter.calculate({
      fuelType: "diesel",
      euroNorm: "Euro 2",
      registrationDate: "2000-01-01",
    });
    expect(res.level).toBe("5");
    expect(res.color).toBe("gris");
  });

  // Fallback by registration date (no valid Euro norm)
  it("should fallback to date for essence without Euro norm", async () => {
    const res = await adapter.calculate({
      fuelType: "essence",
      euroNorm: "unknown",
      registrationDate: "2015-06-01",
    });
    expect(res.level).toBe("1"); // 2011+
  });

  it("should fallback to date for diesel without Euro norm", async () => {
    const res = await adapter.calculate({
      fuelType: "diesel",
      euroNorm: "N/A",
      registrationDate: "2003-06-01",
    });
    expect(res.level).toBe("4"); // 2001-2005
  });

  // Unknown fuel
  it("should return non-classe for unknown fuel type", async () => {
    const res = await adapter.calculate({
      fuelType: "biodiesel_custom",
      euroNorm: "Euro 6",
      registrationDate: "2023-01-01",
    });
    expect(res.level).toBe("non-classe");
  });

  it("should include label in response", async () => {
    const res = await adapter.calculate({
      fuelType: "essence",
      euroNorm: "Euro 6",
      registrationDate: "2022-01-01",
    });
    expect(res.label).toBe("Crit'Air 1");
  });
});

// ─── NHTSA VIN Adapter ─────────────────────────────────────────────────────

describe("NhtsaVINAdapter", () => {
  const adapter = new NhtsaVINAdapter("https://mock-nhtsa.test/api", 5000);

  it("should have provider metadata", () => {
    expect(adapter.providerName).toBe("nhtsa");
    expect(adapter.providerVersion).toBe("1.0.0");
  });

  it("should decode VIN successfully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Results: [
          {
            ErrorCode: "0",
            Make: "VOLKSWAGEN",
            Model: "Golf",
            ModelYear: "2021",
            BodyClass: "Hatchback",
            DriveType: "FWD",
            EngineCylinders: "4",
            DisplacementCC: "1984.0",
            FuelTypePrimary: "Gasoline",
            GVWR: null,
            PlantCountry: "GERMANY",
            Manufacturer: "VOLKSWAGEN AG",
            VehicleType: "PASSENGER CAR",
          },
        ],
      }),
    });

    const result = await adapter.decode({ vin: "WVWZZZ3CZWE123456" });
    expect(result.make).toBe("VOLKSWAGEN");
    expect(result.model).toBe("Golf");
    expect(result.year).toBe(2021);
    expect(result.engineCapacityCc).toBe(1984);
    expect(result.manufacturer).toBe("VOLKSWAGEN AG");
    expect(result.provider.providerName).toBe("nhtsa");
  });

  it("should throw when no results returned", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Results: [] }),
    });

    await expect(adapter.decode({ vin: "INVALID" })).rejects.toThrow("No VIN data returned");
  });

  it("should throw on NHTSA error code", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Results: [{ ErrorCode: "1", ErrorText: "Invalid VIN format" }],
      }),
    });

    await expect(adapter.decode({ vin: "BAD" })).rejects.toThrow("NHTSA VIN decode error");
  });

  it("should handle null optional fields", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Results: [
          {
            ErrorCode: "0",
            Make: "RENAULT",
            Model: "Clio",
            ModelYear: "2022",
            BodyClass: null,
            DriveType: null,
            EngineCylinders: null,
            DisplacementCC: null,
            FuelTypePrimary: null,
            GVWR: null,
            PlantCountry: null,
            Manufacturer: "RENAULT SAS",
            VehicleType: null,
          },
        ],
      }),
    });

    const result = await adapter.decode({ vin: "VF1RFB00X56789012" });
    expect(result.bodyClass).toBeNull();
    expect(result.engineCapacityCc).toBeNull();
    expect(result.fuelType).toBeNull();
  });

  it("should retry on fetch failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error")).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Results: [
          { ErrorCode: "0", Make: "BMW", Model: "X3", ModelYear: "2020", Manufacturer: "BMW AG" },
        ],
      }),
    });

    const result = await adapter.decode({ vin: "WBAPH5C5XBA123456" });
    expect(result.make).toBe("BMW");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should throw after max retries", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: "Server Error" });

    await expect(adapter.decode({ vin: "TEST" })).rejects.toThrow(
      "NHTSA API request failed after 3 attempts",
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
