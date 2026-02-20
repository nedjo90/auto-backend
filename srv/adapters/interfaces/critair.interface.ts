import type { CritAirRequest, CritAirResponse } from "@auto/shared";

export interface ICritAirCalculator {
  readonly providerName: string;
  readonly providerVersion: string;
  calculate(request: CritAirRequest): Promise<CritAirResponse>;
}
