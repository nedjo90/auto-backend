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
  isOverridden?: boolean;
  createdAt: string;
}

export interface OverrideCertifiedResult {
  previousValue: string;
  previousSource: string;
  newRecord: CertifiedFieldRecord;
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

/**
 * Override a certified field with a seller-declared value.
 * - Marks the original CertifiedField as overridden (isOverridden = true)
 * - Creates a new CertifiedField record with isCertified = false, source = 'seller_declared'
 * - Records the override in CertifiedFieldHistory
 * - Returns the previous certified value for UI display
 */
export async function overrideCertifiedField(
  listingId: string,
  fieldName: string,
  newValue: string,
  sellerId: string,
): Promise<OverrideCertifiedResult> {
  const entities = cds.entities("auto");
  const certEntity = entities["CertifiedField"];
  const historyEntity = entities["CertifiedFieldHistory"];
  if (!certEntity) {
    throw new Error("CertifiedField entity not found");
  }
  if (!historyEntity) {
    throw new Error("CertifiedFieldHistory entity not found");
  }

  // Find the existing certified field
  const existing = await cds.run(
    SELECT.one.from(certEntity).where({ listingId, fieldName, isCertified: true }),
  );

  if (!existing) {
    throw new Error(`No certified field found for ${fieldName} on listing ${listingId}`);
  }

  const now = new Date().toISOString();

  // 1. Mark original as overridden
  await cds.run(UPDATE(certEntity).set({ isOverridden: true }).where({ ID: existing.ID }));

  // 2. Create new record with seller-declared value
  const newId = cds.utils.uuid();
  const newRecord: CertifiedFieldRecord = {
    ID: newId,
    listingId,
    fieldName,
    fieldValue: newValue,
    source: "seller_declared",
    sourceTimestamp: now,
    isCertified: false,
    isOverridden: false,
    createdAt: now,
  };

  await cds.run(INSERT.into(certEntity).entries(newRecord));

  // 3. Record in history
  const historyId = cds.utils.uuid();
  await cds.run(
    INSERT.into(historyEntity).entries({
      ID: historyId,
      listingId,
      fieldName,
      originalValue: existing.fieldValue,
      originalSource: existing.source,
      overriddenAt: now,
      overriddenBy: sellerId,
    }),
  );

  LOG.info(`Overridden certified field: ${fieldName} for listing ${listingId} by ${sellerId}`);

  return {
    previousValue: existing.fieldValue,
    previousSource: existing.source,
    newRecord,
  };
}
