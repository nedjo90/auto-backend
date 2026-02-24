import cds from "@sap/cds";
import type { CircuitBreakerState, ICircuitBreakerConfig, AdapterErrorType } from "@auto/shared";
import { RESILIENCE_DEFAULTS } from "@auto/shared";
import { configCache } from "./config-cache";

const LOG = cds.log("circuit-breaker");

interface CircuitEntry {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  circuitOpenedAt: number | null;
  halfOpenAttempts: number;
}

/** In-memory circuit breaker state per adapter name. */
const circuits = new Map<string, CircuitEntry>();

function getConfig(): ICircuitBreakerConfig {
  const threshold = getConfigValue(
    "CIRCUIT_BREAKER_THRESHOLD",
    RESILIENCE_DEFAULTS.CIRCUIT_BREAKER_THRESHOLD,
  );
  const cooldownMs = getConfigValue(
    "CIRCUIT_BREAKER_COOLDOWN_MS",
    RESILIENCE_DEFAULTS.CIRCUIT_BREAKER_COOLDOWN_MS,
  );
  const halfOpenMax = getConfigValue(
    "CIRCUIT_BREAKER_HALF_OPEN_MAX",
    RESILIENCE_DEFAULTS.CIRCUIT_BREAKER_HALF_OPEN_MAX,
  );
  return { failureThreshold: threshold, cooldownMs, halfOpenMaxAttempts: halfOpenMax };
}

function getConfigValue(key: string, defaultValue: number): number {
  const param = configCache.get<{ value: string }>("ConfigParameter", key);
  if (param?.value) {
    const parsed = parseInt(param.value, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return defaultValue;
}

function getOrCreateCircuit(adapterName: string): CircuitEntry {
  let entry = circuits.get(adapterName);
  if (!entry) {
    entry = {
      state: "closed",
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      circuitOpenedAt: null,
      halfOpenAttempts: 0,
    };
    circuits.set(adapterName, entry);
  }
  return entry;
}

/**
 * Check if a call to the given adapter should be allowed.
 * Returns true if the circuit is closed or half-open (allowing a probe).
 * Returns false if the circuit is open and cooldown hasn't elapsed.
 */
export function isCallAllowed(adapterName: string): boolean {
  const entry = getOrCreateCircuit(adapterName);
  const config = getConfig();
  const now = Date.now();

  if (entry.state === "closed") {
    return true;
  }

  if (entry.state === "open") {
    // Check if cooldown has elapsed
    if (entry.circuitOpenedAt && now - entry.circuitOpenedAt >= config.cooldownMs) {
      // Transition to half-open
      entry.state = "half-open";
      entry.halfOpenAttempts = 0;
      LOG.info(`Circuit breaker for ${adapterName}: open -> half-open (cooldown elapsed)`);
      return true;
    }
    return false;
  }

  // half-open: allow up to halfOpenMaxAttempts
  if (entry.halfOpenAttempts < config.halfOpenMaxAttempts) {
    return true;
  }
  return false;
}

/**
 * Record a successful call for the given adapter.
 * Resets the circuit to closed.
 */
export function recordSuccess(adapterName: string): void {
  const entry = getOrCreateCircuit(adapterName);
  const wasOpen = entry.state !== "closed";

  entry.state = "closed";
  entry.consecutiveFailures = 0;
  entry.lastSuccessAt = Date.now();
  entry.halfOpenAttempts = 0;

  if (wasOpen) {
    LOG.info(`Circuit breaker for ${adapterName}: reset to closed (success)`);
  }
}

/**
 * Record a failed call for the given adapter.
 * May transition the circuit to open if threshold is exceeded.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function recordFailure(adapterName: string, _errorType?: AdapterErrorType): void {
  const entry = getOrCreateCircuit(adapterName);
  const config = getConfig();
  const now = Date.now();

  entry.consecutiveFailures++;
  entry.lastFailureAt = now;

  if (entry.state === "half-open") {
    entry.halfOpenAttempts++;
    // Any failure in half-open immediately re-opens
    entry.state = "open";
    entry.circuitOpenedAt = now;
    LOG.warn(`Circuit breaker for ${adapterName}: half-open -> open (probe failed)`);
    return;
  }

  if (entry.consecutiveFailures >= config.failureThreshold && entry.state === "closed") {
    entry.state = "open";
    entry.circuitOpenedAt = now;
    LOG.warn(
      `Circuit breaker for ${adapterName}: closed -> open (${entry.consecutiveFailures} consecutive failures)`,
    );
  }
}

/**
 * Get the current circuit breaker state for an adapter.
 */
export function getCircuitState(adapterName: string): CircuitBreakerState {
  return getOrCreateCircuit(adapterName).state;
}

/**
 * Get the consecutive failure count for an adapter.
 */
export function getConsecutiveFailures(adapterName: string): number {
  return getOrCreateCircuit(adapterName).consecutiveFailures;
}

/**
 * Reset all circuit breaker state (for testing).
 */
export function resetAllCircuits(): void {
  circuits.clear();
}

/**
 * Reset circuit breaker state for a specific adapter (for testing).
 */
export function resetCircuit(adapterName: string): void {
  circuits.delete(adapterName);
}
