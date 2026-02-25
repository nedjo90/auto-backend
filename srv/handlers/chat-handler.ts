import cds from "@sap/cds";
import type {
  IConversationListItem,
  IChatMessage,
  IChatMessageEvent,
  IChatStatusEvent,
} from "@auto/shared";
import {
  CHAT_MESSAGES_PAGE_SIZE,
  CHAT_CONVERSATIONS_PAGE_SIZE,
  CHAT_MAX_MESSAGE_LENGTH,
  CHAT_EVENTS,
  CHAT_HUB_NAME,
} from "@auto/shared";
import { signalrClient } from "../lib/signalr-client";
import { createNotification } from "../lib/notification-emitter";

const LOG = cds.log("chat");

// ─── startOrResumeConversation ───────────────────────────────────────────

export async function handleStartOrResumeConversation(req: cds.Request) {
  const { listingId, buyerId } = req.data as { listingId: string; buyerId: string };
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  if (!listingId || !buyerId) {
    return req.error(400, "Paramètres manquants");
  }

  const entities = cds.entities("auto");

  // Verify listing exists and is published
  const listing = await cds.run(SELECT.one.from(entities["Listing"]).where({ ID: listingId }));

  if (!listing) {
    return req.error(404, "Annonce introuvable");
  }

  if (listing.status !== "published") {
    return req.error(400, "Impossible de contacter le vendeur pour cette annonce");
  }

  // Buyer cannot be the seller
  if (buyerId === listing.sellerId) {
    return req.error(400, "Vous ne pouvez pas vous contacter vous-même");
  }

  // Only the buyer themselves or the seller can start a conversation
  if (userId !== buyerId && userId !== listing.sellerId) {
    return req.error(403, "Accès non autorisé");
  }

  // Check if conversation already exists
  const existing = await cds.run(
    SELECT.one
      .from(entities["Conversation"])
      .where({ buyerId, sellerId: listing.sellerId, listingId }),
  );

  if (existing) {
    LOG.info(`Resumed conversation ${existing.ID} for listing ${listingId}`);
    return { conversationId: existing.ID, isNew: false };
  }

  // Create new conversation
  const conversationId = cds.utils.uuid();
  const now = new Date().toISOString();

  await cds.run(
    INSERT.into(entities["Conversation"]).entries({
      ID: conversationId,
      buyerId,
      sellerId: listing.sellerId,
      listingId,
      createdAt: now,
      modifiedAt: now,
      lastMessageAt: null,
    }),
  );

  LOG.info(`Created conversation ${conversationId} for listing ${listingId}`);
  return { conversationId, isNew: true };
}

// ─── sendMessage ─────────────────────────────────────────────────────────

export async function handleSendMessage(req: cds.Request) {
  const { conversationId, content } = req.data as {
    conversationId: string;
    content: string;
  };
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  if (!conversationId || !content?.trim()) {
    return req.error(400, "Paramètres manquants");
  }

  if (content.trim().length > CHAT_MAX_MESSAGE_LENGTH) {
    return req.error(400, `Le message ne peut pas dépasser ${CHAT_MAX_MESSAGE_LENGTH} caractères`);
  }

  const entities = cds.entities("auto");

  // Verify conversation exists and user is a participant
  const conversation = await cds.run(
    SELECT.one.from(entities["Conversation"]).where({ ID: conversationId }),
  );

  if (!conversation) {
    return req.error(404, "Conversation introuvable");
  }

  if (userId !== conversation.buyerId && userId !== conversation.sellerId) {
    return req.error(403, "Accès non autorisé à cette conversation");
  }

  const messageId = cds.utils.uuid();
  const now = new Date().toISOString();
  const trimmedContent = content.trim();

  await cds.run(
    INSERT.into(entities["ChatMessage"]).entries({
      ID: messageId,
      conversationId,
      senderId: userId,
      content: trimmedContent,
      timestamp: now,
      deliveryStatus: "sent",
    }),
  );

  // Update conversation lastMessageAt
  await cds.run(
    UPDATE(entities["Conversation"])
      .set({ lastMessageAt: now, modifiedAt: now })
      .where({ ID: conversationId }),
  );

  // Emit SignalR event to the other party
  const recipientId =
    userId === conversation.buyerId ? conversation.sellerId : conversation.buyerId;

  const eventPayload: IChatMessageEvent = {
    conversationId,
    messageId,
    senderId: userId,
    content: trimmedContent,
    timestamp: now,
    listingId: conversation.listingId,
  };

  try {
    await signalrClient.sendToUser(
      CHAT_HUB_NAME,
      recipientId,
      CHAT_EVENTS.messageSent,
      eventPayload as unknown as Record<string, unknown>,
    );
  } catch (err) {
    LOG.warn("SignalR notification failed (message still persisted):", err);
  }

  // Create notification for the recipient (Story 5-2)
  try {
    await createNotification({
      userId: recipientId,
      type: "new_message",
      title: "Nouveau message",
      body: trimmedContent.length > 100 ? trimmedContent.slice(0, 97) + "..." : trimmedContent,
      actionUrl: `/seller/chat/${conversationId}`,
      listingId: conversation.listingId,
    });
  } catch {
    // Non-critical
  }

  LOG.info(`Message ${messageId} sent in conversation ${conversationId}`);
  return { messageId, timestamp: now, deliveryStatus: "sent" };
}

// ─── getConversations ────────────────────────────────────────────────────

export async function handleGetConversations(req: cds.Request) {
  const { skip = 0, top = CHAT_CONVERSATIONS_PAGE_SIZE } = req.data as {
    skip?: number;
    top?: number;
  };
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");

  // Get conversations where user is buyer or seller using CDS OR
  const conversations = await cds.run(
    SELECT.from(entities["Conversation"])
      .where({ or: [{ buyerId: userId }, { sellerId: userId }] })
      .orderBy("lastMessageAt desc", "createdAt desc")
      .limit(top + 1, skip),
  );

  const hasMore = conversations.length > top;
  const items = conversations.slice(0, top);

  // Enrich with listing data and unread counts
  const enriched: IConversationListItem[] = [];

  for (const conv of items) {
    const listing = await cds.run(
      SELECT.one.from(entities["Listing"]).where({ ID: conv.listingId }),
    );

    // Get first photo
    let photo: string | null = null;
    try {
      const photos = await cds.run(
        SELECT.from(entities["ListingPhoto"])
          .where({ listingId: conv.listingId })
          .orderBy("sortOrder asc")
          .limit(1),
      );
      if (photos.length > 0) {
        photo = photos[0].cdnUrl || null;
      }
    } catch {
      // ListingPhoto may not exist in test environments
    }

    // Get unread count
    const unreadResult = await cds.run(
      SELECT.one
        .from(entities["ChatMessage"])
        .columns("count(*) as cnt")
        .where({
          conversationId: conv.ID,
          deliveryStatus: { "!=": "read" },
          senderId: { "!=": userId },
        }),
    );

    // Get last message
    const lastMsg = await cds.run(
      SELECT.one
        .from(entities["ChatMessage"])
        .where({ conversationId: conv.ID })
        .orderBy("timestamp desc"),
    );

    // Get other party name
    const otherPartyId = userId === conv.buyerId ? conv.sellerId : conv.buyerId;
    let otherPartyName = "Utilisateur";
    try {
      const otherUser = await cds.run(
        SELECT.one.from(entities["User"]).where({ ID: otherPartyId }),
      );
      if (otherUser) {
        otherPartyName =
          [otherUser.firstName, otherUser.lastName].filter(Boolean).join(" ") || "Utilisateur";
      }
    } catch {
      // User entity may not be accessible
    }

    const title = listing
      ? [listing.make, listing.model, listing.year ? `(${listing.year})` : ""]
          .filter(Boolean)
          .join(" ")
      : "Annonce";

    enriched.push({
      conversationId: conv.ID,
      listingId: conv.listingId,
      listingTitle: title,
      listingPhoto: photo,
      listingPrice: listing?.price ?? null,
      otherPartyId,
      otherPartyName,
      lastMessage: lastMsg?.content ?? null,
      lastMessageAt: lastMsg?.timestamp ?? conv.lastMessageAt ?? conv.createdAt,
      unreadCount: unreadResult?.cnt ?? 0,
    });
  }

  // Count total conversations for user
  const countResult = await cds.run(
    SELECT.one
      .from(entities["Conversation"])
      .columns("count(*) as cnt")
      .where({ or: [{ buyerId: userId }, { sellerId: userId }] }),
  );
  const total = countResult?.cnt ?? 0;

  return {
    items: JSON.stringify(enriched),
    total,
    hasMore,
  };
}

// ─── getMessages ─────────────────────────────────────────────────────────

export async function handleGetMessages(req: cds.Request) {
  const {
    conversationId,
    cursor,
    limit = CHAT_MESSAGES_PAGE_SIZE,
  } = req.data as {
    conversationId: string;
    cursor?: string;
    limit?: number;
  };
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  if (!conversationId) {
    return req.error(400, "Identifiant de conversation requis");
  }

  const entities = cds.entities("auto");

  // Verify user is a participant
  const conversation = await cds.run(
    SELECT.one.from(entities["Conversation"]).where({ ID: conversationId }),
  );

  if (!conversation) {
    return req.error(404, "Conversation introuvable");
  }

  if (userId !== conversation.buyerId && userId !== conversation.sellerId) {
    return req.error(403, "Accès non autorisé à cette conversation");
  }

  // Fetch messages with cursor-based pagination
  let query = SELECT.from(entities["ChatMessage"])
    .where({ conversationId })
    .orderBy("timestamp desc")
    .limit(limit + 1);

  if (cursor) {
    query = SELECT.from(entities["ChatMessage"])
      .where({ conversationId, timestamp: { "<": cursor } })
      .orderBy("timestamp desc")
      .limit(limit + 1);
  }

  const messages = await cds.run(query);
  const hasMore = messages.length > limit;
  const pageMessages = messages.slice(0, limit);

  const result: IChatMessage[] = pageMessages.map((m: Record<string, unknown>) => ({
    ID: m.ID as string,
    conversationId: m.conversationId as string,
    senderId: m.senderId as string,
    content: m.content as string,
    timestamp: m.timestamp as string,
    deliveryStatus: m.deliveryStatus as IChatMessage["deliveryStatus"],
  }));

  const nextCursor =
    pageMessages.length > 0 ? (pageMessages[pageMessages.length - 1].timestamp as string) : null;

  return {
    messages: JSON.stringify(result),
    hasMore,
    cursor: nextCursor,
  };
}

// ─── markAsDelivered ─────────────────────────────────────────────────────

export async function handleMarkAsDelivered(req: cds.Request) {
  return updateMessageStatus(req, "delivered");
}

// ─── markAsRead ──────────────────────────────────────────────────────────

export async function handleMarkAsRead(req: cds.Request) {
  return updateMessageStatus(req, "read");
}

async function updateMessageStatus(req: cds.Request, status: "delivered" | "read") {
  const { conversationId, messageIds } = req.data as {
    conversationId: string;
    messageIds: string;
  };
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  if (!conversationId || !messageIds) {
    return req.error(400, "Paramètres manquants");
  }

  const entities = cds.entities("auto");

  // Verify user is a participant
  const conversation = await cds.run(
    SELECT.one.from(entities["Conversation"]).where({ ID: conversationId }),
  );

  if (!conversation) {
    return req.error(404, "Conversation introuvable");
  }

  if (userId !== conversation.buyerId && userId !== conversation.sellerId) {
    return req.error(403, "Accès non autorisé à cette conversation");
  }

  let ids: string[];
  try {
    ids = JSON.parse(messageIds);
  } catch {
    return req.error(400, "Format de messageIds invalide");
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return req.error(400, "Liste de messages vide");
  }

  // Update messages that belong to this conversation and were NOT sent by current user
  let updated = 0;
  for (const msgId of ids) {
    const msg = await cds.run(
      SELECT.one.from(entities["ChatMessage"]).where({
        ID: msgId,
        conversationId,
        senderId: { "!=": userId },
      }),
    );

    if (msg && shouldUpdateStatus(msg.deliveryStatus as string, status)) {
      await cds.run(
        UPDATE(entities["ChatMessage"]).set({ deliveryStatus: status }).where({ ID: msgId }),
      );
      updated++;

      // Emit SignalR status event
      const eventPayload: IChatStatusEvent = {
        conversationId,
        messageId: msgId,
        status,
      };
      const eventName =
        status === "delivered" ? CHAT_EVENTS.messageDelivered : CHAT_EVENTS.messageRead;

      try {
        await signalrClient.sendToUser(
          CHAT_HUB_NAME,
          msg.senderId as string,
          eventName,
          eventPayload as unknown as Record<string, unknown>,
        );
      } catch {
        // Non-critical
      }
    }
  }

  LOG.info(`Marked ${updated} messages as ${status} in conversation ${conversationId}`);
  return { success: true, updated };
}

function shouldUpdateStatus(current: string, target: string): boolean {
  const order = { sent: 0, delivered: 1, read: 2 };
  return (order[target as keyof typeof order] ?? 0) > (order[current as keyof typeof order] ?? 0);
}

// ─── getUnreadCount ──────────────────────────────────────────────────────

export async function handleGetUnreadCount(req: cds.Request) {
  const userId = req.user?.id;

  if (!userId) {
    return req.error(401, "Authentification requise");
  }

  const entities = cds.entities("auto");

  // Get user's conversation IDs using CDS OR
  const conversations = await cds.run(
    SELECT.from(entities["Conversation"])
      .columns("ID")
      .where({ or: [{ buyerId: userId }, { sellerId: userId }] }),
  );
  const userConvIds = conversations.map((c: Record<string, unknown>) => c.ID as string);

  if (userConvIds.length === 0) {
    return { count: 0 };
  }

  // Count unread messages across all user conversations in a single query
  const result = await cds.run(
    SELECT.one
      .from(entities["ChatMessage"])
      .columns("count(*) as cnt")
      .where({
        conversationId: { in: userConvIds },
        deliveryStatus: { "!=": "read" },
        senderId: { "!=": userId },
      }),
  );

  return { count: result?.cnt ?? 0 };
}
