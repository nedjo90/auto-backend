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
import { markFieldCertified } from "./lib/certification";
import { getCachedResponse, setCachedResponse } from "./lib/api-cache";
import { logAudit } from "./lib/audit-logger";

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
    driveType: data.driveType,
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

export default class SellerServiceHandler extends cds.ApplicationService {
  async init() {
    this.on("autoFillByPlate", this.handleAutoFill);
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
        return req.error(400, "Invalid plate format. Expected: XX-NNN-XX (e.g., AB-123-CD)");
      }
    } else if (identifierType === "vin") {
      if (!VIN_REGEX.test(normalizedIdentifier)) {
        return req.error(
          400,
          "Invalid VIN format. Expected: 17 alphanumeric characters (no I, O, Q)",
        );
      }
    } else {
      return req.error(400, "Invalid identifierType. Must be 'plate' or 'vin'");
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
        identifier,
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
        const response = await vehicleLookupConfig.call(identifier, identifierType);
        vehicleData = response as VehicleLookupResponse;
        vehicleSource.status = "success";
        vehicleSource.providerKey = vehicleData?.provider?.providerName || "unknown";
        vehicleSource.responseTimeMs = Date.now() - startTime;

        const sourceName = vehicleData?.provider?.providerName || "SIV";
        const fields = vehicleLookupConfig.extractFields(response, sourceName);
        allFields.push(...fields);

        // Cache the response
        await setCachedResponse(
          identifier,
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
          const cached = await getCachedResponse(identifier, identifierType, config.interfaceName);

          if (cached) {
            source.status = "cached";
            source.providerKey = "cache";
            const fields = config.extractFields(cached, `cache (${config.interfaceName})`);
            return { source, fields };
          }

          const response = await config.call(identifier, identifierType, vehicleData);
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
          await setCachedResponse(identifier, identifierType, config.interfaceName, response);

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

    // Step 3: Create CertifiedField records for a temporary listing ID
    // (actual listingId will be assigned when the listing is created)
    const tempListingId = cds.utils.uuid();

    for (const field of allFields) {
      try {
        await markFieldCertified(tempListingId, field.fieldName, field.fieldValue, field.source);
      } catch (err) {
        LOG.warn(`Failed to certify field ${field.fieldName}:`, err);
      }
    }

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
}
