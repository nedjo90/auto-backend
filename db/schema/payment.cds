namespace auto;

using {cuid, managed} from '@sap/cds/common';

// ─── Payment Transaction (Story 3-9) ────────────────────────────────────

entity PaymentTransaction : cuid, managed {
  sellerId              : String(36) not null;
  stripeSessionId       : String(255);
  stripePaymentIntentId : String(255);
  amount                : Decimal(10, 2) not null;
  currency              : String(3) default 'EUR';
  status                : String(20) default 'Pending';  // Pending, Succeeded, Failed, Refunded
  listingIds            : LargeString;                   // JSON array of listing UUIDs
  listingCount          : Integer default 0;
  processedAt           : Timestamp;
  webhookReceivedAt     : Timestamp;
}

annotate PaymentTransaction with @(assert.unique: {sessionId: [stripeSessionId]});
