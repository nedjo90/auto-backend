namespace auto;

using {cuid} from '@sap/cds/common';

// ─── Certified Field (Story 3-2) ──────────────────────────────────────────

entity CertifiedField : cuid {
  listingId       : String(36);
  fieldName       : String(100);
  fieldValue      : String(2000);
  source          : String(100);
  sourceTimestamp  : Timestamp;
  isCertified     : Boolean default true;
  createdAt       : Timestamp;
}

// ─── API Cached Data (Story 3-2) ──────────────────────────────────────────

entity ApiCachedData : cuid {
  vehicleIdentifier : String(20);
  identifierType    : String(10);   // 'plate' or 'vin'
  adapterName       : String(100);
  responseData      : LargeString;  // JSON serialized adapter response
  fetchedAt         : Timestamp;
  expiresAt         : Timestamp;
  isValid           : Boolean default true;
}
