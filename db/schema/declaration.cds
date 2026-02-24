namespace auto;

using {cuid, managed} from '@sap/cds/common';

// ─── Declaration of Honor (Story 3-7) ────────────────────────────────────

entity Declaration : cuid {
  listingId          : String(36) not null;
  sellerId           : String(36) not null;
  declarationVersion : String(20) not null;
  checkboxStates     : LargeString not null;  // JSON array: [{label, checked}]
  ipAddress          : String(45);
  signedAt           : Timestamp not null;
  createdAt          : Timestamp;
}

// ─── Declaration Template Configuration (Story 3-7) ─────────────────────

entity ConfigDeclarationTemplate : cuid, managed {
  version        : String(20) not null;
  isActive       : Boolean default true;
  checkboxItems  : LargeString not null;  // JSON array of checkbox labels/descriptions
  introText      : String(2000);
  legalNotice    : String(2000);
}

annotate ConfigDeclarationTemplate with @(assert.unique: [{version}]);
