import cds from "@sap/cds";
import type { IPublicListingCard, IPublicListingDetail } from "@auto/shared";
import { LISTING_PAGE_SIZE } from "@auto/shared";

const LOG = cds.log("catalog-handler");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Handler for getListings action.
 * Returns paginated published listings for the marketplace browse/search page.
 */
export async function handleGetListings(req: cds.Request): Promise<unknown> {
  const {
    skip: rawSkip,
    top: rawTop,
    search,
  } = req.data as {
    skip?: number;
    top?: number;
    search?: string;
  };

  const skip = Math.max(0, rawSkip || 0);
  const top = Math.min(100, Math.max(1, rawTop || LISTING_PAGE_SIZE));

  const entities = cds.entities("auto");

  // Build WHERE conditions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [{ status: "published" }];

  // Basic search across make, model, variant
  if (search && search.trim().length > 0) {
    const term = search.trim().toLowerCase();
    conditions.push({
      or: [
        { make: { like: `%${term}%` } },
        { model: { like: `%${term}%` } },
        { variant: { like: `%${term}%` } },
      ],
    });
  }

  // Count total
  const countResult = await cds.run(
    SELECT.one.from(entities["Listing"]).columns("count(*) as count").where(conditions),
  );
  const total = countResult?.count || 0;

  // Fetch listings page
  const listings = await cds.run(
    SELECT.from(entities["Listing"])
      .columns(
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
      )
      .where(conditions)
      .orderBy("publishedAt desc")
      .limit(top, skip),
  );

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
