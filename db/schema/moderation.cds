namespace auto;

using {cuid, managed} from '@sap/cds/common';

// ─── Report entity (Story 7-1) ──────────────────────────────────────────────

entity Report : cuid, managed {
  reporterId  : String(36) not null;
  targetType  : String(20) not null;   // listing, user, chat
  targetId    : String(36) not null;
  reasonId    : String(36) not null;   // FK to ConfigReportReason
  severity    : String(20) not null;   // low, medium, high, critical
  description : String(2000);
  status      : String(20) default 'pending';  // pending, in_progress, treated, dismissed
  assignedTo  : String(36);                     // moderator user ID
}

// ─── ModerationAction entity (Story 7-3) ────────────────────────────────────

entity ModerationAction : cuid, managed {
  reportId    : String(36);             // FK to Report (nullable for direct actions)
  moderatorId : String(36) not null;    // FK to User (moderator)
  actionType  : String(30) not null;    // deactivate_listing, deactivate_account, warning, reactivate_listing, reactivate_account, dismiss
  reason      : String(1000);
  targetType  : String(20) not null;    // listing, user
  targetId    : String(36) not null;
}
