import cds from "@sap/cds";
import { handleSubmitReport } from "./handlers/moderation-handler";
import {
  handleGetReportQueue,
  handleGetReportMetrics,
  handleGetReportDetail,
  handleAssignReport,
} from "./handlers/moderation-queue-handler";

export default class ModerationServiceHandler extends cds.ApplicationService {
  async init() {
    this.on("submitReport", handleSubmitReport);
    this.on("getReportQueue", handleGetReportQueue);
    this.on("getReportMetrics", handleGetReportMetrics);
    this.on("getReportDetail", handleGetReportDetail);
    this.on("assignReport", handleAssignReport);
    await super.init();
  }
}
