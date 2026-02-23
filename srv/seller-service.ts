import cds from "@sap/cds";
import type {
  VehicleLookupResponse,
  EmissionResponse,
  RecallResponse,
  CritAirResponse,
  VINTechnicalResponse,
} from "@auto/shared";
import type { CertifiedFieldResult, ApiSourceStatus, ApiSourceStatusState } from "@auto/shared";
import {
  getVehicleLookup,
  getEmission,
  getRecall,
  getCritAir,
  getVINTechnical,
} from "./adapters/factory/adapter-factory";
import {
  markFieldCertified,
  getCertifiedFields,
  overrideCertifiedField,
} from "./lib/certification";
import { getCachedResponse, setCachedResponse } from "./lib/api-cache";
import { logAudit } from "./lib/audit-logger";
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
import type { VisibilityScoreResult } from "@auto/shared";
import {
  validateListingField,
  CERTIFIABLE_FIELDS,
  LISTING_FIELDS,
  PHOTO_ALLOWED_MIME_TYPES,
  calculateCompletionPercentage,
} from "@auto/shared";

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
        const fields = vehicleLookupConfig.extractFields(cached, "cache (SIV)");
        allFields.push(...fields);
      } else {
        const response = await vehicleLookupConfig.call(normalizedIdentifier, identifierType);
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
      vehicleSource.responseTimeMs = Date.now() - startTime;
      LOG.error("VehicleLookup failed:", err);
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
            const fields = config.extractFields(cached, `cache (${config.interfaceName})`);
            return { source, fields };
          }

          const response = await config.call(normalizedIdentifier, identifierType, vehicleData);
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
          source.responseTimeMs = Date.now() - callStart;
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
}
