using {auto} from '../db/schema';

@path    : '/api/registration'
@requires: 'any'
service RegistrationService {
  @readonly entity ConfigRegistrationFields as projection on auto.ConfigRegistrationField;

  type RegistrationInput {
    email           : String;
    firstName       : String;
    lastName        : String;
    password        : String;
    phone           : String;
    siret           : String;
  }

  type RegistrationResult {
    success     : Boolean;
    userId      : String;
    email       : String;
    redirectUrl : String;
  }

  action register(input : RegistrationInput) returns RegistrationResult;
}
