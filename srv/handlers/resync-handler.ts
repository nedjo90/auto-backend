import cds from "@sap/cds";
import type {
  CertifiedFieldResult,
  VehicleLookupResponse,
  EmissionResponse,
  RecallResponse,
  CritAirResponse,
  VINTechnicalResponse,
} from "@auto/shared";
import {
  getVehicleLookup,
  getEmission,
  getRecall,
  getCritAir,
  getVINTechnical,
} from "../adapters/factory/adapter-factory";
import { isCallAllowed } from "../lib/circuit-breaker";
import { withResilience } from "../lib/adapter-resilience";
import { setCachedResponse } from "../lib/api-cache";
import { markFieldCertified } from "../lib/certification";
import { calculateVisibilityScore } from "../lib/visibility-score";
import { auditLog } from "../middleware/audit-trail";

const LOG = cds.log("resync-handler");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Map adapter interface names to the listing fields they certify. */
const ADAPTER_FIELD_MAP: Record<string, string[]> = {
  IVehicleLookupAdapter: [
    "plate",
    "vin",
    "make",
    "model",
    "variant",
    "year",
    "registrationDate",
    "fuelType",
    "engineCapacityCc",
    "powerKw",
    "powerHp",
    "gearbox",
    "bodyType",
    "doors",
    "seats",
    "color",
    "co2GKm",
    "euroNorm",
  ],
  IEmissionAdapter: ["co2GKm", "energyClass", "euroNorm"],
  IRecallAdapter: ["recallCount"],
  ICritAirCalculator: ["critAirLevel", "critAirLabel", "critAirColor"],
  IVINTechnicalAdapter: [
    "bodyClass",
    "engineCylinders",
    "manufacturer",
    "vehicleType",
    "plantCountry",
  ],
};

/**
 * Handler for checkResyncAvailability action.
 * Checks which adapters are healthy and can re-certify declared fields.
 */
export async function handleCheckResyncAvailability(req: cds.Request): Promise<unknown> {
  const { listingId } = req.data as { listingId: string };
  const userId = (req.user as { id?: string })?.id;

  if (!userId) return req.error(401, "Authentication required");
  if (!listingId || !UUID_RE.test(listingId)) {
    return req.error(400, "Identifiant d'annonce invalide");
  }

  const entities = cds.entities("auto");
  const listing = await cds.run(SELECT.one.from(entities["Listing"]).where({ ID: listingId }));

  if (!listing) return req.error(404, "Annonce non trouvee");
  if (listing.sellerId !== userId) return req.error(403, "Non autorise");

  // Get certified fields for this listing
  const certifiedFields = await cds.run(
    SELECT.from(entities["CertifiedField"]).where({ listingId }),
  );

  // Find fields that are declared (not certified) but could be certified
  const declaredFieldNames = new Set<string>();
  for (const cf of certifiedFields) {
    if (!cf.isCertified) {
      declaredFieldNames.add(cf.fieldName);
    }
  }

  // Check which adapters are available and could certify declared fields
  const availableAdapters = [];
  for (const [adapterName, fields] of Object.entries(ADAPTER_FIELD_MAP)) {
    const resyncableFields = fields.filter((f) => declaredFieldNames.has(f));
    if (resyncableFields.length === 0) continue;

    const available = isCallAllowed(adapterName);
    availableAdapters.push({
      adapterInterface: adapterName,
      providerKey: adapterName,
      isAvailable: available,
      certifiableFields: resyncableFields,
    });
  }

  const hasResyncable = availableAdapters.some(
    (a) => a.isAvailable && a.certifiableFields.length > 0,
  );

  return {
    listingId,
    hasResyncableFields: hasResyncable,
    availableAdapters: JSON.stringify(availableAdapters),
  };
}

/**
 * Handler for resyncListing action.
 * Re-calls adapters and updates fields from Declared to Certified.
 */
export async function handleResyncListing(req: cds.Request): Promise<unknown> {
  const { listingId, adapterNames: adapterNamesJson } = req.data as {
    listingId: string;
    adapterNames: string;
  };
  const userId = (req.user as { id?: string })?.id;

  if (!userId) return req.error(401, "Authentication required");
  if (!listingId || !UUID_RE.test(listingId)) {
    return req.error(400, "Identifiant d'annonce invalide");
  }

  let adapterNames: string[];
  try {
    adapterNames = JSON.parse(adapterNamesJson);
    if (!Array.isArray(adapterNames)) throw new Error("Not an array");
  } catch {
    return req.error(400, "Format de liste d'adaptateurs invalide");
  }

  const entities = cds.entities("auto");
  const listing = await cds.run(SELECT.one.from(entities["Listing"]).where({ ID: listingId }));

  if (!listing) return req.error(404, "Annonce non trouvee");
  if (listing.sellerId !== userId) return req.error(403, "Non autorise");

  const updatedFields: CertifiedFieldResult[] = [];
  const failedAdapters: string[] = [];

  // Get vehicle identifier for adapter calls
  const plate = listing.plate;
  const vin = listing.vin;
  const identifier = plate || vin;
  const identifierType = plate ? "plate" : "vin";

  if (!identifier) {
    return req.error(400, "Aucun identifiant vehicule disponible pour la re-synchronisation");
  }

  for (const adapterName of adapterNames) {
    if (!ADAPTER_FIELD_MAP[adapterName]) {
      failedAdapters.push(adapterName);
      continue;
    }

    try {
      const { fields, rawResponse } = await callAdapterForResync(
        adapterName,
        identifier,
        identifierType,
        listing,
      );

      if (fields.length > 0) {
        // Mark each field as certified
        for (const field of fields) {
          await markFieldCertified(listingId, field.fieldName, field.fieldValue, field.source);
        }
        // Batch update listing fields in a single UPDATE
        const updateData: Record<string, unknown> = {};
        for (const field of fields) {
          updateData[field.fieldName] = field.fieldValue;
        }
        await cds.run(UPDATE(entities["Listing"]).set(updateData).where({ ID: listingId }));
        updatedFields.push(...fields);

        // Cache the raw adapter response (not extracted fields)
        await setCachedResponse(identifier, identifierType, adapterName, rawResponse);
      }
    } catch (err) {
      LOG.warn(`Resync failed for ${adapterName}:`, err);
      failedAdapters.push(adapterName);
    }
  }

  // Recalculate visibility score
  let newVisibilityScore: number | null = null;
  try {
    const updatedListing = await cds.run(
      SELECT.one.from(entities["Listing"]).where({ ID: listingId }),
    );
    const photos = await cds.run(SELECT.from(entities["ListingPhoto"]).where({ listingId }));
    let hasHistory = false;
    try {
      const hr = await cds.run(
        SELECT.one.from(entities["HistoryReport"]).columns("ID").where({ listingId }),
      );
      hasHistory = !!hr;
    } catch {
      /* ignore */
    }
    const scoreResult = await calculateVisibilityScore({
      listing: updatedListing,
      photoCount: photos.length,
      hasHistoryReport: hasHistory,
    });
    newVisibilityScore = scoreResult.score;

    // Update score on listing
    await cds.run(
      UPDATE(entities["Listing"])
        .set({ visibilityScore: newVisibilityScore })
        .where({ ID: listingId }),
    );
  } catch (err) {
    LOG.warn("Failed to recalculate visibility score after resync:", err);
  }

  // Audit trail
  try {
    await auditLog({
      action: "listing.updated",
      actorId: userId,
      actorRole: "seller",
      targetType: "Listing",
      targetId: listingId,
      details: JSON.stringify({
        type: "resync",
        adapters: adapterNames,
        updatedFieldCount: updatedFields.length,
        failedAdapters,
      }),
      severity: "info",
    });
  } catch (err) {
    LOG.warn("Failed to log audit for resync:", err);
  }

  return {
    listingId,
    success: updatedFields.length > 0,
    updatedFields: JSON.stringify(updatedFields),
    failedAdapters: JSON.stringify(failedAdapters),
    newVisibilityScore,
  };
}

interface AdapterResyncResult {
  fields: CertifiedFieldResult[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawResponse: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callAdapterForResync(
  adapterName: string,
  identifier: string,
  identifierType: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listing: any,
): Promise<AdapterResyncResult> {
  const now = new Date().toISOString();

  switch (adapterName) {
    case "IVehicleLookupAdapter": {
      const adapter = getVehicleLookup();
      const response = await withResilience<VehicleLookupResponse>(adapterName, "auto", () =>
        adapter.lookup(identifierType === "plate" ? { plate: identifier } : { vin: identifier }),
      );
      return {
        rawResponse: response,
        fields: extractResyncFields(response, "SIV", now, [
          "plate",
          "vin",
          "make",
          "model",
          "variant",
          "year",
          "registrationDate",
          "fuelType",
          "engineCapacityCc",
          "powerKw",
          "powerHp",
          "gearbox",
          "bodyType",
          "doors",
          "seats",
          "color",
          "co2GKm",
          "euroNorm",
        ]),
      };
    }
    case "IEmissionAdapter": {
      const adapter = getEmission();
      const response = await withResilience<EmissionResponse>(adapterName, "auto", () =>
        adapter.getEmissions({
          make: listing.make,
          model: listing.model,
          year: listing.year,
          fuelType: listing.fuelType,
        }),
      );
      return {
        rawResponse: response,
        fields: extractResyncFields(response, "ADEME", now, ["co2GKm", "energyClass", "euroNorm"]),
      };
    }
    case "IRecallAdapter": {
      const adapter = getRecall();
      const response = await withResilience<RecallResponse>(adapterName, "auto", () =>
        adapter.getRecalls({
          make: listing.make || "Unknown",
          model: listing.model || "Unknown",
        }),
      );
      return {
        rawResponse: response,
        fields: [
          {
            fieldName: "recallCount",
            fieldValue: String(response.totalCount),
            source: "RappelConso",
            sourceTimestamp: now,
            isCertified: true,
          },
        ],
      };
    }
    case "ICritAirCalculator": {
      const adapter = getCritAir();
      const response = await withResilience<CritAirResponse>(adapterName, "auto", () =>
        adapter.calculate({
          fuelType: listing.fuelType || "essence",
          euroNorm: listing.euroNorm || "Euro 6",
          registrationDate: listing.registrationDate || "2020-01-01",
        }),
      );
      return {
        rawResponse: response,
        fields: [
          {
            fieldName: "critAirLevel",
            fieldValue: response.level,
            source: "Crit'Air",
            sourceTimestamp: now,
            isCertified: true,
          },
          {
            fieldName: "critAirLabel",
            fieldValue: response.label,
            source: "Crit'Air",
            sourceTimestamp: now,
            isCertified: true,
          },
          {
            fieldName: "critAirColor",
            fieldValue: response.color,
            source: "Crit'Air",
            sourceTimestamp: now,
            isCertified: true,
          },
        ],
      };
    }
    case "IVINTechnicalAdapter": {
      const vin = listing.vin;
      if (!vin) return { rawResponse: null, fields: [] };
      const adapter = getVINTechnical();
      const response = await withResilience<VINTechnicalResponse>(adapterName, "auto", () =>
        adapter.decode({ vin }),
      );
      return {
        rawResponse: response,
        fields: extractResyncFields(response, "NHTSA", now, [
          "bodyClass",
          "engineCylinders",
          "manufacturer",
          "vehicleType",
          "plantCountry",
        ]),
      };
    }
    default:
      return { rawResponse: null, fields: [] };
  }
}

function extractResyncFields(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any,
  source: string,
  timestamp: string,
  fieldNames: string[],
): CertifiedFieldResult[] {
  const fields: CertifiedFieldResult[] = [];
  for (const fieldName of fieldNames) {
    const value = response[fieldName];
    if (value != null && value !== "") {
      fields.push({
        fieldName,
        fieldValue: String(value),
        source,
        sourceTimestamp: timestamp,
        isCertified: true,
      });
    }
  }
  return fields;
}
