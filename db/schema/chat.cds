namespace auto;

using {cuid, managed} from '@sap/cds/common';

// ─── Conversation (Story 5-1) ────────────────────────────────────────────

entity Conversation : cuid, managed {
  buyerId       : String(36) not null;
  sellerId      : String(36) not null;
  listingId     : String(36) not null;
  lastMessageAt : Timestamp;
}

annotate Conversation with @(assert.unique: {buyerSellerListing: [buyerId, sellerId, listingId]});

// ─── ChatMessage (Story 5-1) ─────────────────────────────────────────────

entity ChatMessage : cuid {
  conversationId : String(36) not null;
  senderId       : String(36) not null;
  content        : String(2000) not null;
  timestamp      : Timestamp not null;
  deliveryStatus : String(20) not null default 'sent';  // sent, delivered, read
}
