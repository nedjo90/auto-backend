using {auto} from '../db/schema';

@path    : '/api/rbac'
@requires: 'authenticated-user'
service RbacService {
  @readonly
  entity UserRoles as projection on auto.UserRole;

  @readonly
  entity Roles as projection on auto.Role;

  @readonly
  entity ConfigFeatures as projection on auto.ConfigFeature;

  @readonly @requires: 'administrator'
  entity AuditLogs as projection on auto.AuditLog;

  type RoleAssignmentResult {
    success : Boolean;
    message : String;
  }

  @requires: 'administrator'
  action assignRole(userId : UUID, roleCode : String)    returns RoleAssignmentResult;
  @requires: 'administrator'
  action removeRole(userId : UUID, roleCode : String)    returns RoleAssignmentResult;
  function getUserPermissions(userId : UUID)              returns array of String;
}
