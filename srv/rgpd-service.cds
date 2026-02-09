using {auto} from '../db/schema';

@path    : '/api/rgpd'
@requires: 'authenticated-user'
service RgpdService {
  @readonly entity DataExportRequests as projection on auto.DataExportRequest;
  @readonly entity AnonymizationRequests as projection on auto.AnonymizationRequest;

  type DataExportRequestResult {
    requestId                  : UUID;
    status                     : String;
    estimatedCompletionMinutes : Integer;
  }

  type ExportDownloadResult {
    downloadUrl   : String;
    expiresAt     : String;
    fileSizeBytes : Integer;
  }

  type AnonymizationRequestResult {
    requestId : UUID;
    status    : String;
    message   : String;
  }

  type AnonymizationResult {
    success : Boolean;
    message : String;
  }

  action requestDataExport() returns DataExportRequestResult;
  function getExportStatus(requestId : UUID) returns DataExportRequestResult;
  action downloadExport(requestId : UUID) returns ExportDownloadResult;
  action requestAnonymization() returns AnonymizationRequestResult;
  action confirmAnonymization(requestId : UUID, confirmationCode : String) returns AnonymizationResult;
}
