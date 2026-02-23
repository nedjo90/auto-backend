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
