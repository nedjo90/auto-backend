using {auto} from '../db/schema';

@path    : '/api/security'
@requires: 'authenticated-user'
service SecurityService {
  type SecurityResult {
    success   : Boolean;
    mfaStatus : String;
  }

  // L5: CDS-level restriction as defense-in-depth (handler also checks)
  @restrict: [{ grant: '*', to: 'authenticated-user' }]
  action toggle2FA(enable : Boolean) returns SecurityResult;
}
