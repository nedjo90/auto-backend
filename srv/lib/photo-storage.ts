import cds from "@sap/cds";
import { randomUUID } from "crypto";
import { getBlobStorage } from "../adapters/factory/adapter-factory";
import { configCache } from "./config-cache";
import {
  PHOTO_ALLOWED_MIME_TYPES,
  PHOTO_DEFAULT_MAX,
  PHOTO_DEFAULT_MAX_SIZE_BYTES,
} from "@auto/shared";

const LOG = cds.log("photo-storage");

const BLOB_CONTAINER = "listings";
const CDN_BASE_URL = process.env.AZURE_CDN_BASE_URL || "https://cdn.auto-platform.fr";

// ─── Config helpers ─────────────────────────────────────────────────────

export function getMaxPhotos(): number {
  const param = configCache.get<{ value: string }>("ConfigParameter", "MAX_PHOTOS");
  return param ? parseInt(param.value, 10) || PHOTO_DEFAULT_MAX : PHOTO_DEFAULT_MAX;
}

export function getMaxPhotoSizeBytes(): number {
  const param = configCache.get<{ value: string }>("ConfigParameter", "MAX_PHOTO_SIZE_BYTES");
  return param
    ? parseInt(param.value, 10) || PHOTO_DEFAULT_MAX_SIZE_BYTES
    : PHOTO_DEFAULT_MAX_SIZE_BYTES;
}

// ─── Validation ─────────────────────────────────────────────────────────

export function validateMimeType(mimeType: string): boolean {
  return (PHOTO_ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function validateFileSize(fileSize: number): boolean {
  return fileSize > 0 && fileSize <= getMaxPhotoSizeBytes();
}

// ─── Photo count enforcement ────────────────────────────────────────────

export async function getPhotoCount(listingId: string): Promise<number> {
  const entities = cds.entities("auto");
  const ListingPhoto = entities["ListingPhoto"];
  const result = await cds.run(
    SELECT.one.from(ListingPhoto).columns("count(*) as count").where({ listingId }),
  );
  return result?.count ?? 0;
}

export async function canUploadPhoto(listingId: string): Promise<boolean> {
  const currentCount = await getPhotoCount(listingId);
  return currentCount < getMaxPhotos();
}

// ─── Blob path helpers ──────────────────────────────────────────────────

function buildBlobPath(listingId: string, extension: string): string {
  const uniqueName = `${randomUUID()}${extension}`;
  return `${listingId}/photos/${uniqueName}`;
}

function getExtensionFromMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
  };
  return map[mimeType] || ".jpg";
}

export function buildCdnUrl(blobPath: string): string {
  return `${CDN_BASE_URL}/${BLOB_CONTAINER}/${blobPath}`;
}

// ─── Upload ─────────────────────────────────────────────────────────────

export interface UploadResult {
  blobUrl: string;
  cdnUrl: string;
  blobPath: string;
}

export async function uploadPhotoBlob(
  listingId: string,
  content: Buffer,
  mimeType: string,
): Promise<UploadResult> {
  const extension = getExtensionFromMimeType(mimeType);
  const blobPath = buildBlobPath(listingId, extension);

  const blobStorage = getBlobStorage();
  const blobUrl = await blobStorage.uploadFile(BLOB_CONTAINER, blobPath, content);
  const cdnUrl = buildCdnUrl(blobPath);

  LOG.info(`Uploaded photo for listing ${listingId}: ${blobPath}`);

  return { blobUrl, cdnUrl, blobPath };
}

// ─── Delete ─────────────────────────────────────────────────────────────

export async function deletePhotoBlob(blobUrl: string): Promise<void> {
  // Extract the path from the blob URL
  // blobUrl format: https://storage.blob.core.windows.net/listings/{listingId}/photos/{filename}
  const blobStorage = getBlobStorage();

  // Parse path from URL - everything after the container name
  const containerPrefix = `${BLOB_CONTAINER}/`;
  const idx = blobUrl.indexOf(containerPrefix);
  if (idx === -1) {
    LOG.warn(`Cannot parse blob path from URL: ${blobUrl}`);
    return;
  }
  const blobPath = blobUrl.substring(idx + containerPrefix.length);

  await blobStorage.deleteFile(BLOB_CONTAINER, blobPath);
  LOG.info(`Deleted photo blob: ${blobPath}`);
}

/**
 * Delete all photos for a listing from blob storage.
 * Used for cascade deletion when a listing is deleted.
 */
export async function deleteAllPhotosForListing(listingId: string): Promise<void> {
  const entities = cds.entities("auto");
  const ListingPhoto = entities["ListingPhoto"];

  const photos = await cds.run(SELECT.from(ListingPhoto).where({ listingId }));

  for (const photo of photos) {
    try {
      await deletePhotoBlob(photo.blobUrl);
    } catch (err) {
      LOG.warn(`Failed to delete blob for photo ${photo.ID}:`, err);
    }
  }

  // Delete all DB records
  await cds.run(DELETE.from(ListingPhoto).where({ listingId }));
  LOG.info(`Deleted all photos for listing ${listingId} (${photos.length} photos)`);
}

// ─── Next sort order ────────────────────────────────────────────────────

export async function getNextSortOrder(listingId: string): Promise<number> {
  const entities = cds.entities("auto");
  const ListingPhoto = entities["ListingPhoto"];
  const result = await cds.run(
    SELECT.one.from(ListingPhoto).columns("max(sortOrder) as maxOrder").where({ listingId }),
  );
  return (result?.maxOrder ?? -1) + 1;
}
