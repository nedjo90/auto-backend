import type { EmissionRequest, EmissionResponse } from "@auto/shared";
import type { IEmissionAdapter } from "../interfaces/emission.interface";

const MOCK_EMISSIONS: Record<string, EmissionResponse> = {
  "Renault|Clio V|2022|essence": {
    co2GKm: 128,
    energyClass: "B",
    euroNorm: "Euro 6d",
    fuelType: "essence",
    pollutants: { NOx: 0.04, CO: 0.5, HC: 0.05 },
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
  "Peugeot|308|2023|diesel": {
    co2GKm: 102,
    energyClass: "A",
    euroNorm: "Euro 6d-FULL",
    fuelType: "diesel",
    pollutants: { NOx: 0.06, PM: 0.004, CO: 0.3 },
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
  "Volkswagen|Golf 8|2021|essence": {
    co2GKm: 132,
    energyClass: "B",
    euroNorm: "Euro 6d",
    fuelType: "essence",
    pollutants: { NOx: 0.04, CO: 0.6 },
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
  "BMW|Série 3|2020|diesel": {
    co2GKm: 118,
    energyClass: "A",
    euroNorm: "Euro 6d-TEMP",
    fuelType: "diesel",
    pollutants: { NOx: 0.08, PM: 0.005, CO: 0.4 },
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
};

export class MockEmissionAdapter implements IEmissionAdapter {
  readonly providerName = "mock";
  readonly providerVersion = "1.0.0";

  constructor(private delayMs = 0) {}

  async getEmissions(request: EmissionRequest): Promise<EmissionResponse> {
    if (this.delayMs > 0) await delay(this.delayMs);

    const key = `${request.make}|${request.model}|${request.year}|${request.fuelType}`;
    const data = MOCK_EMISSIONS[key];

    if (data) return { ...data };

    // Default response for unknown vehicles
    return {
      co2GKm: 120,
      energyClass: "B",
      euroNorm: "Euro 6",
      fuelType: request.fuelType || "essence",
      pollutants: null,
      provider: { providerName: "mock", providerVersion: "1.0.0" },
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
