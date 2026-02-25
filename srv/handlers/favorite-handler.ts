import cds from "@sap/cds";
import type {
  IFavoriteEnriched,
  IFavoriteChanges,
  IFavoriteCheckResult,
  IPublicListingCard,
} from "@auto/shared";
import { MAX_FAVORITES_PER_USER, FAVORITES_PAGE_SIZE } from "@auto/shared";
import { computeMarketComparison } from "../lib/market-price";

const LOG = cds.log("favorite");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── toggleFavorite ──────────────────────────────────────────────────────────

export async function handleToggleFavorite(req: cds.Request) {
  const { listingId } = req.data as { listingId: string };
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  if (!listingId || !UUID_RE.test(listingId)) {
    return req.error(400, "Identifiant d'annonce invalide");
  }

  const entities = cds.entities("auto");

  // Check if already favorited
  const existing = await cds.run(
    SELECT.one.from(entities["Favorite"]).where({ userId, listingId }),
  );

  if (existing) {
    // Remove favorite
    await cds.run(DELETE.from(entities["Favorite"]).where({ ID: existing.ID }));

    // Decrement analytics counter
    await decrementFavoriteCount(entities, listingId);

    LOG.info(`User ${userId} unfavorited listing ${listingId}`);
    return { favorited: false, favoriteId: null };
  }

  // Check listing exists and is published
  const listing = await cds.run(SELECT.one.from(entities["Listing"]).where({ ID: listingId }));

  if (!listing) {
    return req.error(404, "Annonce introuvable");
  }

  if (listing.status !== "published") {
    return req.error(400, "Seules les annonces publiées peuvent être ajoutées aux favoris");
  }

  // Check max favorites
  const favoriteCount = await cds.run(
    SELECT.one.from(entities["Favorite"]).columns("count(*) as cnt").where({ userId }),
  );

  if (favoriteCount && favoriteCount.cnt >= MAX_FAVORITES_PER_USER) {
    return req.error(400, `Vous avez atteint la limite de ${MAX_FAVORITES_PER_USER} favoris`);
  }

  // Get snapshot data
  const photoCount = await getPhotoCount(entities, listingId);
  const certificationLevel = await getCertificationLevel(entities, listingId);

  const favoriteId = cds.utils.uuid();
  const now = new Date().toISOString();

  await cds.run(
    INSERT.into(entities["Favorite"]).entries({
      ID: favoriteId,
      userId,
      listingId,
      createdAt: now,
      snapshotPrice: listing.price,
      snapshotCertificationLevel: certificationLevel,
      snapshotPhotoCount: photoCount,
    }),
  );

  // Increment analytics counter
  await incrementFavoriteCount(entities, listingId);

  LOG.info(`User ${userId} favorited listing ${listingId}`);
  return { favorited: true, favoriteId };
}

// ─── checkFavorites ──────────────────────────────────────────────────────────

export async function handleCheckFavorites(req: cds.Request) {
  const { listingIds: listingIdsJson } = req.data as { listingIds: string };
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  let listingIds: string[];
  try {
    listingIds = JSON.parse(listingIdsJson);
    if (!Array.isArray(listingIds)) throw new Error("Not an array");
  } catch {
    return req.error(400, "Format de listingIds invalide");
  }

  if (listingIds.length === 0) {
    return { results: JSON.stringify([]) };
  }

  const entities = cds.entities("auto");

  const favorites = await cds.run(
    SELECT.from(entities["Favorite"])
      .columns("ID", "listingId")
      .where({ userId, listingId: { in: listingIds } }),
  );

  const favMap = new Map<string, string>();
  for (const f of favorites) {
    favMap.set(f.listingId, f.ID);
  }

  const results: IFavoriteCheckResult[] = listingIds.map((id) => ({
    listingId: id,
    isFavorited: favMap.has(id),
    favoriteId: favMap.get(id) || null,
  }));

  return { results: JSON.stringify(results) };
}

// ─── getMyFavorites ──────────────────────────────────────────────────────────

export async function handleGetMyFavorites(req: cds.Request) {
  const userId = req.user?.id;
  const { skip = 0, top = FAVORITES_PAGE_SIZE } = req.data as {
    skip?: number;
    top?: number;
  };

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");

  // Count total favorites
  const countResult = await cds.run(
    SELECT.one.from(entities["Favorite"]).columns("count(*) as cnt").where({ userId }),
  );
  const total = countResult?.cnt || 0;

  if (total === 0) {
    return { items: JSON.stringify([]), total: 0, hasMore: false };
  }

  // Fetch favorites with pagination
  const favorites = await cds.run(
    SELECT.from(entities["Favorite"]).where({ userId }).orderBy("createdAt desc").limit(top, skip),
  );

  if (favorites.length === 0) {
    return { items: JSON.stringify([]), total, hasMore: false };
  }

  // Fetch listing data for all favorited listings
  const listingIds = favorites.map((f: { listingId: string }) => f.listingId);
  const listings = await cds.run(
    SELECT.from(entities["Listing"]).where({ ID: { in: listingIds } }),
  );

  const listingMap = new Map<string, Record<string, unknown>>();
  for (const l of listings) {
    listingMap.set(l.ID, l);
  }

  // Fetch photos and certified fields for enrichment
  const photos = await cds.run(
    SELECT.from(entities["ListingPhoto"])
      .columns("listingId", "cdnUrl", "isPrimary", "sortOrder")
      .where({ listingId: { in: listingIds } })
      .orderBy("sortOrder asc"),
  );

  const photoCountMap = new Map<string, number>();
  const primaryPhotoMap = new Map<string, string | null>();
  for (const p of photos) {
    photoCountMap.set(p.listingId, (photoCountMap.get(p.listingId) || 0) + 1);
    if (p.isPrimary || !primaryPhotoMap.has(p.listingId)) {
      primaryPhotoMap.set(p.listingId, p.cdnUrl);
    }
  }

  const certifiedFields = await cds.run(
    SELECT.from(entities["CertifiedField"])
      .columns("listingId", "fieldName", "isCertified")
      .where({ listingId: { in: listingIds } }),
  );

  const certFieldCountMap = new Map<string, { certified: number; total: number }>();
  for (const cf of certifiedFields) {
    const existing = certFieldCountMap.get(cf.listingId) || { certified: 0, total: 0 };
    existing.total++;
    if (cf.isCertified) existing.certified++;
    certFieldCountMap.set(cf.listingId, existing);
  }

  // Build enriched favorites
  const enriched: IFavoriteEnriched[] = [];

  for (const fav of favorites) {
    const listing = listingMap.get(fav.listingId);
    if (!listing) continue;

    const currentPhotoCount = photoCountMap.get(fav.listingId) || 0;
    const primaryPhotoUrl = primaryPhotoMap.get(fav.listingId) || null;
    const certCounts = certFieldCountMap.get(fav.listingId) || { certified: 0, total: 0 };

    const currentCertLevel = computeCertificationLevelFromCounts(
      certCounts.certified,
      certCounts.total,
    );

    // Compute market comparison
    const marketComparison = await computeMarketComparison({
      make: listing.make as string | null,
      model: listing.model as string | null,
      year: listing.year as number | null,
      mileage: listing.mileage as number | null,
      fuelType: listing.fuelType as string | null,
      price: listing.price as number | null,
    });

    // Build change detection
    const changes: IFavoriteChanges = {
      priceChanged:
        fav.snapshotPrice != null &&
        listing.price != null &&
        Number(fav.snapshotPrice) !== Number(listing.price),
      oldPrice: fav.snapshotPrice != null ? Number(fav.snapshotPrice) : null,
      newPrice: listing.price != null ? Number(listing.price) : null,
      certificationChanged:
        fav.snapshotCertificationLevel !== currentCertLevel &&
        fav.snapshotCertificationLevel != null,
      oldCertificationLevel: fav.snapshotCertificationLevel,
      newCertificationLevel: currentCertLevel,
      photosAdded: Math.max(0, currentPhotoCount - (fav.snapshotPhotoCount || 0)),
    };

    const card: IPublicListingCard = {
      ID: listing.ID as string,
      make: listing.make as string | null,
      model: listing.model as string | null,
      variant: listing.variant as string | null,
      year: listing.year as number | null,
      price: listing.price as number | null,
      mileage: listing.mileage as number | null,
      fuelType: listing.fuelType as string | null,
      gearbox: listing.gearbox as string | null,
      bodyType: listing.bodyType as string | null,
      color: listing.color as string | null,
      condition: listing.condition as string | null,
      visibilityScore: (listing.visibilityScore as number) || 0,
      visibilityLabel: (listing.visibilityLabel as string) || "",
      publishedAt: listing.publishedAt as string | null,
      primaryPhotoUrl,
      photoCount: currentPhotoCount,
      certifiedFieldCount: certCounts.certified,
      totalFieldCount: certCounts.total,
      sellerId: listing.sellerId as string,
      certificationLevel: currentCertLevel as IPublicListingCard["certificationLevel"],
      ctValid: (listing.ctValid as boolean) ?? null,
      marketComparison: marketComparison.position !== "unavailable" ? marketComparison : null,
    };

    enriched.push({
      ID: fav.ID,
      userId: fav.userId,
      listingId: fav.listingId,
      createdAt: fav.createdAt,
      snapshotPrice: fav.snapshotPrice != null ? Number(fav.snapshotPrice) : null,
      snapshotCertificationLevel: fav.snapshotCertificationLevel,
      snapshotPhotoCount: fav.snapshotPhotoCount || 0,
      listing: card,
      changes,
    });
  }

  return {
    items: JSON.stringify(enriched),
    total,
    hasMore: skip + top < total,
  };
}

// ─── markAllAsSeen ───────────────────────────────────────────────────────────

export async function handleMarkAllAsSeen(req: cds.Request) {
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");

  // Get all favorites for user
  const favorites = await cds.run(SELECT.from(entities["Favorite"]).where({ userId }));

  if (favorites.length === 0) {
    return { success: true, updated: 0 };
  }

  let updated = 0;

  for (const fav of favorites) {
    const listing = await cds.run(
      SELECT.one.from(entities["Listing"]).where({ ID: fav.listingId }),
    );
    if (!listing) continue;

    const photoCount = await getPhotoCount(entities, fav.listingId);
    const certLevel = await getCertificationLevel(entities, fav.listingId);

    await cds.run(
      UPDATE(entities["Favorite"])
        .set({
          snapshotPrice: listing.price,
          snapshotCertificationLevel: certLevel,
          snapshotPhotoCount: photoCount,
        })
        .where({ ID: fav.ID }),
    );
    updated++;
  }

  LOG.info(`User ${userId} marked ${updated} favorites as seen`);
  return { success: true, updated };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getPhotoCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities: Record<string, any>,
  listingId: string,
): Promise<number> {
  const result = await cds.run(
    SELECT.one.from(entities["ListingPhoto"]).columns("count(*) as count").where({ listingId }),
  );
  return result?.count || 0;
}

async function getCertificationLevel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities: Record<string, any>,
  listingId: string,
): Promise<string | null> {
  const certifiedResult = await cds.run(
    SELECT.one
      .from(entities["CertifiedField"])
      .columns("count(*) as count")
      .where({ listingId, isCertified: true }),
  );
  const totalResult = await cds.run(
    SELECT.one.from(entities["CertifiedField"]).columns("count(*) as count").where({ listingId }),
  );
  return computeCertificationLevelFromCounts(certifiedResult?.count || 0, totalResult?.count || 0);
}

function computeCertificationLevelFromCounts(certified: number, total: number): string | null {
  if (total === 0) return null;
  const ratio = (certified / total) * 100;
  if (ratio >= 80) return "tres_documente";
  if (ratio >= 50) return "bien_documente";
  return "partiellement_documente";
}

async function incrementFavoriteCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities: Record<string, any>,
  listingId: string,
): Promise<void> {
  try {
    const analytics = await cds.run(
      SELECT.one.from(entities["ListingAnalytics"]).where({ listingId }),
    );
    if (analytics) {
      await cds.run(
        UPDATE(entities["ListingAnalytics"])
          .set({ favoriteCount: (analytics.favoriteCount || 0) + 1 })
          .where({ listingId }),
      );
    } else {
      await cds.run(
        INSERT.into(entities["ListingAnalytics"]).entries({
          ID: cds.utils.uuid(),
          listingId,
          viewCount: 0,
          favoriteCount: 1,
          chatCount: 0,
        }),
      );
    }
  } catch (err) {
    LOG.warn("Failed to update favorite count:", err);
  }
}

async function decrementFavoriteCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities: Record<string, any>,
  listingId: string,
): Promise<void> {
  try {
    const analytics = await cds.run(
      SELECT.one.from(entities["ListingAnalytics"]).where({ listingId }),
    );
    if (analytics && analytics.favoriteCount > 0) {
      await cds.run(
        UPDATE(entities["ListingAnalytics"])
          .set({ favoriteCount: analytics.favoriteCount - 1 })
          .where({ listingId }),
      );
    }
  } catch (err) {
    LOG.warn("Failed to update favorite count:", err);
  }
}
