namespace auto;

using {cuid} from '@sap/cds/common';

// ─── Market Watch (Story 6-3) ────────────────────────────────────────────────

entity MarketWatch : cuid {
  sellerId  : String(36) not null;
  listingId : String(36) not null;
  addedAt   : Timestamp;
  notes     : String(500);
}

annotate MarketWatch with @(assert.unique: {sellerListing: [sellerId, listingId]});

// ─── Listing Price History (Story 6-3) ───────────────────────────────────────

entity ListingPriceHistory : cuid {
  listingId     : String(36) not null;
  price         : Decimal(10, 2) not null;
  previousPrice : Decimal(10, 2);
  changedAt     : Timestamp;
}
