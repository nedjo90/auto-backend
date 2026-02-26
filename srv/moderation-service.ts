import cds from "@sap/cds";
import { handleSubmitReport } from "./handlers/moderation-handler";
import {
  handleGetReportQueue,
  handleGetReportMetrics,
  handleGetReportDetail,
  handleAssignReport,
} from "./handlers/moderation-queue-handler";
import {
  handleDeactivateListing,
  handleSendWarning,
  handleDeactivateAccount,
  handleReactivateListing,
  handleReactivateAccount,
  handleDismissReport,
} from "./handlers/moderation-action-handler";
import { handleGetSellerHistory } from "./handlers/moderation-seller-history-handler";

export default class ModerationServiceHandler extends cds.ApplicationService {
  async init() {
    this.on("submitReport", handleSubmitReport);
    this.on("getReportQueue", handleGetReportQueue);
    this.on("getReportMetrics", handleGetReportMetrics);
    this.on("getReportDetail", handleGetReportDetail);
    this.on("assignReport", handleAssignReport);
    this.on("deactivateListing", handleDeactivateListing);
    this.on("sendWarning", handleSendWarning);
    this.on("deactivateAccount", handleDeactivateAccount);
    this.on("reactivateListing", handleReactivateListing);
    this.on("reactivateAccount", handleReactivateAccount);
    this.on("dismissReport", handleDismissReport);
    this.on("getSellerHistory", handleGetSellerHistory);
    await super.init();
  }
}
