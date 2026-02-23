import {
  PHOTO_DEFAULT_MAX,
  PHOTO_DEFAULT_MAX_SIZE_BYTES,
  PHOTO_ALLOWED_MIME_TYPES,
} from "@auto/shared";

// ─── Mocks ──────────────────────────────────────────────────────────────

const mockUploadFile = jest.fn();
const mockDeleteFile = jest.fn();
const mockGet = jest.fn();
const mockRun = jest.fn();
const mockEntities = jest.fn();

jest.mock("../../../srv/adapters/factory/adapter-factory", () => ({
  getBlobStorage: () => ({
    uploadFile: mockUploadFile,
    deleteFile: mockDeleteFile,
    generateSignedUrl: jest.fn(),
  }),
}));

jest.mock("../../../srv/lib/config-cache", () => ({
  configCache: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

jest.mock("@sap/cds", () => ({
  __esModule: true,
  default: {
    log: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
    entities: (...args: unknown[]) => mockEntities(...args),
    run: (...args: unknown[]) => mockRun(...args),
  },
}));

// CDS CQL builders are globals in the CAP runtime
/* eslint-disable @typescript-eslint/no-explicit-any */
(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnThis(),
    columns: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  },
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
};
(global as any).DELETE = {
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
};

jest.mock("crypto", () => ({
  randomUUID: () => "00000000-1111-2222-3333-444444444444",
}));

import {
  getMaxPhotos,
  getMaxPhotoSizeBytes,
  validateMimeType,
  validateFileSize,
  getPhotoCount,
  canUploadPhoto,
  buildCdnUrl,
  uploadPhotoBlob,
  deletePhotoBlob,
  deleteAllPhotosForListing,
  getNextSortOrder,
} from "../../../srv/lib/photo-storage";

describe("photo-storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEntities.mockReturnValue({ ListingPhoto: "auto.ListingPhoto" });
  });

  // ─── Config helpers ───────────────────────────────────────────────────

  describe("getMaxPhotos", () => {
    it("should return ConfigParameter value when set", () => {
      mockGet.mockReturnValue({ value: "15" });
      expect(getMaxPhotos()).toBe(15);
      expect(mockGet).toHaveBeenCalledWith("ConfigParameter", "MAX_PHOTOS");
    });

    it("should return default when ConfigParameter not set", () => {
      mockGet.mockReturnValue(undefined);
      expect(getMaxPhotos()).toBe(PHOTO_DEFAULT_MAX);
    });

    it("should return default for invalid ConfigParameter value", () => {
      mockGet.mockReturnValue({ value: "not-a-number" });
      expect(getMaxPhotos()).toBe(PHOTO_DEFAULT_MAX);
    });
  });

  describe("getMaxPhotoSizeBytes", () => {
    it("should return ConfigParameter value when set", () => {
      mockGet.mockReturnValue({ value: "5242880" });
      expect(getMaxPhotoSizeBytes()).toBe(5242880);
    });

    it("should return default when ConfigParameter not set", () => {
      mockGet.mockReturnValue(undefined);
      expect(getMaxPhotoSizeBytes()).toBe(PHOTO_DEFAULT_MAX_SIZE_BYTES);
    });
  });

  // ─── Validation ───────────────────────────────────────────────────────

  describe("validateMimeType", () => {
    it.each(PHOTO_ALLOWED_MIME_TYPES)("should accept %s", (mime) => {
      expect(validateMimeType(mime)).toBe(true);
    });

    it("should reject unsupported MIME types", () => {
      expect(validateMimeType("image/gif")).toBe(false);
      expect(validateMimeType("application/pdf")).toBe(false);
      expect(validateMimeType("text/plain")).toBe(false);
    });
  });

  describe("validateFileSize", () => {
    beforeEach(() => {
      mockGet.mockReturnValue(undefined); // use defaults
    });

    it("should accept valid file size", () => {
      expect(validateFileSize(1024)).toBe(true);
    });

    it("should accept file at exact max size", () => {
      expect(validateFileSize(PHOTO_DEFAULT_MAX_SIZE_BYTES)).toBe(true);
    });

    it("should reject zero-size file", () => {
      expect(validateFileSize(0)).toBe(false);
    });

    it("should reject negative size", () => {
      expect(validateFileSize(-1)).toBe(false);
    });

    it("should reject file exceeding max size", () => {
      expect(validateFileSize(PHOTO_DEFAULT_MAX_SIZE_BYTES + 1)).toBe(false);
    });
  });

  // ─── Photo count ──────────────────────────────────────────────────────

  describe("getPhotoCount", () => {
    it("should return count from DB", async () => {
      mockRun.mockResolvedValue({ count: 5 });
      const count = await getPhotoCount("listing-1");
      expect(count).toBe(5);
    });

    it("should return 0 when no photos", async () => {
      mockRun.mockResolvedValue({ count: 0 });
      expect(await getPhotoCount("listing-1")).toBe(0);
    });

    it("should return 0 when result is null", async () => {
      mockRun.mockResolvedValue(null);
      expect(await getPhotoCount("listing-1")).toBe(0);
    });
  });

  describe("canUploadPhoto", () => {
    it("should return true when under limit", async () => {
      mockGet.mockReturnValue(undefined); // default MAX_PHOTOS = 20
      mockRun.mockResolvedValue({ count: 5 });
      expect(await canUploadPhoto("listing-1")).toBe(true);
    });

    it("should return false when at limit", async () => {
      mockGet.mockReturnValue({ value: "5" });
      mockRun.mockResolvedValue({ count: 5 });
      expect(await canUploadPhoto("listing-1")).toBe(false);
    });

    it("should return false when over limit", async () => {
      mockGet.mockReturnValue({ value: "5" });
      mockRun.mockResolvedValue({ count: 6 });
      expect(await canUploadPhoto("listing-1")).toBe(false);
    });
  });

  // ─── CDN URL ──────────────────────────────────────────────────────────

  describe("buildCdnUrl", () => {
    it("should build correct CDN URL", () => {
      const url = buildCdnUrl("listing-1/photos/abc.jpg");
      expect(url).toBe("https://cdn.auto-platform.fr/listings/listing-1/photos/abc.jpg");
    });
  });

  // ─── Upload ───────────────────────────────────────────────────────────

  describe("uploadPhotoBlob", () => {
    it("should upload to blob storage and return URLs", async () => {
      mockUploadFile.mockResolvedValue(
        "https://storage.blob.core.windows.net/listings/lid/photos/00000000-1111-2222-3333-444444444444.jpg",
      );

      const result = await uploadPhotoBlob("lid", Buffer.from("test"), "image/jpeg");

      expect(mockUploadFile).toHaveBeenCalledWith(
        "listings",
        "lid/photos/00000000-1111-2222-3333-444444444444.jpg",
        Buffer.from("test"),
      );
      expect(result.blobUrl).toContain("lid/photos/");
      expect(result.cdnUrl).toContain("cdn.auto-platform.fr");
      expect(result.cdnUrl).toContain(".jpg");
    });

    it("should use correct extension for PNG", async () => {
      mockUploadFile.mockResolvedValue("url");
      await uploadPhotoBlob("lid", Buffer.from("test"), "image/png");
      expect(mockUploadFile).toHaveBeenCalledWith(
        "listings",
        expect.stringContaining(".png"),
        expect.any(Buffer),
      );
    });

    it("should use correct extension for WebP", async () => {
      mockUploadFile.mockResolvedValue("url");
      await uploadPhotoBlob("lid", Buffer.from("test"), "image/webp");
      expect(mockUploadFile).toHaveBeenCalledWith(
        "listings",
        expect.stringContaining(".webp"),
        expect.any(Buffer),
      );
    });

    it("should use correct extension for HEIC", async () => {
      mockUploadFile.mockResolvedValue("url");
      await uploadPhotoBlob("lid", Buffer.from("test"), "image/heic");
      expect(mockUploadFile).toHaveBeenCalledWith(
        "listings",
        expect.stringContaining(".heic"),
        expect.any(Buffer),
      );
    });
  });

  // ─── Delete ───────────────────────────────────────────────────────────

  describe("deletePhotoBlob", () => {
    it("should delete from blob storage", async () => {
      await deletePhotoBlob("https://storage.blob.core.windows.net/listings/lid/photos/abc.jpg");
      expect(mockDeleteFile).toHaveBeenCalledWith("listings", "lid/photos/abc.jpg");
    });

    it("should warn when URL cannot be parsed", async () => {
      await deletePhotoBlob("https://invalid-url.com/something");
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });
  });

  describe("deleteAllPhotosForListing", () => {
    it("should delete all photos from blob storage and DB", async () => {
      const photos = [
        { ID: "p1", blobUrl: "https://storage.blob.core.windows.net/listings/lid/photos/a.jpg" },
        { ID: "p2", blobUrl: "https://storage.blob.core.windows.net/listings/lid/photos/b.jpg" },
      ];
      // First call returns photos array, second call is the DELETE
      mockRun.mockResolvedValueOnce(photos).mockResolvedValueOnce(undefined);

      await deleteAllPhotosForListing("lid");

      expect(mockDeleteFile).toHaveBeenCalledTimes(2);
      expect(mockRun).toHaveBeenCalledTimes(2); // SELECT photos + DELETE records
    });

    it("should continue deleting even if one blob delete fails", async () => {
      const photos = [
        { ID: "p1", blobUrl: "https://storage.blob.core.windows.net/listings/lid/photos/a.jpg" },
        { ID: "p2", blobUrl: "https://storage.blob.core.windows.net/listings/lid/photos/b.jpg" },
      ];
      mockRun.mockResolvedValueOnce(photos).mockResolvedValueOnce(undefined);
      mockDeleteFile
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValueOnce(undefined);

      await deleteAllPhotosForListing("lid");

      // Should still attempt second delete and DB delete
      expect(mockDeleteFile).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Sort order ───────────────────────────────────────────────────────

  describe("getNextSortOrder", () => {
    it("should return max + 1", async () => {
      mockRun.mockResolvedValue({ maxOrder: 3 });
      expect(await getNextSortOrder("lid")).toBe(4);
    });

    it("should return 0 when no photos", async () => {
      mockRun.mockResolvedValue({ maxOrder: null });
      expect(await getNextSortOrder("lid")).toBe(0);
    });

    it("should return 0 when result is null", async () => {
      mockRun.mockResolvedValue(null);
      expect(await getNextSortOrder("lid")).toBe(0);
    });
  });
});
