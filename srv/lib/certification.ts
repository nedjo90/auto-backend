import cds from "@sap/cds";

const LOG = cds.log("certification");

export interface MarkCertifiedInput {
  listingId: string;
  fieldName: string;
  value: string;
  source: string;
}

export interface CertifiedFieldRecord {
  ID: string;
  listingId: string;
  fieldName: string;
  fieldValue: string;
  source: string;
  sourceTimestamp: string;
  isCertified: boolean;
  createdAt: string;
}

/**
 * Create a CertifiedField record marking a field as certified with its source.
 * If a record already exists for the same listing+field, it is updated.
 */
export async function markFieldCertified(
  listingId: string,
  fieldName: string,
  value: string,
  source: string,
): Promise<CertifiedFieldRecord> {
  const entities = cds.entities("auto");
  const entity = entities["CertifiedField"];
  if (!entity) {
    throw new Error("CertifiedField entity not found");
  }

  const now = new Date().toISOString();

  // Check if a record already exists for this listing+field
  const existing = await cds.run(SELECT.one.from(entity).where({ listingId, fieldName }));

  if (existing) {
    await cds.run(
      UPDATE(entity)
        .set({
          fieldValue: value,
          source,
          sourceTimestamp: now,
          isCertified: true,
        })
        .where({ ID: existing.ID }),
    );
    LOG.info(`Updated certified field: ${fieldName} for listing ${listingId}`);
    return {
      ID: existing.ID,
      listingId,
      fieldName,
      fieldValue: value,
      source,
      sourceTimestamp: now,
      isCertified: true,
      createdAt: existing.createdAt,
    };
  }

  const id = cds.utils.uuid();
  const record = {
    ID: id,
    listingId,
    fieldName,
    fieldValue: value,
    source,
    sourceTimestamp: now,
    isCertified: true,
    createdAt: now,
  };

  await cds.run(INSERT.into(entity).entries(record));
  LOG.info(`Created certified field: ${fieldName} for listing ${listingId}`);
  return record;
}

/**
 * Get all certified fields for a listing.
 */
export async function getCertifiedFields(listingId: string): Promise<CertifiedFieldRecord[]> {
  const entities = cds.entities("auto");
  const entity = entities["CertifiedField"];
  if (!entity) {
    throw new Error("CertifiedField entity not found");
  }

  const rows = await cds.run(SELECT.from(entity).where({ listingId }));
  return (rows || []) as CertifiedFieldRecord[];
}

/**
 * Check if a specific field is certified for a listing.
 */
export async function isCertified(listingId: string, fieldName: string): Promise<boolean> {
  const entities = cds.entities("auto");
  const entity = entities["CertifiedField"];
  if (!entity) {
    throw new Error("CertifiedField entity not found");
  }

  const row = await cds.run(
    SELECT.one.from(entity).where({ listingId, fieldName, isCertified: true }),
  );
  return !!row;
}
