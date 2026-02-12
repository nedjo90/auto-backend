using {auto} from '../db/schema';

@path    : '/api/admin'
@requires: 'administrator'
service AdminService {
  entity ConfigParameters       as projection on auto.ConfigParameter;
  entity ConfigTexts            as projection on auto.ConfigText;
  entity ConfigFeatures         as projection on auto.ConfigFeature;
  entity ConfigBoostFactors     as projection on auto.ConfigBoostFactor;
  entity ConfigVehicleTypes     as projection on auto.ConfigVehicleType;
  entity ConfigListingDurations as projection on auto.ConfigListingDuration;
  entity ConfigReportReasons    as projection on auto.ConfigReportReason;
  entity ConfigChatActions      as projection on auto.ConfigChatAction;
  entity ConfigModerationRules  as projection on auto.ConfigModerationRule;
  entity ConfigApiProviders     as projection on auto.ConfigApiProvider;
  entity ConfigAlerts           as projection on auto.ConfigAlert;
  entity ConfigSeoTemplates     as projection on auto.ConfigSeoTemplate;
  @readonly entity ConfigRegistrationFields as projection on auto.ConfigRegistrationField;
  @readonly entity ConfigProfileFields      as projection on auto.ConfigProfileField;
  @readonly entity ApiCallLogs              as projection on auto.ApiCallLog;
  @readonly entity AlertEvents             as projection on auto.AlertEvent;

  // ─── Audit Trail (Story 2-8) ─────────────────────────────────────────
  @readonly entity AuditTrailEntries as projection on auto.AuditTrailEntry;

  // ─── Legal document management (Story 2-7) ─────────────────────────────
  entity LegalDocuments        as projection on auto.LegalDocument;
  entity LegalDocumentVersions as projection on auto.LegalDocumentVersion;
  @readonly entity LegalAcceptances as projection on auto.LegalAcceptance;

  /** Estimate impact of changing a config parameter */
  action estimateConfigImpact(parameterKey : String(100) not null) returns {
    affectedCount : Integer;
    message       : String;
  };

  /** Get aggregated API cost summary for a time period */
  action getApiCostSummary(period : String(20) not null) returns {
    totalCost      : Decimal(10, 4);
    callCount      : Integer;
    avgCostPerCall : Decimal(10, 4);
    byProvider     : LargeString;
  };

  /** Get analytics for a specific provider */
  action getProviderAnalytics(providerKey : String(100) not null) returns {
    avgResponseTimeMs : Integer;
    successRate       : Decimal(5, 2);
    totalCalls        : Integer;
    totalCost         : Decimal(10, 4);
    avgCostPerCall    : Decimal(10, 4);
    lastCallTimestamp : String;
  };

  /** Switch active provider for an adapter interface (mutual exclusion) */
  action switchProvider(adapterInterface : String(100) not null, newProviderKey : String(100) not null) returns {
    success : Boolean;
    message : String;
  };

  /** KPI value with trend comparison */
  type KpiValue {
    current  : Integer;
    previous : Integer;
    trend    : Decimal(5, 1);
  }

  /** Traffic source breakdown entry */
  type TrafficSource {
    source     : String;
    visits     : Integer;
    percentage : Decimal(5, 1);
  }

  /** Get all dashboard KPIs for a period */
  action getDashboardKpis(period : String(20) not null) returns {
    visitors       : KpiValue;
    registrations  : KpiValue;
    listings       : KpiValue;
    contacts       : KpiValue;
    sales          : KpiValue;
    revenue        : KpiValue;
    trafficSources : array of TrafficSource;
  };

  /** Get trend data for a specific metric over N days */
  action getDashboardTrend(metric : String(50) not null, days : Integer not null) returns array of {
    date  : Date;
    value : Integer;
  };

  /** Get drill-down data for a specific KPI metric */
  action getKpiDrillDown(metric : String(50) not null, period : String(20) not null) returns array of {
    date  : Date;
    value : Integer;
  };

  /** Publish a new version of a legal document */
  action publishLegalVersion(
    documentId          : UUID not null,
    content             : LargeString not null,
    summary             : String(500),
    requiresReacceptance : Boolean
  ) returns LegalDocumentVersions;

  /** Get count of acceptances for a legal document */
  function getLegalAcceptanceCount(documentId : UUID not null) returns Integer;

  /** Acknowledge an alert event */
  action acknowledgeAlert(alertEventId : String(36) not null) returns {
    success : Boolean;
    message : String;
  };

  /** Get unacknowledged alert events */
  action getActiveAlerts() returns array of {
    ID             : String;
    alertId        : String;
    metric         : String;
    currentValue   : Decimal;
    thresholdValue : Decimal;
    severity       : String;
    message        : String;
    createdAt      : String;
  };

  /** Export audit trail entries as CSV */
  action exportAuditTrail(
    dateFrom   : String,
    dateTo     : String,
    action     : String,
    actorId    : String,
    targetType : String,
    severity   : String
  ) returns LargeString;

  /** Export API call logs as CSV */
  action exportApiCallLogs(
    dateFrom : String,
    dateTo   : String,
    provider : String,
    adapter  : String
  ) returns LargeString;
}
