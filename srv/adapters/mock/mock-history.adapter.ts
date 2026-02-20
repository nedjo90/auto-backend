import type { HistoryRequest, HistoryResponse } from "@auto/shared";
import type { IHistoryAdapter } from "../interfaces/history.interface";
import { delay } from "../../lib/async-utils";

const MOCK_HISTORIES: Record<string, HistoryResponse> = {
  VF1RFB00X56789012: {
    vin: "VF1RFB00X56789012",
    ownerCount: 2,
    firstRegistrationDate: "2018-06-01",
    lastRegistrationDate: "2022-03-15",
    mileageRecords: [
      { date: "2020-06-01", mileageKm: 25000, source: "controle_technique" },
      { date: "2022-06-01", mileageKm: 52000, source: "controle_technique" },
    ],
    accidents: [],
    stolen: false,
    totalDamageCount: 0,
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
  VF3LCBHZ6JS123456: {
    vin: "VF3LCBHZ6JS123456",
    ownerCount: 1,
    firstRegistrationDate: "2023-01-10",
    lastRegistrationDate: "2023-01-10",
    mileageRecords: [{ date: "2024-01-10", mileageKm: 18000, source: "revision_constructeur" }],
    accidents: [],
    stolen: false,
    totalDamageCount: 0,
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
  WVWZZZ3CZWE123456: {
    vin: "WVWZZZ3CZWE123456",
    ownerCount: 3,
    firstRegistrationDate: "2015-04-20",
    lastRegistrationDate: "2021-09-20",
    mileageRecords: [
      { date: "2017-04-20", mileageKm: 40000, source: "controle_technique" },
      { date: "2019-04-20", mileageKm: 82000, source: "controle_technique" },
      { date: "2021-04-20", mileageKm: 115000, source: "controle_technique" },
    ],
    accidents: [{ date: "2019-11-05", severity: "minor", description: "Accrochage latéral" }],
    stolen: false,
    totalDamageCount: 1,
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
  WBA11AA010CH12345: {
    vin: "WBA11AA010CH12345",
    ownerCount: 1,
    firstRegistrationDate: "2020-06-01",
    lastRegistrationDate: "2020-06-01",
    mileageRecords: [
      { date: "2022-06-01", mileageKm: 45000, source: "controle_technique" },
      { date: "2024-06-01", mileageKm: 78000, source: "controle_technique" },
    ],
    accidents: [],
    stolen: false,
    totalDamageCount: 0,
    provider: { providerName: "mock", providerVersion: "1.0.0" },
  },
};

export class MockHistoryAdapter implements IHistoryAdapter {
  readonly providerName = "mock";
  readonly providerVersion = "1.0.0";

  constructor(private delayMs = 0) {}

  async getHistory(request: HistoryRequest): Promise<HistoryResponse> {
    if (this.delayMs > 0) await delay(this.delayMs);

    const data = MOCK_HISTORIES[request.vin];
    if (!data) {
      throw new Error(`No history found for VIN: ${request.vin}`);
    }

    return {
      ...data,
      mileageRecords: data.mileageRecords.map((r) => ({ ...r })),
      accidents: data.accidents.map((a) => ({ ...a })),
    };
  }
}
