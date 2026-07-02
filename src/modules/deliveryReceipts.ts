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
  if (!notificationId) {
    return;
  }

  const storageKey = `${OPENED_RECEIPT_STORAGE_PREFIX}${notificationId}`;
  if (sessionStorage.getItem(storageKey)) {
    return;
  }

  sessionStorage.setItem(storageKey, String(Date.now()));
  void reportDeliveryEvent(notificationId, 'opened');
}

async function reportDeliveryEvent(notificationId: string, event: DeliveryEvent): Promise<void> {
  try {
    await fetch('/api/push-delivery', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notificationId, event }),
    });
  } catch (error) {
    console.debug('Failed to report notification delivery event:', error);
  }
}
