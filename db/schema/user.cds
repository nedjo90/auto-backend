namespace auto;

using {cuid, managed} from '@sap/cds/common';

type UserStatus : String(20) enum {
  active;
  suspended;
  anonymized;
}

@assert.unique: {email: [email]}
entity User : cuid, managed {
  azureAdB2cId    : String(255);
  email           : String(255);
  firstName       : String(100);
  lastName        : String(100);
  displayName     : String(200);
  phone           : String(20);
  address         : String(500);
  addressStreet   : String(500);
  addressCity     : String(100);
  addressPostalCode : String(10);
  addressCountry  : String(2) default 'FR';
  siret           : String(14);
  companyName     : String(200);
  avatarUrl       : String(500);
  bio             : String(500);
  accountCreatedAt : Timestamp;
  isAnonymized    : Boolean default false;
  status          : UserStatus default 'active';
}

entity SellerRating : cuid {
  user                  : Association to User;
  profileCompletionRate : Decimal(5,2);
  overallRating         : Decimal(3,2);
  totalListings         : Integer default 0;
  lastCalculatedAt      : Timestamp;
}
