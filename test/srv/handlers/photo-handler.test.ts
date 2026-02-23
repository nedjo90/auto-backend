/* eslint-disable @typescript-eslint/no-explicit-any */

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "photo-uuid-123");

class MockApplicationService {
  on() {}
  async init() {}
}

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        Listing: "Listing",
        ListingPhoto: "ListingPhoto",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => mockUuid() },
      ApplicationService: MockApplicationService,
    },
  };
});

const mockValidateMimeType = jest.fn();
const mockValidateFileSize = jest.fn();
const mockCanUploadPhoto = jest.fn();
const mockUploadPhotoBlob = jest.fn();
const mockDeletePhotoBlob = jest.fn();
const mockGetNextSortOrder = jest.fn();
const mockGetMaxPhotos = jest.fn();

jest.mock("../../../srv/lib/photo-storage", () => ({
  validateMimeType: (...args: any[]) => mockValidateMimeType(...args),
  validateFileSize: (...args: any[]) => mockValidateFileSize(...args),
  canUploadPhoto: (...args: any[]) => mockCanUploadPhoto(...args),
  uploadPhotoBlob: (...args: any[]) => mockUploadPhotoBlob(...args),
  deletePhotoBlob: (...args: any[]) => mockDeletePhotoBlob(...args),
  getNextSortOrder: (...args: any[]) => mockGetNextSortOrder(...args),
  getPhotoCount: jest.fn(),
  getMaxPhotos: (...args: any[]) => mockGetMaxPhotos(...args),
}));

jest.mock("../../../srv/lib/certification", () => ({
  getCertifiedFields: jest.fn(),
  overrideCertifiedField: jest.fn(),
}));

jest.mock("../../../srv/lib/api-cache", () => ({
  getCachedResponse: jest.fn(),
  setCachedResponse: jest.fn(),
}));

jest.mock("../../../srv/lib/audit-logger", () => ({
  logAudit: jest.fn(),
}));

jest.mock("../../../srv/lib/visibility-score", () => ({
  calculateVisibilityScore: jest.fn(() => ({
    score: 50,
    label: "Bien documenté",
    suggestions: [],
  })),
  getFilledFieldsFromListing: jest.fn(() => ({})),
}));

jest.mock("../../../srv/lib/signalr-client", () => ({
  signalrClient: {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    isConfigured: jest.fn(() => false),
  },
  SIGNALR_HUBS: { admin: "admin", liveScore: "live-score" },
}));

jest.mock("@auto/shared", () => ({
  validateListingField: jest.fn(() => null),
  CERTIFIABLE_FIELDS: ["make", "model"],
  LISTING_FIELDS: [{ fieldName: "make" }, { fieldName: "price" }],
  PHOTO_ALLOWED_MIME_TYPES: ["image/jpeg", "image/png", "image/webp", "image/heic"],
}));

// CDS query globals
(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("select-one-query"),
    }),
  },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue("select-order-query"),
    }),
  }),
};

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-query"),
  }),
};

(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("update-query"),
  }),
});

(global as any).DELETE = {
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("delete-query"),
  }),
};

import SellerServiceHandler from "../../../srv/seller-service";

describe("Photo Management Handlers", () => {
  let handler: SellerServiceHandler;
  const makeReq = (data: Record<string, unknown>, userId = "user-1") => ({
    data,
    user: { id: userId },
    error: jest.fn((code: number, msg: string) => {
      throw new Error(`${code}: ${msg}`);
    }),
  });

  beforeEach(() => {
    mockRun.mockReset();
    mockValidateMimeType.mockReset();
    mockValidateFileSize.mockReset();
    mockCanUploadPhoto.mockReset();
    mockUploadPhotoBlob.mockReset();
    mockDeletePhotoBlob.mockReset();
    mockGetNextSortOrder.mockReset();
    mockGetMaxPhotos.mockReset();
    handler = new SellerServiceHandler();
  });

  // Helper: set up a successful upload scenario
  function setupUploadSuccess() {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1" }); // listing lookup
    mockValidateMimeType.mockReturnValue(true);
    mockValidateFileSize.mockReturnValue(true);
    mockCanUploadPhoto.mockResolvedValue(true);
    mockUploadPhotoBlob.mockResolvedValue({
      blobUrl: "https://blob.storage/listings/listing-1/photos/abc.jpg",
      cdnUrl: "https://cdn.auto-platform.fr/listings/listing-1/photos/abc.jpg",
    });
    mockGetNextSortOrder.mockResolvedValue(0);
    mockRun.mockResolvedValueOnce(undefined); // INSERT
    // Score recalculation calls (no longer in try/catch)
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1" }); // re-fetch listing
    mockRun.mockResolvedValueOnce([{ ID: "photo-uuid-123" }]); // all photos
    mockRun.mockResolvedValueOnce(undefined); // UPDATE score
  }

  // ─── uploadPhoto ────────────────────────────────────────────────────

  describe("uploadPhoto", () => {
    const validData = {
      listingId: "listing-1",
      content: Buffer.from("fake-image"),
      mimeType: "image/jpeg",
      fileSize: 1024,
      width: 800,
      height: 600,
    };

    it("should upload photo successfully and return metadata", async () => {
      setupUploadSuccess();
      const req = makeReq(validData);
      const result = await (handler as any).handleUploadPhoto(req);

      expect(result.ID).toBe("photo-uuid-123");
      expect(result.cdnUrl).toContain("cdn.auto-platform.fr");
      expect(result.sortOrder).toBe(0);
      expect(result.isPrimary).toBe(true);
      expect(result.fileSize).toBe(1024);
      expect(result.mimeType).toBe("image/jpeg");
    });

    it("should set isPrimary=false for subsequent photos", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1" }); // listing
      mockValidateMimeType.mockReturnValue(true);
      mockValidateFileSize.mockReturnValue(true);
      mockCanUploadPhoto.mockResolvedValue(true);
      mockUploadPhotoBlob.mockResolvedValue({
        blobUrl: "blob",
        cdnUrl: "cdn",
      });
      mockGetNextSortOrder.mockResolvedValue(3);
      mockRun.mockResolvedValueOnce(undefined); // INSERT
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1" }); // re-fetch listing
      mockRun.mockResolvedValueOnce([
        { ID: "p1" },
        { ID: "p2" },
        { ID: "p3" },
        { ID: "photo-uuid-123" },
      ]); // all photos
      mockRun.mockResolvedValueOnce(undefined); // UPDATE score

      const req = makeReq(validData);
      const result = await (handler as any).handleUploadPhoto(req);
      expect(result.isPrimary).toBe(false);
      expect(result.sortOrder).toBe(3);
    });

    it("should reject if listing not found", async () => {
      mockRun.mockResolvedValueOnce(null);
      const req = makeReq(validData);
      await expect((handler as any).handleUploadPhoto(req)).rejects.toThrow("404");
    });

    it("should reject if user does not own listing", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "other-user" });
      const req = makeReq(validData);
      await expect((handler as any).handleUploadPhoto(req)).rejects.toThrow("403");
    });

    it("should reject invalid MIME type", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1" });
      mockValidateMimeType.mockReturnValue(false);
      const req = makeReq({ ...validData, mimeType: "image/gif" });
      await expect((handler as any).handleUploadPhoto(req)).rejects.toThrow("400");
    });

    it("should reject file exceeding size limit", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1" });
      mockValidateMimeType.mockReturnValue(true);
      mockValidateFileSize.mockReturnValue(false);
      const req = makeReq(validData);
      await expect((handler as any).handleUploadPhoto(req)).rejects.toThrow("400");
    });

    it("should reject when MAX_PHOTOS reached", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1" });
      mockValidateMimeType.mockReturnValue(true);
      mockValidateFileSize.mockReturnValue(true);
      mockCanUploadPhoto.mockResolvedValue(false);
      mockGetMaxPhotos.mockReturnValue(20);
      const req = makeReq(validData);
      await expect((handler as any).handleUploadPhoto(req)).rejects.toThrow("400");
    });
  });

  // ─── reorderPhotos ──────────────────────────────────────────────────

  describe("reorderPhotos", () => {
    it("should reorder photos and set first as primary", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1" }); // listing
      mockRun.mockResolvedValueOnce([
        { ID: "p1", sortOrder: 0 },
        { ID: "p2", sortOrder: 1 },
        { ID: "p3", sortOrder: 2 },
      ]); // existing photos
      mockRun.mockResolvedValue(undefined); // UPDATEs

      const req = makeReq({
        listingId: "listing-1",
        photoIds: JSON.stringify(["p3", "p1", "p2"]),
      });
      const result = await (handler as any).handleReorderPhotos(req);
      expect(result).toEqual({ success: true, message: "3 photos reordered" });
    });

    it("should reject invalid JSON photoIds", async () => {
      const req = makeReq({ listingId: "listing-1", photoIds: "not-json" });
      await expect((handler as any).handleReorderPhotos(req)).rejects.toThrow("400");
    });

    it("should reject empty array", async () => {
      const req = makeReq({ listingId: "listing-1", photoIds: "[]" });
      await expect((handler as any).handleReorderPhotos(req)).rejects.toThrow("400");
    });

    it("should reject if listing not found", async () => {
      mockRun.mockResolvedValueOnce(null);
      const req = makeReq({
        listingId: "listing-1",
        photoIds: JSON.stringify(["p1"]),
      });
      await expect((handler as any).handleReorderPhotos(req)).rejects.toThrow("404");
    });

    it("should reject if photo does not belong to listing", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1" }); // listing
      mockRun.mockResolvedValueOnce([{ ID: "p1" }]); // only p1 exists
      const req = makeReq({
        listingId: "listing-1",
        photoIds: JSON.stringify(["p1", "p-nonexistent"]),
      });
      await expect((handler as any).handleReorderPhotos(req)).rejects.toThrow("400");
    });
  });

  // ─── deletePhoto ────────────────────────────────────────────────────

  describe("deletePhoto", () => {
    it("should delete photo and reorder remaining", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1" }); // listing
      mockRun.mockResolvedValueOnce({
        ID: "p2",
        listingId: "listing-1",
        blobUrl: "https://storage.blob.core.windows.net/listings/lid/photos/b.jpg",
        sortOrder: 1,
      }); // photo
      mockRun.mockResolvedValueOnce(undefined); // DELETE
      mockRun.mockResolvedValueOnce([
        { ID: "p1", sortOrder: 0, isPrimary: true },
        { ID: "p3", sortOrder: 2, isPrimary: false },
      ]); // remaining
      mockRun.mockResolvedValue(undefined); // UPDATEs

      mockDeletePhotoBlob.mockResolvedValue(undefined);

      const req = makeReq({ listingId: "listing-1", photoId: "p2" });
      const result = await (handler as any).handleDeletePhoto(req);
      expect(result).toEqual({ success: true, message: "Photo deleted" });
      expect(mockDeletePhotoBlob).toHaveBeenCalled();
    });

    it("should reject if listing not found", async () => {
      mockRun.mockResolvedValueOnce(null);
      const req = makeReq({ listingId: "listing-1", photoId: "p1" });
      await expect((handler as any).handleDeletePhoto(req)).rejects.toThrow("404");
    });

    it("should reject if photo not found", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1" }); // listing
      mockRun.mockResolvedValueOnce(null); // photo not found
      const req = makeReq({ listingId: "listing-1", photoId: "p-missing" });
      await expect((handler as any).handleDeletePhoto(req)).rejects.toThrow("404");
    });

    it("should reject unauthorized user", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "other-user" });
      const req = makeReq({ listingId: "listing-1", photoId: "p1" });
      await expect((handler as any).handleDeletePhoto(req)).rejects.toThrow("403");
    });

    it("should continue even if blob deletion fails", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1" }); // listing
      mockRun.mockResolvedValueOnce({
        ID: "p1",
        listingId: "listing-1",
        blobUrl: "https://storage.blob.core.windows.net/listings/lid/photos/a.jpg",
      }); // photo
      mockRun.mockResolvedValueOnce(undefined); // DELETE
      mockRun.mockResolvedValueOnce([]); // no remaining
      mockDeletePhotoBlob.mockRejectedValue(new Error("network error"));

      const req = makeReq({ listingId: "listing-1", photoId: "p1" });
      const result = await (handler as any).handleDeletePhoto(req);
      expect(result.success).toBe(true);
    });
  });
});
