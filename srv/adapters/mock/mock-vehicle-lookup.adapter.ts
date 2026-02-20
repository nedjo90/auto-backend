import type { VehicleLookupRequest, VehicleLookupResponse } from "@auto/shared";
import type { IVehicleLookupAdapter } from "../interfaces/vehicle-lookup.interface";

const MOCK_VEHICLES: VehicleLookupResponse[] = [
  {
    plate: "AB-123-CD",
    vin: "VF1RFB00X56789012",
    make: "Renault",
    model: "Clio V",
    variant: "RS Line",
    year: 2022,
    registrationDate: "2022-03-15",
    fuelType: "essence",
    engineCapacityCc: 1333,
    powerKw: 96,
    powerHp: 131,
    gearbox: "EDC",
    bodyType: "berline",
    doors: 5,
    seats: 5,
    color: "Rouge Flamme",
    co2GKm: 128,
    euroNorm: "Euro 6d",
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
  {
    plate: "EF-456-GH",
    vin: "VF3LCBHZ6JS123456",
    make: "Peugeot",
    model: "308",
    variant: "GT",
    year: 2023,
    registrationDate: "2023-01-10",
    fuelType: "diesel",
    engineCapacityCc: 1499,
    powerKw: 96,
    powerHp: 130,
    gearbox: "EAT8",
    bodyType: "berline",
    doors: 5,
    seats: 5,
    color: "Bleu Vertigo",
    co2GKm: 102,
    euroNorm: "Euro 6d-FULL",
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
  {
    plate: "IJ-789-KL",
    vin: "WVWZZZ3CZWE123456",
    make: "Volkswagen",
    model: "Golf 8",
    variant: null,
    year: 2021,
    registrationDate: "2021-09-20",
    fuelType: "essence",
    engineCapacityCc: 1498,
    powerKw: 110,
    powerHp: 150,
    gearbox: "DSG",
    bodyType: "berline",
    doors: 5,
    seats: 5,
    color: "Gris Moonstone",
    co2GKm: 132,
    euroNorm: "Euro 6d",
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
  {
    plate: "MN-012-OP",
    vin: "WBA11AA010CH12345",
    make: "BMW",
    model: "Série 3",
    variant: "320d",
    year: 2020,
    registrationDate: "2020-06-01",
    fuelType: "diesel",
    engineCapacityCc: 1995,
    powerKw: 140,
    powerHp: 190,
    gearbox: "automatique",
    bodyType: "berline",
    doors: 4,
    seats: 5,
    color: "Noir Saphir",
    co2GKm: 118,
    euroNorm: "Euro 6d-TEMP",
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
];

export class MockVehicleLookupAdapter implements IVehicleLookupAdapter {
  readonly providerName = "mock";
  readonly providerVersion = "1.0.0";

  constructor(private delayMs = 0) {}

  async lookup(request: VehicleLookupRequest): Promise<VehicleLookupResponse> {
    if (this.delayMs > 0) await delay(this.delayMs);

    if (!request.plate && !request.vin) {
      throw new Error("Either plate or vin must be provided");
    }

    const vehicle = MOCK_VEHICLES.find((v) => v.plate === request.plate || v.vin === request.vin);

    if (!vehicle) {
      throw new Error(`Vehicle not found for plate=${request.plate} vin=${request.vin}`);
    }

    return { ...vehicle };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
