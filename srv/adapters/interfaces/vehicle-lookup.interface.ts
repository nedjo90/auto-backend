import type { VehicleLookupRequest, VehicleLookupResponse } from "@auto/shared";

export interface IVehicleLookupAdapter {
  readonly providerName: string;
  readonly providerVersion: string;
  lookup(request: VehicleLookupRequest): Promise<VehicleLookupResponse>;
}
