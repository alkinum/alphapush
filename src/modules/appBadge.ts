import type { Notification } from '@/types/notification';

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

interface MarkReadResponse {
  all: boolean;
  readAt: string;
  notificationIds?: string[];
  unreadCount: number;
}

interface UnreadCountResponse {
  unreadCount: number;
}

const MARK_READ_THROTTLE_MS = 5000;

let lastMarkAllReadAt = 0;
let syncInFlight: Promise<void> | null = null;

export function initializeAppBadgeSync(): void {
  if (typeof document === 'undefined') {
    return;
  }

  if (!isLoggedIn()) {
    void setAppBadgeCount(0);
    return;
  }

  void markAllNotificationsReadAndSyncBadge(true);

  window.addEventListener('pageshow', () => {
    void markAllNotificationsReadAndSyncBadge();
  });

  window.addEventListener('focus', () => {
    void markAllNotificationsReadAndSyncBadge();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void markAllNotificationsReadAndSyncBadge();
    }
  });

  window.addEventListener('online', () => {
    void syncAppBadgeWithUnreadCount();
  });

  document.addEventListener('alphapush:new-notification', (event) => {
    const notification = (event as CustomEvent<{ notification?: Notification }>).detail?.notification;
    if (document.visibilityState === 'visible' && notification?.id) {
      void markNotificationsReadAndSyncBadge([notification.id]);
    } else {
      void syncAppBadgeWithUnreadCount();
    }
  });

  document.addEventListener('notificationDeleted', () => {
    void syncAppBadgeWithUnreadCount();
  });
}

export async function syncAppBadgeWithUnreadCount(): Promise<void> {
  if (!isLoggedIn()) {
    await setAppBadgeCount(0);
    return;
  }

  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = (async () => {
    try {
      const response = await fetch('/api/notifications/unread-count', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as UnreadCountResponse;
      await setAppBadgeCount(data.unreadCount);
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

export async function markAllNotificationsReadAndSyncBadge(force = false): Promise<void> {
  if (!isLoggedIn()) {
    await setAppBadgeCount(0);
    return;
  }

  const now = Date.now();
  if (!force && now - lastMarkAllReadAt < MARK_READ_THROTTLE_MS) {
    return;
  }

  lastMarkAllReadAt = now;
  await markNotificationsReadAndSyncBadge(undefined, true);
}

export async function markNotificationsReadAndSyncBadge(
  notificationIds?: string[],
  all = false
): Promise<void> {
  if (!isLoggedIn()) {
    await setAppBadgeCount(0);
    return;
  }

  try {
    const response = await fetch('/api/notifications/read', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(all ? { all: true } : { notificationIds }),
    });

    if (!response.ok) {
      await syncAppBadgeWithUnreadCount();
      return;
    }

    const data = (await response.json()) as MarkReadResponse;
    await setAppBadgeCount(data.unreadCount);
    document.dispatchEvent(new CustomEvent('alphapush:notifications-read', { detail: data }));
  } catch (error) {
    console.debug('Failed to mark notifications read for app badge sync:', error);
    await syncAppBadgeWithUnreadCount();
  }
}

export async function setAppBadgeCount(count: number): Promise<void> {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const badgeNavigator = navigator as BadgeNavigator;

  try {
    if (safeCount > 0 && typeof badgeNavigator.setAppBadge === 'function') {
      await badgeNavigator.setAppBadge(safeCount);
    } else if (safeCount === 0 && typeof badgeNavigator.clearAppBadge === 'function') {
      await badgeNavigator.clearAppBadge();
    }
  } catch (error) {
    console.debug('Failed to update app badge:', error);
  }
}

function isLoggedIn(): boolean {
  return document.body.dataset.userLoggedIn === 'true';
}
