namespace auto;

using {cuid} from '@sap/cds/common';
using {auto.User} from './user';

@assert.unique: {code}
entity Role : cuid {
  code        : String(20);
  name        : String(100);
  description : String(255);
  level       : Integer;
}

entity UserRole : cuid {
  user       : Association to User;
  role       : Association to Role;
  assignedAt : Timestamp;
  assignedBy : Association to User;
}

@assert.unique: {code}
entity Permission : cuid {
  code        : String(50);
  description : String(255);
}

entity RolePermission : cuid {
  role       : Association to Role;
  permission : Association to Permission;
}
