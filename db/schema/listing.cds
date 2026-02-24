namespace auto;

using {cuid, managed} from '@sap/cds/common';

// ─── Listing (Story 3-3) ─────────────────────────────────────────────────

entity Listing : cuid, managed {
  // Owner
  sellerId          : String(36) not null;

  // Vehicle identity (certifiable via auto-fill)
  plate             : String(20);
  vin               : String(17);
  make              : String(100);
  model             : String(100);
  variant           : String(100);
  year              : Integer;
  registrationDate  : String(10);
  fuelType          : String(50);
  engineCapacityCc  : Integer;
  powerKw           : Integer;
  powerHp           : Integer;
  gearbox           : String(50);
  bodyType          : String(50);
  doors             : Integer;
  seats             : Integer;
  color             : String(50);
  co2GKm            : Integer;
  euroNorm          : String(20);
  energyClass       : String(5);
  critAirLevel      : String(15);
  critAirLabel      : String(100);
  critAirColor      : String(20);
  recallCount       : Integer;

  // Declared fields (seller input only)
  price             : Decimal(10, 2);
  mileage           : Integer;
  description       : LargeString;
  condition         : String(20);           // Excellent, Bon, Correct, A_restaurer
  options           : LargeString;          // JSON array of option strings
  interiorColor     : String(50);
  exteriorColor     : String(50);
  numberOfDoors     : Integer;
  transmission      : String(30);           // manuelle, automatique
  driveType         : String(30);           // traction, propulsion, integrale

  // VIN-technical (certifiable)
  bodyClass         : String(100);
  engineCylinders   : Integer;
  manufacturer      : String(100);
  vehicleType       : String(100);
  plantCountry      : String(100);

  // Status
  status                : String(20) default 'draft';  // draft, published, sold, archived
  visibilityScore       : Integer default 0;
  visibilityLabel       : String(50) default 'Partiellement documenté';
  completionPercentage  : Integer default 0;
  declarationId         : String(36);

  // Associations
  certifiedFields   : Composition of many CertifiedField on certifiedFields.listingId = $self.ID;
  photos            : Composition of many ListingPhoto on photos.listingId = $self.ID;
}

// ─── Certified Field (Story 3-2) ──────────────────────────────────────────

entity CertifiedField : cuid, managed {
  listingId       : String(36);
  fieldName       : String(100);
  fieldValue      : String(2000);
  source          : String(100);
  sourceTimestamp  : Timestamp;
  isCertified     : Boolean default true;
  isOverridden    : Boolean default false;
}

// ─── Certified Field History (Story 3-3) ──────────────────────────────────

entity CertifiedFieldHistory : cuid, managed {
  listingId       : String(36);
  fieldName       : String(100);
  originalValue   : String(2000);
  originalSource  : String(100);
  overriddenAt    : Timestamp;
  overriddenBy    : String(36);     // seller ID
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

// ─── Listing Photo (Story 3-4) ──────────────────────────────────────────

entity ListingPhoto : cuid, managed {
  listingId   : String(36) not null;
  blobUrl     : String(500);
  cdnUrl      : String(500);
  sortOrder   : Integer default 0;
  isPrimary   : Boolean default false;
  fileSize    : Integer;               // bytes
  mimeType    : String(50);
  width       : Integer;
  height      : Integer;
  uploadedAt  : Timestamp;
}

// ─── Indexes ──────────────────────────────────────────────────────────────

annotate CertifiedField with @(assert.unique: [{listingId, fieldName}]);
annotate ApiCachedData with @(assert.unique: [{vehicleIdentifier, identifierType, adapterName, isValid}]);
