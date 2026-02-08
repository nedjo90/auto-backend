namespace auto;

using {cuid} from '@sap/cds/common';

entity AuditLog : cuid {
  userId    : String(36);
  action    : String(100);
  resource  : String(200);
  details   : String(1000);
  ipAddress : String(45);
  timestamp : Timestamp;
}
