using {auto} from '../db/schema';

@path    : '/api/buyer'
@requires: 'authenticated-user'
service BuyerService {
  @readonly
  @restrict: [{ grant: 'READ', where: 'status = ''published''' }]
  entity Listings as projection on auto.Listing;

  @readonly
  entity HistoryReports as projection on auto.HistoryReport;

  /** Get the history report for a published listing (authenticated buyers only) */
  action getHistoryReport(
    listingId : String(36) not null
  ) returns {
    reportId      : String(36);
    source        : String(100);
    fetchedAt     : String;
    reportVersion : String(20);
    reportData    : LargeString;   // JSON: HistoryResponse
    isMockData    : Boolean;       // true when provider is mock
  };
}
