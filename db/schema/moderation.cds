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
