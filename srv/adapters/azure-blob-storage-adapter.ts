import type { IBlobStorageAdapter } from "./interfaces/blob-storage.interface";

/**
 * Azure Blob Storage adapter for RGPD data export files.
 * Uses @azure/storage-blob SDK in production.
 * Currently a stub that stores files in memory for development.
 */
export class AzureBlobStorageAdapter implements IBlobStorageAdapter {
  private storage = new Map<string, Buffer | string>();

  async uploadFile(container: string, path: string, content: Buffer | string): Promise<string> {
    const key = `${container}/${path}`;
    this.storage.set(key, content);
    return `https://storage.blob.core.windows.net/${key}`;
  }

  async generateSignedUrl(container: string, path: string, expiryMinutes: number): Promise<string> {
    const key = `${container}/${path}`;
    if (!this.storage.has(key)) {
      throw new Error(`File not found: ${key}`);
    }
    const expiry = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();
    return `https://storage.blob.core.windows.net/${key}?se=${encodeURIComponent(expiry)}&sig=stub-signature`;
  }

  async deleteFile(container: string, path: string): Promise<void> {
    const key = `${container}/${path}`;
    this.storage.delete(key);
  }
}
