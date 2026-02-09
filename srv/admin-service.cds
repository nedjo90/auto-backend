using {auto} from '../db/schema';

@path    : '/api/admin'
@requires: 'admin'
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
}
