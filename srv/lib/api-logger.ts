import cds from "@sap/cds";

const LOG = cds.log("api-logger");

export interface ApiCallEntry {
  adapterInterface: string;
  providerKey: string;
  endpoint: string;
  httpMethod: string;
  httpStatus: number;
  responseTimeMs: number;
  cost: number;
  listingId?: string;
  requestId?: string;
  errorMessage?: string;
}

/**
 * Log an API call to the ApiCallLog entity.
 * Fire-and-forget: errors are logged but do not propagate.
 */
export async function logApiCall(entry: ApiCallEntry): Promise<void> {
  try {
    const entities = cds.entities("auto");
    const entity = entities["ApiCallLog"];
    if (!entity) {
      LOG.warn("ApiCallLog entity not found, skipping API call logging");
      return;
    }

    await cds.run(
      INSERT.into(entity).entries({
        adapterInterface: entry.adapterInterface,
        providerKey: entry.providerKey,
        endpoint: entry.endpoint,
        httpMethod: entry.httpMethod,
        httpStatus: entry.httpStatus,
        responseTimeMs: entry.responseTimeMs,
        cost: entry.cost,
        listingId: entry.listingId || null,
        requestId: entry.requestId || null,
        errorMessage: entry.errorMessage || null,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    LOG.error("Failed to log API call:", err);
  }
}

/**
 * Wraps an async function to automatically log the API call.
 * Use this to instrument adapter methods.
 */
export function withApiLogging<TArgs extends unknown[], TResult>(
  adapterInterface: string,
  providerKey: string,
  costPerCall: number,
  fn: (...args: TArgs) => Promise<TResult>,
  endpointName?: string,
): (...args: TArgs) => Promise<TResult> {
  const resolvedEndpoint = endpointName || fn.name || "unknown";
  return async (...args: TArgs): Promise<TResult> => {
    const start = Date.now();
    let httpStatus = 200;
    let errorMessage: string | undefined;

    try {
      const result = await fn(...args);
      return result;
    } catch (err) {
      httpStatus = 500;
      errorMessage = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const responseTimeMs = Date.now() - start;
      await logApiCall({
        adapterInterface,
        providerKey,
        endpoint: resolvedEndpoint,
        httpMethod: "POST",
        httpStatus,
        responseTimeMs,
        cost: costPerCall,
        errorMessage,
      });
    }
  };
}
