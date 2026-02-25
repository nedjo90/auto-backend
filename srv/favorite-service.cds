using {auto} from '../db/schema';

@path    : '/api/favorites'
@requires: 'authenticated-user'
service FavoriteService {
  /** Toggle favorite (add or remove) */
  action toggleFavorite(
    listingId : String(36) not null
  ) returns {
    favorited  : Boolean;
    favoriteId : String(36);
  };

  /** Check if listings are favorited by the current user (batch) */
  action checkFavorites(
    listingIds : LargeString not null   // JSON array of listing IDs
  ) returns {
    results : LargeString;   // JSON array of IFavoriteCheckResult
  };

  /** Get the current user's favorites with change detection */
  action getMyFavorites(
    skip : Integer,
    top  : Integer
  ) returns {
    items   : LargeString;   // JSON array of IFavoriteEnriched
    total   : Integer;
    hasMore : Boolean;
  };

  /** Mark all favorite snapshots as seen (reset to current values) */
  action markAllAsSeen() returns {
    success : Boolean;
    updated : Integer;
  };

  /** Get user's notifications */
  action getNotifications(
    skip : Integer,
    top  : Integer
  ) returns {
    items       : LargeString;   // JSON array of INotification
    total       : Integer;
    unreadCount : Integer;
    hasMore     : Boolean;
  };

  /** Mark notifications as read */
  action markNotificationsRead(
    notificationIds : LargeString not null   // JSON array of notification IDs, or "all"
  ) returns {
    success : Boolean;
    updated : Integer;
  };

  /** Get unread notification count (for bell badge) */
  function getUnreadCount() returns {
    count : Integer;
  };
}
