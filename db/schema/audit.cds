namespace auto;

using {cuid} from '@sap/cds/common';

// ─── Audit Trail (Story 2-8) ────────────────────────────────────────

entity AuditTrailEntry : cuid {
  action     : String(100);   // e.g. "listing.published", "config.updated"
  actorId    : String(36);    // UUID of who performed the action
  actorRole  : String(20);    // e.g. "admin", "seller", "buyer", "system"
  targetType : String(100);   // e.g. "Listing", "User", "ConfigParameter"
  targetId   : String(36);    // ID of the affected entity
  timestamp  : Timestamp;
  details    : LargeString;   // JSON string with contextual data
  ipAddress  : String(45);
  userAgent  : String(500);
  requestId  : String(36);    // for correlating related operations
  severity   : String(10);    // info, warning, critical
}

// ─── API Call Log (Story 2-3, enhanced in Story 2-8) ────────────────

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

// ─── Alert Events (Story 2-5) ───────────────────────────────────────

entity AlertEvent : cuid {
  // Loose string reference (not Association) because auto-alerts from api-logger
  // use synthetic IDs (e.g., "auto-provider-name") with no corresponding ConfigAlert row.
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
