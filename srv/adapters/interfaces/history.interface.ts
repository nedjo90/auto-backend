import type { HistoryRequest, HistoryResponse } from "@auto/shared";

export interface IHistoryAdapter {
  readonly providerName: string;
  readonly providerVersion: string;
  getHistory(request: HistoryRequest): Promise<HistoryResponse>;
}
