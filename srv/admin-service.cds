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
  @readonly entity ConfigRegistrationFields as projection on auto.ConfigRegistrationField;
  @readonly entity ConfigProfileFields      as projection on auto.ConfigProfileField;
  @readonly entity ApiCallLogs              as projection on auto.ApiCallLog;

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
}
