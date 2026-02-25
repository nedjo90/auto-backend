import cds from "@sap/cds";
import type { INotification } from "@auto/shared";
import { NOTIFICATIONS_PAGE_SIZE } from "@auto/shared";

const LOG = cds.log("notification");

// ─── getNotifications ────────────────────────────────────────────────────────

export async function handleGetNotifications(req: cds.Request) {
  const userId = req.user?.id;
  const { skip = 0, top = NOTIFICATIONS_PAGE_SIZE } = req.data as {
    skip?: number;
    top?: number;
  };

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");

  const countResult = await cds.run(
    SELECT.one.from(entities["Notification"]).columns("count(*) as cnt").where({ userId }),
  );
  const total = countResult?.cnt || 0;

  const unreadResult = await cds.run(
    SELECT.one
      .from(entities["Notification"])
      .columns("count(*) as cnt")
      .where({ userId, isRead: false }),
  );
  const unreadCount = unreadResult?.cnt || 0;

  if (total === 0) {
    return {
      items: JSON.stringify([]),
      total: 0,
      unreadCount: 0,
      hasMore: false,
    };
  }

  const notifications = await cds.run(
    SELECT.from(entities["Notification"])
      .where({ userId })
      .orderBy("createdAt desc")
      .limit(top, skip),
  );

  const items: INotification[] = notifications.map((n: Record<string, unknown>) => ({
    ID: n.ID as string,
    userId: n.userId as string,
    type: n.type as INotification["type"],
    title: (n.title as string) || "",
    body: (n.body as string) || (n.message as string) || "",
    message: (n.message as string) || (n.body as string) || "",
    actionUrl: (n.actionUrl as string) || null,
    listingId: (n.listingId as string) || null,
    isRead: (n.isRead as boolean) || false,
    createdAt: n.createdAt as string,
  }));

  return {
    items: JSON.stringify(items),
    total,
    unreadCount,
    hasMore: skip + top < total,
  };
}

// ─── markNotificationsRead ───────────────────────────────────────────────────

export async function handleMarkNotificationsRead(req: cds.Request) {
  const userId = req.user?.id;
  const { notificationIds: idsJson } = req.data as { notificationIds: string };

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");

  if (idsJson === "all") {
    const result = await cds.run(
      UPDATE(entities["Notification"]).set({ isRead: true }).where({ userId, isRead: false }),
    );
    LOG.info(`User ${userId} marked all notifications as read (${result} updated)`);
    return { success: true, updated: result || 0 };
  }

  let ids: string[];
  try {
    ids = JSON.parse(idsJson);
    if (!Array.isArray(ids)) throw new Error("Not an array");
  } catch {
    return req.error(400, "Format de notificationIds invalide");
  }

  if (ids.length === 0) {
    return { success: true, updated: 0 };
  }

  const result = await cds.run(
    UPDATE(entities["Notification"])
      .set({ isRead: true })
      .where({ userId, ID: { in: ids }, isRead: false }),
  );

  return { success: true, updated: result || 0 };
}

// ─── getUnreadCount ──────────────────────────────────────────────────────────

export async function handleGetUnreadCount(req: cds.Request) {
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");

  const result = await cds.run(
    SELECT.one
      .from(entities["Notification"])
      .columns("count(*) as cnt")
      .where({ userId, isRead: false }),
  );

  return { count: result?.cnt || 0 };
}
