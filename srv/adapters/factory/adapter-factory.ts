import type { IIdentityProviderAdapter } from "../interfaces/identity-provider.interface";
import type { IBlobStorageAdapter } from "../interfaces/blob-storage.interface";
import { AzureAdB2cAdapter } from "../azure-ad-b2c-adapter";
import { AzureBlobStorageAdapter } from "../azure-blob-storage-adapter";
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
  "azure.adb2c": () => new AzureAdB2cAdapter(),
  "azure.blob": () => new AzureBlobStorageAdapter(),
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
        );
      }
    }
  }

  return wrapped as T;
}

/**
 * Get or create an adapter instance for the given interface name.
 * Resolves the active provider from configCache and instantiates the correct adapter.
 * All adapter method calls are automatically logged to ApiCallLog.
 */
function resolveAdapter<T>(interfaceName: string): T {
  const cached = instances.get(interfaceName);
  if (cached) return cached as T;

  const provider = getActiveProvider(interfaceName);
  if (!provider) {
    throw new Error(
      `No active provider found for adapter interface '${interfaceName}'. ` +
        `Check ConfigApiProvider table for an entry with status='active'.`,
    );
  }

  const factory = ADAPTER_REGISTRY[provider.key];
  if (!factory) {
    throw new Error(
      `No adapter implementation registered for provider key '${provider.key}'. ` +
        `Register it in ADAPTER_REGISTRY.`,
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

// ─── Typed accessor functions (backward-compatible) ──────────────────────

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
