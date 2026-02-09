import { AzureBlobStorageAdapter } from "../../../srv/adapters/azure-blob-storage-adapter";

describe("AzureBlobStorageAdapter", () => {
  let adapter: AzureBlobStorageAdapter;

  beforeEach(() => {
    adapter = new AzureBlobStorageAdapter();
  });

  describe("uploadFile", () => {
    it("should upload and return a URL", async () => {
      const url = await adapter.uploadFile("test-container", "test/file.json", "content");
      expect(url).toContain("test-container/test/file.json");
      expect(url).toContain("https://");
    });
  });

  describe("generateSignedUrl", () => {
    it("should generate signed URL for uploaded file", async () => {
      await adapter.uploadFile("test-container", "test/file.json", "content");
      const url = await adapter.generateSignedUrl("test-container", "test/file.json", 60);
      expect(url).toContain("sig=");
      expect(url).toContain("se=");
    });

    it("should throw for non-existent file", async () => {
      await expect(
        adapter.generateSignedUrl("test-container", "nonexistent.json", 60),
      ).rejects.toThrow("File not found");
    });
  });

  describe("deleteFile", () => {
    it("should delete uploaded file", async () => {
      await adapter.uploadFile("test-container", "test/file.json", "content");
      await adapter.deleteFile("test-container", "test/file.json");
      await expect(
        adapter.generateSignedUrl("test-container", "test/file.json", 60),
      ).rejects.toThrow("File not found");
    });

    it("should not throw for non-existent file", async () => {
      await expect(adapter.deleteFile("test-container", "nonexistent.json")).resolves.not.toThrow();
    });
  });
});
