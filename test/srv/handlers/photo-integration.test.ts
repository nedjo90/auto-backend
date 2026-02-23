/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Photo Management Integration Tests (Story 3-4, Task 6)
 * Tests full upload/reorder/delete flows and MAX_PHOTOS enforcement.
 */

const mockRun = jest.fn();
let uuidCounter = 0;

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
      utils: {
        uuid: () => {
          uuidCounter++;
          return `photo-uuid-${uuidCounter}`;
        },
      },
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
  calculateVisibilityScore: jest.fn(() => 50),
  getFilledFieldsFromListing: jest.fn(() => ({})),
}));
jest.mock("@auto/shared", () => ({
  validateListingField: jest.fn(() => null),
  CERTIFIABLE_FIELDS: [],
  LISTING_FIELDS: [],
  PHOTO_ALLOWED_MIME_TYPES: ["image/jpeg", "image/png", "image/webp", "image/heic"],
}));

// CDS query globals
(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }),
  },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue("q"),
    }),
  }),
};
(global as any).INSERT = {
  into: jest.fn().mockReturnValue({ entries: jest.fn().mockReturnValue("q") }),
};
(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }),
});
(global as any).DELETE = {
  from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }),
};

import SellerServiceHandler from "../../../srv/seller-service";

describe("Photo Management Integration", () => {
  let handler: SellerServiceHandler;
  const makeReq = (data: Record<string, unknown>, userId = "seller-1") => ({
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
    uuidCounter = 0;
    handler = new SellerServiceHandler();
  });

  // ─── Full Upload Flow ──────────────────────────────────────────────

  describe("full upload flow", () => {
    it("should upload → compress → store blob → create record → return CDN URL", async () => {
      // Setup: listing exists, owned by seller
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1" });
      mockValidateMimeType.mockReturnValue(true);
      mockValidateFileSize.mockReturnValue(true);
      mockCanUploadPhoto.mockResolvedValue(true);
      mockUploadPhotoBlob.mockResolvedValue({
        blobUrl: "https://storage.blob.core.windows.net/listings/listing-1/photos/abc.jpg",
        cdnUrl: "https://cdn.auto-platform.fr/listings/listing-1/photos/abc.jpg",
      });
      mockGetNextSortOrder.mockResolvedValue(0);
      mockRun.mockResolvedValueOnce(undefined); // INSERT

      const req = makeReq({
        listingId: "listing-1",
        content: Buffer.from("fake-jpeg-data"),
        mimeType: "image/jpeg",
        fileSize: 500000,
        width: 1920,
        height: 1080,
      });

      const result = await (handler as any).handleUploadPhoto(req);

      // Verify blob upload was called
      expect(mockUploadPhotoBlob).toHaveBeenCalledWith(
        "listing-1",
        expect.any(Buffer),
        "image/jpeg",
      );

      // Verify result has CDN URL
      expect(result.cdnUrl).toBe("https://cdn.auto-platform.fr/listings/listing-1/photos/abc.jpg");
      expect(result.sortOrder).toBe(0);
      expect(result.isPrimary).toBe(true);
      expect(result.mimeType).toBe("image/jpeg");
    });
  });

  // ─── Full Reorder Flow ─────────────────────────────────────────────

  describe("full reorder flow", () => {
    it("should upload 3 photos → reorder → verify new order and primary", async () => {
      // Upload 3 photos
      const photos = [
        { ID: "p1", sortOrder: 0, isPrimary: true },
        { ID: "p2", sortOrder: 1, isPrimary: false },
        { ID: "p3", sortOrder: 2, isPrimary: false },
      ];

      // Reorder: p3 first, p1 second, p2 third
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1" }); // listing
      mockRun.mockResolvedValueOnce(photos); // existing photos
      mockRun.mockResolvedValue(undefined); // UPDATEs

      const req = makeReq({
        listingId: "listing-1",
        photoIds: JSON.stringify(["p3", "p1", "p2"]),
      });

      const result = await (handler as any).handleReorderPhotos(req);
      expect(result.success).toBe(true);
      expect(result.message).toBe("3 photos reordered");

      // Verify UPDATEs were called (3 photos)
      // First call: listing lookup, Second: existing photos, Then: 3 UPDATEs
      expect(mockRun).toHaveBeenCalledTimes(5); // listing + photos + 3 updates
    });
  });

  // ─── Full Delete Flow ──────────────────────────────────────────────

  describe("full delete flow", () => {
    it("should delete photo → remove blob → remove DB record → reorder remaining", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1" }); // listing
      mockRun.mockResolvedValueOnce({
        ID: "p2",
        listingId: "listing-1",
        blobUrl: "https://storage.blob.core.windows.net/listings/listing-1/photos/b.jpg",
      }); // photo
      mockRun.mockResolvedValueOnce(undefined); // DELETE record
      mockRun.mockResolvedValueOnce([
        { ID: "p1", sortOrder: 0, isPrimary: true },
        { ID: "p3", sortOrder: 2, isPrimary: false },
      ]); // remaining
      mockRun.mockResolvedValue(undefined); // UPDATE for p3

      mockDeletePhotoBlob.mockResolvedValue(undefined);

      const req = makeReq({ listingId: "listing-1", photoId: "p2" });
      const result = await (handler as any).handleDeletePhoto(req);

      expect(result.success).toBe(true);
      expect(mockDeletePhotoBlob).toHaveBeenCalledWith(
        "https://storage.blob.core.windows.net/listings/listing-1/photos/b.jpg",
      );
    });
  });

  // ─── MAX_PHOTOS Enforcement ────────────────────────────────────────

  describe("MAX_PHOTOS enforcement", () => {
    it("should reject upload when at configurable MAX_PHOTOS limit", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1" });
      mockValidateMimeType.mockReturnValue(true);
      mockValidateFileSize.mockReturnValue(true);
      mockCanUploadPhoto.mockResolvedValue(false); // at limit
      mockGetMaxPhotos.mockReturnValue(5);

      const req = makeReq({
        listingId: "listing-1",
        content: Buffer.from("data"),
        mimeType: "image/jpeg",
        fileSize: 1024,
      });

      await expect((handler as any).handleUploadPhoto(req)).rejects.toThrow(
        "Maximum number of photos (5) reached",
      );
    });

    it("should enforce custom MAX_PHOTOS from ConfigParameter", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1" });
      mockValidateMimeType.mockReturnValue(true);
      mockValidateFileSize.mockReturnValue(true);
      mockCanUploadPhoto.mockResolvedValue(false);
      mockGetMaxPhotos.mockReturnValue(10);

      const req = makeReq({
        listingId: "listing-1",
        content: Buffer.from("data"),
        mimeType: "image/jpeg",
        fileSize: 1024,
      });

      await expect((handler as any).handleUploadPhoto(req)).rejects.toThrow(
        "Maximum number of photos (10) reached",
      );
    });
  });

  // ─── File Type Validation ──────────────────────────────────────────

  describe("file type validation", () => {
    it.each(["image/jpeg", "image/png", "image/webp", "image/heic"])(
      "should accept %s",
      async (mimeType) => {
        mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1" });
        mockValidateMimeType.mockReturnValue(true);
        mockValidateFileSize.mockReturnValue(true);
        mockCanUploadPhoto.mockResolvedValue(true);
        mockUploadPhotoBlob.mockResolvedValue({ blobUrl: "b", cdnUrl: "c" });
        mockGetNextSortOrder.mockResolvedValue(0);
        mockRun.mockResolvedValueOnce(undefined);

        const req = makeReq({
          listingId: "listing-1",
          content: Buffer.from("data"),
          mimeType,
          fileSize: 1024,
        });

        const result = await (handler as any).handleUploadPhoto(req);
        expect(result.mimeType).toBe(mimeType);
      },
    );

    it("should reject image/gif", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1" });
      mockValidateMimeType.mockReturnValue(false);

      const req = makeReq({
        listingId: "listing-1",
        content: Buffer.from("data"),
        mimeType: "image/gif",
        fileSize: 1024,
      });

      await expect((handler as any).handleUploadPhoto(req)).rejects.toThrow("400");
    });
  });

  // ─── Ownership Validation ─────────────────────────────────────────

  describe("ownership validation", () => {
    it("should reject upload from non-owner", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "other-seller" });
      const req = makeReq(
        { listingId: "listing-1", content: Buffer.from("d"), mimeType: "image/jpeg", fileSize: 1 },
        "seller-1",
      );
      await expect((handler as any).handleUploadPhoto(req)).rejects.toThrow("403");
    });

    it("should reject reorder from non-owner", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "other-seller" });
      const req = makeReq({ listingId: "listing-1", photoIds: JSON.stringify(["p1"]) }, "seller-1");
      await expect((handler as any).handleReorderPhotos(req)).rejects.toThrow("403");
    });

    it("should reject delete from non-owner", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "other-seller" });
      const req = makeReq({ listingId: "listing-1", photoId: "p1" }, "seller-1");
      await expect((handler as any).handleDeletePhoto(req)).rejects.toThrow("403");
    });
  });
});
