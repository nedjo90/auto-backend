import type { IIdentityProviderAdapter } from "../interfaces/identity-provider.interface";
import { AzureAdB2cAdapter } from "../azure-ad-b2c-adapter";

let identityProviderInstance: IIdentityProviderAdapter | null = null;

export function getIdentityProvider(): IIdentityProviderAdapter {
  if (!identityProviderInstance) {
    identityProviderInstance = new AzureAdB2cAdapter();
  }
  return identityProviderInstance;
}

export function setIdentityProvider(
  adapter: IIdentityProviderAdapter,
): void {
  identityProviderInstance = adapter;
}

export function resetIdentityProvider(): void {
  identityProviderInstance = null;
}
