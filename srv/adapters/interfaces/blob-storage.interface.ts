export interface IBlobStorageAdapter {
  uploadFile(container: string, path: string, content: Buffer | string): Promise<string>;
  generateSignedUrl(container: string, path: string, expiryMinutes: number): Promise<string>;
  deleteFile(container: string, path: string): Promise<void>;
}
