using {auto} from '../db/schema';

@path    : '/api/seller'
@requires: 'authenticated-user'
service SellerService {
  @readonly
  @restrict: [{ grant: 'READ', where: 'listingId in (SELECT listingId FROM auto.CertifiedField WHERE listingId IS NOT NULL)' }]
  entity CertifiedFields as projection on auto.CertifiedField;

  @restrict: [{ grant: ['READ', 'WRITE'], where: 'sellerId = $user.id' }]
  entity Listings as projection on auto.Listing;

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
    previousCertifiedValue : String(2000);
  };
}
