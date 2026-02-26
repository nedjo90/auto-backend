import cds from "@sap/cds";
import { handleSubmitReport } from "./handlers/moderation-handler";

export default class ModerationServiceHandler extends cds.ApplicationService {
  async init() {
    this.on("submitReport", handleSubmitReport);
    await super.init();
  }
}
