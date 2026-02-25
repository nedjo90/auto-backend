/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
export {};

// Mock SignalR client
const mockSendToUser = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../srv/lib/signalr-client", () => ({
  signalrClient: {
    sendToUser: (...args: any[]) => mockSendToUser(...args),
    isConfigured: () => true,
  },
}));

const mockRun = jest.fn();
const mockEntities = jest.fn();
const mockUuid = jest.fn().mockReturnValue("new-uuid-1234");

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      log: jest.fn(() => mockLog),
      run: (...args: any[]) => mockRun(...args),
      entities: (...args: any[]) => mockEntities(...args),
      utils: { uuid: () => mockUuid() },
    },
  };
});

// Mock CDS query builders
const mockWhere = jest.fn().mockReturnThis();
const mockColumns = jest.fn().mockReturnThis();
const mockOrderBy = jest.fn().mockReturnThis();
const mockLimit = jest.fn().mockReturnThis();
const mockSet = jest.fn().mockReturnThis();
const mockEntries = jest.fn().mockReturnThis();

(global as any).SELECT = {
  from: jest.fn().mockReturnValue({
    columns: mockColumns,
    where: mockWhere,
    orderBy: mockOrderBy,
    limit: mockLimit,
  }),
  one: {
    from: jest.fn().mockReturnValue({
      columns: mockColumns,
      where: mockWhere,
    }),
  },
};

(global as any).UPDATE = jest.fn().mockReturnValue({
  set: mockSet,
  where: mockWhere,
});

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: mockEntries,
  }),
};

(global as any).DELETE = {
  from: jest.fn().mockReturnValue({
    where: mockWhere,
  }),
};

// Re-wire chain returns
mockColumns.mockReturnValue({
  where: mockWhere,
  orderBy: mockOrderBy,
  limit: mockLimit,
});
mockWhere.mockReturnValue({
  orderBy: mockOrderBy,
  limit: mockLimit,
});
mockOrderBy.mockReturnValue({
  limit: mockLimit,
});
mockSet.mockReturnValue({
  where: mockWhere,
});

const fakeEntities: Record<string, string> = {
  Conversation: "Conversation",
  ChatMessage: "ChatMessage",
  Listing: "Listing",
  ListingPhoto: "ListingPhoto",
  User: "User",
};

import cds from "@sap/cds";
import {
  handleStartOrResumeConversation,
  handleSendMessage,
  handleGetMessages,
  handleMarkAsDelivered,
  handleMarkAsRead,
  handleGetUnreadCount,
} from "../../../srv/handlers/chat-handler";

function makeReq(data: Record<string, unknown>, userId = "buyer-1") {
  const errors: { code: number; message: string }[] = [];
  return {
    data,
    user: { id: userId },
    error: (code: number, message: string) => {
      errors.push({ code, message });
    },
    _errors: errors,
  } as unknown as cds.Request;
}

describe("Chat Handler (Story 5-1, Task 2)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEntities.mockReturnValue(fakeEntities);
  });

  // ─── startOrResumeConversation ───────────────────────────────────────────

  describe("handleStartOrResumeConversation", () => {
    it("should create a new conversation when none exists", async () => {
      // Listing exists and is published
      mockRun
        .mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1", status: "published" }) // SELECT listing
        .mockResolvedValueOnce(null) // SELECT existing conversation
        .mockResolvedValueOnce(undefined); // INSERT

      const req = makeReq({ listingId: "listing-1", buyerId: "buyer-1" }, "buyer-1");
      const result = await handleStartOrResumeConversation(req);

      expect(result).toEqual({ conversationId: "new-uuid-1234", isNew: true });
    });

    it("should resume an existing conversation", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1", status: "published" }) // SELECT listing
        .mockResolvedValueOnce({ ID: "conv-existing" }); // SELECT existing conversation

      const req = makeReq({ listingId: "listing-1", buyerId: "buyer-1" }, "buyer-1");
      const result = await handleStartOrResumeConversation(req);

      expect(result).toEqual({ conversationId: "conv-existing", isNew: false });
    });

    it("should reject if listing not found", async () => {
      mockRun.mockResolvedValueOnce(null);

      const req = makeReq({ listingId: "missing", buyerId: "buyer-1" }, "buyer-1");
      await handleStartOrResumeConversation(req);

      expect((req as any)._errors[0]).toEqual(expect.objectContaining({ code: 404 }));
    });

    it("should reject if listing not published", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1", status: "draft" });

      const req = makeReq({ listingId: "listing-1", buyerId: "buyer-1" }, "buyer-1");
      await handleStartOrResumeConversation(req);

      expect((req as any)._errors[0]).toEqual(expect.objectContaining({ code: 400 }));
    });

    it("should reject if buyer is the seller", async () => {
      mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "buyer-1", status: "published" });

      const req = makeReq({ listingId: "listing-1", buyerId: "buyer-1" }, "buyer-1");
      await handleStartOrResumeConversation(req);

      expect((req as any)._errors[0]).toEqual(expect.objectContaining({ code: 400 }));
    });

    it("should reject unauthenticated users", async () => {
      const req = makeReq({ listingId: "listing-1", buyerId: "buyer-1" });
      (req as any).user = { id: undefined };

      await handleStartOrResumeConversation(req);

      expect((req as any)._errors[0]).toEqual(expect.objectContaining({ code: 401 }));
    });
  });

  // ─── sendMessage ─────────────────────────────────────────────────────────

  describe("handleSendMessage", () => {
    it("should send a message and emit SignalR event", async () => {
      mockRun
        .mockResolvedValueOnce({
          ID: "conv-1",
          buyerId: "buyer-1",
          sellerId: "seller-1",
          listingId: "listing-1",
        }) // SELECT conversation
        .mockResolvedValueOnce(undefined) // INSERT message
        .mockResolvedValueOnce(undefined); // UPDATE conversation

      const req = makeReq({ conversationId: "conv-1", content: "Hello!" }, "buyer-1");
      const result = await handleSendMessage(req);

      expect(result).toEqual(
        expect.objectContaining({
          messageId: "new-uuid-1234",
          deliveryStatus: "sent",
        }),
      );
      expect(mockSendToUser).toHaveBeenCalledWith(
        "chat",
        "seller-1",
        "chat:message-sent",
        expect.objectContaining({
          conversationId: "conv-1",
          senderId: "buyer-1",
          content: "Hello!",
        }),
      );
    });

    it("should reject empty content", async () => {
      const req = makeReq({ conversationId: "conv-1", content: "   " }, "buyer-1");
      await handleSendMessage(req);

      expect((req as any)._errors[0]).toEqual(expect.objectContaining({ code: 400 }));
    });

    it("should reject if not a participant", async () => {
      mockRun.mockResolvedValueOnce({
        ID: "conv-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
      });

      const req = makeReq({ conversationId: "conv-1", content: "Hello!" }, "intruder");
      await handleSendMessage(req);

      expect((req as any)._errors[0]).toEqual(expect.objectContaining({ code: 403 }));
    });

    it("should reject if conversation not found", async () => {
      mockRun.mockResolvedValueOnce(null);

      const req = makeReq({ conversationId: "missing", content: "Hello!" }, "buyer-1");
      await handleSendMessage(req);

      expect((req as any)._errors[0]).toEqual(expect.objectContaining({ code: 404 }));
    });
  });

  // ─── getMessages ─────────────────────────────────────────────────────────

  describe("handleGetMessages", () => {
    it("should return messages with cursor-based pagination", async () => {
      const mockMessages = [
        {
          ID: "msg-2",
          conversationId: "conv-1",
          senderId: "seller-1",
          content: "Yes!",
          timestamp: "2026-02-25T10:01:00Z",
          deliveryStatus: "sent",
        },
        {
          ID: "msg-1",
          conversationId: "conv-1",
          senderId: "buyer-1",
          content: "Is it available?",
          timestamp: "2026-02-25T10:00:00Z",
          deliveryStatus: "read",
        },
      ];

      mockRun
        .mockResolvedValueOnce({ ID: "conv-1", buyerId: "buyer-1", sellerId: "seller-1" }) // SELECT conversation
        .mockResolvedValueOnce(mockMessages); // SELECT messages

      const req = makeReq({ conversationId: "conv-1", limit: 50 }, "buyer-1");
      const result = await handleGetMessages(req);

      expect(result).toEqual(
        expect.objectContaining({
          hasMore: false,
        }),
      );
      const messages = JSON.parse((result as any).messages);
      expect(messages).toHaveLength(2);
      expect(messages[0].ID).toBe("msg-2");
    });

    it("should reject unauthorized access", async () => {
      mockRun.mockResolvedValueOnce({ ID: "conv-1", buyerId: "buyer-1", sellerId: "seller-1" });

      const req = makeReq({ conversationId: "conv-1" }, "intruder");
      await handleGetMessages(req);

      expect((req as any)._errors[0]).toEqual(expect.objectContaining({ code: 403 }));
    });
  });

  // ─── markAsDelivered ───────────────────────────────────────────────────

  describe("handleMarkAsDelivered", () => {
    it("should mark messages as delivered", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "conv-1", buyerId: "buyer-1", sellerId: "seller-1" }) // SELECT conversation
        .mockResolvedValueOnce({ ID: "msg-1", senderId: "seller-1", deliveryStatus: "sent" }) // SELECT message
        .mockResolvedValueOnce(undefined); // UPDATE message

      const req = makeReq(
        { conversationId: "conv-1", messageIds: JSON.stringify(["msg-1"]) },
        "buyer-1",
      );
      const result = await handleMarkAsDelivered(req);

      expect(result).toEqual({ success: true, updated: 1 });
    });

    it("should not update own messages", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "conv-1", buyerId: "buyer-1", sellerId: "seller-1" }) // SELECT conversation
        .mockResolvedValueOnce(null); // SELECT message (not found because senderId != userId filter)

      const req = makeReq(
        { conversationId: "conv-1", messageIds: JSON.stringify(["msg-1"]) },
        "buyer-1",
      );
      const result = await handleMarkAsRead(req);

      expect(result).toEqual({ success: true, updated: 0 });
    });
  });

  // ─── markAsRead ────────────────────────────────────────────────────────

  describe("handleMarkAsRead", () => {
    it("should mark messages as read", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "conv-1", buyerId: "buyer-1", sellerId: "seller-1" })
        .mockResolvedValueOnce({ ID: "msg-1", senderId: "seller-1", deliveryStatus: "delivered" })
        .mockResolvedValueOnce(undefined);

      const req = makeReq(
        { conversationId: "conv-1", messageIds: JSON.stringify(["msg-1"]) },
        "buyer-1",
      );
      const result = await handleMarkAsRead(req);

      expect(result).toEqual({ success: true, updated: 1 });
    });

    it("should not downgrade read status", async () => {
      mockRun
        .mockResolvedValueOnce({ ID: "conv-1", buyerId: "buyer-1", sellerId: "seller-1" })
        .mockResolvedValueOnce({ ID: "msg-1", senderId: "seller-1", deliveryStatus: "read" });

      const req = makeReq(
        { conversationId: "conv-1", messageIds: JSON.stringify(["msg-1"]) },
        "buyer-1",
      );
      const result = await handleMarkAsDelivered(req);

      expect(result).toEqual({ success: true, updated: 0 });
    });
  });

  // ─── getUnreadCount ────────────────────────────────────────────────────

  describe("handleGetUnreadCount", () => {
    it("should return 0 when no conversations", async () => {
      mockRun.mockResolvedValueOnce([]); // SELECT conversations

      const req = makeReq({}, "buyer-1");
      const result = await handleGetUnreadCount(req);

      expect(result).toEqual({ count: 0 });
    });

    it("should count unread messages across conversations", async () => {
      mockRun
        .mockResolvedValueOnce([
          { ID: "conv-1", buyerId: "buyer-1", sellerId: "seller-1" },
          { ID: "conv-2", buyerId: "buyer-1", sellerId: "seller-2" },
        ])
        .mockResolvedValueOnce({ cnt: 3 }) // conv-1 unread
        .mockResolvedValueOnce({ cnt: 1 }); // conv-2 unread

      const req = makeReq({}, "buyer-1");
      const result = await handleGetUnreadCount(req);

      expect(result).toEqual({ count: 4 });
    });

    it("should reject unauthenticated users", async () => {
      const req = makeReq({});
      (req as any).user = { id: undefined };

      await handleGetUnreadCount(req);

      expect((req as any)._errors[0]).toEqual(expect.objectContaining({ code: 401 }));
    });
  });
});
