import type { RecallRequest, RecallResponse } from "@auto/shared";

export interface IRecallAdapter {
  readonly providerName: string;
  readonly providerVersion: string;
  getRecalls(request: RecallRequest): Promise<RecallResponse>;
}
