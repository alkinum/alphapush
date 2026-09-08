type DeliveryEvent = 'displayed' | 'opened';

const OPENED_RECEIPT_STORAGE_PREFIX = 'alphapush:openedReceipt:';
const sentReceipts = new Set<string>();
const inFlightReceipts = new Set<string>();
let initialized = false;

export function initializeDeliveryReceipts(): void {
  if (typeof document === 'undefined' || initialized) {
    return;
  }

  initialized = true;
  reportOpenedNotificationFromPage();
  document.addEventListener('astro:page-load', reportOpenedNotificationFromPage);
  window.addEventListener('online', reportOpenedNotificationFromPage);
  window.addEventListener('pageshow', reportOpenedNotificationFromPage);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reportOpenedNotificationFromPage();
  });
}

function reportOpenedNotificationFromPage(): void {
  const notificationId = document.body.dataset.notificationId;
  const subscriptionId = document.body.dataset.subscriptionId;
  const attemptId = document.body.dataset.attemptId;
  const receiptToken = document.body.dataset.receiptToken;
  if (!notificationId) {
    return;
  }

  const storageKey = `${OPENED_RECEIPT_STORAGE_PREFIX}${notificationId}:${attemptId || subscriptionId || 'unknown'}`;
  if (sentReceipts.has(storageKey) || inFlightReceipts.has(storageKey)) return;
  try {
    if (sessionStorage.getItem(storageKey)) return;
  } catch { /* Receipt delivery also works when storage is blocked. */ }

  inFlightReceipts.add(storageKey);
  void reportDeliveryEvent(notificationId, 'opened', subscriptionId, attemptId, receiptToken)
    .then(sent => {
      if (!sent) return;
      sentReceipts.add(storageKey);
      try {
        sessionStorage.setItem(storageKey, String(Date.now()));
      } catch { /* Use the in-memory record until the next page load. */ }
    })
    .finally(() => inFlightReceipts.delete(storageKey));
}

async function reportDeliveryEvent(
  notificationId: string,
  event: DeliveryEvent,
  subscriptionId?: string,
  attemptId?: string,
  receiptToken?: string
): Promise<boolean> {
  try {
    const response = await fetch('/api/push-delivery', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notificationId, subscriptionId, attemptId, receiptToken, event }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok || response.status === 400 || response.status === 404;
  } catch (error) {
    console.debug('Failed to report notification delivery event:', error);
    return false;
  }
}
