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

  /** Moderator-only: fetch paginated report queue with filters */
  @requires: 'moderator'
  action getReportQueue(
    status     : String(20),
    targetType : String(20),
    severity   : String(20),
    sortBy     : String(20),
    skip       : Integer,
    top        : Integer
  ) returns {
    items   : LargeString;
    total   : Integer;
    hasMore : Boolean;
  };

  /** Moderator-only: fetch report queue metrics summary */
  @requires: 'moderator'
  action getReportMetrics() returns {
    pendingCount      : Integer;
    inProgressCount   : Integer;
    treatedThisWeek   : Integer;
    dismissedThisWeek : Integer;
    weeklyTrend       : Double;
  };

  /** Moderator-only: fetch full report detail with context */
  @requires: 'moderator'
  action getReportDetail(
    reportId : String(36) not null
  ) returns LargeString;

  /** Moderator-only: assign a report to the current moderator */
  @requires: 'moderator'
  action assignReport(
    reportId : String(36) not null
  ) returns {
    success : Boolean;
    status  : String(20);
  };
}
