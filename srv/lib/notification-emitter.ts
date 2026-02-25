import cds from "@sap/cds";
import type { ICreateNotificationInput, INotificationEvent, IUnreadCountEvent } from "@auto/shared";
import { NOTIFICATION_HUB_NAME, NOTIFICATION_EVENTS } from "@auto/shared";
import { signalrClient } from "./signalr-client";

const LOG = cds.log("notification-emitter");

/**
 * Create a notification, check user preferences, persist it, and emit SignalR events.
 * Returns the notification ID if created, null if blocked by preference.
 */
export async function createNotification(input: ICreateNotificationInput): Promise<string | null> {
  const entities = cds.entities("auto");
  const { userId, type, title, body, actionUrl, listingId } = input;

  // Check user preference (system notifications always go through)
  if (type !== "system") {
    const pref = await cds.run(
      SELECT.one.from(entities["NotificationPreference"]).where({ userId, type }),
    );
    if (pref && pref.enabled === false) {
      LOG.debug(`Notification ${type} blocked by user ${userId} preference`);
      return null;
    }
  }

  const notificationId = cds.utils.uuid();
  const now = new Date().toISOString();

  await cds.run(
    INSERT.into(entities["Notification"]).entries({
      ID: notificationId,
      userId,
      type,
      title,
      body,
      message: body, // backward compat
      actionUrl: actionUrl || null,
      listingId: listingId || null,
      isRead: false,
      createdAt: now,
    }),
  );

  // Emit SignalR event to user
  const eventPayload: INotificationEvent = {
    notificationId,
    type,
    title,
    body,
    actionUrl: actionUrl || null,
    listingId: listingId || null,
  };

  try {
    await signalrClient.sendToUser(
      NOTIFICATION_HUB_NAME,
      userId,
      NOTIFICATION_EVENTS.newNotification,
      eventPayload as unknown as Record<string, unknown>,
    );

    // Also emit updated unread count
    const countResult = await cds.run(
      SELECT.one
        .from(entities["Notification"])
        .columns("count(*) as cnt")
        .where({ userId, isRead: false }),
    );
    const unreadPayload: IUnreadCountEvent = { count: countResult?.cnt || 0 };
    await signalrClient.sendToUser(
      NOTIFICATION_HUB_NAME,
      userId,
      NOTIFICATION_EVENTS.unreadCountUpdate,
      unreadPayload as unknown as Record<string, unknown>,
    );
  } catch (err) {
    LOG.warn("SignalR notification emit failed:", err);
  }

  LOG.info(`Notification ${notificationId} (${type}) created for user ${userId}`);
  return notificationId;
}
