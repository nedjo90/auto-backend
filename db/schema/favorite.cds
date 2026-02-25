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

// ─── Notification (Story 4-4 + 5-2) ─────────────────────────────────────────

entity Notification : cuid {
  userId    : String(36) not null;
  type      : String(30) not null;    // price_change, sold, certification_update, photos_added, new_message, new_view, new_contact, report_handled, system
  title     : String(200) not null default '';
  body      : String(500) not null default '';
  message   : String(500) not null default '';   // legacy field (= body), kept for backward compatibility
  actionUrl : String(500);
  listingId : String(36);
  isRead    : Boolean default false;
  createdAt : Timestamp;
}

// ─── Notification Preference (Story 5-2) ────────────────────────────────────

entity NotificationPreference : cuid {
  userId  : String(36) not null;
  type    : String(30) not null;
  enabled : Boolean default true;
}

annotate NotificationPreference with @(assert.unique: {userType: [userId, type]});

// ─── Push Subscription (Story 5-2) ──────────────────────────────────────────

entity PushSubscription : cuid {
  userId      : String(36) not null;
  endpoint    : String(500) not null;
  p256dhKey   : String(200) not null;
  authKey     : String(200) not null;
  deviceLabel : String(100);
  createdAt   : Timestamp;
}
