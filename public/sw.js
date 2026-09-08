const TOKEN_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
const TOKEN_EXPIRY_THRESHOLD = 30 * 1000; // 30 seconds before expiry

const MASTER_KEY_STORAGE_KEY = 'masterKey';
const DB_NAME = 'encryptionDB';
const STORE_NAME = 'keyStore';
const DB_VERSION = 1;
const RECEIPT_CACHE = 'alphapush-delivery-receipts-v1';
const RECEIPT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let receiptFlushPromise = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      db.createObjectStore(STORE_NAME);
    };
  });
}

async function getMasterKey() {
  try {
    const db = await openDatabase();
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      console.debug('Object store not found, returning empty string');
      return '';
    }

    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const result = await new Promise((resolve, reject) => {
      const request = store.get(MASTER_KEY_STORAGE_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    if (result === undefined) {
      console.debug('No existing master key found, returning empty string');
      return '';
    }

    return result;
  } catch (error) {
    console.error('Error while attempting to get master key:', error);
    return '';
  }
}

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const TAG_LENGTH = 128;

function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  return base64ToUint8Array(base64);
}

async function deriveKey(masterKey, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(masterKey), { name: 'PBKDF2' }, false, [
    'deriveKey',
  ]);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 10000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['decrypt'],
  );
}

async function decryptMessage(encryptedContent, nonce) {
  const masterKey = await getMasterKey();
  if (!masterKey) {
    console.error('Master key not found');
    throw new Error('Master key not found');
  }

  try {
    const encryptedData = base64ToUint8Array(encryptedContent);
    const nonceBuffer = base64ToUint8Array(nonce);

    const derivedKey = await deriveKey(masterKey, nonceBuffer);

    const decryptedData = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: nonceBuffer, tagLength: TAG_LENGTH },
      derivedKey,
      encryptedData,
    );

    const decoder = new TextDecoder();
    const result = decoder.decode(decryptedData);
    return result;
  } catch (error) {
    console.error('Error during decryption:', error);
    throw error;
  }
}

self.addEventListener('push', function (event) {
  event.waitUntil(
    handlePushEvent(event).catch(async (error) => {
      console.error('Unhandled push event error:', error);
      try {
        await showFallbackNotification({});
      } catch (fallbackError) {
        console.error('Failed to show final fallback notification:', fallbackError);
      }
    }),
  );
});

self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(handlePushSubscriptionChange(event));
});

async function handlePushSubscriptionChange(event) {
  try {
    const keyResponse = await fetch('/api/vapid-keys', {
      method: 'GET',
      credentials: 'include',
    });

    if (!keyResponse.ok) {
      throw new Error(`Failed to fetch VAPID key: ${keyResponse.status}`);
    }

    const keyData = await keyResponse.json();
    if (!keyData.publicKey) {
      throw new Error('Missing VAPID public key');
    }

    const applicationServerKey = urlBase64ToUint8Array(keyData.publicKey);
    const subscription =
      event.newSubscription ||
      (await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      }));

    const response = await fetch('/api/subscription', {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscription,
        oldEndpoint: event.oldSubscription?.endpoint,
        isSafari: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to update subscription after pushsubscriptionchange: ${response.status}`);
    }

    console.debug('Push subscription refreshed after pushsubscriptionchange');
  } catch (error) {
    console.debug('Failed to handle pushsubscriptionchange:', error);
  }
}

async function handlePushEvent(event) {
  let data = {};

  try {
    data = parsePushPayload(event);
  } catch (error) {
    console.error('Failed to parse push payload:', error);
    await showFallbackNotification({});
    return;
  }

  let options = {
    // Repeated transport attempts replace the same notification.
    tag: data.id || undefined,
    body: data.body || data.content || 'Open AlphaPush to view this notification.',
    icon: data.iconUrl || '/icons/icon-192x192.png',
    vibrate: [100, 75, 240],
    data: {
      id: data.id,
      subscriptionId: data.subscriptionId,
      attemptId: data.attemptId,
      receiptToken: data.receiptToken,
      category: data.categoryId || data.category,
      notification_group: data.groupId || data.notification_group,
      type: data.type,
      approvalId: data.approvalId,
      createdAt: data.createdAt || Date.now(),
      tempAccessToken: data.tempAccessToken,
      navigateUrl: data.navigate_url || data.navigateUrl,
      badgeCount: data.badgeCount ?? data.badge,
    },
  };

  try {
    if (data.type === 'encrypted') {
      try {
        const extraInfo = data.extraInfo ? JSON.parse(data.extraInfo) : {};
        const nonce = extraInfo.nonce;
        if (!nonce) {
          throw new Error('Nonce not found in extra info');
        }
        const decryptedContent = await decryptMessage(data.content, nonce);
        options.body = decryptedContent;

        // If there's no title but we have decrypted content, store it for title generation
        if (!data.title) {
          data.decryptedContent = decryptedContent;
        }
      } catch (error) {
        console.error('Decryption failed:', error);
        options.body = 'This is an encrypted notification. Please click the notification to view the details.';
      }
    }

    if (data.type === 'approval-process') {
      options.actions = [
        { action: 'reject', title: 'Reject' },
        { action: 'approve', title: 'Approve' },
      ];
    } else {
      options.actions = [{ action: 'detail', title: 'View Details' }];
    }

    // Handle notifications with no title
    const notificationTitle = data.title || getDefaultTitle(data);
    await showNotificationWithReceipt(notificationTitle, options);
  } catch (error) {
    console.error('Failed to show push notification:', error);
    await showFallbackNotification(data);
  }
}

function parsePushPayload(event) {
  if (!event.data) {
    return {};
  }

  try {
    const parsed = event.data.json();
    return parsed && typeof parsed === 'object' ? parsed : { body: String(parsed || '') };
  } catch {
    const text = event.data.text();
    return text ? { body: text } : {};
  }
}

// Helper function to generate a default title when none is provided
function getDefaultTitle(data) {
  // For encrypted notifications, use decrypted content if available
  if (data.type === 'encrypted' && data.decryptedContent) {
    const words = data.decryptedContent.split(' ');
    const preview = words.slice(0, 3).join(' ');
    return preview + (words.length > 3 ? '...' : '');
  }

  // If we have a body, use the first few words as the title
  if (data.body) {
    const words = data.body.split(' ');
    const preview = words.slice(0, 3).join(' ');
    return preview + (words.length > 3 ? '...' : '');
  }

  // If we have a category or group, use that
  if (data.category) {
    return `New ${data.category} notification`;
  }

  if (data.notification_group) {
    return `New notification from ${data.notification_group}`;
  }

  // Fallback to a generic title
  return 'New notification';
}

self.addEventListener('notificationclick', function (event) {
  const notificationData = event.notification.data || {};

  const url = new URL('/', self.location.origin);
  setSearchParamIfPresent(url, 'notificationId', notificationData.id);
  setSearchParamIfPresent(url, 'subscriptionId', notificationData.subscriptionId);
  setSearchParamIfPresent(url, 'attemptId', notificationData.attemptId);
  setSearchParamIfPresent(url, 'receiptToken', notificationData.receiptToken);
  const currentTime = Date.now();
  const numericCreatedAt = Number(notificationData.createdAt || 0);
  const createdAt = Number.isFinite(numericCreatedAt) ? numericCreatedAt : Date.parse(notificationData.createdAt);
  const timeSinceCreation = createdAt ? currentTime - createdAt : Number.POSITIVE_INFINITY;

  if (notificationData.type === 'approval-process') {
    if (timeSinceCreation < TOKEN_TTL - TOKEN_EXPIRY_THRESHOLD) {
      // Token is still valid, directly update the approval state
      if ((event.action === 'approve' || event.action === 'reject') && notificationData.approvalId && notificationData.tempAccessToken) {
        event.waitUntil(
          Promise.allSettled([
            reportDeliveryEvent(
              notificationData.id,
              'opened',
              notificationData.subscriptionId,
              notificationData.attemptId,
              notificationData.receiptToken,
            ),
            markNotificationRead(notificationData.id),
            (async () => {
              try {
                await updateApprovalState(notificationData.approvalId, event.action, notificationData.tempAccessToken);
                event.notification.close();
              } catch (error) {
                console.error('Failed to update approval state:', error);
                // If update fails, fall back to opening the details page
                setSearchParamIfPresent(url, 'approvalId', notificationData.approvalId);
                setSearchParamIfPresent(url, 'action', event.action); // Add action to URL
                return clients.openWindow(url.toString());
              }
            })(),
          ]),
        );
        return;
      }
    }

    // Token is expired or nearly expired, or action is 'detail'
    setSearchParamIfPresent(url, 'approvalId', notificationData.approvalId);
    setSearchParamIfPresent(url, 'subscriptionId', notificationData.subscriptionId);
    setSearchParamIfPresent(url, 'attemptId', notificationData.attemptId);
    setSearchParamIfPresent(url, 'receiptToken', notificationData.receiptToken);
    setSearchParamIfPresent(url, 'action', event.action); // Add action to URL
  }

  // Check if navigateUrl exists and use it instead of default URL
  if (notificationData.navigateUrl) {
    try {
      // Validate if the URL is valid
      const navigateUrl = new URL(notificationData.navigateUrl, self.location.origin);

      // Check if the URL has a valid protocol (http or https)
      if (navigateUrl.protocol === 'http:' || navigateUrl.protocol === 'https:') {
        event.notification.close();
        event.waitUntil(openWindowWithReceipt(navigateUrl.toString(), notificationData));
        return;
      } else {
        console.warn('Invalid URL protocol:', navigateUrl.protocol);
      }
    } catch (error) {
      console.warn('Invalid navigate URL:', notificationData.navigateUrl, error);
    }
  }

  // If navigateUrl is not valid or doesn't exist, use the default URL
  if (event.action === 'detail' || !event.action) {
    setSearchParamIfPresent(url, 'notificationId', notificationData.id);
    setSearchParamIfPresent(url, 'subscriptionId', notificationData.subscriptionId);
    setSearchParamIfPresent(url, 'attemptId', notificationData.attemptId);
    setSearchParamIfPresent(url, 'receiptToken', notificationData.receiptToken);
    setSearchParamIfPresent(url, 'category', notificationData.category);
    setSearchParamIfPresent(url, 'notification_group', notificationData.notification_group);
  }

  event.notification.close();
  event.waitUntil(openWindowWithReceipt(url.toString(), notificationData));
});

function setSearchParamIfPresent(url, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    url.searchParams.set(key, String(value));
  }
}

async function showNotificationWithReceipt(title, options) {
  await self.registration.showNotification(title, options);
  await Promise.allSettled([
    reportDeliveryEvent(
      options?.data?.id,
      'displayed',
      options?.data?.subscriptionId,
      options?.data?.attemptId,
      options?.data?.receiptToken,
    ),
    flushDeliveryReceipts(),
    updateBadgeFromPayload(options?.data),
    notifyOpenClients(options?.data),
  ]);
}

async function showFallbackNotification(data) {
  await showNotificationWithReceipt('New notification', {
    body: 'Open AlphaPush to view the latest notification.',
    icon: '/icons/icon-192x192.png',
    data: {
      id: data?.id,
      subscriptionId: data?.subscriptionId,
      attemptId: data?.attemptId,
      receiptToken: data?.receiptToken,
      badgeCount: data?.badgeCount ?? data?.badge,
      createdAt: Date.now(),
    },
  });
}

async function openWindowWithReceipt(url, notificationData) {
  const openWindowPromise = clients.openWindow(url);
  await Promise.allSettled([
    reportDeliveryEvent(
      notificationData.id,
      'opened',
      notificationData.subscriptionId,
      notificationData.attemptId,
      notificationData.receiptToken,
    ),
    markNotificationRead(notificationData.id),
    openWindowPromise,
  ]);
  return openWindowPromise;
}

async function sendReceipt(receipt) {
  const response = await fetch('/api/push-delivery', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
    body: JSON.stringify(receipt),
  });
  // Invalid/deleted messages are terminal. Session failures can recover later.
  return response.ok || response.status === 400 || response.status === 404;
}

async function reportDeliveryEvent(notificationId, eventType, subscriptionId, attemptId, receiptToken) {
  if (!notificationId) return;
  const receipt = { notificationId, subscriptionId, attemptId, receiptToken, event: eventType };
  let cache;
  let key;
  try {
    cache = await caches.open(RECEIPT_CACHE);
    key = new URL(`/__delivery-receipts/${encodeURIComponent(attemptId || notificationId)}/${eventType}`, self.location.origin).href;
    // Persist before sending so termination or offline transitions do not lose the receipt.
    await cache.put(key, new Response(JSON.stringify({ receipt, queuedAt: Date.now() })));
  } catch (error) { console.debug('Unable to persist delivery receipt:', error); }
  try {
    if (await sendReceipt(receipt)) {
      if (cache && key) await cache.delete(key);
      return;
    }
  } catch (error) { console.debug('Delivery receipt queued for retry:', error); }
  try { await self.registration.sync?.register('alphapush-delivery-receipts'); } catch { /* Retry on the next app or push event. */ }
}

function flushDeliveryReceipts() {
  if (receiptFlushPromise) return receiptFlushPromise;
  receiptFlushPromise = (async () => {
    const cache = await caches.open(RECEIPT_CACHE);
    const keys = await cache.keys();
    const pending = [];
    // Bound storage; receipts expire after seven days or the latest 100 entries.
    for (const [index, key] of keys.entries()) {
      const response = await cache.match(key);
      const queued = response && await response.json();
      if (!queued || index < keys.length - 100 || Date.now() - queued.queuedAt > RECEIPT_MAX_AGE_MS) {
        await cache.delete(key); continue;
      }
      pending.push({ key, receipt: queued.receipt });
    }
    for (const { key, receipt } of pending) {
      // Reject on transient failures so Background Sync can schedule another attempt.
      if (!await sendReceipt(receipt)) throw new Error('Delivery receipt is still pending');
      await cache.delete(key);
    }
  })().finally(() => { receiptFlushPromise = null; });
  return receiptFlushPromise;
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'alphapush-delivery-receipts') event.waitUntil(flushDeliveryReceipts());
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'alphapush:flush-receipts') event.waitUntil(flushDeliveryReceipts());
});

async function notifyOpenClients(notification) {
  if (!notification?.id) {
    return;
  }

  const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windowClients) {
    client.postMessage({ type: 'alphapush:push-received', notification });
  }
}

async function markNotificationRead(notificationId) {
  if (!notificationId) {
    return;
  }

  try {
    const response = await fetch('/api/notifications/read', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        notificationIds: [notificationId],
      }),
    });

    if (!response.ok) {
      await syncBadgeWithUnreadCount();
      return;
    }

    const data = await response.json();
    await setAppBadgeCount(data.unreadCount);
  } catch (error) {
    console.debug('Failed to mark notification read:', error);
    await syncBadgeWithUnreadCount();
  }
}

async function updateBadgeFromPayload(data) {
  const badgeCount = getBadgeCountFromPayload(data);
  if (badgeCount !== null) {
    await setAppBadgeCount(badgeCount);
    return;
  }

  await syncBadgeWithUnreadCount();
}

async function syncBadgeWithUnreadCount() {
  try {
    const response = await fetch('/api/notifications/unread-count', {
      method: 'GET',
      credentials: 'include',
    });

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    await setAppBadgeCount(data.unreadCount);
  } catch (error) {
    console.debug('Failed to sync app badge unread count:', error);
  }
}

async function setAppBadgeCount(count) {
  const safeCount = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;
  const badgeNavigator = globalThis.navigator || {};
  const badgeRegistration = self.registration || {};

  try {
    if (safeCount > 0) {
      if (typeof badgeNavigator.setAppBadge === 'function') {
        await badgeNavigator.setAppBadge(safeCount);
      } else if (typeof badgeRegistration.setAppBadge === 'function') {
        await badgeRegistration.setAppBadge(safeCount);
      }
    } else if (typeof badgeNavigator.clearAppBadge === 'function') {
      await badgeNavigator.clearAppBadge();
    } else if (typeof badgeRegistration.clearAppBadge === 'function') {
      await badgeRegistration.clearAppBadge();
    }
  } catch (error) {
    console.debug('Failed to update app badge:', error);
  }
}

function getBadgeCountFromPayload(data) {
  if (!data) {
    return null;
  }

  const value = data.badgeCount ?? data.badge;
  const count = Number(value);

  if (!Number.isFinite(count)) {
    return null;
  }

  return Math.max(0, Math.floor(count));
}

async function updateApprovalState(approvalId, action, token) {
  const state = action === 'approve' ? 'approved' : 'rejected';
  const response = await fetch('/api/approval', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ approvalId, state }),
  });

  if (!response.ok) {
    throw response;
  }

  return response.json();
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.allSettled([self.clients.claim(), flushDeliveryReceipts()]));
});
