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

entity ApiCallLog : cuid {
  adapterInterface : String(100);
  providerKey      : String(100);
  endpoint         : String(500);
  httpMethod       : String(10);
  httpStatus       : Integer;
  responseTimeMs   : Integer;
  cost             : Decimal(10, 4) default 0;
  listingId        : String(36);
  requestId        : String(36);
  errorMessage     : String(500);
  timestamp        : Timestamp;
}

entity AlertEvent : cuid {
  alertId        : String(36);
  metric         : String(100);
  currentValue   : Decimal(15, 4);
  thresholdValue : Decimal(15, 4);
  severity       : String(10);  // info, warning, critical
  message        : String(500);
  acknowledged   : Boolean default false;
  acknowledgedBy : String(36);
  acknowledgedAt : Timestamp;
  createdAt      : Timestamp;
}
