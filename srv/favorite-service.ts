import cds from "@sap/cds";
import {
  handleToggleFavorite,
  handleCheckFavorites,
  handleGetMyFavorites,
  handleMarkAllAsSeen,
} from "./handlers/favorite-handler";
import {
  handleGetNotifications,
  handleMarkNotificationsRead,
  handleGetUnreadCount,
} from "./handlers/notification-handler";

const LOG = cds.log("favorite-service");

export default class FavoriteServiceHandler extends cds.ApplicationService {
  async init() {
    // Favorite actions
    this.on("toggleFavorite", handleToggleFavorite);
    this.on("checkFavorites", handleCheckFavorites);
    this.on("getMyFavorites", handleGetMyFavorites);
    this.on("markAllAsSeen", handleMarkAllAsSeen);

    // Notification actions
    this.on("getNotifications", handleGetNotifications);
    this.on("markNotificationsRead", handleMarkNotificationsRead);
    this.on("getUnreadCount", handleGetUnreadCount);

    LOG.info("FavoriteService initialized");
    await super.init();
  }
}
