namespace auto;

using {cuid, managed} from '@sap/cds/common';
using {auto.Role} from './rbac';

// ─── Existing config entities (updated with managed aspect) ─────────────

@assert.unique: {fieldName: [fieldName]}
entity ConfigRegistrationField : cuid, managed {
  fieldName         : String(50);
  fieldType         : String(20);
  isRequired        : Boolean;
  isVisible         : Boolean;
  displayOrder      : Integer;
  validationPattern : String(255);
  labelKey          : String(100);
  placeholderKey    : String(100);
}

@assert.unique: {configKey: [key]}
entity ConfigParameter : cuid, managed {
  ![key]      : String(100);
  value       : String(500);
  type        : String(20) default 'string';
  category    : String(50);
  description : String(500);
}

@assert.unique: {code: [code]}
entity ConfigFeature : cuid, managed {
  code         : String(50);
  name         : String(100);
  requiresAuth : Boolean default false;
  requiredRole : Association to Role;
  isActive     : Boolean default true;
}

@assert.unique: {fieldName: [fieldName]}
entity ConfigProfileField : cuid, managed {
  fieldName               : String(50);
  isVisibleToPublic       : Boolean default false;
  contributesToCompletion : Boolean default true;
  weight                  : Integer default 1;
  tipKey                  : String(200);
  displayOrder            : Integer;
}

// ─── New config entities (Story 2-1) ────────────────────────────────────

@assert.unique: {key_language: [key, language]}
entity ConfigText : cuid, managed {
  ![key]   : String(100);
  language : String(5) default 'fr';
  value    : LargeString;
  category : String(50);
}

@assert.unique: {configKey: [key]}
entity ConfigBoostFactor : cuid, managed {
  ![key]      : String(100);
  factor      : Decimal(5, 2) default 1.0;
  description : String(500);
}

@assert.unique: {configKey: [key]}
entity ConfigVehicleType : cuid, managed {
  ![key] : String(50);
  label  : String(100);
  active : Boolean default true;
}

@assert.unique: {configKey: [key]}
entity ConfigListingDuration : cuid, managed {
  ![key] : String(50);
  days   : Integer;
  label  : String(100);
  active : Boolean default true;
}

@assert.unique: {configKey: [key]}
entity ConfigReportReason : cuid, managed {
  ![key]   : String(100);
  label    : String(200);
  severity : String(20);
  active   : Boolean default true;
}

@assert.unique: {configKey: [key]}
entity ConfigChatAction : cuid, managed {
  ![key] : String(100);
  label  : String(200);
  active : Boolean default true;
}

@assert.unique: {configKey: [key]}
entity ConfigModerationRule : cuid, managed {
  ![key]    : String(100);
  condition : String(500);
  action    : String(100);
  active    : Boolean default true;
}

@assert.unique: {configKey: [key]}
entity ConfigApiProvider : cuid, managed {
  ![key]           : String(100);
  adapterInterface : String(100);
  status           : String(20) default 'inactive';
  costPerCall      : Decimal(10, 4) default 0;
  baseUrl          : String(500);
  active           : Boolean default true;
}

// ─── Alert configuration (Story 2-5) ────────────────────────────────────

@assert.unique: {name: [name]}
entity ConfigAlert : cuid, managed {
  name               : String(200);
  metric             : String(100);
  thresholdValue     : Decimal(15, 4);
  comparisonOperator : String(10);  // above, below, equals
  notificationMethod : String(10);  // in_app, email, both
  severityLevel      : String(10);  // info, warning, critical
  enabled            : Boolean default true;
  cooldownMinutes    : Integer default 60;
  lastTriggeredAt    : Timestamp;
}
