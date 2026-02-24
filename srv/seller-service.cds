using {auto} from '../db/schema';

@path    : '/api/seller'
@requires: 'authenticated-user'
service SellerService {
  @readonly
  @restrict: [{ grant: 'READ', where: 'listingId in (SELECT listingId FROM auto.CertifiedField WHERE listingId IS NOT NULL)' }]
  entity CertifiedFields as projection on auto.CertifiedField;

  @restrict: [{ grant: ['READ', 'WRITE'], where: 'sellerId = $user.id' }]
  entity Listings as projection on auto.Listing;

  @readonly
  @restrict: [{ grant: 'READ', where: 'sellerId = $user.id' }]
  entity Declarations as projection on auto.Declaration;

  /** Auto-fill vehicle data by license plate or VIN */
  action autoFillByPlate(
    identifier     : String(20) not null,
    identifierType : String(10) not null   // 'plate' or 'vin'
  ) returns {
    fields  : LargeString;   // JSON array of CertifiedFieldResult
    sources : LargeString;   // JSON array of ApiSourceStatus
  };

  @readonly
  entity ListingPhotos as projection on auto.ListingPhoto;

  /** Upload a photo for a listing */
  action uploadPhoto(
    listingId : String(36) not null,
    content   : LargeBinary not null,
    mimeType  : String(50) not null,
    fileSize  : Integer not null,
    width     : Integer,
    height    : Integer
  ) returns {
    ID        : UUID;
    cdnUrl    : String(500);
    sortOrder : Integer;
    isPrimary : Boolean;
    fileSize  : Integer;
    mimeType  : String(50);
    width     : Integer;
    height    : Integer;
  };

  /** Reorder photos for a listing */
  action reorderPhotos(
    listingId : String(36) not null,
    photoIds  : LargeString not null   // JSON array of photo IDs in new order
  ) returns {
    success : Boolean;
    message : String;
  };

  /** Delete a photo from a listing */
  action deletePhoto(
    listingId : String(36) not null,
    photoId   : String(36) not null
  ) returns {
    success : Boolean;
    message : String;
  };

  /** Recalculate visibility score for a listing */
  action recalculateScore(
    listingId : String(36) not null
  ) returns {
    score              : Integer;
    label              : String(50);
    suggestions        : LargeString;        // JSON array of ScoreSuggestion
    normalizedScore    : Integer;
    normalizationMessage : String(200);
  };

  /** Save listing as draft (create new or update existing) */
  action saveDraft(
    listingId       : String(36),           // null for new draft
    fields          : LargeString not null,  // JSON object: {make: "Renault", price: 15000, ...}
    certifiedFields : LargeString           // JSON array: [{fieldName, fieldValue, source, sourceTimestamp, isCertified}]
  ) returns {
    listingId            : String(36);
    success              : Boolean;
    completionPercentage : Integer;
    visibilityScore      : Integer;
    visibilityLabel      : String(50);
  };

  /** Load full draft data including certified fields and photos */
  action loadDraft(
    listingId : String(36) not null
  ) returns {
    listing         : LargeString;   // JSON: full listing fields
    certifiedFields : LargeString;   // JSON array: certified field records
    photos          : LargeString;   // JSON array: photos ordered by sortOrder
  };

  /** Duplicate an existing draft (copies declared fields + photos, NOT certified fields) */
  action duplicateDraft(
    listingId : String(36) not null
  ) returns {
    listingId : String(36);
    success   : Boolean;
  };

  /** Delete a draft listing and all associated data */
  action deleteDraft(
    listingId : String(36) not null
  ) returns {
    success : Boolean;
    message : String;
  };

  /** Get the active declaration template */
  action getDeclarationTemplate() returns {
    version       : String(20);
    checkboxItems : LargeString;   // JSON array of checkbox labels
    introText     : String(2000);
    legalNotice   : String(2000);
  };

  /** Submit a signed declaration of honor for a listing */
  action submitDeclaration(
    listingId      : String(36) not null,
    checkboxStates : LargeString not null   // JSON array: [{label, checked}]
  ) returns {
    declarationId : String(36);
    signedAt      : String;
    success       : Boolean;
  };

  /** Fetch vehicle history report for a listing */
  action fetchHistoryReport(
    listingId : String(36) not null
  ) returns {
    reportId      : String(36);
    source        : String(100);
    fetchedAt     : String;
    reportVersion : String(20);
    reportData    : LargeString;   // JSON: HistoryResponse
  };

  /** Get declaration summary for a listing (safe for buyer view - no checkbox details) */
  action getDeclarationSummary(
    listingId : String(36) not null
  ) returns {
    hasDeclared        : Boolean;
    signedAt           : String;
    declarationVersion : String(20);
  };

  /** Get all eligible drafts for publication with pricing info */
  action getPublishableListings() returns {
    listings     : LargeString;   // JSON array of IPublishableListing
    unitPriceCents : Integer;
  };

  /** Calculate batch total for selected listings */
  action calculateBatchTotal(
    listingIds : LargeString not null   // JSON array of listing UUIDs
  ) returns {
    count          : Integer;
    unitPriceCents : Integer;
    totalCents     : Integer;
    listingIds     : LargeString;   // JSON array (validated)
  };

  /** Create a Stripe Checkout Session for batch publication */
  action createCheckoutSession(
    listingIds : LargeString not null,   // JSON array of listing UUIDs
    successUrl : String(500) not null,
    cancelUrl  : String(500) not null
  ) returns {
    sessionId  : String(255);
    sessionUrl : String(500);
  };

  /** Get payment session status (for polling after redirect) */
  action getPaymentSessionStatus(
    sessionId : String(255) not null
  ) returns {
    status       : String(20);
    listingCount : Integer;
    listings     : LargeString;   // JSON array: [{ID, status}]
  };

  /** Update a single listing field and recalculate visibility score */
  action updateListingField(
    listingId : String(36) not null,
    fieldName : String(100) not null,
    value     : String(2000) not null
  ) returns {
    fieldName              : String(100);
    value                  : String(2000);
    status                 : String(20);      // certified, declared, empty
    visibilityScore        : Integer;
    visibilityLabel        : String(50);
    suggestions            : LargeString;     // JSON array of ScoreSuggestion
    previousCertifiedValue : String(2000);
  };

  /** Mark a published listing as sold (Story 3-10) */
  action markAsSold(
    listingId : String(36) not null
  ) returns {
    success   : Boolean;
    listingId : String(36);
    newStatus : String(20);
    timestamp : String;
  };

  /** Archive a listing (from published or sold status) (Story 3-10) */
  action archiveListing(
    listingId : String(36) not null
  ) returns {
    success   : Boolean;
    listingId : String(36);
    newStatus : String(20);
    timestamp : String;
  };

  /** Get seller's published listings with analytics (Story 3-10) */
  action getSellerListings() returns {
    listings : LargeString;   // JSON array of ISellerPublishedListing
  };

  /** Get seller's listing history with performance metrics (Story 3-10) */
  action getListingHistory() returns {
    listings : LargeString;   // JSON array of ISellerListingHistoryItem
  };
}
