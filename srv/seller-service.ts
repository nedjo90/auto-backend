import cds from "@sap/cds";
import type {
  VehicleLookupResponse,
  EmissionResponse,
  RecallResponse,
  CritAirResponse,
  VINTechnicalResponse,
  HistoryResponse,
} from "@auto/shared";
import type {
  CertifiedFieldResult,
  ApiSourceStatus,
  ApiSourceStatusState,
  AdapterErrorType,
} from "@auto/shared";
import {
  getVehicleLookup,
  getEmission,
  getRecall,
  getCritAir,
  getVINTechnical,
  getHistory,
} from "./adapters/factory/adapter-factory";
import {
  markFieldCertified,
  getCertifiedFields,
  overrideCertifiedField,
} from "./lib/certification";
import { getCachedResponse, getCachedResponseWithStatus, setCachedResponse } from "./lib/api-cache";
import { withResilience, classifyError } from "./lib/adapter-resilience";
import { logAudit } from "./lib/audit-logger";
import { auditLog } from "./middleware/audit-trail";
import { calculateVisibilityScore } from "./lib/visibility-score";
import type { VisibilityScoreInput } from "@auto/shared";
import {
  validateMimeType,
  validateFileSize,
  canUploadPhoto,
  uploadPhotoBlob,
  deletePhotoBlob,
  deleteAllPhotosForListing,
  getNextSortOrder,
  getMaxPhotos,
} from "./lib/photo-storage";
import { signalrClient, SIGNALR_HUBS } from "./lib/signalr-client";
import { notifyPriceChange } from "./lib/favorite-notifications";
import { recordPriceChange } from "./handlers/market-watch-handler";
import type { VisibilityScoreResult } from "@auto/shared";
import {
  validateListingField,
  CERTIFIABLE_FIELDS,
  LISTING_FIELDS,
  PHOTO_ALLOWED_MIME_TYPES,
  calculateCompletionPercentage,
} from "@auto/shared";
import {
  handleGetPublishableListings,
  handleCalculateBatchTotal,
  handleCreateCheckoutSession,
  handleGetPaymentSessionStatus,
} from "./handlers/payment-handler";
import {
  handleMarkAsSold,
  handleArchiveListing,
  handleGetSellerListings,
  handleGetListingHistory,
} from "./handlers/lifecycle-handler";
import { handleCheckResyncAvailability, handleResyncListing } from "./handlers/resync-handler";
import {
  handleGetAggregateKPIs,
  handleGetListingPerformance,
  handleGetMetricDrilldown,
} from "./handlers/seller-kpi-handler";
import {
  handleAddToMarketWatch,
  handleRemoveFromMarketWatch,
  handleGetMarketWatchList,
  handleCheckMarketWatches,
} from "./handlers/market-watch-handler";

const LOG = cds.log("seller");

const PLATE_REGEX = /^[A-Z]{2}-[0-9]{3}-[A-Z]{2}$/;
const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

/**
 * Auto-fill adapter interfaces relevant for vehicle lookup.
 * Each entry maps an adapter interface to the function that calls it,
 * and the function that extracts certified fields from the response.
 */
interface AdapterCallConfig {
  interfaceName: string;
  call: (
    identifier: string,
    identifierType: string,
    vehicleData?: VehicleLookupResponse,
  ) => Promise<unknown>;
  extractFields: (response: unknown, source: string) => CertifiedFieldResult[];
}

function extractVehicleLookupFields(response: unknown, source: string): CertifiedFieldResult[] {
  const data = response as VehicleLookupResponse;
  const now = new Date().toISOString();
  const fields: CertifiedFieldResult[] = [];

  const fieldMap: Record<string, string | number | null | undefined> = {
    plate: data.plate,
    vin: data.vin,
    make: data.make,
    model: data.model,
    variant: data.variant,
    year: data.year,
    registrationDate: data.registrationDate,
    fuelType: data.fuelType,
    engineCapacityCc: data.engineCapacityCc,
    powerKw: data.powerKw,
    powerHp: data.powerHp,
    gearbox: data.gearbox,
    bodyType: data.bodyType,
    doors: data.doors,
    seats: data.seats,
    color: data.color,
    co2GKm: data.co2GKm,
    euroNorm: data.euroNorm,
  };

  for (const [fieldName, value] of Object.entries(fieldMap)) {
    if (value != null && value !== "") {
      fields.push({
        fieldName,
        fieldValue: String(value),
        source,
        sourceTimestamp: now,
        isCertified: true,
      });
    }
  }

  return fields;
}

function extractEmissionFields(response: unknown, source: string): CertifiedFieldResult[] {
  const data = response as EmissionResponse;
  const now = new Date().toISOString();
  const fields: CertifiedFieldResult[] = [];

  if (data.co2GKm != null)
    fields.push({
      fieldName: "co2GKm",
      fieldValue: String(data.co2GKm),
      source,
      sourceTimestamp: now,
      isCertified: true,
    });
  if (data.energyClass)
    fields.push({
      fieldName: "energyClass",
      fieldValue: data.energyClass,
      source,
      sourceTimestamp: now,
      isCertified: true,
    });
  if (data.euroNorm)
    fields.push({
      fieldName: "euroNorm",
      fieldValue: data.euroNorm,
      source,
      sourceTimestamp: now,
      isCertified: true,
    });

  return fields;
}

function extractRecallFields(response: unknown, source: string): CertifiedFieldResult[] {
  const data = response as RecallResponse;
  const now = new Date().toISOString();
  const fields: CertifiedFieldResult[] = [];

  if (data.totalCount != null) {
    fields.push({
      fieldName: "recallCount",
      fieldValue: String(data.totalCount),
      source,
      sourceTimestamp: now,
      isCertified: true,
    });
  }

  return fields;
}

function extractCritAirFields(response: unknown, source: string): CertifiedFieldResult[] {
  const data = response as CritAirResponse;
  const now = new Date().toISOString();
  const fields: CertifiedFieldResult[] = [];

  const fieldMap: Record<string, string | null | undefined> = {
    critAirLevel: data.level,
    critAirLabel: data.label,
    critAirColor: data.color,
  };

  for (const [fieldName, value] of Object.entries(fieldMap)) {
    if (value != null && value !== "") {
      fields.push({
        fieldName,
        fieldValue: value,
        source,
        sourceTimestamp: now,
        isCertified: true,
      });
    }
  }

  return fields;
}

function extractVINTechnicalFields(response: unknown, source: string): CertifiedFieldResult[] {
  const data = response as VINTechnicalResponse;
  const now = new Date().toISOString();
  const fields: CertifiedFieldResult[] = [];

  const fieldMap: Record<string, string | number | null | undefined> = {
    bodyClass: data.bodyClass,
    engineCylinders: data.engineCylinders,
    manufacturer: data.manufacturer,
    vehicleType: data.vehicleType,
    plantCountry: data.plantCountry,
  };

  for (const [fieldName, value] of Object.entries(fieldMap)) {
    if (value != null && value !== "") {
      fields.push({
        fieldName,
        fieldValue: String(value),
        source,
        sourceTimestamp: now,
        isCertified: true,
      });
    }
  }

  return fields;
}

function buildAdapterCalls(identifier: string, identifierType: string): AdapterCallConfig[] {
  return [
    {
      interfaceName: "IVehicleLookupAdapter",
      call: async () => {
        const adapter = getVehicleLookup();
        const request = identifierType === "plate" ? { plate: identifier } : { vin: identifier };
        return adapter.lookup(request);
      },
      extractFields: extractVehicleLookupFields,
    },
    {
      interfaceName: "IEmissionAdapter",
      call: async (_id, _type, vehicleData) => {
        const adapter = getEmission();
        return adapter.getEmissions({
          vin: vehicleData?.vin,
          make: vehicleData?.make,
          model: vehicleData?.model,
          year: vehicleData?.year,
          fuelType: vehicleData?.fuelType,
          engineCapacityCc: vehicleData?.engineCapacityCc ?? undefined,
        });
      },
      extractFields: extractEmissionFields,
    },
    {
      interfaceName: "IRecallAdapter",
      call: async (_id, _type, vehicleData) => {
        const adapter = getRecall();
        return adapter.getRecalls({
          make: vehicleData?.make || "Unknown",
          model: vehicleData?.model || "Unknown",
          vin: vehicleData?.vin,
        });
      },
      extractFields: extractRecallFields,
    },
    {
      interfaceName: "ICritAirCalculator",
      call: async (_id, _type, vehicleData) => {
        const adapter = getCritAir();
        return adapter.calculate({
          fuelType: vehicleData?.fuelType || "essence",
          euroNorm: vehicleData?.euroNorm || "Euro 6",
          registrationDate: vehicleData?.registrationDate || "2020-01-01",
        });
      },
      extractFields: extractCritAirFields,
    },
    {
      interfaceName: "IVINTechnicalAdapter",
      call: async (id, idType, vehicleData) => {
        const vin = idType === "vin" ? id : vehicleData?.vin;
        if (!vin) return null;
        const adapter = getVINTechnical();
        return adapter.decode({ vin });
      },
      extractFields: extractVINTechnicalFields,
    },
  ];
}

/**
 * Broadcast score update to the seller via SignalR live-score hub.
 * Non-blocking — errors are logged but don't fail the request.
 */
async function broadcastScoreUpdate(userId: string, result: VisibilityScoreResult): Promise<void> {
  try {
    await signalrClient.sendToUser(SIGNALR_HUBS.liveScore, userId, "scoreUpdate", {
      score: result.score,
      label: result.label,
      suggestions: result.suggestions,
      normalizedScore: result.normalizedScore ?? null,
      normalizationMessage: result.normalizationMessage ?? null,
    });
  } catch (err) {
    LOG.warn("Failed to broadcast score update via SignalR:", err);
  }
}

export default class SellerServiceHandler extends cds.ApplicationService {
  async init() {
    this.on("autoFillByPlate", this.handleAutoFill);
    this.on("saveDraft", this.handleSaveDraft);
    this.on("loadDraft", this.handleLoadDraft);
    this.on("duplicateDraft", this.handleDuplicateDraft);
    this.on("deleteDraft", this.handleDeleteDraft);
    this.on("recalculateScore", this.handleRecalculateScore);
    this.on("updateListingField", this.handleUpdateListingField);
    this.on("uploadPhoto", this.handleUploadPhoto);
    this.on("reorderPhotos", this.handleReorderPhotos);
    this.on("deletePhoto", this.handleDeletePhoto);
    this.on("getDeclarationTemplate", this.handleGetDeclarationTemplate);
    this.on("submitDeclaration", this.handleSubmitDeclaration);
    this.on("getDeclarationSummary", this.handleGetDeclarationSummary);
    this.on("fetchHistoryReport", this.handleFetchHistoryReport);
    this.on("getPublishableListings", handleGetPublishableListings);
    this.on("calculateBatchTotal", handleCalculateBatchTotal);
    this.on("createCheckoutSession", handleCreateCheckoutSession);
    this.on("getPaymentSessionStatus", handleGetPaymentSessionStatus);
    this.on("markAsSold", handleMarkAsSold);
    this.on("archiveListing", handleArchiveListing);
    this.on("getSellerListings", handleGetSellerListings);
    this.on("getListingHistory", handleGetListingHistory);
    this.on("checkResyncAvailability", handleCheckResyncAvailability);
    this.on("resyncListing", handleResyncListing);
    this.on("getAggregateKPIs", handleGetAggregateKPIs);
    this.on("getListingPerformance", handleGetListingPerformance);
    this.on("getMetricDrilldown", handleGetMetricDrilldown);
    this.on("addToMarketWatch", handleAddToMarketWatch);
    this.on("removeFromMarketWatch", handleRemoveFromMarketWatch);
    this.on("getMarketWatchList", handleGetMarketWatchList);
    this.on("checkMarketWatches", handleCheckMarketWatches);
    this.before("UPDATE", "Declarations", this.rejectDeclarationUpdate);
    this.before("DELETE", "Declarations", this.rejectDeclarationDelete);
    await super.init();
  }

  private handleAutoFill = async (req: cds.Request) => {
    const { identifier, identifierType } = req.data as {
      identifier: string;
      identifierType: string;
    };

    // Normalize to uppercase (plates and VINs are case-insensitive)
    const normalizedIdentifier = identifier.toUpperCase();

    // Validate identifier format
    if (identifierType === "plate") {
      if (!PLATE_REGEX.test(normalizedIdentifier)) {
        req.error(400, "Invalid plate format. Expected: XX-NNN-XX (e.g., AB-123-CD)");
        return;
      }
    } else if (identifierType === "vin") {
      if (!VIN_REGEX.test(normalizedIdentifier)) {
        req.error(400, "Invalid VIN format. Expected: 17 alphanumeric characters (no I, O, Q)");
        return;
      }
    } else {
      req.error(400, "Invalid identifierType. Must be 'plate' or 'vin'");
      return;
    }

    const adapterCalls = buildAdapterCalls(normalizedIdentifier, identifierType);
    const allFields: CertifiedFieldResult[] = [];
    const allSources: ApiSourceStatus[] = [];

    // Step 1: Call VehicleLookup first (others depend on its data)
    const vehicleLookupConfig = adapterCalls[0];
    let vehicleData: VehicleLookupResponse | undefined;

    const vehicleSource: ApiSourceStatus = {
      adapterInterface: vehicleLookupConfig.interfaceName,
      providerKey: "",
      status: "pending" as ApiSourceStatusState,
    };

    const startTime = Date.now();

    try {
      // Check cache first
      const cached = await getCachedResponse<VehicleLookupResponse>(
        normalizedIdentifier,
        identifierType,
        vehicleLookupConfig.interfaceName,
      );

      if (cached) {
        vehicleData = cached;
        vehicleSource.status = "cached";
        vehicleSource.providerKey = "cache";
        vehicleSource.cacheStatus = "cached";
        const fields = vehicleLookupConfig.extractFields(cached, "cache (SIV)");
        allFields.push(...fields);
      } else {
        const response = await withResilience(vehicleLookupConfig.interfaceName, "auto", () =>
          vehicleLookupConfig.call(normalizedIdentifier, identifierType),
        );
        vehicleData = response as VehicleLookupResponse;
        vehicleSource.status = "success";
        vehicleSource.providerKey = vehicleData?.provider?.providerName || "unknown";
        vehicleSource.responseTimeMs = Date.now() - startTime;

        const sourceName = vehicleData?.provider?.providerName || "SIV";
        const fields = vehicleLookupConfig.extractFields(response, sourceName);
        allFields.push(...fields);

        // Cache the response
        await setCachedResponse(
          normalizedIdentifier,
          identifierType,
          vehicleLookupConfig.interfaceName,
          response,
        );
      }
    } catch (err) {
      vehicleSource.status = "failed";
      vehicleSource.errorMessage = err instanceof Error ? err.message : String(err);
      vehicleSource.errorType = classifyError(err) as AdapterErrorType;
      vehicleSource.responseTimeMs = Date.now() - startTime;
      LOG.error("VehicleLookup failed:", err);

      // Cache fallback: try to serve stale data
      try {
        const fallback = await getCachedResponseWithStatus<VehicleLookupResponse>(
          normalizedIdentifier,
          identifierType,
          vehicleLookupConfig.interfaceName,
        );
        if (fallback) {
          vehicleData = fallback.data;
          vehicleSource.status = "cached";
          vehicleSource.cacheStatus = fallback.status;
          vehicleSource.cachedAt = fallback.fetchedAt;
          vehicleSource.errorMessage = undefined;
          vehicleSource.errorType = undefined;
          const fields = vehicleLookupConfig.extractFields(fallback.data, `cache (SIV)`);
          allFields.push(...fields);
          LOG.info(
            `VehicleLookup served from ${fallback.status} cache for ${normalizedIdentifier}`,
          );
        }
      } catch (cacheErr) {
        LOG.warn("Cache fallback failed for VehicleLookup:", cacheErr);
      }
    }

    allSources.push(vehicleSource);

    // Step 2: Call remaining adapters in parallel using Promise.allSettled
    const remainingCalls = adapterCalls.slice(1);
    const results = await Promise.allSettled(
      remainingCalls.map(async (config) => {
        const source: ApiSourceStatus = {
          adapterInterface: config.interfaceName,
          providerKey: "",
          status: "pending" as ApiSourceStatusState,
        };

        const callStart = Date.now();

        try {
          // Check cache first
          const cached = await getCachedResponse(
            normalizedIdentifier,
            identifierType,
            config.interfaceName,
          );

          if (cached) {
            source.status = "cached";
            source.providerKey = "cache";
            source.cacheStatus = "cached";
            const fields = config.extractFields(cached, `cache (${config.interfaceName})`);
            return { source, fields };
          }

          const response = await withResilience(config.interfaceName, "auto", () =>
            config.call(normalizedIdentifier, identifierType, vehicleData),
          );
          if (response === null) {
            source.status = "failed";
            source.errorMessage = "Insufficient data (no VIN available)";
            source.responseTimeMs = Date.now() - callStart;
            return { source, fields: [] };
          }

          source.status = "success";
          const provider = (response as { provider?: { providerName?: string } })?.provider;
          source.providerKey = provider?.providerName || "unknown";
          source.responseTimeMs = Date.now() - callStart;

          const sourceName = provider?.providerName || config.interfaceName;
          const fields = config.extractFields(response, sourceName);

          // Cache the response
          await setCachedResponse(
            normalizedIdentifier,
            identifierType,
            config.interfaceName,
            response,
          );

          return { source, fields };
        } catch (err) {
          source.status = "failed";
          source.errorMessage = err instanceof Error ? err.message : String(err);
          source.errorType = classifyError(err) as AdapterErrorType;
          source.responseTimeMs = Date.now() - callStart;

          // Cache fallback: try to serve stale/cached data
          try {
            const fallback = await getCachedResponseWithStatus(
              normalizedIdentifier,
              identifierType,
              config.interfaceName,
            );
            if (fallback) {
              source.status = "cached";
              source.cacheStatus = fallback.status;
              source.cachedAt = fallback.fetchedAt;
              source.errorMessage = undefined;
              source.errorType = undefined;
              const fields = config.extractFields(fallback.data, `cache (${config.interfaceName})`);
              LOG.info(
                `${config.interfaceName} served from ${fallback.status} cache for ${normalizedIdentifier}`,
              );
              return { source, fields };
            }
          } catch (cacheErr) {
            LOG.warn(`Cache fallback failed for ${config.interfaceName}:`, cacheErr);
          }

          return { source, fields: [] };
        }
      }),
    );

    // Collect results from parallel calls
    for (const result of results) {
      if (result.status === "fulfilled") {
        allSources.push(result.value.source);
        allFields.push(...result.value.fields);
      }
    }

    // NOTE: CertifiedField records are created when the listing is persisted (Story 3-3),
    // not during the auto-fill lookup. The fields data is returned in the response JSON.

    // Audit log
    try {
      await logAudit({
        userId: (req.user as { id?: string })?.id || "unknown",
        action: "listing.autofill",
        resource: "Vehicle",
        details: JSON.stringify({
          identifierType,
          fieldsCount: allFields.length,
          sourcesCount: allSources.length,
          successCount: allSources.filter((s) => s.status === "success" || s.status === "cached")
            .length,
        }),
      });
    } catch (err) {
      LOG.warn("Failed to log audit for auto-fill:", err);
    }

    return {
      fields: JSON.stringify(allFields),
      sources: JSON.stringify(allSources),
    };
  };

  // ─── Draft Management Handlers (Story 3-6) ──────────────────────────────

  private handleSaveDraft = async (req: cds.Request) => {
    const {
      listingId: inputListingId,
      fields: fieldsJson,
      certifiedFields: certFieldsJson,
    } = req.data as {
      listingId: string | null;
      fields: string;
      certifiedFields: string | null;
    };

    const userId = (req.user as { id?: string })?.id;
    if (!userId) {
      return req.error(401, "Authentication required");
    }

    // Parse fields JSON
    let fieldData: Record<string, unknown>;
    try {
      fieldData = JSON.parse(fieldsJson);
    } catch {
      return req.error(400, "Invalid fields JSON");
    }

    // Whitelist: only allow known listing field names
    const validFieldNames = new Set(LISTING_FIELDS.map((f) => f.fieldName));
    const sanitizedFields: Record<string, unknown> = {};
    const numericFields = [
      "price",
      "mileage",
      "year",
      "engineCapacityCc",
      "powerKw",
      "powerHp",
      "doors",
      "seats",
      "co2GKm",
      "numberOfDoors",
      "engineCylinders",
      "recallCount",
    ];

    for (const [key, val] of Object.entries(fieldData)) {
      if (!validFieldNames.has(key)) continue;
      if (val === "" || val == null) {
        sanitizedFields[key] = null;
      } else if (numericFields.includes(key)) {
        sanitizedFields[key] = Number(val);
      } else {
        sanitizedFields[key] = val;
      }
    }

    const entities = cds.entities("auto");
    const Listing = entities["Listing"];
    const ListingPhoto = entities["ListingPhoto"];

    let finalListingId: string;

    if (inputListingId) {
      // Update existing draft
      const listing = await cds.run(SELECT.one.from(Listing).where({ ID: inputListingId }));
      if (!listing) {
        return req.error(404, "Listing not found");
      }
      if (listing.sellerId !== userId) {
        return req.error(403, "Not authorized to update this listing");
      }

      await cds.run(UPDATE(Listing).set(sanitizedFields).where({ ID: inputListingId }));
      finalListingId = inputListingId;
    } else {
      // Create new draft
      finalListingId = cds.utils.uuid();
      await cds.run(
        INSERT.into(Listing).entries({
          ID: finalListingId,
          sellerId: userId,
          status: "draft",
          ...sanitizedFields,
        }),
      );
    }

    // Persist certified fields if provided
    if (certFieldsJson) {
      let certFields: Array<{
        fieldName: string;
        fieldValue: string;
        source: string;
        sourceTimestamp?: string;
        isCertified?: boolean;
      }>;
      try {
        certFields = JSON.parse(certFieldsJson);
      } catch {
        certFields = [];
      }

      for (const cf of certFields) {
        if (cf.fieldName && cf.fieldValue && cf.source) {
          try {
            await markFieldCertified(finalListingId, cf.fieldName, cf.fieldValue, cf.source);
          } catch (err) {
            LOG.warn(`Failed to persist certified field ${cf.fieldName}:`, err);
          }
        }
      }
    }

    // Re-fetch listing to calculate scores with persisted data
    const savedListing = await cds.run(SELECT.one.from(Listing).where({ ID: finalListingId }));
    const photos = await cds.run(SELECT.from(ListingPhoto).where({ listingId: finalListingId }));

    // Calculate visibility score
    const scoreInput: VisibilityScoreInput = {
      listing: savedListing,
      photoCount: photos.length,
      hasHistoryReport: false,
    };
    const scoreResult = calculateVisibilityScore(scoreInput);

    // Calculate completion percentage
    const completionPercentage = calculateCompletionPercentage(savedListing, photos.length);

    // Persist calculated values
    await cds.run(
      UPDATE(Listing)
        .set({
          visibilityScore: scoreResult.score,
          visibilityLabel: scoreResult.label,
          completionPercentage,
        })
        .where({ ID: finalListingId }),
    );

    // Broadcast score update
    await broadcastScoreUpdate(userId, scoreResult);

    // Audit log
    try {
      await logAudit({
        userId,
        action: inputListingId ? "listing.draft.update" : "listing.draft.create",
        resource: "Listing",
        details: JSON.stringify({
          listingId: finalListingId,
          fieldCount: Object.keys(sanitizedFields).length,
          completionPercentage,
        }),
      });
    } catch {
      LOG.warn("Failed to log audit for saveDraft");
    }

    LOG.info(
      `Draft ${inputListingId ? "updated" : "created"}: ${finalListingId} (${completionPercentage}% complete)`,
    );

    return {
      listingId: finalListingId,
      success: true,
      completionPercentage,
      visibilityScore: scoreResult.score,
      visibilityLabel: scoreResult.label,
    };
  };

  private handleLoadDraft = async (req: cds.Request) => {
    const { listingId } = req.data as { listingId: string };

    const userId = (req.user as { id?: string })?.id;
    if (!userId) {
      return req.error(401, "Authentication required");
    }

    const entities = cds.entities("auto");
    const Listing = entities["Listing"];
    const CertifiedField = entities["CertifiedField"];
    const ListingPhoto = entities["ListingPhoto"];

    // Load listing
    const listing = await cds.run(SELECT.one.from(Listing).where({ ID: listingId }));
    if (!listing) {
      return req.error(404, "Listing not found");
    }
    if (listing.sellerId !== userId) {
      return req.error(403, "Not authorized to access this listing");
    }

    // Load certified fields
    const certifiedFields = await cds.run(SELECT.from(CertifiedField).where({ listingId }));

    // Load photos ordered by sortOrder
    const photos = await cds.run(
      SELECT.from(ListingPhoto).where({ listingId }).orderBy("sortOrder asc"),
    );

    return {
      listing: JSON.stringify(listing),
      certifiedFields: JSON.stringify(certifiedFields || []),
      photos: JSON.stringify(photos || []),
    };
  };

  private handleDuplicateDraft = async (req: cds.Request) => {
    const { listingId } = req.data as { listingId: string };

    const userId = (req.user as { id?: string })?.id;
    if (!userId) {
      return req.error(401, "Authentication required");
    }

    const entities = cds.entities("auto");
    const Listing = entities["Listing"];
    const ListingPhoto = entities["ListingPhoto"];

    // Load source listing
    const source = await cds.run(SELECT.one.from(Listing).where({ ID: listingId }));
    if (!source) {
      return req.error(404, "Listing not found");
    }
    if (source.sellerId !== userId) {
      return req.error(403, "Not authorized to duplicate this listing");
    }

    // Build new listing data: copy declared fields only, NOT certified fields
    const validFieldNames = new Set(LISTING_FIELDS.map((f) => f.fieldName));
    const newListingData: Record<string, unknown> = {};
    for (const fieldName of validFieldNames) {
      if (source[fieldName] != null) {
        newListingData[fieldName] = source[fieldName];
      }
    }

    const newId = cds.utils.uuid();
    await cds.run(
      INSERT.into(Listing).entries({
        ID: newId,
        sellerId: userId,
        status: "draft",
        visibilityScore: 0,
        visibilityLabel: "Partiellement documenté",
        completionPercentage: 0,
        ...newListingData,
      }),
    );

    // Duplicate photos (copy DB records with new IDs, same blob URLs)
    const sourcePhotos = await cds.run(
      SELECT.from(ListingPhoto).where({ listingId }).orderBy("sortOrder asc"),
    );
    for (const photo of sourcePhotos) {
      const newPhotoId = cds.utils.uuid();
      await cds.run(
        INSERT.into(ListingPhoto).entries({
          ID: newPhotoId,
          listingId: newId,
          blobUrl: photo.blobUrl,
          cdnUrl: photo.cdnUrl,
          sortOrder: photo.sortOrder,
          isPrimary: photo.isPrimary,
          fileSize: photo.fileSize,
          mimeType: photo.mimeType,
          width: photo.width,
          height: photo.height,
          uploadedAt: photo.uploadedAt,
        }),
      );
    }

    // Recalculate scores for the new listing
    const newListing = await cds.run(SELECT.one.from(Listing).where({ ID: newId }));
    const newPhotos = await cds.run(SELECT.from(ListingPhoto).where({ listingId: newId }));
    const scoreInput: VisibilityScoreInput = {
      listing: newListing,
      photoCount: newPhotos.length,
      hasHistoryReport: false,
    };
    const scoreResult = calculateVisibilityScore(scoreInput);
    const completionPct = calculateCompletionPercentage(newListing, newPhotos.length);

    await cds.run(
      UPDATE(Listing)
        .set({
          visibilityScore: scoreResult.score,
          visibilityLabel: scoreResult.label,
          completionPercentage: completionPct,
        })
        .where({ ID: newId }),
    );

    // Audit log
    try {
      await logAudit({
        userId,
        action: "listing.draft.duplicate",
        resource: "Listing",
        details: JSON.stringify({
          sourceListingId: listingId,
          newListingId: newId,
          photosCount: sourcePhotos.length,
        }),
      });
    } catch {
      LOG.warn("Failed to log audit for duplicateDraft");
    }

    LOG.info(`Draft duplicated: ${listingId} → ${newId} (${sourcePhotos.length} photos copied)`);

    return { listingId: newId, success: true };
  };

  private handleDeleteDraft = async (req: cds.Request) => {
    const { listingId } = req.data as { listingId: string };

    const userId = (req.user as { id?: string })?.id;
    if (!userId) {
      return req.error(401, "Authentication required");
    }

    const entities = cds.entities("auto");
    const Listing = entities["Listing"];
    const CertifiedField = entities["CertifiedField"];

    // Load listing
    const listing = await cds.run(SELECT.one.from(Listing).where({ ID: listingId }));
    if (!listing) {
      return req.error(404, "Listing not found");
    }
    if (listing.sellerId !== userId) {
      return req.error(403, "Not authorized to delete this listing");
    }
    if (listing.status !== "draft") {
      return req.error(400, "Only draft listings can be deleted via this action");
    }

    // Delete photos from blob storage and DB
    await deleteAllPhotosForListing(listingId);

    // Delete certified fields
    await cds.run(DELETE.from(CertifiedField).where({ listingId }));

    // Delete the listing itself
    await cds.run(DELETE.from(Listing).where({ ID: listingId }));

    // Audit log
    try {
      await logAudit({
        userId,
        action: "listing.draft.delete",
        resource: "Listing",
        details: JSON.stringify({ listingId }),
      });
    } catch {
      LOG.warn("Failed to log audit for deleteDraft");
    }

    LOG.info(`Draft deleted: ${listingId}`);

    return { success: true, message: "Draft deleted" };
  };

  private handleRecalculateScore = async (req: cds.Request) => {
    const { listingId } = req.data as { listingId: string };

    const entities = cds.entities("auto");
    const Listing = entities["Listing"];
    const ListingPhoto = entities["ListingPhoto"];

    // Load listing with all data
    const listing = await cds.run(SELECT.one.from(Listing).where({ ID: listingId }));
    if (!listing) {
      return req.error(404, "Listing not found");
    }

    // Verify ownership
    const userId = (req.user as { id?: string })?.id;
    if (!userId || listing.sellerId !== userId) {
      return req.error(403, "Not authorized to access this listing");
    }

    // Count photos
    const photos = await cds.run(SELECT.from(ListingPhoto).where({ listingId }));

    const scoreInput: VisibilityScoreInput = {
      listing,
      photoCount: photos.length,
      hasHistoryReport: false, // Story 3-8 will integrate history report
    };
    const result = calculateVisibilityScore(scoreInput);

    // Persist score and label
    await cds.run(
      UPDATE(Listing)
        .set({ visibilityScore: result.score, visibilityLabel: result.label })
        .where({ ID: listingId }),
    );

    // Broadcast score update to seller via SignalR
    await broadcastScoreUpdate(userId, result);

    return {
      score: result.score,
      label: result.label,
      suggestions: JSON.stringify(result.suggestions),
      normalizedScore: result.normalizedScore ?? null,
      normalizationMessage: result.normalizationMessage ?? null,
    };
  };

  private handleUpdateListingField = async (req: cds.Request) => {
    const { listingId, fieldName, value } = req.data as {
      listingId: string;
      fieldName: string;
      value: string;
    };

    // Whitelist fieldName against valid listing fields to prevent injection
    const validFieldNames = LISTING_FIELDS.map((f) => f.fieldName);
    if (!validFieldNames.includes(fieldName)) {
      req.error(400, `Invalid field name: ${fieldName}`);
      return;
    }

    const entities = cds.entities("auto");
    const Listing = entities["Listing"];

    // Validate field value
    const validationError = validateListingField(fieldName, value);
    if (validationError) {
      return req.error(400, validationError);
    }

    // Get the listing
    const listing = await cds.run(SELECT.one.from(Listing).where({ ID: listingId }));
    if (!listing) {
      return req.error(404, "Listing not found");
    }

    // Verify ownership
    const userId = (req.user as { id?: string })?.id;
    if (!userId || listing.sellerId !== userId) {
      return req.error(403, "Not authorized to update this listing");
    }

    let previousCertifiedValue: string | undefined;
    let status: string = "declared";

    // Check if this field is certifiable and currently certified
    if (CERTIFIABLE_FIELDS.includes(fieldName)) {
      const certifiedFields = await getCertifiedFields(listingId);
      const certField = certifiedFields.find((f) => f.fieldName === fieldName && f.isCertified);

      if (certField) {
        // Override the certified field
        const sellerId = (req.user as { id?: string })?.id || "unknown";
        const overrideResult = await overrideCertifiedField(listingId, fieldName, value, sellerId);
        previousCertifiedValue = overrideResult.previousValue;
        status = "declared";
      }
    }

    // Determine CDS field value based on type
    const updateData: Record<string, unknown> = {};
    const numericFields = [
      "price",
      "mileage",
      "year",
      "engineCapacityCc",
      "powerKw",
      "powerHp",
      "doors",
      "seats",
      "co2GKm",
      "numberOfDoors",
      "engineCylinders",
      "recallCount",
    ];

    if (numericFields.includes(fieldName)) {
      updateData[fieldName] = value === "" ? null : Number(value);
    } else {
      updateData[fieldName] = value === "" ? null : value;
    }

    // Update the listing field
    await cds.run(UPDATE(Listing).set(updateData).where({ ID: listingId }));

    // Notify favoriting users on price change for published listings (Story 4-4)
    if (fieldName === "price" && listing.status === "published" && listing.price != null) {
      const newPrice = Number(value);
      if (!isNaN(newPrice) && newPrice !== Number(listing.price)) {
        notifyPriceChange(
          listingId,
          listing.make,
          listing.model,
          Number(listing.price),
          newPrice,
        ).catch((err: unknown) => LOG.warn("Failed to send price change notifications:", err));
        // Record price history and notify market watchers (Story 6-3)
        recordPriceChange(listingId, newPrice, Number(listing.price)).catch((err: unknown) =>
          LOG.warn("Failed to record price change:", err),
        );
      }
    }

    // Recalculate visibility score.
    // NOTE: We intentionally re-SELECT the full listing here rather than merging
    // the update into the score calculation. The visibility score depends on ALL
    // current field values, so a fresh read ensures correctness even if concurrent
    // updates occurred. The extra DB round-trip is acceptable for data integrity.
    const updatedListing = await cds.run(SELECT.one.from(Listing).where({ ID: listingId }));
    const ListingPhoto = entities["ListingPhoto"];
    const photos = await cds.run(SELECT.from(ListingPhoto).where({ listingId }));
    const scoreInput: VisibilityScoreInput = {
      listing: updatedListing,
      photoCount: photos.length,
      hasHistoryReport: false, // Story 3-8 will integrate history report
    };
    const scoreResult = calculateVisibilityScore(scoreInput);

    // Update score and label
    await cds.run(
      UPDATE(Listing)
        .set({ visibilityScore: scoreResult.score, visibilityLabel: scoreResult.label })
        .where({ ID: listingId }),
    );

    // Broadcast score update to seller via SignalR
    await broadcastScoreUpdate(userId!, scoreResult);

    // Determine final status
    if (value === "") {
      status = "empty";
    }

    return {
      fieldName,
      value,
      status,
      visibilityScore: scoreResult.score,
      visibilityLabel: scoreResult.label,
      suggestions: JSON.stringify(scoreResult.suggestions),
      previousCertifiedValue: previousCertifiedValue || null,
    };
  };

  // ─── Photo Management Handlers (Story 3-4) ─────────────────────────────

  private handleUploadPhoto = async (req: cds.Request) => {
    const { listingId, content, mimeType, fileSize, width, height } = req.data as {
      listingId: string;
      content: Buffer;
      mimeType: string;
      fileSize: number;
      width?: number;
      height?: number;
    };

    const entities = cds.entities("auto");
    const Listing = entities["Listing"];
    const ListingPhoto = entities["ListingPhoto"];

    // Validate listing exists and ownership
    const listing = await cds.run(SELECT.one.from(Listing).where({ ID: listingId }));
    if (!listing) {
      return req.error(404, "Listing not found");
    }
    const userId = (req.user as { id?: string })?.id;
    if (!userId) {
      return req.error(401, "Authentication required");
    }
    if (listing.sellerId !== userId) {
      return req.error(403, "Not authorized to upload photos to this listing");
    }

    // Validate MIME type
    if (!validateMimeType(mimeType)) {
      return req.error(
        400,
        `Invalid file type: ${mimeType}. Allowed: ${PHOTO_ALLOWED_MIME_TYPES.join(", ")}`,
      );
    }

    // Validate file size
    if (!validateFileSize(fileSize)) {
      return req.error(400, "File size exceeds maximum allowed limit");
    }

    // Validate width/height if provided
    const safeWidth =
      width !== undefined && typeof width === "number" && width >= 1 && width <= 50000 ? width : 0;
    const safeHeight =
      height !== undefined && typeof height === "number" && height >= 1 && height <= 50000
        ? height
        : 0;

    // Check MAX_PHOTOS limit
    if (!(await canUploadPhoto(listingId))) {
      const max = getMaxPhotos();
      return req.error(400, `Maximum number of photos (${max}) reached for this listing`);
    }

    // Upload to blob storage
    const { blobUrl, cdnUrl } = await uploadPhotoBlob(
      listingId,
      Buffer.isBuffer(content) ? content : Buffer.from(content),
      mimeType,
    );

    // Determine sort order and primary status
    const sortOrder = await getNextSortOrder(listingId);
    const isPrimary = sortOrder === 0;

    // Create DB record — if INSERT fails, clean up the orphaned blob
    const photoId = cds.utils.uuid();
    try {
      await cds.run(
        INSERT.into(ListingPhoto).entries({
          ID: photoId,
          listingId,
          blobUrl,
          cdnUrl,
          sortOrder,
          isPrimary,
          fileSize,
          mimeType,
          width: safeWidth,
          height: safeHeight,
          uploadedAt: new Date().toISOString(),
        }),
      );
    } catch (err) {
      try {
        await deletePhotoBlob(blobUrl);
      } catch {
        LOG.warn(`Failed to clean up orphaned blob after INSERT failure: ${blobUrl}`);
      }
      throw err;
    }

    // Recalculate visibility score with updated photo count.
    // Re-fetch listing to ensure field data is current (concurrent updates may have occurred).
    const currentListing = await cds.run(SELECT.one.from(Listing).where({ ID: listingId }));
    const allPhotos = await cds.run(SELECT.from(ListingPhoto).where({ listingId }));
    const uploadScoreInput: VisibilityScoreInput = {
      listing: currentListing,
      photoCount: allPhotos.length,
      hasHistoryReport: false,
    };
    const uploadScoreResult = calculateVisibilityScore(uploadScoreInput);
    await cds.run(
      UPDATE(Listing)
        .set({
          visibilityScore: uploadScoreResult.score,
          visibilityLabel: uploadScoreResult.label,
        })
        .where({ ID: listingId }),
    );
    await broadcastScoreUpdate(userId, uploadScoreResult);

    // Audit log
    try {
      await logAudit({
        userId,
        action: "photo.upload",
        resource: "ListingPhoto",
        details: JSON.stringify({ photoId, listingId, mimeType, fileSize, sortOrder }),
      });
    } catch {
      LOG.warn("Failed to log audit for photo upload");
    }

    LOG.info(`Photo uploaded for listing ${listingId}: ${photoId} (order: ${sortOrder})`);

    return {
      ID: photoId,
      cdnUrl,
      sortOrder,
      isPrimary,
      fileSize,
      mimeType,
      width: safeWidth,
      height: safeHeight,
    };
  };

  private handleReorderPhotos = async (req: cds.Request) => {
    const { listingId, photoIds: photoIdsJson } = req.data as {
      listingId: string;
      photoIds: string;
    };

    const entities = cds.entities("auto");
    const Listing = entities["Listing"];
    const ListingPhoto = entities["ListingPhoto"];

    // Parse photo IDs
    let photoIds: string[];
    try {
      photoIds = JSON.parse(photoIdsJson);
      if (!Array.isArray(photoIds) || photoIds.length === 0) {
        return req.error(400, "photoIds must be a non-empty array of photo IDs");
      }
    } catch {
      return req.error(400, "Invalid photoIds format: must be a JSON array");
    }

    // Validate listing exists and ownership
    const listing = await cds.run(SELECT.one.from(Listing).where({ ID: listingId }));
    if (!listing) {
      return req.error(404, "Listing not found");
    }
    const userId = (req.user as { id?: string })?.id;
    if (!userId) {
      return req.error(401, "Authentication required");
    }
    if (listing.sellerId !== userId) {
      return req.error(403, "Not authorized to reorder photos of this listing");
    }

    // Verify all photo IDs belong to this listing and count matches
    const existingPhotos = await cds.run(SELECT.from(ListingPhoto).where({ listingId }));
    const existingIds = new Set(existingPhotos.map((p: { ID: string }) => p.ID));
    if (photoIds.length !== existingIds.size) {
      return req.error(
        400,
        `All photos must be included in reorder (expected ${existingIds.size}, got ${photoIds.length})`,
      );
    }
    for (const id of photoIds) {
      if (!existingIds.has(id)) {
        return req.error(400, `Photo ${id} does not belong to listing ${listingId}`);
      }
    }

    // Update sort order for each photo
    for (let i = 0; i < photoIds.length; i++) {
      const isPrimary = i === 0;
      await cds.run(
        UPDATE(ListingPhoto).set({ sortOrder: i, isPrimary }).where({ ID: photoIds[i] }),
      );
    }

    // Audit log
    try {
      await logAudit({
        userId,
        action: "photo.reorder",
        resource: "ListingPhoto",
        details: JSON.stringify({ listingId, photoIds }),
      });
    } catch {
      LOG.warn("Failed to log audit for photo reorder");
    }

    LOG.info(`Photos reordered for listing ${listingId}: ${photoIds.length} photos`);

    return { success: true, message: `${photoIds.length} photos reordered` };
  };

  private handleDeletePhoto = async (req: cds.Request) => {
    const { listingId, photoId } = req.data as {
      listingId: string;
      photoId: string;
    };

    const entities = cds.entities("auto");
    const Listing = entities["Listing"];
    const ListingPhoto = entities["ListingPhoto"];

    // Validate listing exists and ownership
    const listing = await cds.run(SELECT.one.from(Listing).where({ ID: listingId }));
    if (!listing) {
      return req.error(404, "Listing not found");
    }
    const userId = (req.user as { id?: string })?.id;
    if (!userId) {
      return req.error(401, "Authentication required");
    }
    if (listing.sellerId !== userId) {
      return req.error(403, "Not authorized to delete photos from this listing");
    }

    // Find the photo
    const photo = await cds.run(SELECT.one.from(ListingPhoto).where({ ID: photoId, listingId }));
    if (!photo) {
      return req.error(404, "Photo not found");
    }

    // Delete from blob storage
    try {
      await deletePhotoBlob(photo.blobUrl);
    } catch (err) {
      LOG.warn(`Failed to delete blob for photo ${photoId}:`, err);
    }

    // Delete DB record
    await cds.run(DELETE.from(ListingPhoto).where({ ID: photoId }));

    // Reorder remaining photos to fill gap
    const remaining = await cds.run(
      SELECT.from(ListingPhoto).where({ listingId }).orderBy("sortOrder asc"),
    );
    for (let i = 0; i < remaining.length; i++) {
      const isPrimary = i === 0;
      if (remaining[i].sortOrder !== i || remaining[i].isPrimary !== isPrimary) {
        await cds.run(
          UPDATE(ListingPhoto).set({ sortOrder: i, isPrimary }).where({ ID: remaining[i].ID }),
        );
      }
    }

    // Recalculate visibility score with updated photo count.
    // Listing fields don't change on photo delete, so no re-fetch needed.
    const deleteScoreInput: VisibilityScoreInput = {
      listing,
      photoCount: remaining.length,
      hasHistoryReport: false,
    };
    const deleteScoreResult = calculateVisibilityScore(deleteScoreInput);
    await cds.run(
      UPDATE(Listing)
        .set({
          visibilityScore: deleteScoreResult.score,
          visibilityLabel: deleteScoreResult.label,
        })
        .where({ ID: listingId }),
    );
    await broadcastScoreUpdate(userId!, deleteScoreResult);

    // Audit log
    try {
      await logAudit({
        userId,
        action: "photo.delete",
        resource: "ListingPhoto",
        details: JSON.stringify({ photoId, listingId, remainingCount: remaining.length }),
      });
    } catch {
      LOG.warn("Failed to log audit for photo delete");
    }

    LOG.info(`Photo deleted from listing ${listingId}: ${photoId}`);

    return { success: true, message: "Photo deleted" };
  };

  // ─── Declaration of Honor handlers (Story 3-7) ──────────────────────────

  private handleGetDeclarationTemplate = async (req: cds.Request) => {
    const entities = cds.entities("auto");
    const ConfigDeclarationTemplate = entities["ConfigDeclarationTemplate"];

    const templates = await cds.run(
      SELECT.from(ConfigDeclarationTemplate).where({ isActive: true }),
    );

    if (!templates || templates.length === 0) {
      return req.error(404, "No active declaration template found");
    }

    if (templates.length > 1) {
      LOG.warn("Multiple active declaration templates found, using first");
    }

    const template = templates[0];
    return {
      version: template.version,
      checkboxItems: template.checkboxItems,
      introText: template.introText,
      legalNotice: template.legalNotice,
    };
  };

  private handleSubmitDeclaration = async (req: cds.Request) => {
    const { listingId, checkboxStates } = req.data as {
      listingId: string;
      checkboxStates: string;
    };
    const userId = (req.user as { id?: string })?.id;
    if (!userId) return req.error(401, "Authentication required");

    const entities = cds.entities("auto");
    const Listing = entities["Listing"];
    const Declaration = entities["Declaration"];
    const ConfigDeclarationTemplate = entities["ConfigDeclarationTemplate"];

    // Validate listing exists and belongs to current seller
    const listing = await cds.run(SELECT.one.from(Listing).where({ ID: listingId }));
    if (!listing) return req.error(404, "Listing not found");
    if (listing.sellerId !== userId) return req.error(403, "Not authorized");
    if (listing.status !== "draft") {
      return req.error(400, "Declaration can only be submitted for draft listings");
    }

    // Prevent duplicate declarations for the same listing
    const existingDeclaration = await cds.run(SELECT.one.from(Declaration).where({ listingId }));
    if (existingDeclaration) {
      return req.error(409, "A declaration already exists for this listing");
    }

    // Parse and validate checkbox states
    let parsedCheckboxStates: Array<{ label: string; checked: boolean }>;
    try {
      parsedCheckboxStates = JSON.parse(checkboxStates);
    } catch {
      return req.error(400, "Invalid checkboxStates format");
    }

    if (!Array.isArray(parsedCheckboxStates) || parsedCheckboxStates.length === 0) {
      return req.error(400, "checkboxStates must be a non-empty array");
    }

    // Validate all checkboxes are checked
    const unchecked = parsedCheckboxStates.filter((cb) => !cb.checked);
    if (unchecked.length > 0) {
      return req.error(400, "All checkboxes must be checked to submit declaration");
    }

    // Get active template and validate checkbox count matches
    const templates = await cds.run(
      SELECT.from(ConfigDeclarationTemplate).where({ isActive: true }),
    );
    const templateVersion = templates && templates.length > 0 ? templates[0].version : "unknown";

    if (templates && templates.length > 0) {
      const templateItems: string[] =
        typeof templates[0].checkboxItems === "string"
          ? JSON.parse(templates[0].checkboxItems)
          : templates[0].checkboxItems;
      if (parsedCheckboxStates.length !== templateItems.length) {
        return req.error(
          400,
          `Expected ${templateItems.length} checkboxes, received ${parsedCheckboxStates.length}`,
        );
      }
    }

    // Capture IP address (extract client IP from x-forwarded-for chain)
    const forwardedFor = req.headers && (req.headers["x-forwarded-for"] as string);
    const ipAddress =
      (forwardedFor ? forwardedFor.split(",")[0].trim() : null) ||
      (req as unknown as { ip?: string }).ip ||
      "unknown";

    // Create Declaration record
    const declarationId = cds.utils.uuid();
    const signedAt = new Date().toISOString();

    await cds.run(
      INSERT.into(Declaration).entries({
        ID: declarationId,
        listingId,
        sellerId: userId,
        declarationVersion: templateVersion,
        checkboxStates: JSON.stringify(parsedCheckboxStates),
        ipAddress,
        signedAt,
        createdAt: signedAt,
      }),
    );

    // Update listing with declarationId
    await cds.run(UPDATE(Listing).set({ declarationId }).where({ ID: listingId }));

    // Audit log
    try {
      await logAudit({
        userId,
        action: "declaration.submitted",
        resource: "Declaration",
        details: JSON.stringify({
          declarationId,
          listingId,
          version: templateVersion,
        }),
        ipAddress,
      });
    } catch {
      LOG.warn("Failed to log audit for declaration submission");
    }

    LOG.info(`Declaration submitted for listing ${listingId} by seller ${userId}`);

    return {
      declarationId,
      signedAt,
      success: true,
    };
  };

  private handleGetDeclarationSummary = async (req: cds.Request) => {
    const { listingId } = req.data as { listingId: string };

    const entities = cds.entities("auto");
    const Declaration = entities["Declaration"];

    const declaration = await cds.run(SELECT.one.from(Declaration).where({ listingId }));

    if (!declaration) {
      return {
        hasDeclared: false,
        signedAt: null,
        declarationVersion: null,
      };
    }

    return {
      hasDeclared: true,
      signedAt: declaration.signedAt,
      declarationVersion: declaration.declarationVersion,
    };
  };

  private rejectDeclarationUpdate = async (req: cds.Request) => {
    return req.error(403, "Declarations are immutable and cannot be updated");
  };

  private rejectDeclarationDelete = async (req: cds.Request) => {
    return req.error(403, "Declarations are immutable and cannot be deleted");
  };

  private handleFetchHistoryReport = async (req: cds.Request) => {
    const { listingId } = req.data as { listingId: string };
    const userId = (req.user as { id: string }).id;

    // Validate listing exists and belongs to seller
    const entities = cds.entities("auto");
    const listing = await cds.run(
      SELECT.one.from(entities["Listing"]).where({ ID: listingId, sellerId: userId }),
    );

    if (!listing) {
      return req.error(404, "Listing not found or does not belong to current seller");
    }

    if (!listing.vin) {
      return req.error(
        400,
        "Listing has no VIN - auto-fill must be completed before fetching history report",
      );
    }

    // Check for existing report
    const existingReport = await cds.run(
      SELECT.one.from(entities["HistoryReport"]).where({ listingId }),
    );

    if (existingReport) {
      LOG.info(`Returning existing history report for listing ${listingId}`);
      return {
        reportId: existingReport.ID,
        source: existingReport.source,
        fetchedAt: existingReport.fetchedAt,
        reportVersion: existingReport.reportVersion,
        reportData: existingReport.reportData,
      };
    }

    // Check cache first
    const identifierType = "vin";
    const cached = await getCachedResponse<HistoryResponse>(
      listing.vin,
      identifierType,
      "IHistoryAdapter",
    );

    let reportData: HistoryResponse;

    if (cached) {
      LOG.info(`Using cached history report for VIN ${listing.vin}`);
      reportData = cached;
    } else {
      // Fetch from adapter — wrap in try-catch for network/provider errors
      try {
        const adapter = getHistory();
        reportData = await adapter.getHistory({
          vin: listing.vin,
          plate: listing.plate || undefined,
        });
      } catch (err: unknown) {
        LOG.error(`History adapter failed for VIN ${listing.vin}:`, err);
        return req.error(502, "Le fournisseur d'historique est temporairement indisponible");
      }

      // Cache the response
      await setCachedResponse(listing.vin, identifierType, "IHistoryAdapter", reportData);
    }

    // Store the report — handle race condition (duplicate INSERT on concurrent requests)
    const reportId = cds.utils.uuid();
    const fetchedAt = new Date().toISOString();

    try {
      await cds.run(
        INSERT.into(entities["HistoryReport"]).entries({
          ID: reportId,
          listingId,
          reportData: JSON.stringify(reportData),
          source: reportData.provider.providerName,
          fetchedAt,
          reportVersion: reportData.provider.providerVersion,
        }),
      );
    } catch (err: unknown) {
      // Unique constraint violation — another concurrent request already inserted
      const existing = await cds.run(
        SELECT.one.from(entities["HistoryReport"]).where({ listingId }),
      );
      if (existing) {
        LOG.info(`Returning concurrently-created history report for listing ${listingId}`);
        return {
          reportId: existing.ID,
          source: existing.source,
          fetchedAt: existing.fetchedAt,
          reportVersion: existing.reportVersion,
          reportData: existing.reportData,
        };
      }
      throw err;
    }

    LOG.info(
      `History report ${reportId} created for listing ${listingId} (source: ${reportData.provider.providerName})`,
    );

    await auditLog({
      action: "listing.updated",
      actorId: userId,
      targetType: "HistoryReport",
      targetId: reportId,
      details: { listingId, vin: listing.vin, source: reportData.provider.providerName },
    });

    return {
      reportId,
      source: reportData.provider.providerName,
      fetchedAt,
      reportVersion: reportData.provider.providerVersion,
      reportData: JSON.stringify(reportData),
    };
  };
}
