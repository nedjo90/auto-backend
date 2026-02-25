namespace auto;

using {cuid, managed} from '@sap/cds/common';

// ─── Favorite (Story 4-4) ──────────────────────────────────────────────────

entity Favorite : cuid {
  userId                     : String(36) not null;
  listingId                  : String(36) not null;
  createdAt                  : Timestamp;
  snapshotPrice              : Decimal(10, 2);
  snapshotCertificationLevel : String(30);
  snapshotPhotoCount         : Integer default 0;
}

annotate Favorite with @(assert.unique: {userListing: [userId, listingId]});

// ─── Notification (Story 4-4) ───────────────────────────────────────────────

entity Notification : cuid {
  userId    : String(36) not null;
  type      : String(30) not null;    // price_change, sold, certification_update, photos_added
  message   : String(500) not null;
  listingId : String(36) not null;
  isRead    : Boolean default false;
  createdAt : Timestamp;
}
