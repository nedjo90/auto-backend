import cds from "@sap/cds";
import type { INotification, INotificationPreference, IPushSubscription } from "@auto/shared";
import { NOTIFICATIONS_PAGE_SIZE, PREFERENCE_NOTIFICATION_TYPES } from "@auto/shared";

const LOG = cds.log("notification-v2");

// ─── getNotifications ────────────────────────────────────────────────────────

export async function handleGetNotificationsV2(req: cds.Request) {
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

export async function handleMarkNotificationsReadV2(req: cds.Request) {
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

export async function handleGetUnreadCountV2(req: cds.Request) {
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

// ─── updatePreference ────────────────────────────────────────────────────────

export async function handleUpdatePreference(req: cds.Request) {
  const userId = req.user?.id;
  const { type, enabled } = req.data as { type: string; enabled: boolean };

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  if (!type || typeof enabled !== "boolean") {
    return req.error(400, "Paramètres manquants");
  }

  // Validate type is configurable
  if (!(PREFERENCE_NOTIFICATION_TYPES as readonly string[]).includes(type)) {
    return req.error(400, "Type de notification non configurable");
  }

  const entities = cds.entities("auto");

  // Upsert: check if preference exists
  const existing = await cds.run(
    SELECT.one.from(entities["NotificationPreference"]).where({ userId, type }),
  );

  if (existing) {
    await cds.run(
      UPDATE(entities["NotificationPreference"]).set({ enabled }).where({ ID: existing.ID }),
    );
  } else {
    await cds.run(
      INSERT.into(entities["NotificationPreference"]).entries({
        ID: cds.utils.uuid(),
        userId,
        type,
        enabled,
      }),
    );
  }

  LOG.info(`User ${userId} updated preference: ${type} = ${enabled}`);
  return { success: true };
}

// ─── getPreferences ──────────────────────────────────────────────────────────

export async function handleGetPreferences(req: cds.Request) {
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");

  const stored = await cds.run(SELECT.from(entities["NotificationPreference"]).where({ userId }));

  // Build complete list with defaults (all enabled unless overridden)
  const storedMap = new Map<string, { id: string; enabled: boolean }>();
  for (const p of stored) {
    storedMap.set(p.type as string, { id: p.ID as string, enabled: p.enabled as boolean });
  }

  const preferences: INotificationPreference[] = PREFERENCE_NOTIFICATION_TYPES.map((type) => ({
    ID: storedMap.get(type)?.id || "",
    userId,
    type,
    enabled: storedMap.get(type)?.enabled ?? true,
  }));

  return { preferences: JSON.stringify(preferences) };
}

// ─── registerPushSubscription ────────────────────────────────────────────────

export async function handleRegisterPushSubscription(req: cds.Request) {
  const userId = req.user?.id;
  const { endpoint, p256dhKey, authKey, deviceLabel } = req.data as {
    endpoint: string;
    p256dhKey: string;
    authKey: string;
    deviceLabel?: string;
  };

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  if (!endpoint || !p256dhKey || !authKey) {
    return req.error(400, "Paramètres manquants");
  }

  const entities = cds.entities("auto");

  // Check for existing subscription with same endpoint
  const existing = await cds.run(
    SELECT.one.from(entities["PushSubscription"]).where({ userId, endpoint }),
  );

  if (existing) {
    // Update existing
    await cds.run(
      UPDATE(entities["PushSubscription"])
        .set({ p256dhKey, authKey, deviceLabel: deviceLabel || null })
        .where({ ID: existing.ID }),
    );
    return { subscriptionId: existing.ID };
  }

  const subscriptionId = cds.utils.uuid();
  await cds.run(
    INSERT.into(entities["PushSubscription"]).entries({
      ID: subscriptionId,
      userId,
      endpoint,
      p256dhKey,
      authKey,
      deviceLabel: deviceLabel || null,
      createdAt: new Date().toISOString(),
    }),
  );

  LOG.info(`User ${userId} registered push subscription ${subscriptionId}`);
  return { subscriptionId };
}

// ─── unregisterPushSubscription ──────────────────────────────────────────────

export async function handleUnregisterPushSubscription(req: cds.Request) {
  const userId = req.user?.id;
  const { subscriptionId } = req.data as { subscriptionId: string };

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  if (!subscriptionId) {
    return req.error(400, "Identifiant de souscription requis");
  }

  const entities = cds.entities("auto");

  // Only delete if owned by this user
  const result = await cds.run(
    DELETE.from(entities["PushSubscription"]).where({ ID: subscriptionId, userId }),
  );

  return { success: (result || 0) > 0 };
}

// ─── getPushSubscriptions ────────────────────────────────────────────────────

export async function handleGetPushSubscriptions(req: cds.Request) {
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");

  const subs = await cds.run(
    SELECT.from(entities["PushSubscription"]).where({ userId }).orderBy("createdAt desc"),
  );

  const subscriptions: IPushSubscription[] = subs.map((s: Record<string, unknown>) => ({
    ID: s.ID as string,
    userId: s.userId as string,
    endpoint: s.endpoint as string,
    p256dhKey: s.p256dhKey as string,
    authKey: s.authKey as string,
    deviceLabel: (s.deviceLabel as string) || null,
    createdAt: s.createdAt as string,
  }));

  return { subscriptions: JSON.stringify(subscriptions) };
}
