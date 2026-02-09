namespace auto;

using {cuid} from '@sap/cds/common';
using {auto.User} from './user';

type ExportStatus : String(20) enum {
  pending;
  processing;
  ready;
  downloaded;
  expired;
}

type AnonymizationStatus : String(20) enum {
  requested;
  confirmed;
  processing;
  completed;
  failed;
}

entity DataExportRequest : cuid {
  user          : Association to User;
  status        : ExportStatus default 'pending';
  requestedAt   : Timestamp;
  completedAt   : Timestamp;
  downloadUrl   : String(1000);
  expiresAt     : Timestamp;
  fileSizeBytes : Integer;
}

entity AnonymizationRequest : cuid {
  user             : Association to User;
  status           : AnonymizationStatus default 'requested';
  requestedAt      : Timestamp;
  confirmedAt      : Timestamp;
  completedAt      : Timestamp;
  anonymizedFields : LargeString;
}
