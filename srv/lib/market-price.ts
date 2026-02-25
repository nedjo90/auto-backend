import type { MarketComparison, MarketPricePosition } from "@auto/shared";
import { MARKET_PRICE_THRESHOLDS } from "@auto/shared";
import { getValuation } from "../adapters/factory/adapter-factory";
import cds from "@sap/cds";

const LOG = cds.log("market-price");

/** Listing data needed for market price computation. */
export interface MarketPriceInput {
  make: string | null;
  model: string | null;
  year: number | null;
  mileage: number | null;
  fuelType: string | null;
  price: number | null;
}

// ─── In-memory cache (TTL = 1 hour) ────────────────────────────────

interface CacheEntry {
  result: MarketComparison;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, CacheEntry>();

/** Build a deterministic cache key from listing attributes. */
function buildCacheKey(listing: MarketPriceInput): string {
  return `${listing.make}|${listing.model}|${listing.year}|${listing.mileage}|${listing.fuelType}|${listing.price}`;
}

/** Clear expired entries from cache. Called periodically during writes. */
function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

/** Expose cache clear for testing. */
export function clearMarketPriceCache(): void {
  cache.clear();
}

/** Expose cache size for testing. */
export function getMarketPriceCacheSize(): number {
  return cache.size;
}

/**
 * Compute market price comparison for a listing.
 * Calls the active IValuationAdapter via the adapter factory,
 * computes percentage difference, and returns a MarketComparison.
 * Results are cached in-memory with a 1-hour TTL.
 */
export async function computeMarketComparison(
  listing: MarketPriceInput,
): Promise<MarketComparison> {
  // If listing is missing required fields, return unavailable
  if (
    !listing.make ||
    !listing.model ||
    listing.year == null ||
    listing.mileage == null ||
    !listing.fuelType ||
    listing.price == null
  ) {
    return {
      position: "unavailable",
      percentageDiff: null,
      displayText: "Estimation non disponible",
    };
  }

  // Check cache
  const cacheKey = buildCacheKey(listing);
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  try {
    const adapter = getValuation();
    const result = await adapter.evaluate({
      make: listing.make,
      model: listing.model,
      year: listing.year,
      mileageKm: listing.mileage,
      fuelType: listing.fuelType,
    });

    if (!result || result.estimatedValueEur <= 0) {
      const unavailable: MarketComparison = {
        position: "unavailable",
        percentageDiff: null,
        displayText: "Estimation non disponible",
      };
      cache.set(cacheKey, { result: unavailable, expiresAt: now + CACHE_TTL_MS });
      evictExpired();
      return unavailable;
    }

    const percentageDiff =
      ((listing.price - result.estimatedValueEur) / result.estimatedValueEur) * 100;
    const position = classifyPosition(percentageDiff);
    const displayText = formatDisplayText(position, percentageDiff);

    const comparison: MarketComparison = {
      position,
      percentageDiff: Math.round(percentageDiff),
      displayText,
    };
    cache.set(cacheKey, { result: comparison, expiresAt: now + CACHE_TTL_MS });
    evictExpired();
    return comparison;
  } catch (err) {
    LOG.warn("Market price computation failed:", err);
    return {
      position: "unavailable",
      percentageDiff: null,
      displayText: "Estimation non disponible",
    };
  }
}

/**
 * Classify market position based on percentage difference.
 * below: diff <= -5%, aligned: -5% < diff < 5%, above: diff >= 5%
 */
export function classifyPosition(percentageDiff: number): MarketPricePosition {
  if (percentageDiff <= MARKET_PRICE_THRESHOLDS.belowMaxPercent) return "below";
  if (percentageDiff >= MARKET_PRICE_THRESHOLDS.aboveMinPercent) return "above";
  return "aligned";
}

/**
 * Format the display text for the market comparison indicator.
 */
export function formatDisplayText(position: MarketPricePosition, percentageDiff: number): string {
  const absDiff = Math.abs(Math.round(percentageDiff));
  switch (position) {
    case "below":
      return `${absDiff}% en dessous du marché`;
    case "above":
      return `${absDiff}% au-dessus du marché`;
    case "aligned":
      return "Prix aligné";
    case "unavailable":
      return "Estimation non disponible";
  }
}
