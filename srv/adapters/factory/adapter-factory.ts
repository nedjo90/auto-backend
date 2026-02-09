import type { IIdentityProviderAdapter } from "../interfaces/identity-provider.interface";
import type { IBlobStorageAdapter } from "../interfaces/blob-storage.interface";
import { AzureAdB2cAdapter } from "../azure-ad-b2c-adapter";
import { AzureBlobStorageAdapter } from "../azure-blob-storage-adapter";

let identityProviderInstance: IIdentityProviderAdapter | null = null;
let blobStorageInstance: IBlobStorageAdapter | null = null;

export function getIdentityProvider(): IIdentityProviderAdapter {
  if (!identityProviderInstance) {
    identityProviderInstance = new AzureAdB2cAdapter();
  }
  return identityProviderInstance;
}

export function setIdentityProvider(adapter: IIdentityProviderAdapter): void {
  identityProviderInstance = adapter;
}

export function resetIdentityProvider(): void {
  identityProviderInstance = null;
}

export function getBlobStorage(): IBlobStorageAdapter {
  if (!blobStorageInstance) {
    blobStorageInstance = new AzureBlobStorageAdapter();
  }
  return blobStorageInstance;
}

export function setBlobStorage(adapter: IBlobStorageAdapter): void {
  blobStorageInstance = adapter;
}

export function resetBlobStorage(): void {
  blobStorageInstance = null;
}
