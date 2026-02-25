import cds from "@sap/cds";
import {
  handleGetNotificationsV2,
  handleMarkNotificationsReadV2,
  handleGetUnreadCountV2,
  handleUpdatePreference,
  handleGetPreferences,
  handleRegisterPushSubscription,
  handleUnregisterPushSubscription,
  handleGetPushSubscriptions,
} from "./handlers/notification-v2-handler";

const LOG = cds.log("notification-service");

export default class NotificationServiceHandler extends cds.ApplicationService {
  async init() {
    this.on("getNotifications", handleGetNotificationsV2);
    this.on("markNotificationsRead", handleMarkNotificationsReadV2);
    this.on("getUnreadCount", handleGetUnreadCountV2);
    this.on("updatePreference", handleUpdatePreference);
    this.on("getPreferences", handleGetPreferences);
    this.on("registerPushSubscription", handleRegisterPushSubscription);
    this.on("unregisterPushSubscription", handleUnregisterPushSubscription);
    this.on("getPushSubscriptions", handleGetPushSubscriptions);

    LOG.info("NotificationService initialized");
    await super.init();
  }
}
