import cds from "@sap/cds";
import { configCache } from "./config-cache";

const LOG = cds.log("api-cache");

const DEFAULT_CACHE_TTL_HOURS = 48;
const CACHE_TTL_CONFIG_KEY = "API_CACHE_TTL_HOURS";

/**
 * Get the configured cache TTL in hours from ConfigParameter table.
 * Falls back to DEFAULT_CACHE_TTL_HOURS if not configured.
 */
export function getCacheTtlHours(): number {
  const param = configCache.get<{ value: string }>("ConfigParameter", CACHE_TTL_CONFIG_KEY);
  if (param?.value) {
    const parsed = parseInt(param.value, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_CACHE_TTL_HOURS;
}

/**
 * Look up cached API response data for a vehicle identifier and adapter.
 * Returns the parsed response data if a valid, non-expired cache entry exists.
 * Returns null if no cache entry or if expired.
 */
export async function getCachedResponse<T>(
  vehicleIdentifier: string,
  identifierType: string,
  adapterName: string,
): Promise<T | null> {
  const entities = cds.entities("auto");
  const entity = entities["ApiCachedData"];
  if (!entity) {
    LOG.warn("ApiCachedData entity not found, skipping cache lookup");
    return null;
  }

  const now = new Date().toISOString();

  const row = await cds.run(
    SELECT.one.from(entity).where({
      vehicleIdentifier,
      identifierType,
      adapterName,
      isValid: true,
    }),
  );

  if (!row) return null;

  // Check if expired
  if (row.expiresAt && row.expiresAt <= now) {
    LOG.info(`Cache expired for ${adapterName} / ${vehicleIdentifier} (expired: ${row.expiresAt})`);
    return null;
  }

  try {
    return JSON.parse(row.responseData) as T;
  } catch {
    LOG.warn(`Failed to parse cached response data for ${adapterName} / ${vehicleIdentifier}`);
    return null;
  }
}

/**
 * Write an API response to the cache for a vehicle identifier and adapter.
 * Invalidates any existing cache entry for the same combination.
 */
export async function setCachedResponse(
  vehicleIdentifier: string,
  identifierType: string,
  adapterName: string,
  responseData: unknown,
): Promise<void> {
  const entities = cds.entities("auto");
  const entity = entities["ApiCachedData"];
  if (!entity) {
    LOG.warn("ApiCachedData entity not found, skipping cache write");
    return;
  }

  const ttlHours = getCacheTtlHours();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

  // Invalidate any existing entries for the same combination
  try {
    await cds.run(
      UPDATE(entity)
        .set({ isValid: false })
        .where({ vehicleIdentifier, identifierType, adapterName, isValid: true }),
    );
  } catch (err) {
    LOG.warn("Failed to invalidate old cache entries:", err);
  }

  // Insert new cache entry
  const id = cds.utils.uuid();
  await cds.run(
    INSERT.into(entity).entries({
      ID: id,
      vehicleIdentifier,
      identifierType,
      adapterName,
      responseData: JSON.stringify(responseData),
      fetchedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      isValid: true,
    }),
  );

  LOG.info(`Cached response for ${adapterName} / ${vehicleIdentifier} (TTL: ${ttlHours}h)`);
}
