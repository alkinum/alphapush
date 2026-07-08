import { signIn, signOut } from '@/lib/auth/client';
import { toast } from '@/components/ui/sonner/use-toast';
import { getCombinedFingerprint } from '@/utils/fingerprint';
import { StreamErrorCode } from '@/types/stream';
import { isSafari } from '@/lib/utils';

// Constants
const FINGERPRINTS_STORAGE_KEY = 'userFingerprints';
const VAPID_KEY_STORAGE_KEY = 'vapidPublicKey';
const PUSH_TOKEN_STORAGE_KEY = 'pushToken';
const SUBSCRIPTION_HEALTH_STORAGE_KEY = 'pushSubscriptionHealthCheckAt';
const SUBSCRIPTION_HEALTH_INTERVAL_MS = 60 * 60 * 1000;
const SUBSCRIPTION_EXPIRY_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

// State
let vapidPublicKey: string | null = null;
let deviceFingerprint: string | null = null;
let droppedSubscriptionRepairPromise: Promise<boolean> | null = null;

// User fingerprints map: { userEmail: fingerprint }
interface UserFingerprints {
  [userEmail: string]: string;
}

function getStoredVapidPublicKey(): string | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  return localStorage.getItem(VAPID_KEY_STORAGE_KEY);
}

function getCachedVapidPublicKey(): string | null {
  if (!vapidPublicKey) {
    vapidPublicKey = getStoredVapidPublicKey();
  }

  return vapidPublicKey;
}

function isCurrentUserLoggedIn(): boolean {
  return document.body.dataset.userLoggedIn === 'true' && !!document.body.dataset.userEmail;
}

function hasGrantedNotificationPermission(): boolean {
  return 'Notification' in window && Notification.permission === 'granted';
}

/**
 * Get stored fingerprints for all users
 */
function getStoredFingerprints(): UserFingerprints {
  try {
    const storedData = localStorage.getItem(FINGERPRINTS_STORAGE_KEY);
    return storedData ? JSON.parse(storedData) : {};
  } catch (error) {
    console.error('Error parsing stored fingerprints:', error);
    return {};
  }
}

/**
 * Get stored fingerprint for a specific user
 */
function getUserFingerprint(userEmail: string): string | null {
  const fingerprints = getStoredFingerprints();
  return fingerprints[userEmail] || null;
}

/**
 * Save fingerprint for a specific user
 */
function saveUserFingerprint(userEmail: string, fingerprint: string): void {
  const fingerprints = getStoredFingerprints();
  fingerprints[userEmail] = fingerprint;
  localStorage.setItem(FINGERPRINTS_STORAGE_KEY, JSON.stringify(fingerprints));
}

/**
 * Remove fingerprint for a specific user
 */
function removeUserFingerprint(userEmail: string): void {
  const fingerprints = getStoredFingerprints();
  if (fingerprints[userEmail]) {
    delete fingerprints[userEmail];
    localStorage.setItem(FINGERPRINTS_STORAGE_KEY, JSON.stringify(fingerprints));
  }
}

/**
 * Fetch VAPID public key from the server
 */
export async function getVapidKey(options: { silent?: boolean } = {}): Promise<string | null> {
  try {
    const response = await fetch('/api/vapid-keys');
    if (!response.ok) {
      throw new Error('Failed to fetch VAPID key');
    }
    const data = (await response.json()) as { publicKey: string; pushToken: string };
    const serverVapidKey = data.publicKey;

    // Check if server key is different from local key
    const storedVapidKey = getStoredVapidPublicKey();
    if (serverVapidKey && serverVapidKey !== storedVapidKey) {
      console.debug('Server VAPID key differs from local key, updating...');

      // Update local storage with new key
      localStorage.setItem(VAPID_KEY_STORAGE_KEY, serverVapidKey);
      vapidPublicKey = serverVapidKey;

      // Force resubscription if keys are different
      if (storedVapidKey) {
        // Unsubscribe from current subscription because key has changed
        if ('serviceWorker' in navigator && 'PushManager' in window) {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            await subscription.unsubscribe();
            console.debug('Unsubscribed from push due to VAPID key change');
          }
        }
      }
    } else if (serverVapidKey) {
      vapidPublicKey = serverVapidKey;
      localStorage.setItem(VAPID_KEY_STORAGE_KEY, vapidPublicKey);
    }

    if (data.pushToken) {
      document.dispatchEvent(new CustomEvent('newPushToken', { detail: { pushToken: data.pushToken } }));
    }

    if (!serverVapidKey) {
      throw new Error('Invalid VAPID key received');
    }

    return vapidPublicKey;
  } catch (error) {
    console.error('Error fetching VAPID key:', error);
    if (!options.silent) {
      toast({
        title: 'Error',
        description: 'Failed to get push key. Please try again later.',
        variant: 'destructive',
      });
    }
    return null;
  }
}

/**
 * Helper function to convert ArrayBuffer to URL-safe Base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(buffer) as unknown as number[]));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Helper function to convert base64 string to Uint8Array for VAPID key
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function normalizeVapidKey(publicKey: string): string {
  return publicKey.replace(/=+$/g, '');
}

function getSubscriptionApplicationServerKey(subscription: PushSubscription): string | null {
  const applicationServerKey = subscription.options?.applicationServerKey;

  if (!applicationServerKey) {
    return null;
  }

  if (typeof applicationServerKey === 'string') {
    return normalizeVapidKey(applicationServerKey);
  }

  return arrayBufferToBase64(applicationServerKey);
}

function getSubscriptionRefreshReason(subscription: PushSubscription, publicKey: string): string | null {
  const existingKey = getSubscriptionApplicationServerKey(subscription);
  const normalizedPublicKey = normalizeVapidKey(publicKey);

  if (existingKey && existingKey !== normalizedPublicKey) {
    return 'application server key mismatch';
  }

  if (
    typeof subscription.expirationTime === 'number' &&
    subscription.expirationTime - Date.now() < SUBSCRIPTION_EXPIRY_REFRESH_THRESHOLD_MS
  ) {
    return 'subscription is expired or expiring soon';
  }

  return null;
}

/**
 * Check if Safari supports declarative web push (window.pushManager)
 */
function supportsSafariDeclarativePush(): boolean {
  return isSafari() && 'pushManager' in window && 'subscribe' in (window as any).pushManager;
}

async function getActiveWebPushSubscription(): Promise<PushSubscription | null> {
  if (supportsSafariDeclarativePush()) {
    const safariPushManager = (window as any).pushManager;
    return await safariPushManager.getSubscription();
  }

  if ('serviceWorker' in navigator && 'PushManager' in window) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      return null;
    }

    return await registration.pushManager.getSubscription();
  }

  return null;
}

export async function hasActiveWebPushSubscription(): Promise<boolean> {
  try {
    return !!(await getActiveWebPushSubscription());
  } catch (error) {
    console.warn('Failed to check active web push subscription:', error);
    return false;
  }
}

/**
 * Unsubscribe from web push for a specific fingerprint
 */
export async function unsubscribeWebPush(
  fingerprintToUnsubscribe?: string,
  userEmail?: string,
  options: { silent?: boolean } = {}
): Promise<boolean> {
  try {
    let subscription: PushSubscription | null = null;

    // Handle Safari declarative push
    if (supportsSafariDeclarativePush()) {
      subscription = await getActiveWebPushSubscription();

      if (subscription) {
        await subscription.unsubscribe();
        console.debug('Unsubscribed from Safari push subscription in browser');
      }
    }
    // Handle service worker-based push
    else if ('serviceWorker' in navigator && 'PushManager' in window) {
      subscription = await getActiveWebPushSubscription();

      // If we have an active subscription, unsubscribe from it
      if (subscription) {
        await subscription.unsubscribe();
        console.debug('Unsubscribed from push subscription in browser');
      }
    }

    // If we have a fingerprint to unsubscribe, delete it from the server
    if (fingerprintToUnsubscribe) {
      const email = userEmail || document.body.getAttribute('data-user-email');
      if (!email) {
        throw new Error('User email not found');
      }

      const response = await fetch('/api/subscription', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deviceFingerprint: fingerprintToUnsubscribe }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.debug('Subscription not found on server, already deleted');
        } else {
          throw new Error(`Failed to delete subscription on server: ${response.status} ${response.statusText}`);
        }
      } else {
        console.debug('Unsubscribed from push subscription on server');
      }

      // Remove the fingerprint from storage if provided userEmail
      if (userEmail) {
        removeUserFingerprint(userEmail);
      }
    }

    return true;
  } catch (error) {
    console.error('Unsubscribe web push failed:', error);
    if (!options.silent) {
      toast({
        title: 'Error',
        description: 'Failed to unsubscribe from Web Push. Please try again.',
        variant: 'destructive',
      });
    }
    return false;
  }
}

/**
 * Handle fingerprint changes and update subscription
 */
async function handleFingerprintChange(userEmail: string, newFingerprint: string): Promise<boolean> {
  const storedFingerprint = getUserFingerprint(userEmail);

  // If fingerprint hasn't changed, just return true
  if (storedFingerprint === newFingerprint) {
    return true;
  }

  console.debug(`Fingerprint changed for user ${userEmail}, updating subscription...`);

  try {
    // Get current subscription
    let subscription: PushSubscription | null = null;

    if (supportsSafariDeclarativePush()) {
      const safariPushManager = (window as any).pushManager;
      subscription = await safariPushManager.getSubscription();
    } else if ('serviceWorker' in navigator && 'PushManager' in window) {
      const registration = await navigator.serviceWorker.ready;
      subscription = await registration.pushManager.getSubscription();
    }

    if (!subscription) {
      console.debug('No active subscription found, initializing web push...');
      return await initializeWebPush(true);
    }

    // Unsubscribe old fingerprint if exists
    if (storedFingerprint) {
      await unsubscribeWebPush(storedFingerprint, userEmail);
    }

    // Update fingerprint in storage
    deviceFingerprint = newFingerprint;
    saveUserFingerprint(userEmail, deviceFingerprint);

    // Update subscription with new fingerprint using PUT method
    const response = await fetch('/api/subscription', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscription,
        deviceFingerprint,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to update subscription on server: ${response.status} ${response.statusText}`);
    }

    console.debug('Subscription updated successfully with new fingerprint');
    return true;
  } catch (error) {
    console.error('Failed to handle fingerprint change:', error);
    toast({
      title: 'Error',
      description: 'Failed to update subscription. Please reload the app.',
      variant: 'destructive',
    });
    return false;
  }
}

/**
 * Subscribe to web push notifications
 * Compares application server keys and unsubscribes if keys don't match
 * Registers the subscription with the server using PUT method
 * Supports both Safari declarative push and service worker-based push
 */
export async function subscribeWebPush(publicKey: string, options: { silent?: boolean } = {}): Promise<boolean> {
  try {
    const userEmail = document.body.getAttribute('data-user-email');

    if (!userEmail) {
      throw new Error('User email not found');
    }

    // Get and validate fingerprint
    const newFingerprint = await getCombinedFingerprint(userEmail);
    const storedFingerprint = getUserFingerprint(userEmail);

    let subscription: PushSubscription | null = null;

    // Handle Safari declarative push (window.pushManager)
    if (supportsSafariDeclarativePush()) {
      console.debug('Using Safari declarative web push');
      const safariPushManager = (window as any).pushManager;

      // Check for existing subscription
      subscription = await safariPushManager.getSubscription();

      if (subscription) {
        const refreshReason = getSubscriptionRefreshReason(subscription, publicKey);

        if (refreshReason) {
          console.debug(`Refreshing Safari push subscription: ${refreshReason}`);
          await subscription.unsubscribe();
          subscription = null;
        }
      }

      // If fingerprint changed and we have an old one, unsubscribe it from server
      if (storedFingerprint && storedFingerprint !== newFingerprint) {
        console.debug('Fingerprint changed, unsubscribing old fingerprint');
        await unsubscribeWebPush(storedFingerprint, userEmail, options);
      }

      // Subscribe only if there's no valid subscription
      if (!subscription) {
        console.debug('Creating new Safari push subscription');
        const applicationServerKey = urlBase64ToUint8Array(publicKey);

        subscription = await safariPushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey,
        });
      } else {
        console.debug('Using existing Safari push subscription');
      }
    }
    // Handle service worker-based push
    else if ('serviceWorker' in navigator && 'PushManager' in window) {
      console.debug('Using service worker-based web push');
      const registration = await navigator.serviceWorker.ready;

      // Check for existing subscription
      subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const refreshReason = getSubscriptionRefreshReason(subscription, publicKey);

        if (refreshReason) {
          console.debug(`Refreshing push subscription: ${refreshReason}`);
          await subscription.unsubscribe();
          subscription = null;
        }
      }

      // If fingerprint changed and we have an old one, unsubscribe it from server
      if (storedFingerprint && storedFingerprint !== newFingerprint) {
        console.debug('Fingerprint changed, unsubscribing old fingerprint');
        await unsubscribeWebPush(storedFingerprint, userEmail, options);
      }

      // Subscribe only if there's no valid subscription
      if (!subscription) {
        console.debug('Creating new push subscription');
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
      } else {
        console.debug('Using existing push subscription');
      }
    } else {
      throw new Error('Push notifications are not supported in this browser');
    }

    // Update fingerprint in storage
    deviceFingerprint = newFingerprint;
    saveUserFingerprint(userEmail, deviceFingerprint);

    // Send subscription details to server using PUT method
    const response = await fetch('/api/subscription', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscription,
        deviceFingerprint: newFingerprint,
        isSafari: supportsSafariDeclarativePush(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to register subscription on server: ${response.status} ${response.statusText}`);
    }

    console.debug('Subscription registered successfully with server');

    // Dispatch subscription success event
    document.dispatchEvent(new CustomEvent('subscriptionSuccess'));
    return true;
  } catch (error) {
    console.error('Web Push subscription failed:', error);
    // Cancel the subscription if it exists
    try {
      if (supportsSafariDeclarativePush()) {
        const safariPushManager = (window as any).pushManager;
        const subscription = await safariPushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
          console.debug('Cleaned up failed Safari subscription');
        }
      } else if ('serviceWorker' in navigator && 'PushManager' in window) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
          console.debug('Cleaned up failed subscription');
        }
      }
    } catch (cleanupError) {
      console.error('Failed to clean up subscription after error:', cleanupError);
    }

    if (!options.silent) {
      toast({
        title: 'Error',
        description: 'Push subscription failed. Please reload the app and try again.',
        variant: 'destructive',
      });
    }
    return false;
  }
}

/**
 * Initialize web push subscription
 * When forceRefresh is true, always fetches the latest VAPID key from server
 * Handles subscribing to push notifications with proper VAPID key verification
 */
export async function initializeWebPush(
  forceRefresh = false,
  options: { silent?: boolean } = {}
): Promise<boolean> {
  if (!hasGrantedNotificationPermission()) {
    return false;
  }

  try {
    // Always fetch the latest VAPID key from server if forceRefresh is true or vapidPublicKey doesn't exist
    if (forceRefresh || !getCachedVapidPublicKey()) {
      vapidPublicKey = await getVapidKey(options);
    }

    if (vapidPublicKey) {
      return await subscribeWebPush(vapidPublicKey, options);
    }

    return false;
  } catch (error) {
    console.error('Failed to initialize web push:', error);
    if (!options.silent) {
      toast({
        title: 'Error',
        description: 'Failed to initialize push notifications. Please try again later.',
        variant: 'destructive',
      });
    }
    return false;
  }
}

async function silentlyRepairDroppedSubscriptionIfNeeded(reason: string): Promise<boolean> {
  if (!isCurrentUserLoggedIn() || !hasGrantedNotificationPermission()) {
    return false;
  }

  const userEmail = document.body.getAttribute('data-user-email');
  if (!userEmail) {
    return false;
  }

  const storedFingerprint = getUserFingerprint(userEmail);
  if (!storedFingerprint) {
    return false;
  }

  try {
    const subscription = await getActiveWebPushSubscription();
    if (subscription) {
      return true;
    }
  } catch (error) {
    console.debug('Failed to inspect current push subscription:', error);
    return false;
  }

  if (droppedSubscriptionRepairPromise) {
    return droppedSubscriptionRepairPromise;
  }

  console.debug(`Detected dropped push subscription for previously subscribed device; repairing silently (${reason})`);
  droppedSubscriptionRepairPromise = initializeWebPush(true, { silent: true })
    .then((success) => {
      if (success) {
        localStorage.setItem(SUBSCRIPTION_HEALTH_STORAGE_KEY, String(Date.now()));
      }
      return success;
    })
    .catch((error) => {
      console.debug('Silent dropped subscription repair failed:', error);
      return false;
    })
    .finally(() => {
      droppedSubscriptionRepairPromise = null;
    });

  return droppedSubscriptionRepairPromise;
}

async function refreshSubscriptionHealth(force = false): Promise<boolean> {
  if (!isCurrentUserLoggedIn() || !hasGrantedNotificationPermission()) {
    return false;
  }

  const now = Date.now();
  const lastCheck = Number(localStorage.getItem(SUBSCRIPTION_HEALTH_STORAGE_KEY) || '0');

  if (!force && Number.isFinite(lastCheck) && now - lastCheck < SUBSCRIPTION_HEALTH_INTERVAL_MS) {
    return true;
  }

  const success = await initializeWebPush(force);
  if (success) {
    localStorage.setItem(SUBSCRIPTION_HEALTH_STORAGE_KEY, String(Date.now()));
  }

  return success;
}

export async function repairPushSubscription(): Promise<boolean> {
  return refreshSubscriptionHealth(true);
}

/**
 * Handle SSE connection errors
 */
export async function handleSSEConnectionError(error: string, code: StreamErrorCode): Promise<void> {
  console.error('SSE connection error:', error, 'code:', code);

  if (code === StreamErrorCode.INVALID_FINGERPRINT) {
    console.debug('Invalid fingerprint detected, re-registering subscription...');

    const userEmail = document.body.getAttribute('data-user-email');
    if (!userEmail) {
      console.error('User email not found, cannot re-register subscription');
      return;
    }

    try {
      const newFingerprint = await getCombinedFingerprint(userEmail);
      const success = await handleFingerprintChange(userEmail, newFingerprint);

      if (success) {
        console.debug('Subscription re-registered successfully, reconnecting SSE...');
        document.dispatchEvent(new CustomEvent('reconnectSSE'));
      }
    } catch (error) {
      console.error('Failed to re-register subscription:', error);
      toast({
        title: 'Connection Error',
        description: 'Failed to reconnect to notification service. Please reload the app.',
        variant: 'destructive',
      });
    }
  }
}

/**
 * Register service worker
 */
export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(
        function (registration) {
          console.log('ServiceWorker registration successful with scope: ', registration.scope);
        },
        function (err) {
          console.error('ServiceWorker registration failed: ', err);
          toast({
            title: 'Error',
            description: 'ServiceWorker registration failed. Some features may not work properly.',
            variant: 'destructive',
          });
        },
      );
    });
  }
}

/**
 * Clean up on logout
 */
export async function cleanupOnLogout(): Promise<void> {
  const userEmail = document.body.getAttribute('data-user-email');

  // Delete user related localStorage items
  localStorage.removeItem(VAPID_KEY_STORAGE_KEY);
  localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);

  // Get the stored fingerprint for this user
  if (userEmail) {
    const storedFingerprint = getUserFingerprint(userEmail);

    // Unsubscribe from web push
    if (storedFingerprint) {
      await unsubscribeWebPush(storedFingerprint, userEmail);
    }

    // Remove this user's fingerprint
    removeUserFingerprint(userEmail);
  }

  // Reset state
  deviceFingerprint = null;

  // Sign out
  signOut().then(() => {
    window.location.reload();
  });
}

/**
 * Initialize the module
 * Always fetches the latest VAPID key from the server and verifies it against the local storage.
 * If keys differ, cancels old subscription and re-initializes web push.
 */
export function initializePushModule(): void {
  // Check if user is logged in
  const isLoggedIn = isCurrentUserLoggedIn();
  const userEmail = document.body.getAttribute('data-user-email');

  if (!isLoggedIn || !userEmail) {
    localStorage.removeItem(VAPID_KEY_STORAGE_KEY);
    localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
    // Note: We don't clear all fingerprints here, as other users might still be valid
  } else {
    console.debug('Starting to initialize web push...');
    // Always fetch the latest VAPID key from server and verify
    getVapidKey().then((key) => {
      if (key) {
        vapidPublicKey = key;
        initializeWebPush();
      }
    });
  }

  // Register event listeners
  document.addEventListener('login', async (event) => {
    const { provider } = (event as CustomEvent).detail;
    try {
      await signIn(provider);
    } catch (error) {
      console.error('Failed to login:', error);
      toast({
        title: 'Login failed',
        description: error instanceof Error ? error.message : 'Unable to start GitHub sign-in. Please try again.',
        variant: 'destructive',
      });
    }
  });

  document.addEventListener('logout', async () => {
    await cleanupOnLogout();
  });

  document.addEventListener('vapidKeysReset', async (event) => {
    const { newPublicKey } = (event as CustomEvent).detail;
    console.debug('VAPID keys reset, reinitializing web push...');

    // Store the new public key
    if (newPublicKey) {
      vapidPublicKey = newPublicKey;
      localStorage.setItem(VAPID_KEY_STORAGE_KEY, newPublicKey);
    }

    // Force refresh
    await initializeWebPush(true);
  });

  document.addEventListener('notificationPermissionGranted', () => {
    initializeWebPush(true);
  });

  window.addEventListener('SSEConnectionError', async (event) => {
    const { error, code } = (event as CustomEvent).detail;
    await handleSSEConnectionError(error, code);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void silentlyRepairDroppedSubscriptionIfNeeded('visibilitychange');
      void refreshSubscriptionHealth();
    }
  });

  window.addEventListener('pageshow', () => {
    void silentlyRepairDroppedSubscriptionIfNeeded('pageshow');
    void refreshSubscriptionHealth();
  });

  window.addEventListener('focus', () => {
    void silentlyRepairDroppedSubscriptionIfNeeded('focus');
    void refreshSubscriptionHealth();
  });

  window.addEventListener('online', () => {
    void silentlyRepairDroppedSubscriptionIfNeeded('online');
    void refreshSubscriptionHealth(true);
  });

  // Check for fingerprint changes periodically
  setInterval(async () => {
    if (isLoggedIn && userEmail) {
      const currentFingerprint = await getCombinedFingerprint(userEmail);
      const storedFingerprint = getUserFingerprint(userEmail);

      if (storedFingerprint && currentFingerprint !== storedFingerprint) {
        console.debug(`Fingerprint changed during session for user ${userEmail}, updating subscription...`);
        // Re-initialize web push with the new fingerprint
        await initializeWebPush(true);
      }
    }
  }, 60 * 60 * 1000); // Check once per hour
}
