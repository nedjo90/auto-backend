import cds from "@sap/cds";
import type { IPublicListingCard, IPublicListingDetail } from "@auto/shared";
import { LISTING_PAGE_SIZE } from "@auto/shared";

const LOG = cds.log("catalog-handler");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Input shape for getListings action. */
interface GetListingsInput {
  skip?: number;
  top?: number;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  make?: string;
  model?: string;
  minYear?: number;
  maxYear?: number;
  maxMileage?: number;
  fuelType?: string; // JSON array
  gearbox?: string; // JSON array
  bodyType?: string; // JSON array
  color?: string; // JSON array
  latitude?: number;
  longitude?: number;
  radius?: number; // km
  sort?: string;
}

const EARTH_RADIUS_KM = 6371;

/** Safe JSON array parser — returns string[] or empty array. */
function parseJsonArray(value: string | undefined | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed))
      return parsed.filter((v: unknown) => typeof v === "string" && v.length > 0);
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * Haversine distance between two points in km.
 * Used for location radius filtering.
 */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Compute bounding box for a given center and radius (km).
 * Returns lat/lng bounds for pre-filtering before precise Haversine check.
 */
function locationBounds(lat: number, lon: number, radiusKm: number) {
  const latDelta = radiusKm / 111.32; // ~111.32 km per degree latitude
  const lonDelta = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  };
}

/** Map sort parameter to CDS orderBy clause. */
function resolveOrderBy(sort: string | undefined): string {
  switch (sort) {
    case "price_asc":
      return "price asc";
    case "price_desc":
      return "price desc";
    case "date_desc":
      return "publishedAt desc";
    case "mileage_asc":
      return "mileage asc";
    default:
      return "publishedAt desc"; // relevance / default
  }
}

/**
 * Handler for getListings action.
 * Returns paginated published listings with multi-criteria filtering and sorting.
 */
export async function handleGetListings(req: cds.Request): Promise<unknown> {
  const data = req.data as GetListingsInput;

  const skip = Math.max(0, data.skip || 0);
  const top = Math.min(100, Math.max(1, data.top || LISTING_PAGE_SIZE));

  const entities = cds.entities("auto");

  // Build WHERE conditions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [{ status: "published" }];

  // Full-text search across make, model, variant
  if (data.search && data.search.trim().length > 0) {
    const term = data.search.trim().toLowerCase();
    conditions.push({
      or: [
        { make: { like: `%${term}%` } },
        { model: { like: `%${term}%` } },
        { variant: { like: `%${term}%` } },
      ],
    });
  }

  // Price range filter
  if (data.minPrice != null) {
    conditions.push({ price: { ">=": data.minPrice } });
  }
  if (data.maxPrice != null) {
    conditions.push({ price: { "<=": data.maxPrice } });
  }

  // Make (brand) exact match
  if (data.make) {
    conditions.push({ make: data.make });
  }

  // Model exact match
  if (data.model) {
    conditions.push({ model: data.model });
  }

  // Year range filter
  if (data.minYear != null) {
    conditions.push({ year: { ">=": data.minYear } });
  }
  if (data.maxYear != null) {
    conditions.push({ year: { "<=": data.maxYear } });
  }

  // Max mileage filter
  if (data.maxMileage != null) {
    conditions.push({ mileage: { "<=": data.maxMileage } });
  }

  // Multi-value filters (JSON arrays)
  const fuelTypes = parseJsonArray(data.fuelType);
  if (fuelTypes.length > 0) {
    conditions.push({ fuelType: { in: fuelTypes } });
  }

  const gearboxes = parseJsonArray(data.gearbox);
  if (gearboxes.length > 0) {
    conditions.push({ gearbox: { in: gearboxes } });
  }

  const bodyTypes = parseJsonArray(data.bodyType);
  if (bodyTypes.length > 0) {
    conditions.push({ bodyType: { in: bodyTypes } });
  }

  const colors = parseJsonArray(data.color);
  if (colors.length > 0) {
    conditions.push({ color: { in: colors } });
  }

  // Location radius search
  const hasLocationFilter =
    data.latitude != null && data.longitude != null && data.radius != null && data.radius > 0;

  if (hasLocationFilter) {
    // Pre-filter with bounding box (reduces candidate set before Haversine)
    const bounds = locationBounds(data.latitude!, data.longitude!, data.radius!);
    conditions.push({ latitude: { ">=": bounds.minLat } });
    conditions.push({ latitude: { "<=": bounds.maxLat } });
    conditions.push({ longitude: { ">=": bounds.minLon } });
    conditions.push({ longitude: { "<=": bounds.maxLon } });
  }

  // Resolve sort order
  const orderBy = resolveOrderBy(data.sort);

  const listingColumns = [
    "ID",
    "make",
    "model",
    "variant",
    "year",
    "price",
    "mileage",
    "fuelType",
    "gearbox",
    "bodyType",
    "color",
    "condition",
    "visibilityScore",
    "visibilityLabel",
    "publishedAt",
    "sellerId",
    "latitude",
    "longitude",
    "city",
    "postalCode",
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let listings: any[];
  let total: number;

  if (hasLocationFilter) {
    // Fetch all bounding-box candidates, then apply precise Haversine filter
    const candidates = await cds.run(
      SELECT.from(entities["Listing"])
        .columns(...listingColumns)
        .where(conditions)
        .orderBy(orderBy),
    );

    // Precise Haversine post-filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filtered = candidates.filter((l: any) => {
      if (l.latitude == null || l.longitude == null) return false;
      const dist = haversineDistance(
        data.latitude!,
        data.longitude!,
        Number(l.latitude),
        Number(l.longitude),
      );
      return dist <= data.radius!;
    });

    total = filtered.length;
    listings = filtered.slice(skip, skip + top);
  } else {
    // Standard path: count + paginated fetch
    const countResult = await cds.run(
      SELECT.one.from(entities["Listing"]).columns("count(*) as count").where(conditions),
    );
    total = countResult?.count || 0;

    listings = await cds.run(
      SELECT.from(entities["Listing"])
        .columns(...listingColumns)
        .where(conditions)
        .orderBy(orderBy)
        .limit(top, skip),
    );
  }

  // Enrich with photo and certification data
  const items: IPublicListingCard[] = [];
  for (const listing of listings) {
    // Get primary photo
    const primaryPhoto = await cds.run(
      SELECT.one
        .from(entities["ListingPhoto"])
        .columns("cdnUrl")
        .where({ listingId: listing.ID, isPrimary: true }),
    );

    // Get photo count
    const photoCountResult = await cds.run(
      SELECT.one
        .from(entities["ListingPhoto"])
        .columns("count(*) as count")
        .where({ listingId: listing.ID }),
    );

    // Get certified/total field counts
    const certifiedResult = await cds.run(
      SELECT.one
        .from(entities["CertifiedField"])
        .columns("count(*) as count")
        .where({ listingId: listing.ID, isCertified: true }),
    );
    const totalFieldsResult = await cds.run(
      SELECT.one
        .from(entities["CertifiedField"])
        .columns("count(*) as count")
        .where({ listingId: listing.ID }),
    );

    items.push({
      ID: listing.ID,
      make: listing.make,
      model: listing.model,
      variant: listing.variant,
      year: listing.year,
      price: listing.price,
      mileage: listing.mileage,
      fuelType: listing.fuelType,
      gearbox: listing.gearbox,
      bodyType: listing.bodyType,
      color: listing.color,
      condition: listing.condition,
      visibilityScore: listing.visibilityScore || 0,
      visibilityLabel: listing.visibilityLabel || "Non évalué",
      publishedAt: listing.publishedAt,
      primaryPhotoUrl: primaryPhoto?.cdnUrl || null,
      photoCount: photoCountResult?.count || 0,
      certifiedFieldCount: certifiedResult?.count || 0,
      totalFieldCount: totalFieldsResult?.count || 0,
      sellerId: listing.sellerId,
    });
  }

  return {
    items: JSON.stringify(items),
    total,
    skip,
    top,
    hasMore: skip + top < total,
  };
}

/**
 * Handler for getListingDetail action.
 * Returns full listing detail for the detail page.
 */
export async function handleGetListingDetail(req: cds.Request): Promise<unknown> {
  const { listingId } = req.data as { listingId: string };

  if (!listingId || !UUID_RE.test(listingId)) {
    return req.error(400, "Identifiant d'annonce invalide");
  }

  const entities = cds.entities("auto");

  const listing = await cds.run(SELECT.one.from(entities["Listing"]).where({ ID: listingId }));

  if (!listing) return req.error(404, "Annonce non trouvée");

  // Only allow published or sold
  if (listing.status !== "published" && listing.status !== "sold") {
    return req.error(404, "Annonce non trouvée");
  }

  // Get photos
  const photos = await cds.run(
    SELECT.from(entities["ListingPhoto"]).where({ listingId }).orderBy("sortOrder asc"),
  );

  // Get certified fields
  const certifiedFields = await cds.run(
    SELECT.from(entities["CertifiedField"])
      .columns("fieldName", "source", "isCertified")
      .where({ listingId }),
  );

  // Check history report existence
  let hasHistoryReport = false;
  try {
    const hr = await cds.run(
      SELECT.one.from(entities["HistoryReport"]).columns("ID").where({ listingId }),
    );
    hasHistoryReport = !!hr;
  } catch {
    /* ignore */
  }

  // Get analytics
  let analytics = { viewCount: 0, favoriteCount: 0 };
  try {
    const analyticsRow = await cds.run(
      SELECT.one.from(entities["ListingAnalytics"]).where({ listingId }),
    );
    if (analyticsRow) {
      analytics = {
        viewCount: analyticsRow.viewCount || 0,
        favoriteCount: analyticsRow.favoriteCount || 0,
      };
    }
  } catch {
    /* ignore */
  }

  // Increment view count
  try {
    const existing = await cds.run(
      SELECT.one.from(entities["ListingAnalytics"]).where({ listingId }),
    );
    if (existing) {
      await cds.run(
        UPDATE(entities["ListingAnalytics"])
          .set({ viewCount: (existing.viewCount || 0) + 1 })
          .where({ listingId }),
      );
      analytics.viewCount = (existing.viewCount || 0) + 1;
    } else {
      await cds.run(
        INSERT.into(entities["ListingAnalytics"]).entries({
          ID: cds.utils.uuid(),
          listingId,
          viewCount: 1,
          favoriteCount: 0,
          chatCount: 0,
        }),
      );
      analytics.viewCount = 1;
    }
  } catch (err) {
    LOG.warn("Failed to update view count:", err);
  }

  const detail: IPublicListingDetail = {
    ID: listing.ID,
    make: listing.make,
    model: listing.model,
    variant: listing.variant,
    year: listing.year,
    price: listing.price,
    mileage: listing.mileage,
    fuelType: listing.fuelType,
    engineCapacityCc: listing.engineCapacityCc,
    powerKw: listing.powerKw,
    powerHp: listing.powerHp,
    gearbox: listing.gearbox,
    bodyType: listing.bodyType,
    doors: listing.doors,
    seats: listing.seats,
    color: listing.color,
    co2GKm: listing.co2GKm,
    euroNorm: listing.euroNorm,
    energyClass: listing.energyClass,
    critAirLevel: listing.critAirLevel,
    critAirLabel: listing.critAirLabel,
    condition: listing.condition,
    description: listing.description,
    options: listing.options,
    interiorColor: listing.interiorColor,
    exteriorColor: listing.exteriorColor,
    transmission: listing.transmission,
    driveType: listing.driveType,
    registrationDate: listing.registrationDate,
    status: listing.status,
    visibilityScore: listing.visibilityScore || 0,
    visibilityLabel: listing.visibilityLabel || "Non évalué",
    publishedAt: listing.publishedAt,
    soldAt: listing.soldAt,
    sellerId: listing.sellerId,
    photos: photos.map((p: Record<string, unknown>) => ({
      ID: p.ID,
      listingId: p.listingId,
      blobUrl: p.blobUrl || "",
      cdnUrl: p.cdnUrl || "",
      sortOrder: p.sortOrder || 0,
      isPrimary: p.isPrimary || false,
      fileSize: p.fileSize || 0,
      mimeType: p.mimeType || "",
      width: p.width || 0,
      height: p.height || 0,
      uploadedAt: p.uploadedAt || "",
    })),
    certifiedFields: certifiedFields.map((cf: Record<string, unknown>) => ({
      fieldName: cf.fieldName as string,
      source: cf.source as string,
      isCertified: cf.isCertified as boolean,
    })),
    hasHistoryReport,
    analytics,
  };

  return {
    listing: JSON.stringify(detail),
  };
}
