import type { EmissionRequest, EmissionResponse } from "@auto/shared";

export interface IEmissionAdapter {
  readonly providerName: string;
  readonly providerVersion: string;
  getEmissions(request: EmissionRequest): Promise<EmissionResponse>;
}
