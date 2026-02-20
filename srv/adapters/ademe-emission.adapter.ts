import type { EmissionRequest, EmissionResponse } from "@auto/shared";
import type { IEmissionAdapter } from "./interfaces/emission.interface";

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

interface AdemeRecord {
  co2_g_km?: number;
  lib_eg_conso?: string;
  norme_euro?: string;
  cod_cbr?: string;
  co_typ_1?: number;
  nox_typ_1?: number;
  ptcl_typ_1?: number;
}

interface AdemeApiResponse {
  results: AdemeRecord[];
}

/** ADEME (Agence de l'Environnement et de la Maîtrise de l'Énergie) adapter. */
export class AdemeEmissionAdapter implements IEmissionAdapter {
  readonly providerName = "ademe";
  readonly providerVersion = "1.0.0";

  constructor(
    private baseUrl = "https://data.ademe.fr/data-fair/api/v1/datasets/ademe-car-labelling",
    private timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async getEmissions(request: EmissionRequest): Promise<EmissionResponse> {
    const params = new URLSearchParams();
    if (request.make) params.set("lib_mrq_utf8_eq", request.make.toUpperCase());
    if (request.model) params.set("lib_mod_utf8_eq", request.model.toUpperCase());
    if (request.year) params.set("annee_eq", String(request.year));
    if (request.fuelType) params.set("cod_cbr_eq", mapFuelType(request.fuelType));
    params.set("size", "1");
    params.set("select", "co2_g_km,lib_eg_conso,norme_euro,cod_cbr,co_typ_1,nox_typ_1,ptcl_typ_1");

    const url = `${this.baseUrl}/lines?${params.toString()}`;
    const data = (await this.fetchWithRetry(url)) as unknown as AdemeApiResponse;

    if (!data.results || data.results.length === 0) {
      throw new Error(
        `No emission data found for ${request.make} ${request.model} ${request.year}`,
      );
    }

    const record: AdemeRecord = data.results[0];

    return {
      co2GKm: record.co2_g_km ?? 0,
      energyClass: record.lib_eg_conso ?? "unknown",
      euroNorm: record.norme_euro ?? "unknown",
      fuelType: request.fuelType || unmapFuelType(record.cod_cbr),
      pollutants: buildPollutants(record),
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
          throw new Error(`ADEME API error: ${response.status} ${response.statusText}`);
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
        `ADEME API request failed after ${MAX_RETRIES + 1} attempts: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function mapFuelType(fuelType: string): string {
  const map: Record<string, string> = {
    essence: "ES",
    diesel: "GO",
    gazole: "GO",
    electrique: "EL",
    hybride: "EH",
    gpl: "GP",
    gnv: "GN",
  };
  return map[fuelType.toLowerCase()] || fuelType;
}

function unmapFuelType(code: string | undefined): string {
  const map: Record<string, string> = {
    ES: "essence",
    GO: "diesel",
    EL: "electrique",
    EH: "hybride",
    GP: "gpl",
    GN: "gnv",
  };
  return map[code || ""] || code || "unknown";
}

function buildPollutants(record: AdemeRecord): Record<string, number> | null {
  const pollutants: Record<string, number> = {};
  if (record.co_typ_1 != null) pollutants.CO = record.co_typ_1;
  if (record.nox_typ_1 != null) pollutants.NOx = record.nox_typ_1;
  if (record.ptcl_typ_1 != null) pollutants.PM = record.ptcl_typ_1;
  return Object.keys(pollutants).length > 0 ? pollutants : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
