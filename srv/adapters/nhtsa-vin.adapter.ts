import type { VINTechnicalRequest, VINTechnicalResponse } from "@auto/shared";
import type { IVINTechnicalAdapter } from "./interfaces/vin-technical.interface";

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

interface NhtsaResult {
  ErrorCode?: string;
  ErrorText?: string;
  Make?: string;
  Model?: string;
  ModelYear?: string;
  BodyClass?: string;
  DriveType?: string;
  EngineCylinders?: string;
  DisplacementCC?: string;
  FuelTypePrimary?: string;
  GVWR?: string;
  PlantCountry?: string;
  Manufacturer?: string;
  VehicleType?: string;
}

interface NhtsaApiResponse {
  Results: NhtsaResult[];
}

/** NHTSA vPIC (Vehicle Product Information Catalog) adapter for VIN decoding. */
export class NhtsaVINAdapter implements IVINTechnicalAdapter {
  readonly providerName = "nhtsa";
  readonly providerVersion = "1.0.0";

  constructor(
    private baseUrl = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues",
    private timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async decode(request: VINTechnicalRequest): Promise<VINTechnicalResponse> {
    const url = `${this.baseUrl}/${encodeURIComponent(request.vin)}?format=json`;
    const data = (await this.fetchWithRetry(url)) as unknown as NhtsaApiResponse;

    if (!data.Results || data.Results.length === 0) {
      throw new Error(`No VIN data returned for: ${request.vin}`);
    }

    const r = data.Results[0];

    // NHTSA returns ErrorCode "0" for success
    if (r.ErrorCode && r.ErrorCode !== "0" && !r.ErrorCode.includes("0")) {
      throw new Error(`NHTSA VIN decode error: ${r.ErrorText || r.ErrorCode}`);
    }

    return {
      vin: request.vin,
      make: r.Make || "Unknown",
      model: r.Model || "Unknown",
      year: parseInt(r.ModelYear || "0", 10) || 0,
      bodyClass: r.BodyClass || null,
      driveType: r.DriveType || null,
      engineCylinders: r.EngineCylinders ? parseInt(r.EngineCylinders, 10) : null,
      engineCapacityCc: r.DisplacementCC ? Math.round(parseFloat(r.DisplacementCC)) : null,
      fuelType: r.FuelTypePrimary || null,
      gvwr: r.GVWR || null,
      plantCountry: r.PlantCountry || null,
      manufacturer: r.Manufacturer || "Unknown",
      vehicleType: r.VehicleType || null,
      provider: { providerName: this.providerName, providerVersion: this.providerVersion },
    };
  }

  private async fetchWithRetry(url: string, attempt = 0): Promise<Record<string, unknown>> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`NHTSA API error: ${response.status} ${response.statusText}`);
        }
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * (attempt + 1));
        return this.fetchWithRetry(url, attempt + 1);
      }
      throw new Error(
        `NHTSA API request failed after ${MAX_RETRIES + 1} attempts: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
