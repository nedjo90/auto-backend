namespace auto;

using {cuid, managed} from '@sap/cds/common';
using {auto.User} from './user';

// ─── Legal document management (Story 2-7) ──────────────────────────────

@assert.unique: {configKey: [key]}
entity LegalDocument : cuid, managed {
  ![key]                : String(30);  // cgu, cgv, privacy_policy, legal_notices
  title                 : String(200);
  currentVersion        : Integer default 1;
  requiresReacceptance  : Boolean default false;
  active                : Boolean default true;
  versions              : Composition of many LegalDocumentVersion on versions.document = $self;
}

@assert.unique: {docVersion: [document, version]}
entity LegalDocumentVersion : cuid, managed {
  document    : Association to LegalDocument;
  version     : Integer;
  content     : LargeString;
  summary     : String(500);
  publishedAt : Timestamp;
  publishedBy : String(255);
  archived    : Boolean default false;
}

entity LegalAcceptance : cuid, managed {
  user        : Association to User;
  document    : Association to LegalDocument;
  documentKey : String(30);
  version     : Integer;
  acceptedAt  : Timestamp;
  ipAddress   : String(45);
  userAgent   : String(500);
}
