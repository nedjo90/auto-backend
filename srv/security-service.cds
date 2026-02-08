using {auto} from '../db/schema';

@path    : '/api/security'
@requires: 'authenticated-user'
service SecurityService {
  type SecurityResult {
    success   : Boolean;
    mfaStatus : String;
  }

  action toggle2FA(enable : Boolean) returns SecurityResult;
}
