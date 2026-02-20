import type { VINTechnicalRequest, VINTechnicalResponse } from "@auto/shared";
import type { IVINTechnicalAdapter } from "../interfaces/vin-technical.interface";
import { delay } from "../../lib/async-utils";

const MOCK_VIN_DATA: Record<string, VINTechnicalResponse> = {
  VF1RFB00X56789012: {
    vin: "VF1RFB00X56789012",
    make: "Renault",
    model: "Clio",
    year: 2022,
    bodyClass: "Hatchback",
    driveType: "FWD",
    engineCylinders: 4,
    engineCapacityCc: 1333,
    fuelType: "Gasoline",
    gvwr: null,
    plantCountry: "France",
    manufacturer: "Renault SAS",
    vehicleType: "Passenger Car",
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
  VF3LCBHZ6JS123456: {
    vin: "VF3LCBHZ6JS123456",
    make: "Peugeot",
    model: "308",
    year: 2023,
    bodyClass: "Hatchback",
    driveType: "FWD",
    engineCylinders: 4,
    engineCapacityCc: 1499,
    fuelType: "Diesel",
    gvwr: null,
    plantCountry: "France",
    manufacturer: "Automobiles Peugeot",
    vehicleType: "Passenger Car",
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
  WVWZZZ3CZWE123456: {
    vin: "WVWZZZ3CZWE123456",
    make: "Volkswagen",
    model: "Golf",
    year: 2021,
    bodyClass: "Hatchback",
    driveType: "FWD",
    engineCylinders: 4,
    engineCapacityCc: 1498,
    fuelType: "Gasoline",
    gvwr: null,
    plantCountry: "Germany",
    manufacturer: "Volkswagen AG",
    vehicleType: "Passenger Car",
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
  WBA11AA010CH12345: {
    vin: "WBA11AA010CH12345",
    make: "BMW",
    model: "3 Series",
    year: 2020,
    bodyClass: "Sedan",
    driveType: "RWD",
    engineCylinders: 4,
    engineCapacityCc: 1995,
    fuelType: "Diesel",
    gvwr: null,
    plantCountry: "Germany",
    manufacturer: "BMW AG",
    vehicleType: "Passenger Car",
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
};

export class MockVINTechnicalAdapter implements IVINTechnicalAdapter {
  readonly providerName = "mock";
  readonly providerVersion = "1.0.0";

  constructor(private delayMs = 0) {}

  async decode(request: VINTechnicalRequest): Promise<VINTechnicalResponse> {
    if (this.delayMs > 0) await delay(this.delayMs);

    const data = MOCK_VIN_DATA[request.vin];
    if (!data) {
      throw new Error(`VIN not found: ${request.vin}`);
    }

    return { ...data };
  }
}
