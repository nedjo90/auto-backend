import cds from "@sap/cds";
import type {
  IMarketWatchEnriched,
  IMarketWatchCheckResult,
  IListingPriceHistory,
  IPublicListingCard,
} from "@auto/shared";
import { MAX_MARKET_WATCHES_PER_SELLER, MARKET_WATCH_PAGE_SIZE } from "@auto/shared";
import { createNotification } from "../lib/notification-emitter";

const LOG = cds.log("market-watch");

// ─── addToMarketWatch ────────────────────────────────────────────────────────

export async function handleAddToMarketWatch(req: cds.Request) {
  const userId = req.user?.id;
  const { listingId, notes } = req.data as { listingId: string; notes?: string };

  if (!userId) return req.error(401, "Authentification requise");

  const entities = cds.entities("auto");

  // Check listing exists and is published
  const listing = await cds.run(
    SELECT.one
      .from(entities["Listing"])
      .columns("ID", "sellerId", "status")
      .where({ ID: listingId }),
  );
  if (!listing || listing.status !== "published") {
    return req.error(404, "Annonce non trouvée ou non publiée");
  }

  // Cannot watch own listing
  if (listing.sellerId === userId) {
    return req.error(400, "Vous ne pouvez pas suivre vos propres annonces");
  }

  // Check if already watching
  const existing = await cds.run(
    SELECT.one.from(entities["MarketWatch"]).where({ sellerId: userId, listingId }),
  );
  if (existing) {
    return { watching: true, watchId: existing.ID };
  }

  // Check max watches limit
  const countResult = await cds.run(
    SELECT.one.from(entities["MarketWatch"]).columns("count(*) as cnt").where({ sellerId: userId }),
  );
  if ((countResult?.cnt || 0) >= MAX_MARKET_WATCHES_PER_SELLER) {
    return req.error(400, `Limite de ${MAX_MARKET_WATCHES_PER_SELLER} annonces suivies atteinte`);
  }

  // Create the watch
  const watchId = cds.utils.uuid();
  await cds.run(
    INSERT.into(entities["MarketWatch"]).entries({
      ID: watchId,
      sellerId: userId,
      listingId,
      addedAt: new Date().toISOString(),
      notes: notes || null,
    }),
  );

  return { watching: true, watchId };
}

// ─── removeFromMarketWatch ───────────────────────────────────────────────────

export async function handleRemoveFromMarketWatch(req: cds.Request) {
  const userId = req.user?.id;
  const { listingId } = req.data as { listingId: string };

  if (!userId) return req.error(401, "Authentification requise");

  const entities = cds.entities("auto");

  await cds.run(DELETE.from(entities["MarketWatch"]).where({ sellerId: userId, listingId }));

  return { success: true };
}

// ─── getMarketWatchList ──────────────────────────────────────────────────────

export async function handleGetMarketWatchList(req: cds.Request) {
  const userId = req.user?.id;
  const { skip = 0, top = MARKET_WATCH_PAGE_SIZE } = req.data as {
    skip?: number;
    top?: number;
  };

  if (!userId) return req.error(401, "Authentification requise");

  const entities = cds.entities("auto");

  // Count total
  const countResult = await cds.run(
    SELECT.one.from(entities["MarketWatch"]).columns("count(*) as cnt").where({ sellerId: userId }),
  );
  const total = countResult?.cnt || 0;

  if (total === 0) {
    return { items: JSON.stringify([]), total: 0 };
  }

  // Fetch watches ordered by most recent
  const watches = await cds.run(
    SELECT.from(entities["MarketWatch"])
      .where({ sellerId: userId })
      .orderBy("addedAt desc")
      .limit(top, skip),
  );

  const listingIds = watches.map((w: Record<string, unknown>) => w.listingId as string);

  // Fetch listings data
  const listings = await cds.run(
    SELECT.from(entities["Listing"]).where({ ID: { in: listingIds } }),
  );
  const listingMap = new Map<string, Record<string, unknown>>();
  for (const l of listings) {
    listingMap.set(l.ID as string, l);
  }

  // Fetch photos
  const photos = await cds.run(
    SELECT.from(entities["ListingPhoto"])
      .columns("listingId", "cdnUrl", "isPrimary", "sortOrder")
      .where({ listingId: { in: listingIds } })
      .orderBy("sortOrder asc"),
  );
  const photoMap = new Map<string, { url: string | null; count: number }>();
  for (const p of photos) {
    const existing = photoMap.get(p.listingId as string);
    if (!existing) {
      photoMap.set(p.listingId as string, { url: (p.cdnUrl as string) || null, count: 1 });
    } else {
      existing.count++;
      if (p.isPrimary) existing.url = (p.cdnUrl as string) || null;
    }
  }

  // Fetch price history for all tracked listings
  const priceHistories = await cds.run(
    SELECT.from(entities["ListingPriceHistory"])
      .where({ listingId: { in: listingIds } })
      .orderBy("changedAt desc"),
  );
  const priceHistoryMap = new Map<string, IListingPriceHistory[]>();
  for (const ph of priceHistories) {
    const lid = ph.listingId as string;
    if (!priceHistoryMap.has(lid)) {
      priceHistoryMap.set(lid, []);
    }
    priceHistoryMap.get(lid)!.push({
      ID: ph.ID as string,
      listingId: lid,
      price: Number(ph.price),
      previousPrice: ph.previousPrice != null ? Number(ph.previousPrice) : null,
      changedAt: ph.changedAt as string,
    });
  }

  // Build enriched results
  const items: IMarketWatchEnriched[] = watches.map((w: Record<string, unknown>) => {
    const l = listingMap.get(w.listingId as string);
    const p = photoMap.get(w.listingId as string) || { url: null, count: 0 };
    const history = priceHistoryMap.get(w.listingId as string) || [];

    const listingCard: IPublicListingCard = {
      ID: l ? (l.ID as string) : (w.listingId as string),
      slug: l
        ? `${((l.make as string) || "").toLowerCase()}-${((l.model as string) || "").toLowerCase()}-${l.year || ""}-${(l.ID as string).slice(0, 8)}`
        : "",
      make: l ? (l.make as string) || null : null,
      model: l ? (l.model as string) || null : null,
      variant: l ? (l.variant as string) || null : null,
      year: l ? (l.year as number) || null : null,
      price: l ? (l.price as number) || null : null,
      mileage: l ? (l.mileage as number) || null : null,
      fuelType: l ? (l.fuelType as string) || null : null,
      gearbox: l ? (l.gearbox as string) || null : null,
      bodyType: l ? (l.bodyType as string) || null : null,
      color: l ? (l.color as string) || null : null,
      condition: l ? (l.condition as string) || null : null,
      visibilityScore: l ? (l.visibilityScore as number) || 0 : 0,
      visibilityLabel: "",
      publishedAt: l ? (l.publishedAt as string) || null : null,
      primaryPhotoUrl: p.url,
      photoCount: p.count,
      certifiedFieldCount: 0,
      totalFieldCount: 0,
      certificationLevel: null,
      ctValid: null,
      marketComparison: null,
      sellerId: l ? (l.sellerId as string) || "" : "",
    };

    return {
      ID: w.ID as string,
      sellerId: w.sellerId as string,
      listingId: w.listingId as string,
      addedAt: w.addedAt as string,
      notes: (w.notes as string) || null,
      listing: listingCard,
      priceHistory: history,
      hasChangedSinceLastVisit:
        history.length > 0 &&
        new Date(history[0].changedAt).getTime() > new Date(w.addedAt as string).getTime(),
    };
  });

  return { items: JSON.stringify(items), total };
}

// ─── checkMarketWatches ──────────────────────────────────────────────────────

export async function handleCheckMarketWatches(req: cds.Request) {
  const userId = req.user?.id;
  const { listingIds: listingIdsJson } = req.data as { listingIds: string };

  if (!userId) return req.error(401, "Authentification requise");

  let listingIds: string[];
  try {
    listingIds = JSON.parse(listingIdsJson);
  } catch {
    return req.error(400, "Invalid listingIds JSON");
  }

  if (!Array.isArray(listingIds) || listingIds.length === 0) {
    return { results: JSON.stringify([]) };
  }

  const entities = cds.entities("auto");

  const watches = await cds.run(
    SELECT.from(entities["MarketWatch"])
      .columns("ID", "listingId")
      .where({ sellerId: userId, listingId: { in: listingIds } }),
  );

  const watchMap = new Map<string, string>();
  for (const w of watches) {
    watchMap.set(w.listingId as string, w.ID as string);
  }

  const results: IMarketWatchCheckResult[] = listingIds.map((id) => ({
    listingId: id,
    isWatching: watchMap.has(id),
    watchId: watchMap.get(id) || null,
  }));

  return { results: JSON.stringify(results) };
}

// ─── Price history tracking (called from lifecycle/updateListingField) ────────

export async function recordPriceChange(
  listingId: string,
  newPrice: number,
  previousPrice: number | null,
): Promise<void> {
  const entities = cds.entities("auto");

  await cds.run(
    INSERT.into(entities["ListingPriceHistory"]).entries({
      ID: cds.utils.uuid(),
      listingId,
      price: newPrice,
      previousPrice,
      changedAt: new Date().toISOString(),
    }),
  );

  // Notify watchers
  await notifyMarketWatchers(listingId, previousPrice, newPrice);
}

/**
 * Notify all sellers watching a listing about a price change.
 */
async function notifyMarketWatchers(
  listingId: string,
  oldPrice: number | null,
  newPrice: number,
): Promise<void> {
  const entities = cds.entities("auto");

  const watches = await cds.run(
    SELECT.from(entities["MarketWatch"]).columns("sellerId").where({ listingId }),
  );

  if (watches.length === 0) return;

  const listing = await cds.run(
    SELECT.one.from(entities["Listing"]).columns("make", "model").where({ ID: listingId }),
  );

  const label = [listing?.make, listing?.model].filter(Boolean).join(" ") || "véhicule";
  const direction = oldPrice != null && newPrice < oldPrice ? "baissé" : "augmenté";
  const body =
    oldPrice != null
      ? `Le prix du ${label} a ${direction} de ${oldPrice}€ à ${newPrice}€`
      : `Le prix du ${label} est maintenant ${newPrice}€`;

  let created = 0;
  for (const w of watches) {
    const result = await createNotification({
      userId: w.sellerId,
      type: "price_change",
      title: "Changement de prix (suivi marché)",
      body,
      actionUrl: `/seller/market`,
      listingId,
    });
    if (result) created++;
  }

  LOG.info(`Created ${created} market watch notifications for listing ${listingId}`);
}
