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

  /** Moderator-only: deactivate (suspend) a listing */
  @requires: 'moderator'
  action deactivateListing(
    reportId  : String(36) not null,
    listingId : String(36) not null,
    reason    : String(1000)
  ) returns {
    success  : Boolean;
    actionId : String(36);
    message  : String;
  };

  /** Moderator-only: send a warning to a user */
  @requires: 'moderator'
  action sendWarning(
    reportId       : String(36) not null,
    userId         : String(36) not null,
    warningMessage : String(1000)
  ) returns {
    success  : Boolean;
    actionId : String(36);
    message  : String;
  };

  /** Moderator-only: deactivate (suspend) a user account */
  @requires: 'moderator'
  action deactivateAccount(
    reportId  : String(36),
    userId    : String(36) not null,
    reason    : String(1000),
    confirmed : Boolean not null
  ) returns {
    success  : Boolean;
    actionId : String(36);
    message  : String;
  };

  /** Moderator-only: reactivate a suspended listing */
  @requires: 'moderator'
  action reactivateListing(
    listingId : String(36) not null,
    reason    : String(1000)
  ) returns {
    success  : Boolean;
    actionId : String(36);
    message  : String;
  };

  /** Moderator-only: reactivate a suspended user account */
  @requires: 'moderator'
  action reactivateAccount(
    userId : String(36) not null,
    reason : String(1000)
  ) returns {
    success  : Boolean;
    actionId : String(36);
    message  : String;
  };

  /** Moderator-only: dismiss a report */
  @requires: 'moderator'
  action dismissReport(
    reportId : String(36) not null,
    reason   : String(1000)
  ) returns {
    success  : Boolean;
    actionId : String(36);
    message  : String;
  };

  /** Moderator-only: fetch seller moderation history with pattern detection */
  @requires: 'moderator'
  action getSellerHistory(
    sellerId : String(36) not null
  ) returns LargeString;
}
