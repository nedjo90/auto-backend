import cds from "@sap/cds";
import {
  handleStartOrResumeConversation,
  handleSendMessage,
  handleGetConversations,
  handleGetMessages,
  handleMarkAsDelivered,
  handleMarkAsRead,
  handleGetUnreadCount,
} from "./handlers/chat-handler";

const LOG = cds.log("chat-service");

export default class ChatServiceHandler extends cds.ApplicationService {
  async init() {
    this.on("startOrResumeConversation", handleStartOrResumeConversation);
    this.on("sendMessage", handleSendMessage);
    this.on("getConversations", handleGetConversations);
    this.on("getMessages", handleGetMessages);
    this.on("markAsDelivered", handleMarkAsDelivered);
    this.on("markAsRead", handleMarkAsRead);
    this.on("getUnreadCount", handleGetUnreadCount);

    LOG.info("ChatService initialized");
    await super.init();
  }
}
