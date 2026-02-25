using {auto} from '../db/schema';

@path    : '/api/notifications'
@requires: 'authenticated-user'
service NotificationService {
  /** Get user's notifications (paginated) */
  action getNotifications(
    skip : Integer,
    top  : Integer
  ) returns {
    items       : LargeString;   // JSON array of INotification
    total       : Integer;
    unreadCount : Integer;
    hasMore     : Boolean;
  };

  /** Mark notifications as read (by IDs or "all") */
  action markNotificationsRead(
    notificationIds : LargeString not null   // JSON array of IDs, or "all"
  ) returns {
    success : Boolean;
    updated : Integer;
  };

  /** Get unread notification count */
  function getUnreadCount() returns {
    count : Integer;
  };

  /** Update notification preference for a type */
  action updatePreference(
    type    : String(30) not null,
    enabled : Boolean not null
  ) returns {
    success : Boolean;
  };

  /** Get all notification preferences for current user */
  action getPreferences() returns {
    preferences : LargeString;   // JSON array of INotificationPreference
  };

  /** Register a push subscription for current user */
  action registerPushSubscription(
    endpoint    : String(500) not null,
    p256dhKey   : String(200) not null,
    authKey     : String(200) not null,
    deviceLabel : String(100)
  ) returns {
    subscriptionId : String(36);
  };

  /** Remove a push subscription */
  action unregisterPushSubscription(
    subscriptionId : String(36) not null
  ) returns {
    success : Boolean;
  };

  /** Get user's push subscriptions */
  action getPushSubscriptions() returns {
    subscriptions : LargeString;   // JSON array of IPushSubscription
  };
}
