using {auto} from '../db/schema';

@path    : '/api/chat'
@requires: 'authenticated-user'
service ChatService {
  /** Start or resume a conversation for a listing between buyer and seller */
  action startOrResumeConversation(
    listingId : String(36) not null,
    buyerId   : String(36) not null
  ) returns {
    conversationId : String(36);
    isNew          : Boolean;
  };

  /** Send a message in a conversation */
  action sendMessage(
    conversationId : String(36) not null,
    content        : String(2000) not null
  ) returns {
    messageId      : String(36);
    timestamp      : String;
    deliveryStatus : String(20);
  };

  /** Get user's conversations with aggregated data */
  action getConversations(
    skip : Integer,
    top  : Integer
  ) returns {
    items   : LargeString;   // JSON array of IConversationListItem
    total   : Integer;
    hasMore : Boolean;
  };

  /** Get messages for a conversation (cursor-based pagination) */
  action getMessages(
    conversationId : String(36) not null,
    cursor         : String,
    limit          : Integer
  ) returns {
    messages : LargeString;   // JSON array of IChatMessage
    hasMore  : Boolean;
    cursor   : String;
  };

  /** Mark messages as delivered */
  action markAsDelivered(
    conversationId : String(36) not null,
    messageIds     : LargeString not null   // JSON array of message IDs
  ) returns {
    success : Boolean;
    updated : Integer;
  };

  /** Mark messages as read */
  action markAsRead(
    conversationId : String(36) not null,
    messageIds     : LargeString not null   // JSON array of message IDs
  ) returns {
    success : Boolean;
    updated : Integer;
  };

  /** Get total unread message count across all conversations */
  function getUnreadCount() returns {
    count : Integer;
  };
}
