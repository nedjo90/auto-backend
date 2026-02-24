import cds from "@sap/cds";
import type { AdapterErrorType, AdapterTypedError } from "@auto/shared";
import { RESILIENCE_DEFAULTS } from "@auto/shared";
import { configCache } from "./config-cache";
import { isCallAllowed, recordSuccess, recordFailure } from "./circuit-breaker";
import { delay } from "./async-utils";

const LOG = cds.log("adapter-resilience");

/**
 * Classify an error into an AdapterErrorType.
 */
export function classifyError(err: unknown): AdapterErrorType {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("timeout") || msg.includes("abort") || msg.includes("timed out")) {
      return "timeout";
    }
    if (
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("network") ||
      msg.includes("fetch failed") ||
      msg.includes("econnreset")
    ) {
      return "connection";
    }
    if (msg.includes("429") || msg.includes("too many requests") || msg.includes("rate limit")) {
      return "rate_limit";
    }
  }
  return "response";
}

/**
 * Extract HTTP status from an error if possible.
 */
export function extractHttpStatus(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.status === "number") return e.status;
    if (typeof e.statusCode === "number") return e.statusCode;
  }
  return undefined;
}

/**
 * Create a typed adapter error from a caught error.
 */
export function createTypedError(err: unknown, provider: string): AdapterTypedError {
  const errorType = classifyError(err);
  const httpStatus = extractHttpStatus(err);
  const message = err instanceof Error ? err.message : String(err);

  return {
    code: `ADAPTER_${errorType.toUpperCase()}`,
    message,
    provider,
    retryable: errorType === "timeout" || errorType === "connection" || errorType === "rate_limit",
    errorType,
    httpStatus,
    retryAfterMs: errorType === "rate_limit" ? 60000 : undefined,
  };
}

function getRetryCount(): number {
  const param = configCache.get<{ value: string }>("ConfigParameter", "ADAPTER_RETRY_COUNT");
  if (param?.value) {
    const parsed = parseInt(param.value, 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  return RESILIENCE_DEFAULTS.ADAPTER_RETRY_COUNT;
}

/**
 * Execute an adapter call with:
 * - Circuit breaker check
 * - Retry with exponential backoff
 * - Error classification
 * - Circuit breaker state updates
 *
 * Returns the result or throws an AdapterTypedError-like error.
 */
export async function withResilience<T>(
  adapterName: string,
  providerKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Circuit breaker check
  if (!isCallAllowed(adapterName)) {
    const circuitError = new Error(`Circuit breaker open for ${adapterName} - call skipped`);
    const typed = createTypedError(circuitError, providerKey);
    typed.errorType = "connection";
    typed.code = "CIRCUIT_OPEN";
    Object.assign(circuitError, typed);
    throw circuitError;
  }

  const maxRetries = getRetryCount();
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      recordSuccess(adapterName);
      return result;
    } catch (err) {
      lastError = err;
      const errorType = classifyError(err);

      // Only retry on retryable errors
      if (attempt < maxRetries && (errorType === "timeout" || errorType === "connection")) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000);
        LOG.info(
          `Retry ${attempt + 1}/${maxRetries} for ${adapterName} after ${backoffMs}ms (${errorType})`,
        );
        await delay(backoffMs);
        continue;
      }

      // Record failure on last attempt or non-retryable error
      recordFailure(adapterName, errorType);
      break;
    }
  }

  const typedError = createTypedError(lastError, providerKey);
  const error = new Error(typedError.message);
  Object.assign(error, typedError);
  throw error;
}
