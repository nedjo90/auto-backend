import cds from "@sap/cds";
import { isValidListingTransition } from "@auto/shared";
import type { ListingStatus } from "@auto/shared";
import { auditLog, extractAuditContext } from "../middleware/audit-trail";

const LOG = cds.log("lifecycle");

// ─── markAsSold ─────────────────────────────────────────────────────────────

export async function handleMarkAsSold(req: cds.Request) {
  const { listingId } = req.data as { listingId: string };
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");
  const listing = await cds.run(SELECT.one.from(entities["Listing"]).where({ ID: listingId }));

  if (!listing) {
    return req.error(404, "Annonce introuvable");
  }

  if (listing.sellerId !== userId) {
    return req.error(403, "Vous n'êtes pas le propriétaire de cette annonce");
  }

  const currentStatus = listing.status as ListingStatus;
  if (!isValidListingTransition(currentStatus, "sold")) {
    return req.error(
      400,
      `Transition invalide : impossible de passer de "${currentStatus}" à "sold"`,
    );
  }

  const now = new Date().toISOString();

  await cds.run(
    UPDATE(entities["Listing"]).set({ status: "sold", soldAt: now }).where({ ID: listingId }),
  );

  LOG.info(`Listing ${listingId} marked as sold by seller ${userId}`);

  // Fire-and-forget audit
  const auditCtx = extractAuditContext(req);
  auditLog({
    action: "listing.sold",
    actorId: auditCtx.actorId,
    actorRole: auditCtx.actorRole,
    targetType: "Listing",
    targetId: listingId,
    details: { previousStatus: currentStatus, sellerId: userId },
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
    severity: "info",
  });

  // Emit event for chat notification (pluggable, Epic 5)
  emitListingStatusChanged(listingId, userId, "sold");

  return {
    success: true,
    listingId,
    newStatus: "sold",
    timestamp: now,
  };
}

// ─── archiveListing ─────────────────────────────────────────────────────────

export async function handleArchiveListing(req: cds.Request) {
  const { listingId } = req.data as { listingId: string };
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");
  const listing = await cds.run(SELECT.one.from(entities["Listing"]).where({ ID: listingId }));

  if (!listing) {
    return req.error(404, "Annonce introuvable");
  }

  if (listing.sellerId !== userId) {
    return req.error(403, "Vous n'êtes pas le propriétaire de cette annonce");
  }

  const currentStatus = listing.status as ListingStatus;
  if (!isValidListingTransition(currentStatus, "archived")) {
    return req.error(
      400,
      `Transition invalide : impossible de passer de "${currentStatus}" à "archived"`,
    );
  }

  const now = new Date().toISOString();

  await cds.run(
    UPDATE(entities["Listing"])
      .set({ status: "archived", archivedAt: now })
      .where({ ID: listingId }),
  );

  LOG.info(`Listing ${listingId} archived by seller ${userId}`);

  // Fire-and-forget audit
  const auditCtx = extractAuditContext(req);
  auditLog({
    action: "listing.archived",
    actorId: auditCtx.actorId,
    actorRole: auditCtx.actorRole,
    targetType: "Listing",
    targetId: listingId,
    details: { previousStatus: currentStatus, sellerId: userId },
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
    severity: "info",
  });

  return {
    success: true,
    listingId,
    newStatus: "archived",
    timestamp: now,
  };
}

// ─── getSellerListings (published listings with analytics) ──────────────────

export async function handleGetSellerListings(req: cds.Request) {
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");

  const listings = await cds.run(
    SELECT.from(entities["Listing"])
      .where({ sellerId: userId, status: "published" })
      .orderBy("publishedAt desc"),
  );

  const result = await enrichListingsWithAnalytics(entities, listings);

  return { listings: JSON.stringify(result) };
}

// ─── getListingHistory (all non-draft listings with metrics) ────────────────

export async function handleGetListingHistory(req: cds.Request) {
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");

  const listings = await cds.run(
    SELECT.from(entities["Listing"])
      .where({ sellerId: userId, status: { "!=": "draft" } })
      .orderBy("modifiedAt desc"),
  );

  const result = await enrichListingsWithAnalytics(entities, listings);

  return { listings: JSON.stringify(result) };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface ListingRow {
  ID: string;
  make: string | null;
  model: string | null;
  year: number | null;
  price: number | null;
  status: string;
  visibilityScore: number;
  publishedAt: string | null;
  soldAt: string | null;
  archivedAt: string | null;
  modifiedAt: string | null;
}

async function enrichListingsWithAnalytics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities: Record<string, any>,
  listings: ListingRow[],
) {
  if (listings.length === 0) return [];

  const listingIds = listings.map((l) => l.ID);

  // Fetch analytics for all listings in one query
  const analytics = await cds.run(
    SELECT.from(entities["ListingAnalytics"]).where({ listingId: { in: listingIds } }),
  );

  const analyticsMap = new Map<
    string,
    { viewCount: number; favoriteCount: number; chatCount: number }
  >();
  for (const a of analytics) {
    analyticsMap.set(a.listingId, {
      viewCount: a.viewCount || 0,
      favoriteCount: a.favoriteCount || 0,
      chatCount: a.chatCount || 0,
    });
  }

  // Fetch photo counts per listing
  const photos = await cds.run(
    SELECT.from(entities["ListingPhoto"])
      .columns("listingId", "cdnUrl", "isPrimary", "sortOrder")
      .where({ listingId: { in: listingIds } })
      .orderBy("sortOrder asc"),
  );

  const photoMap = new Map<string, { count: number; primaryUrl: string | null }>();
  for (const p of photos) {
    const existing = photoMap.get(p.listingId);
    if (!existing) {
      photoMap.set(p.listingId, {
        count: 1,
        primaryUrl: p.isPrimary ? p.cdnUrl : p.cdnUrl, // First photo as fallback
      });
    } else {
      existing.count++;
      if (p.isPrimary) existing.primaryUrl = p.cdnUrl;
    }
  }

  const now = new Date();

  return listings.map((l) => {
    const a = analyticsMap.get(l.ID) || { viewCount: 0, favoriteCount: 0, chatCount: 0 };
    const p = photoMap.get(l.ID) || { count: 0, primaryUrl: null };

    // Calculate days on market
    let daysOnMarket: number | null = null;
    if (l.publishedAt) {
      const start = new Date(l.publishedAt);
      const end = l.soldAt ? new Date(l.soldAt) : l.archivedAt ? new Date(l.archivedAt) : now;
      daysOnMarket = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
    }

    return {
      ID: l.ID,
      make: l.make,
      model: l.model,
      year: l.year,
      price: l.price,
      status: l.status,
      visibilityScore: l.visibilityScore || 0,
      publishedAt: l.publishedAt,
      soldAt: l.soldAt || null,
      archivedAt: l.archivedAt || null,
      viewCount: a.viewCount,
      favoriteCount: a.favoriteCount,
      chatCount: a.chatCount,
      daysOnMarket,
      photoCount: p.count,
      primaryPhotoUrl: p.primaryUrl,
    };
  });
}

// ─── Event emitter for chat notification (pluggable hook) ───────────────────

type ListingStatusChangeHandler = (listingId: string, sellerId: string, newStatus: string) => void;

const statusChangeHandlers: ListingStatusChangeHandler[] = [];

/** Register a handler for listing status changes (used by chat system in Epic 5). */
export function onListingStatusChange(handler: ListingStatusChangeHandler): void {
  statusChangeHandlers.push(handler);
}

function emitListingStatusChanged(listingId: string, sellerId: string, newStatus: string): void {
  for (const handler of statusChangeHandlers) {
    try {
      handler(listingId, sellerId, newStatus);
    } catch (err) {
      LOG.error("Error in listing status change handler:", err);
    }
  }

  // Default log for now (Epic 5 will register its own handler)
  if (newStatus === "sold") {
    LOG.info(
      `[Chat hook] Listing ${listingId} marked as sold — active conversations should be notified`,
    );
  }
}
