using {auto} from '../db/schema';

@path    : '/api/legal'
@requires: 'any'
service LegalService {
  /** Public: get all active legal documents (without full content) */
  @readonly entity ActiveLegalDocuments as projection on auto.LegalDocument {
    ID,
    ![key],
    title,
    currentVersion,
    requiresReacceptance,
    modifiedAt
  } where active = true;

  /** Public: get the current (non-archived) version content for a document */
  function getCurrentVersion(documentKey : String(30) not null) returns {
    ID           : UUID;
    document_ID  : UUID;
    version      : Integer;
    content      : LargeString;
    summary      : String;
    publishedAt  : String;
  };

  /** Authenticated: accept a legal document version */
  @requires: 'authenticated-user'
  action acceptLegalDocument(documentId : UUID not null, version : Integer not null) returns {
    success : Boolean;
    message : String;
  };

  /** Authenticated: check which documents need re-acceptance for current user */
  @requires: 'authenticated-user'
  function checkLegalAcceptance() returns array of {
    documentId  : UUID;
    documentKey : String;
    title       : String;
    version     : Integer;
    summary     : String;
  };
}
