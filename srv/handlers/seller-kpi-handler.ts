import cds from "@sap/cds";
import type {
  ISellerKpiSummary,
  ISellerListingPerformance,
  IMetricDrilldownData,
  IMetricDrilldownPoint,
  IKpiValue,
  SellerKpiMetric,
  MarketPricePosition,
} from "@auto/shared";
import {
  SELLER_KPI_METRICS,
  SELLER_KPI_PERIOD_DAYS,
  SELLER_LISTINGS_PAGE_SIZE,
  SELLER_DRILLDOWN_PERIODS,
  VISIBILITY_LABELS,
  DEFAULT_VISIBILITY_WEIGHTS,
} from "@auto/shared";
import { computeMarketComparison } from "../lib/market-price";

/** Columns that exist on the Listing entity and can be used in DB ORDER BY. */
const DB_SORTABLE_COLUMNS = ["price", "visibilityScore", "publishedAt"] as const;

/** Columns computed from analytics that require in-memory sort. */
const MEMORY_SORT_COLUMNS = ["viewCount", "chatCount", "daysOnMarket"] as const;

// ─── getAggregateKPIs ───────────────────────────────────────────────────────

export async function handleGetAggregateKPIs(req: cds.Request) {
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");
  const now = new Date();
  const periodMs = SELLER_KPI_PERIOD_DAYS * 86400000;
  const currentStart = new Date(now.getTime() - periodMs);
  const previousStart = new Date(currentStart.getTime() - periodMs);

  // Fetch all published listings for this seller
  const listings = await cds.run(
    SELECT.from(entities["Listing"])
      .columns("ID", "publishedAt", "status")
      .where({ sellerId: userId, status: { in: ["published", "sold"] } }),
  );

  const activeListings = listings.filter((l: Record<string, unknown>) => l.status === "published");

  // Count listings published in current vs previous period
  const currentPublished = listings.filter(
    (l: Record<string, unknown>) =>
      l.publishedAt && new Date(l.publishedAt as string) >= currentStart,
  ).length;
  const previousPublished = listings.filter(
    (l: Record<string, unknown>) =>
      l.publishedAt &&
      new Date(l.publishedAt as string) >= previousStart &&
      new Date(l.publishedAt as string) < currentStart,
  ).length;

  const listingIds = listings.map((l: Record<string, unknown>) => l.ID as string);

  // Fetch analytics for all listings
  let totalViews = 0;
  let totalContacts = 0;
  if (listingIds.length > 0) {
    const analytics = await cds.run(
      SELECT.from(entities["ListingAnalytics"]).where({ listingId: { in: listingIds } }),
    );
    for (const a of analytics) {
      totalViews += (a.viewCount as number) || 0;
      totalContacts += (a.chatCount as number) || 0;
    }
  }

  // Calculate average days online for active listings
  let avgDaysOnline = 0;
  if (activeListings.length > 0) {
    let totalDays = 0;
    for (const l of activeListings) {
      if (l.publishedAt) {
        const days = Math.max(
          0,
          Math.floor((now.getTime() - new Date(l.publishedAt as string).getTime()) / 86400000),
        );
        totalDays += days;
      }
    }
    avgDaysOnline = Math.round(totalDays / activeListings.length);
  }

  // Note: views/contacts/avgDaysOnline trends require daily snapshots (not yet implemented).
  // We only compute trend for activeListings based on publish dates.
  const kpis: ISellerKpiSummary = {
    activeListings: buildKpiValue(activeListings.length, currentPublished, previousPublished),
    totalViews: { current: totalViews, previous: 0, trend: 0 },
    totalContacts: { current: totalContacts, previous: 0, trend: 0 },
    avgDaysOnline: { current: avgDaysOnline, previous: 0, trend: 0 },
  };

  return { kpis: JSON.stringify(kpis) };
}

// ─── getListingPerformance ──────────────────────────────────────────────────

export async function handleGetListingPerformance(req: cds.Request) {
  const userId = req.user?.id;
  const {
    sortBy = "publishedAt",
    sortDir = "desc",
    skip = 0,
    top = SELLER_LISTINGS_PAGE_SIZE,
  } = req.data as {
    sortBy?: string;
    sortDir?: string;
    skip?: number;
    top?: number;
  };

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");

  // Count total published listings
  const countResult = await cds.run(
    SELECT.one
      .from(entities["Listing"])
      .columns("count(*) as cnt")
      .where({ sellerId: userId, status: "published" }),
  );
  const total = countResult?.cnt || 0;

  if (total === 0) {
    return { listings: JSON.stringify([]), total: 0 };
  }

  const validSortDir = sortDir === "asc" ? "asc" : "desc";
  const isDbSort = (DB_SORTABLE_COLUMNS as readonly string[]).includes(sortBy);
  const isMemorySort = (MEMORY_SORT_COLUMNS as readonly string[]).includes(sortBy);

  // For DB-sortable columns, use ORDER BY. For analytics columns, fetch all and sort in memory.
  let listings: Record<string, unknown>[];
  if (isDbSort) {
    listings = await cds.run(
      SELECT.from(entities["Listing"])
        .where({ sellerId: userId, status: "published" })
        .orderBy(`${sortBy} ${validSortDir}`)
        .limit(top, skip),
    );
  } else {
    // Fetch all published listings (no DB sort for computed columns)
    listings = await cds.run(
      SELECT.from(entities["Listing"])
        .where({ sellerId: userId, status: "published" })
        .orderBy("publishedAt desc"),
    );
  }

  const listingIds = listings.map((l) => l.ID as string);

  // Batch fetch analytics
  const analytics = await cds.run(
    SELECT.from(entities["ListingAnalytics"]).where({ listingId: { in: listingIds } }),
  );
  const analyticsMap = new Map<
    string,
    { viewCount: number; favoriteCount: number; chatCount: number }
  >();
  for (const a of analytics) {
    analyticsMap.set(a.listingId as string, {
      viewCount: (a.viewCount as number) || 0,
      favoriteCount: (a.favoriteCount as number) || 0,
      chatCount: (a.chatCount as number) || 0,
    });
  }

  // Batch fetch photos
  const photos = await cds.run(
    SELECT.from(entities["ListingPhoto"])
      .columns("listingId", "cdnUrl", "isPrimary", "sortOrder")
      .where({ listingId: { in: listingIds } })
      .orderBy("sortOrder asc"),
  );
  const photoMap = new Map<string, { count: number; primaryUrl: string | null }>();
  for (const p of photos) {
    const existing = photoMap.get(p.listingId as string);
    if (!existing) {
      photoMap.set(p.listingId as string, {
        count: 1,
        primaryUrl: (p.cdnUrl as string) || null,
      });
    } else {
      existing.count++;
      if (p.isPrimary) existing.primaryUrl = (p.cdnUrl as string) || null;
    }
  }

  // Parallelize market comparison calls
  const comparisons = await Promise.allSettled(
    listings.map((l) =>
      computeMarketComparison({
        make: l.make as string | null,
        model: l.model as string | null,
        year: l.year as number | null,
        mileage: l.mileage as number | null,
        fuelType: l.fuelType as string | null,
        price: l.price as number | null,
      }),
    ),
  );

  const now = new Date();

  const result: ISellerListingPerformance[] = listings.map((l, i) => {
    const a = analyticsMap.get(l.ID as string) || { viewCount: 0, favoriteCount: 0, chatCount: 0 };
    const p = photoMap.get(l.ID as string) || { count: 0, primaryUrl: null };
    const compResult = comparisons[i];
    const marketPosition: MarketPricePosition | null =
      compResult.status === "fulfilled" ? compResult.value?.position || null : null;

    let daysOnMarket: number | null = null;
    if (l.publishedAt) {
      daysOnMarket = Math.max(
        0,
        Math.floor((now.getTime() - new Date(l.publishedAt as string).getTime()) / 86400000),
      );
    }

    const score = (l.visibilityScore as number) || 0;

    return {
      ID: l.ID as string,
      make: (l.make as string) || null,
      model: (l.model as string) || null,
      year: (l.year as number) || null,
      price: (l.price as number) || null,
      status: l.status as string as ISellerListingPerformance["status"],
      visibilityScore: score,
      visibilityLabel: getVisibilityLabel(score),
      publishedAt: (l.publishedAt as string) || null,
      viewCount: a.viewCount,
      favoriteCount: a.favoriteCount,
      chatCount: a.chatCount,
      daysOnMarket,
      photoCount: p.count,
      primaryPhotoUrl: p.primaryUrl,
      marketPosition,
    };
  });

  // In-memory sort for analytics/computed columns
  if (isMemorySort) {
    result.sort((a, b) => {
      const aVal = (a[sortBy as keyof ISellerListingPerformance] as number) ?? 0;
      const bVal = (b[sortBy as keyof ISellerListingPerformance] as number) ?? 0;
      return validSortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
  }

  // Apply pagination for in-memory sorted results
  const paged = isMemorySort ? result.slice(skip, skip + top) : result;

  return { listings: JSON.stringify(paged), total };
}

// ─── getMetricDrilldown ─────────────────────────────────────────────────────

export async function handleGetMetricDrilldown(req: cds.Request) {
  const userId = req.user?.id;
  const {
    metric,
    listingId,
    periodDays = SELLER_KPI_PERIOD_DAYS,
  } = req.data as {
    metric: string;
    listingId?: string;
    periodDays?: number;
  };

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  if (!(SELLER_KPI_METRICS as readonly string[]).includes(metric)) {
    return req.error(400, "Métrique invalide");
  }

  const validPeriod = (SELLER_DRILLDOWN_PERIODS as readonly number[]).includes(periodDays)
    ? periodDays
    : SELLER_KPI_PERIOD_DAYS;

  const entities = cds.entities("auto");
  const now = new Date();
  const startMs = now.getTime() - validPeriod * 86400000;

  // Build time series points based on metric type
  const points: IMetricDrilldownPoint[] = [];
  const insights: string[] = [];

  if (metric === "activeListings") {
    const listings = await cds.run(
      SELECT.from(entities["Listing"])
        .columns("publishedAt", "soldAt", "archivedAt", "status")
        .where({ sellerId: userId, status: { in: ["published", "sold", "archived"] } }),
    );

    // Use UTC ms arithmetic to avoid DST issues
    for (let t = startMs; t <= now.getTime(); t += 86400000) {
      const d = new Date(t);
      const dateStr = d.toISOString().split("T")[0];
      const dayEndMs = t + 86400000 - 1;

      const activeOnDay = listings.filter((l: Record<string, unknown>) => {
        const pubMs = l.publishedAt ? new Date(l.publishedAt as string).getTime() : null;
        const soldMs = l.soldAt ? new Date(l.soldAt as string).getTime() : null;
        const archivedMs = l.archivedAt ? new Date(l.archivedAt as string).getTime() : null;
        if (!pubMs || pubMs > dayEndMs) return false;
        if (soldMs && soldMs <= dayEndMs) return false;
        if (archivedMs && archivedMs <= dayEndMs) return false;
        return true;
      }).length;

      points.push({ date: dateStr, value: activeOnDay });
    }

    if (points.length >= 2) {
      const first = points[0].value;
      const last = points[points.length - 1].value;
      if (last > first) {
        insights.push("Votre nombre d'annonces actives est en hausse sur cette période.");
      } else if (last < first) {
        insights.push(
          "Votre nombre d'annonces actives a diminué. Pensez à publier de nouvelles annonces.",
        );
      }
    }
  } else if (metric === "totalViews" || metric === "totalContacts") {
    // No daily time-series data available; return empty points with insight only.
    const whereClause: Record<string, unknown> = { sellerId: userId, status: "published" };
    const listings = await cds.run(
      SELECT.from(entities["Listing"]).columns("ID").where(whereClause),
    );
    const listingIds = listings.map((l: Record<string, unknown>) => l.ID as string);

    if (listingIds.length > 0 && listingId) {
      if (!listingIds.includes(listingId)) {
        return req.error(403, "Annonce non trouvée ou non autorisée");
      }
    }

    // Return empty points - no daily snapshots available yet
    if (metric === "totalViews") {
      insights.push(
        "Les vues dépendent de la qualité de vos photos et de votre score de visibilité.",
      );
      insights.push("Le suivi journalier détaillé sera disponible prochainement.");
    } else {
      insights.push(
        "Un nombre de contacts élevé indique un prix attractif et une annonce bien rédigée.",
      );
      insights.push("Le suivi journalier détaillé sera disponible prochainement.");
    }
  } else if (metric === "avgDaysOnline") {
    // Include sold/archived listings to get accurate historical average
    const listings = await cds.run(
      SELECT.from(entities["Listing"])
        .columns("publishedAt", "soldAt", "archivedAt", "status")
        .where({ sellerId: userId, status: { in: ["published", "sold", "archived"] } }),
    );

    for (let t = startMs; t <= now.getTime(); t += 86400000) {
      const d = new Date(t);
      const dateStr = d.toISOString().split("T")[0];
      const dayEndMs = t + 86400000 - 1;

      // Only count listings that were active (published) on this day
      const activePubs = listings.filter((l: Record<string, unknown>) => {
        const pubMs = l.publishedAt ? new Date(l.publishedAt as string).getTime() : null;
        const soldMs = l.soldAt ? new Date(l.soldAt as string).getTime() : null;
        const archivedMs = l.archivedAt ? new Date(l.archivedAt as string).getTime() : null;
        if (!pubMs || pubMs > dayEndMs) return false;
        if (soldMs && soldMs <= dayEndMs) return false;
        if (archivedMs && archivedMs <= dayEndMs) return false;
        return true;
      });

      if (activePubs.length > 0) {
        let totalDays = 0;
        for (const l of activePubs) {
          totalDays += Math.max(
            0,
            Math.floor((dayEndMs - new Date(l.publishedAt as string).getTime()) / 86400000),
          );
        }
        points.push({
          date: dateStr,
          value: Math.round(totalDays / activePubs.length),
        });
      } else {
        points.push({ date: dateStr, value: 0 });
      }
    }

    if (points.length >= 2 && points[points.length - 1].value > 30) {
      insights.push(
        "Vos annonces sont en ligne depuis longtemps en moyenne. Vérifiez les prix ou améliorez les photos.",
      );
    }
  }

  const drilldown: IMetricDrilldownData = {
    metric: metric as SellerKpiMetric,
    listingId: listingId || null,
    points,
    insights,
  };

  return { drilldown: JSON.stringify(drilldown) };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildKpiValue(current: number, periodCurrent: number, periodPrevious: number): IKpiValue {
  let trend = 0;
  if (periodPrevious > 0) {
    trend = ((periodCurrent - periodPrevious) / periodPrevious) * 100;
  } else if (periodCurrent > 0) {
    trend = 100;
  }
  return {
    current,
    previous: periodPrevious,
    trend: Math.round(trend * 10) / 10,
  };
}

function getVisibilityLabel(score: number): string {
  const { labelThresholdLow, labelThresholdHigh } = DEFAULT_VISIBILITY_WEIGHTS;
  if (score > labelThresholdHigh) return VISIBILITY_LABELS.high;
  if (score > labelThresholdLow) return VISIBILITY_LABELS.medium;
  return VISIBILITY_LABELS.low;
}
