namespace auto;

using {cuid, managed} from '@sap/cds/common';
using {auto.User} from './user';

type ConsentDecision : String(10) enum {
  granted;
  revoked;
}

@assert.unique: {code: [code]}
entity ConfigConsentType : cuid, managed {
  code           : String(50);
  labelKey       : String(100);
  descriptionKey : String(200);
  isMandatory    : Boolean default false;
  isActive       : Boolean default true;
  displayOrder   : Integer;
  version        : Integer default 1;
}

entity UserConsent : cuid {
  user               : Association to User;
  consentType        : Association to ConfigConsentType;
  consentTypeVersion : Integer;
  decision           : ConsentDecision;
  timestamp          : Timestamp;
  ipAddress          : String(45);
  userAgent          : String(500);
}
