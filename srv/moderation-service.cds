using {auto} from '../db/schema';

@path    : '/api/moderation'
@requires: 'authenticated-user'
service ModerationService {
  /** Read-only: active report reasons for the reporting dialog */
  @readonly
  entity ReportReasons as projection on auto.ConfigReportReason;

  /** Submit a new abuse report */
  action submitReport(
    targetType  : String(20) not null,
    targetId    : String(36) not null,
    reasonId    : String(36) not null,
    description : String(2000) not null
  ) returns {
    reportId  : String(36);
    status    : String(20);
    createdAt : String;
  };
}
