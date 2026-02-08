namespace auto;

using {cuid, managed} from '@sap/cds/common';

type UserStatus : String(20) enum {
  active;
  suspended;
  anonymized;
}

entity UserRole : cuid, managed {
  user : Association to User;
  role : String(30);
}

@assert.unique: {email}
entity User : cuid, managed {
  azureAdB2cId : String(255);
  email        : String(255);
  firstName    : String(100);
  lastName     : String(100);
  phone        : String(20);
  address      : String(500);
  siret        : String(14);
  isAnonymized : Boolean default false;
  status       : UserStatus default 'active';
}
