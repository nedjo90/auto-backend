import type { VINTechnicalRequest, VINTechnicalResponse } from "@auto/shared";

export interface IVINTechnicalAdapter {
  readonly providerName: string;
  readonly providerVersion: string;
  decode(request: VINTechnicalRequest): Promise<VINTechnicalResponse>;
}
