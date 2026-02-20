import type { ValuationRequest, ValuationResponse } from "@auto/shared";

export interface IValuationAdapter {
  readonly providerName: string;
  readonly providerVersion: string;
  evaluate(request: ValuationRequest): Promise<ValuationResponse>;
}
