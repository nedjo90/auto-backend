using {auto} from '../db/schema';

@path    : '/api/seller'
@requires: 'authenticated-user'
service SellerService {
  @readonly
  @restrict: [{ grant: 'READ', where: 'listingId in (SELECT listingId FROM auto.CertifiedField WHERE listingId IS NOT NULL)' }]
  entity CertifiedFields as projection on auto.CertifiedField;

  /** Auto-fill vehicle data by license plate or VIN */
  action autoFillByPlate(
    identifier     : String(20) not null,
    identifierType : String(10) not null   // 'plate' or 'vin'
  ) returns {
    fields  : LargeString;   // JSON array of CertifiedFieldResult
    sources : LargeString;   // JSON array of ApiSourceStatus
  };
}
