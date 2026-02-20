import type { IIdentityProviderAdapter } from "../interfaces/identity-provider.interface";
import type { IBlobStorageAdapter } from "../interfaces/blob-storage.interface";
import type { IVehicleLookupAdapter } from "../interfaces/vehicle-lookup.interface";
import type { IEmissionAdapter } from "../interfaces/emission.interface";
import type { IRecallAdapter } from "../interfaces/recall.interface";
import type { ICritAirCalculator } from "../interfaces/critair.interface";
import type { IVINTechnicalAdapter } from "../interfaces/vin-technical.interface";
import type { IHistoryAdapter } from "../interfaces/history.interface";
import type { IValuationAdapter } from "../interfaces/valuation.interface";
import type { IPaymentAdapter } from "../interfaces/payment.interface";
import { AzureAdB2cAdapter } from "../azure-ad-b2c-adapter";
import { AzureBlobStorageAdapter } from "../azure-blob-storage-adapter";
import { AdemeEmissionAdapter } from "../ademe-emission.adapter";
import { RappelConsoRecallAdapter } from "../rappelconso-recall.adapter";
import { LocalCritAirCalculator } from "../local-critair.adapter";
import { NhtsaVINAdapter } from "../nhtsa-vin.adapter";
import { MockVehicleLookupAdapter } from "../mock/mock-vehicle-lookup.adapter";
import { MockEmissionAdapter } from "../mock/mock-emission.adapter";
import { MockRecallAdapter } from "../mock/mock-recall.adapter";
import { MockCritAirAdapter } from "../mock/mock-critair.adapter";
import { MockVINTechnicalAdapter } from "../mock/mock-vin-technical.adapter";
import { MockHistoryAdapter } from "../mock/mock-history.adapter";
import { MockValuationAdapter } from "../mock/mock-valuation.adapter";
import { MockPaymentAdapter } from "../mock/mock-payment.adapter";
import { configCache } from "../../lib/config-cache";
import { withApiLogging } from "../../lib/api-logger";
import cds from "@sap/cds";

const LOG = cds.log("adapter-factory");

interface CachedProvider {
  key: string;
  adapterInterface: string;
  status: string;
  baseUrl: string;
  active: boolean;
  costPerCall: number;
}

/** Registry of adapter constructors by provider key. */
const ADAPTER_REGISTRY: Record<string, () => unknown> = {
  // Existing adapters
  "azure.adb2c": () => new AzureAdB2cAdapter(),
  "azure.blob": () => new AzureBlobStorageAdapter(),
  // Free API adapters
  ademe: () => new AdemeEmissionAdapter(),
  rappelconso: () => new RappelConsoRecallAdapter(),
  "local.critair": () => new LocalCritAirCalculator(),
  nhtsa: () => new NhtsaVINAdapter(),
  // Mock adapters (used for paid APIs not yet integrated & as fallbacks)
  "mock.vehicle-lookup": () => new MockVehicleLookupAdapter(),
  "mock.emission": () => new MockEmissionAdapter(),
  "mock.recall": () => new MockRecallAdapter(),
  "mock.critair": () => new MockCritAirAdapter(),
  "mock.vin-technical": () => new MockVINTechnicalAdapter(),
  "mock.history": () => new MockHistoryAdapter(),
  "mock.valuation": () => new MockValuationAdapter(),
  "mock.payment": () => new MockPaymentAdapter(),
};

/** Mock fallback provider keys per interface. */
const MOCK_FALLBACK_KEYS: Record<string, string> = {
  IVehicleLookupAdapter: "mock.vehicle-lookup",
  IEmissionAdapter: "mock.emission",
  IRecallAdapter: "mock.recall",
  ICritAirCalculator: "mock.critair",
  IVINTechnicalAdapter: "mock.vin-technical",
  IHistoryAdapter: "mock.history",
  IValuationAdapter: "mock.valuation",
  IPaymentAdapter: "mock.payment",
};

/** Cached adapter instances keyed by interface name. */
const instances = new Map<string, unknown>();

/**
 * Get the active provider configuration for a given adapter interface.
 * Reads from the in-memory config cache (not DB directly).
 */
export function getActiveProvider(interfaceName: string): CachedProvider | undefined {
  const allProviders = configCache.getAll<CachedProvider>("ConfigApiProvider");
  return allProviders.find((p) => p.adapterInterface === interfaceName && p.status === "active");
}

/**
 * Wrap all methods of an adapter with API call logging.
 * Each method call is automatically logged to ApiCallLog.
 */
function wrapWithLogging<T extends object>(
  adapter: T,
  interfaceName: string,
  providerKey: string,
  costPerCall: number,
): T {
  const wrapped = {} as Record<string, unknown>;

  // Wrap own enumerable methods (plain objects, mocks)
  for (const key of Object.keys(adapter)) {
    const val = (adapter as Record<string, unknown>)[key];
    if (typeof val === "function") {
      const bound = (val as (...a: unknown[]) => Promise<unknown>).bind(adapter);
      (wrapped as Record<string, unknown>)[key] = withApiLogging(
        interfaceName,
        providerKey,
        costPerCall,
        bound,
        key,
      );
    } else {
      wrapped[key] = val;
    }
  }

  // Wrap prototype methods (class instances)
  const proto = Object.getPrototypeOf(adapter) as Record<string, unknown>;
  if (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === "constructor" || key in wrapped) continue;
      const val = (adapter as Record<string, unknown>)[key];
      if (typeof val === "function") {
        const bound = (val as (...a: unknown[]) => Promise<unknown>).bind(adapter);
        (wrapped as Record<string, unknown>)[key] = withApiLogging(
          interfaceName,
          providerKey,
          costPerCall,
          bound,
          key,
        );
      }
    }
  }

  return wrapped as T;
}

/**
 * Get or create an adapter instance for the given interface name.
 * Resolves the active provider from configCache and instantiates the correct adapter.
 * Falls back to mock adapter if the active provider is unavailable.
 * All adapter method calls are automatically logged to ApiCallLog.
 */
function resolveAdapter<T>(interfaceName: string): T {
  const cached = instances.get(interfaceName);
  if (cached) return cached as T;

  const provider = getActiveProvider(interfaceName);

  // If no provider configured, try mock fallback
  if (!provider) {
    return resolveWithMockFallback<T>(interfaceName, "no active provider configured");
  }

  const factory = ADAPTER_REGISTRY[provider.key];
  if (!factory) {
    return resolveWithMockFallback<T>(
      interfaceName,
      `no implementation registered for provider key '${provider.key}'`,
    );
  }

  LOG.info(`Resolved adapter for ${interfaceName}: provider=${provider.key}`);
  const instance = factory() as T;
  const logged = wrapWithLogging(
    instance as object,
    interfaceName,
    provider.key,
    provider.costPerCall,
  ) as T;
  instances.set(interfaceName, logged);
  return logged;
}

/**
 * Attempt to resolve using the mock fallback adapter for the given interface.
 * Throws if no mock fallback is available.
 */
function resolveWithMockFallback<T>(interfaceName: string, reason: string): T {
  const mockKey = MOCK_FALLBACK_KEYS[interfaceName];
  if (!mockKey) {
    throw new Error(
      `No active provider found for adapter interface '${interfaceName}' (${reason}). ` +
        `Check ConfigApiProvider table for an entry with status='active'.`,
    );
  }

  const mockFactory = ADAPTER_REGISTRY[mockKey];
  if (!mockFactory) {
    throw new Error(`Mock fallback '${mockKey}' not registered for interface '${interfaceName}'.`);
  }

  LOG.warn(`Falling back to mock adapter for ${interfaceName}: ${reason} → using '${mockKey}'`);
  const instance = mockFactory() as T;
  const logged = wrapWithLogging(instance as object, interfaceName, mockKey, 0) as T;
  instances.set(interfaceName, logged);
  return logged;
}

/**
 * Invalidate cached adapter instance for an interface.
 * Called when a provider switch occurs to force re-resolution.
 */
export function invalidateAdapter(interfaceName?: string): void {
  if (interfaceName) {
    instances.delete(interfaceName);
  } else {
    instances.clear();
  }
}

// ─── Typed accessor functions ────────────────────────────────────────────

export function getIdentityProvider(): IIdentityProviderAdapter {
  return resolveAdapter<IIdentityProviderAdapter>("IIdentityProviderAdapter");
}

export function setIdentityProvider(adapter: IIdentityProviderAdapter): void {
  instances.set("IIdentityProviderAdapter", adapter);
}

export function resetIdentityProvider(): void {
  instances.delete("IIdentityProviderAdapter");
}

export function getBlobStorage(): IBlobStorageAdapter {
  return resolveAdapter<IBlobStorageAdapter>("IBlobStorageAdapter");
}

export function setBlobStorage(adapter: IBlobStorageAdapter): void {
  instances.set("IBlobStorageAdapter", adapter);
}

export function resetBlobStorage(): void {
  instances.delete("IBlobStorageAdapter");
}

// ─── New Epic 3 typed accessors ──────────────────────────────────────────

export function getVehicleLookup(): IVehicleLookupAdapter {
  return resolveAdapter<IVehicleLookupAdapter>("IVehicleLookupAdapter");
}

export function getEmission(): IEmissionAdapter {
  return resolveAdapter<IEmissionAdapter>("IEmissionAdapter");
}

export function getRecall(): IRecallAdapter {
  return resolveAdapter<IRecallAdapter>("IRecallAdapter");
}

export function getCritAir(): ICritAirCalculator {
  return resolveAdapter<ICritAirCalculator>("ICritAirCalculator");
}

export function getVINTechnical(): IVINTechnicalAdapter {
  return resolveAdapter<IVINTechnicalAdapter>("IVINTechnicalAdapter");
}

export function getHistory(): IHistoryAdapter {
  return resolveAdapter<IHistoryAdapter>("IHistoryAdapter");
}

export function getValuation(): IValuationAdapter {
  return resolveAdapter<IValuationAdapter>("IValuationAdapter");
}

export function getPayment(): IPaymentAdapter {
  return resolveAdapter<IPaymentAdapter>("IPaymentAdapter");
}
