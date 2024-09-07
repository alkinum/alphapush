const TOKEN_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
const TOKEN_EXPIRY_THRESHOLD = 30 * 1000; // 30 seconds before expiry

const MASTER_KEY_STORAGE_KEY = 'masterKey';
const DB_NAME = 'encryptionDB';
const STORE_NAME = 'keyStore';
const DB_VERSION = 1;

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
  console.log('Starting decryption process');
  console.log('Encrypted content:', encryptedContent);
  console.log('Nonce:', nonce);

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

self.addEventListener('push', async function (event) {
  const data = event.data.json();
  let options = {
    body: data.body,
    icon: data.iconUrl || '/icon.png',
    vibrate: [100, 75, 240],
    data: {
      id: data.id,
      category: data.category,
      group: data.group,
      type: data.type,
      approvalId: data.approvalId,
      createdAt: data.createdAt,
      tempAccessToken: data.tempAccessToken,
    },
  };

  if (data.type === 'encrypted') {
    try {
      const extraInfo = data.extraInfo ? JSON.parse(data.extraInfo) : {};
      const nonce = extraInfo.nonce;
      if (!nonce) {
        throw new Error('Nonce not found in extra info');
      }
      const decryptedContent = await decryptMessage(data.content, nonce);
      options.body = decryptedContent;
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

  self.registration.showNotification(data.title, options);
});

self.addEventListener('notificationclick', function (event) {
  const notificationData = event.notification.data;

  const url = new URL('/', self.location.origin);
  const currentTime = Date.now();
  const timeSinceCreation = currentTime - notificationData.createdAt;

  if (notificationData.type === 'approval-process') {
    if (timeSinceCreation < TOKEN_TTL - TOKEN_EXPIRY_THRESHOLD) {
      // Token is still valid, directly update the approval state
      if (event.action === 'approve' || event.action === 'reject') {
        event.waitUntil(
          updateApprovalState(notificationData.approvalId, event.action, notificationData.tempAccessToken)
            .then(() => {
              event.notification.close();
            })
            .catch((error) => {
              console.error('Failed to update approval state:', error);
              // If update fails, fall back to opening the details page
              url.searchParams.set('approvalId', notificationData.approvalId);
              url.searchParams.set('action', event.action); // Add action to URL
              clients.openWindow(url.toString());
            }),
        );
        return;
      }
    }

    // Token is expired or nearly expired, or action is 'detail'
    url.searchParams.set('approvalId', notificationData.approvalId);
    url.searchParams.set('action', event.action); // Add action to URL
  }

  if (event.action === 'detail' || !event.action) {
    url.searchParams.set('notificationId', notificationData.id);
    url.searchParams.set('category', notificationData.category);
    url.searchParams.set('group', notificationData.group);
  }

  event.notification.close();
  event.waitUntil(clients.openWindow(url.toString()));
});

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
  event.waitUntil(self.clients.claim());
});
