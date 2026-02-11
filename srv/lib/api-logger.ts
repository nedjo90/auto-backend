import cds from "@sap/cds";
import { createAlertEvent } from "./alert-evaluator";
import { sendAlertNotification } from "./alert-notifier";

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

/** Consecutive failure tracking per provider. */
interface FailureState {
  count: number;
  lastSuccessAt: string | null;
}

const FAILURE_THRESHOLD = 3;
const failureCounters = new Map<string, FailureState>();

/**
 * Get the current failure state for a provider.
 */
export function getFailureState(providerKey: string): FailureState | undefined {
  return failureCounters.get(providerKey);
}

/**
 * Reset all failure counters (for testing).
 */
export function resetFailureCounters(): void {
  failureCounters.clear();
}

/**
 * Track consecutive failures and trigger auto-alert when threshold is reached.
 */
async function trackProviderFailure(entry: ApiCallEntry): Promise<void> {
  const isFailure = entry.httpStatus >= 400;
  const state = failureCounters.get(entry.providerKey) || {
    count: 0,
    lastSuccessAt: null,
  };

  if (isFailure) {
    state.count++;
    failureCounters.set(entry.providerKey, state);

    if (state.count === FAILURE_THRESHOLD) {
      // Trigger auto-alert
      try {
        const alertEventId = await createAlertEvent(
          {
            ID: `auto-${entry.providerKey}`,
            name: `API Provider Failure: ${entry.providerKey}`,
            metric: "api_availability",
            thresholdValue: FAILURE_THRESHOLD,
            comparisonOperator: "equals",
            notificationMethod: "both",
            severityLevel: "critical",
            enabled: true,
            cooldownMinutes: 30,
            lastTriggeredAt: null,
          },
          state.count,
        );

        if (alertEventId) {
          await sendAlertNotification({
            alertEventId,
            alertName: `API Provider Failure: ${entry.providerKey}`,
            metric: "api_availability",
            currentValue: state.count,
            thresholdValue: FAILURE_THRESHOLD,
            severity: "critical",
            message: `API provider "${entry.providerKey}" has ${state.count} consecutive failures. Last success: ${state.lastSuccessAt || "never"}`,
            notificationMethod: "both",
          });
        }

        LOG.warn(
          `API provider "${entry.providerKey}" has ${state.count} consecutive failures - alert triggered`,
        );
      } catch (err) {
        LOG.error("Failed to trigger API failure auto-alert:", err);
      }
    }
  } else {
    // Reset on success
    state.count = 0;
    state.lastSuccessAt = new Date().toISOString();
    failureCounters.set(entry.providerKey, state);
  }
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

    // Track consecutive failures for auto-alerting
    await trackProviderFailure(entry);
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
