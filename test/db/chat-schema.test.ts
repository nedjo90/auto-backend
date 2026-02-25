import * as fs from "fs";
import * as path from "path";

const rootDir = path.resolve(__dirname, "../..");

describe("CDS Schema - Chat (Story 5-1, Task 1)", () => {
  const chatCds = fs.readFileSync(path.join(rootDir, "db/schema/chat.cds"), "utf-8");

  it("should use auto namespace", () => {
    expect(chatCds).toContain("namespace auto;");
  });

  it("should import cuid and managed from @sap/cds/common", () => {
    expect(chatCds).toContain("using {cuid, managed} from '@sap/cds/common'");
  });

  describe("Conversation entity", () => {
    it("should define Conversation with cuid and managed aspects", () => {
      expect(chatCds).toContain("entity Conversation : cuid, managed");
    });

    it("should have buyerId field (not null)", () => {
      expect(chatCds).toMatch(/buyerId\s+:\s+String\(36\)\s+not\s+null/);
    });

    it("should have sellerId field (not null)", () => {
      expect(chatCds).toMatch(/sellerId\s+:\s+String\(36\)\s+not\s+null/);
    });

    it("should have listingId field (not null)", () => {
      expect(chatCds).toMatch(/listingId\s+:\s+String\(36\)\s+not\s+null/);
    });

    it("should have lastMessageAt timestamp field", () => {
      expect(chatCds).toMatch(/lastMessageAt\s+:\s+Timestamp/);
    });

    it("should enforce unique constraint on (buyerId, sellerId, listingId)", () => {
      expect(chatCds).toContain("assert.unique");
      expect(chatCds).toContain("buyerSellerListing");
      expect(chatCds).toContain("buyerId");
      expect(chatCds).toContain("sellerId");
      expect(chatCds).toContain("listingId");
    });
  });

  describe("ChatMessage entity", () => {
    it("should define ChatMessage with cuid aspect", () => {
      expect(chatCds).toContain("entity ChatMessage : cuid");
    });

    it("should have conversationId field (not null)", () => {
      expect(chatCds).toMatch(/conversationId\s+:\s+String\(36\)\s+not\s+null/);
    });

    it("should have senderId field (not null)", () => {
      expect(chatCds).toMatch(/senderId\s+:\s+String\(36\)\s+not\s+null/);
    });

    it("should have content field (not null, max 2000 chars)", () => {
      expect(chatCds).toMatch(/content\s+:\s+String\(2000\)\s+not\s+null/);
    });

    it("should have timestamp field (not null)", () => {
      expect(chatCds).toMatch(/timestamp\s+:\s+Timestamp\s+not\s+null/);
    });

    it("should have deliveryStatus field with default 'sent'", () => {
      expect(chatCds).toContain("deliveryStatus");
      expect(chatCds).toContain("default 'sent'");
    });
  });
});

describe("CDS Schema - schema.cds imports chat", () => {
  const schemaCds = fs.readFileSync(path.join(rootDir, "db/schema.cds"), "utf-8");

  it("should import chat schema", () => {
    expect(schemaCds).toContain("using from './schema/chat'");
  });
});

describe("CDS Service - ChatService (Story 5-1, Task 1.3)", () => {
  const chatServiceCds = fs.readFileSync(path.join(rootDir, "srv/chat-service.cds"), "utf-8");

  it("should define ChatService with /api/chat path", () => {
    expect(chatServiceCds).toContain("@path");
    expect(chatServiceCds).toContain("/api/chat");
    expect(chatServiceCds).toContain("service ChatService");
  });

  it("should require authenticated-user", () => {
    expect(chatServiceCds).toContain("@requires: 'authenticated-user'");
  });

  it("should define startOrResumeConversation action", () => {
    expect(chatServiceCds).toContain("action startOrResumeConversation");
    expect(chatServiceCds).toContain("listingId");
    expect(chatServiceCds).toContain("buyerId");
    expect(chatServiceCds).toContain("conversationId");
    expect(chatServiceCds).toContain("isNew");
  });

  it("should define sendMessage action", () => {
    expect(chatServiceCds).toContain("action sendMessage");
    expect(chatServiceCds).toContain("conversationId");
    expect(chatServiceCds).toContain("content");
    expect(chatServiceCds).toContain("messageId");
    expect(chatServiceCds).toContain("deliveryStatus");
  });

  it("should define getConversations action", () => {
    expect(chatServiceCds).toContain("action getConversations");
  });

  it("should define getMessages action with cursor-based pagination", () => {
    expect(chatServiceCds).toContain("action getMessages");
    expect(chatServiceCds).toContain("cursor");
  });

  it("should define markAsDelivered action", () => {
    expect(chatServiceCds).toContain("action markAsDelivered");
    expect(chatServiceCds).toContain("messageIds");
  });

  it("should define markAsRead action", () => {
    expect(chatServiceCds).toContain("action markAsRead");
    expect(chatServiceCds).toContain("messageIds");
  });

  it("should define getUnreadCount function", () => {
    expect(chatServiceCds).toContain("function getUnreadCount");
  });
});
