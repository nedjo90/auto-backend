import type { HistoryRequest, HistoryResponse } from "@auto/shared";
import type { IHistoryAdapter } from "../interfaces/history.interface";
import { delay } from "../../lib/async-utils";

/**
 * Expected provider interface for future real adapter implementations:
 *
 * - **CarVertical** (carvertical.com): VIN-based vehicle history reports
 *   covering ownership, accidents, mileage fraud, theft, finance liens.
 *   API: REST JSON, auth via API key, cost ~2-5 EUR/report.
 *
 * - **AutoDNA** (autodna.com): European vehicle history reports
 *   covering ownership, damage, mileage, registration history.
 *   API: REST JSON, auth via API key, cost ~3-7 EUR/report.
 *
 * - **Autoviza** (autoviza.com): French-focused vehicle history
 *   covering SIV registration, contrôle technique, accidents.
 *   API: REST JSON, auth via API key, cost ~1-4 EUR/report.
 *
 * All providers must implement IHistoryAdapter and return data
 * conforming to HistoryResponse. Provider swap is handled via
 * ConfigApiProvider configuration without code changes.
 *
 * Default configurable delay: 150ms (simulates real API latency).
 */

const DEFAULT_MOCK_DELAY_MS = 150;

const MOCK_HISTORIES: Record<string, HistoryResponse> = {
  // Clean 2-owner Renault, normal mileage progression, no issues
  VF1RFB00X56789012: {
    vin: "VF1RFB00X56789012",
    ownerCount: 2,
    firstRegistrationDate: "2018-06-01",
    lastRegistrationDate: "2022-03-15",
    mileageRecords: [
      { date: "2019-06-01", mileageKm: 12500, source: "revision_constructeur" },
      { date: "2020-06-01", mileageKm: 25000, source: "controle_technique" },
      { date: "2021-06-15", mileageKm: 38000, source: "revision_constructeur" },
      { date: "2022-06-01", mileageKm: 52000, source: "controle_technique" },
      { date: "2023-09-10", mileageKm: 64000, source: "revision_constructeur" },
    ],
    accidents: [],
    registrationHistory: [
      { date: "2018-06-01", department: "75", region: "Île-de-France" },
      { date: "2022-03-15", department: "69", region: "Auvergne-Rhône-Alpes" },
    ],
    outstandingFinance: false,
    stolen: false,
    totalDamageCount: 0,
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },

  // Single-owner recent Peugeot, low mileage, spotless record
  VF3LCBHZ6JS123456: {
    vin: "VF3LCBHZ6JS123456",
    ownerCount: 1,
    firstRegistrationDate: "2023-01-10",
    lastRegistrationDate: "2023-01-10",
    mileageRecords: [
      { date: "2024-01-10", mileageKm: 18000, source: "revision_constructeur" },
      { date: "2025-01-15", mileageKm: 35000, source: "controle_technique" },
    ],
    accidents: [],
    registrationHistory: [
      { date: "2023-01-10", department: "33", region: "Nouvelle-Aquitaine" },
    ],
    outstandingFinance: false,
    stolen: false,
    totalDamageCount: 0,
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },

  // 3-owner Volkswagen with minor accident, high mileage, multiple department changes
  WVWZZZ3CZWE123456: {
    vin: "WVWZZZ3CZWE123456",
    ownerCount: 3,
    firstRegistrationDate: "2015-04-20",
    lastRegistrationDate: "2021-09-20",
    mileageRecords: [
      { date: "2017-04-20", mileageKm: 40000, source: "controle_technique" },
      { date: "2018-05-12", mileageKm: 55000, source: "revision_constructeur" },
      { date: "2019-04-20", mileageKm: 82000, source: "controle_technique" },
      { date: "2020-07-03", mileageKm: 95000, source: "garage_independant" },
      { date: "2021-04-20", mileageKm: 115000, source: "controle_technique" },
      { date: "2023-04-20", mileageKm: 142000, source: "controle_technique" },
    ],
    accidents: [
      { date: "2019-11-05", severity: "minor", description: "Accrochage latéral côté passager" },
    ],
    registrationHistory: [
      { date: "2015-04-20", department: "13", region: "Provence-Alpes-Côte d'Azur" },
      { date: "2018-02-10", department: "06", region: "Provence-Alpes-Côte d'Azur" },
      { date: "2021-09-20", department: "31", region: "Occitanie" },
    ],
    outstandingFinance: false,
    stolen: false,
    totalDamageCount: 1,
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },

  // Single-owner BMW, medium mileage, clean
  WBA11AA010CH12345: {
    vin: "WBA11AA010CH12345",
    ownerCount: 1,
    firstRegistrationDate: "2020-06-01",
    lastRegistrationDate: "2020-06-01",
    mileageRecords: [
      { date: "2021-06-01", mileageKm: 22000, source: "revision_constructeur" },
      { date: "2022-06-01", mileageKm: 45000, source: "controle_technique" },
      { date: "2023-06-01", mileageKm: 61000, source: "revision_constructeur" },
      { date: "2024-06-01", mileageKm: 78000, source: "controle_technique" },
    ],
    accidents: [],
    registrationHistory: [
      { date: "2020-06-01", department: "92", region: "Île-de-France" },
    ],
    outstandingFinance: false,
    stolen: false,
    totalDamageCount: 0,
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },

  // 2-owner Citroën with outstanding finance lien (flagged)
  VF7SAHMZ0EW123456: {
    vin: "VF7SAHMZ0EW123456",
    ownerCount: 2,
    firstRegistrationDate: "2019-03-15",
    lastRegistrationDate: "2023-08-20",
    mileageRecords: [
      { date: "2021-03-15", mileageKm: 30000, source: "controle_technique" },
      { date: "2022-04-10", mileageKm: 42000, source: "revision_constructeur" },
      { date: "2023-03-15", mileageKm: 58000, source: "controle_technique" },
      { date: "2025-03-15", mileageKm: 75000, source: "controle_technique" },
    ],
    accidents: [],
    registrationHistory: [
      { date: "2019-03-15", department: "44", region: "Pays de la Loire" },
      { date: "2023-08-20", department: "35", region: "Bretagne" },
    ],
    outstandingFinance: true,
    stolen: false,
    totalDamageCount: 0,
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },

  // 4-owner Mercedes with multiple accidents and damage, complex history
  WDD2130011A123456: {
    vin: "WDD2130011A123456",
    ownerCount: 4,
    firstRegistrationDate: "2012-09-01",
    lastRegistrationDate: "2024-01-10",
    mileageRecords: [
      { date: "2014-09-01", mileageKm: 45000, source: "controle_technique" },
      { date: "2016-09-01", mileageKm: 92000, source: "controle_technique" },
      { date: "2017-11-20", mileageKm: 110000, source: "garage_independant" },
      { date: "2018-09-01", mileageKm: 135000, source: "controle_technique" },
      { date: "2020-09-01", mileageKm: 168000, source: "controle_technique" },
      { date: "2022-09-01", mileageKm: 195000, source: "controle_technique" },
      { date: "2024-09-01", mileageKm: 218000, source: "controle_technique" },
    ],
    accidents: [
      { date: "2016-03-12", severity: "moderate", description: "Collision arrière, pare-chocs et coffre endommagés" },
      { date: "2020-01-08", severity: "minor", description: "Stationnement - rayure portière conducteur" },
      { date: "2023-07-15", severity: "minor", description: "Accrochage rétroviseur droit" },
    ],
    registrationHistory: [
      { date: "2012-09-01", department: "59", region: "Hauts-de-France" },
      { date: "2015-06-20", department: "62", region: "Hauts-de-France" },
      { date: "2019-04-01", department: "75", region: "Île-de-France" },
      { date: "2024-01-10", department: "78", region: "Île-de-France" },
    ],
    outstandingFinance: false,
    stolen: false,
    totalDamageCount: 3,
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
};

/** VINs available in mock data for testing. */
export const MOCK_HISTORY_VINS = Object.keys(MOCK_HISTORIES);

export class MockHistoryAdapter implements IHistoryAdapter {
  readonly providerName = "mock";
  readonly providerVersion = "1.0.0";

  constructor(private delayMs = DEFAULT_MOCK_DELAY_MS) {}

  async getHistory(request: HistoryRequest): Promise<HistoryResponse> {
    if (this.delayMs > 0) await delay(this.delayMs);

    const data = MOCK_HISTORIES[request.vin];
    if (!data) {
      throw new Error(`No history found for VIN: ${request.vin}`);
    }

    // Return deep copies to prevent mutations
    return {
      ...data,
      mileageRecords: data.mileageRecords.map((r) => ({ ...r })),
      accidents: data.accidents.map((a) => ({ ...a })),
      registrationHistory: data.registrationHistory.map((r) => ({ ...r })),
      provider: { ...data.provider },
    };
  }
}
