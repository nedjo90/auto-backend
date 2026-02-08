using {auto} from '../db/schema';

@path    : '/api/consent'
@requires: 'any'
service ConsentService {
  @readonly entity ActiveConsentTypes as projection on auto.ConfigConsentType where isActive = true;

  type ConsentInput {
    consentTypeId      : UUID;
    decision           : String;
  }

  type ConsentBatchInput {
    consents : array of ConsentInput;
  }

  type ConsentResult {
    success : Boolean;
    id      : UUID;
  }

  type ConsentBatchResult {
    success : Boolean;
    count   : Integer;
  }

  // Public: used during registration (user not yet authenticated)
  action recordConsent(input : ConsentInput) returns ConsentResult;
  action recordConsents(input : ConsentBatchInput) returns ConsentBatchResult;

  // Authenticated: requires logged-in user
  @requires: 'authenticated-user'
  function getUserConsents(userId : UUID) returns array of auto.UserConsent;
  @requires: 'authenticated-user'
  function getPendingConsents(userId : UUID) returns array of auto.ConfigConsentType;
}
