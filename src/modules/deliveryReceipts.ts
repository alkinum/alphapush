type DeliveryEvent = 'displayed' | 'opened';

const OPENED_RECEIPT_STORAGE_PREFIX = 'alphapush:openedReceipt:';

export function initializeDeliveryReceipts(): void {
  if (typeof document === 'undefined') {
    return;
  }

  reportOpenedNotificationFromPage();
  document.addEventListener('astro:page-load', reportOpenedNotificationFromPage);
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
  if (sessionStorage.getItem(storageKey)) {
    return;
  }

  sessionStorage.setItem(storageKey, String(Date.now()));
  void reportDeliveryEvent(notificationId, 'opened', subscriptionId, attemptId, receiptToken);
}

async function reportDeliveryEvent(
  notificationId: string,
  event: DeliveryEvent,
  subscriptionId?: string,
  attemptId?: string,
  receiptToken?: string
): Promise<void> {
  try {
    await fetch('/api/push-delivery', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notificationId, subscriptionId, attemptId, receiptToken, event }),
    });
  } catch (error) {
    console.debug('Failed to report notification delivery event:', error);
  }
}
