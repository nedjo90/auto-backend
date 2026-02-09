using {auto} from '../db/schema';

@path    : '/api/profile'
@requires: 'authenticated-user'
service ProfileService {
  @readonly entity UserProfiles as projection on auto.User;
  @readonly entity PublicSellerProfiles as projection on auto.User;
  @readonly entity ConfigProfileFields as projection on auto.ConfigProfileField;

  type ProfileUpdateInput {
    displayName     : String;
    phone           : String;
    addressStreet   : String;
    addressCity     : String;
    addressPostalCode : String;
    addressCountry  : String;
    siret           : String;
    companyName     : String;
    avatarUrl       : String;
    bio             : String;
  }

  type ProfileResult {
    success : Boolean;
    userId  : String;
  }

  type IncompleteField {
    fieldName : String;
    tipKey    : String;
  }

  type ProfileCompletionResult {
    percentage       : Decimal;
    badge            : String;
    incompleteFields : array of IncompleteField;
  }

  type PublicSellerProfileResult {
    userId                 : String;
    displayName            : String;
    avatarUrl              : String;
    bio                    : String;
    rating                 : Decimal;
    profileCompletionBadge : String;
    totalListings          : Integer;
    memberSince            : String;
    isAnonymized           : Boolean;
  }

  action updateProfile(input : ProfileUpdateInput) returns ProfileResult;
  function getProfileCompletion() returns ProfileCompletionResult;

  @requires: 'any'
  function getPublicSellerProfile(sellerId : UUID) returns PublicSellerProfileResult;
}
