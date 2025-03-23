import { signIn, signOut } from 'auth-astro/client';
import { useToast } from '@/components/ui/toast/use-toast';
import { getCombinedFingerprint } from '@/utils/fingerprint';
import { StreamErrorCode } from '@/pages/api/stream';

// Constants
const FINGERPRINTS_STORAGE_KEY = 'userFingerprints';
const VAPID_KEY_STORAGE_KEY = 'vapidPublicKey';
const PUSH_TOKEN_STORAGE_KEY = 'pushToken';

// State
let vapidPublicKey: string | null = localStorage.getItem(VAPID_KEY_STORAGE_KEY);
let deviceFingerprint: string | null = null;

// User fingerprints map: { userEmail: fingerprint }
interface UserFingerprints {
  [userEmail: string]: string;
}

const { toast } = useToast();

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
export async function getVapidKey(): Promise<string | null> {
  try {
    const response = await fetch('/api/vapid-keys');
    if (!response.ok) {
      throw new Error('Failed to fetch VAPID key');
    }
    const data = (await response.json()) as { publicKey: string; pushToken: string };
    const serverVapidKey = data.publicKey;

    // Check if server key is different from local key
    const storedVapidKey = localStorage.getItem(VAPID_KEY_STORAGE_KEY);
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
    toast({
      title: 'Error',
      description: 'Failed to get push key. Please try again later.',
      variant: 'destructive',
    });
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
 * Unsubscribe from web push for a specific fingerprint
 */
export async function unsubscribeWebPush(fingerprintToUnsubscribe?: string, userEmail?: string): Promise<boolean> {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      // If we have an active subscription, unsubscribe from it
      if (subscription) {
        await subscription.unsubscribe();
        console.debug('Unsubscribed from push subscription in browser');
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
      toast({
        title: 'Error',
        description: 'Failed to unsubscribe from Web Push. Please try again.',
        variant: 'destructive',
      });
      return false;
    }
  }
  return false;
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
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

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
      body: JSON.stringify({ subscription, deviceFingerprint }),
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
 */
export async function subscribeWebPush(publicKey: string): Promise<boolean> {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const registration = await navigator.serviceWorker.ready;
      const userEmail = document.body.getAttribute('data-user-email');

      if (!userEmail) {
        throw new Error('User email not found');
      }

      // Get and validate fingerprint
      const newFingerprint = await getCombinedFingerprint(userEmail);
      const storedFingerprint = getUserFingerprint(userEmail);

      // Check for existing subscription
      let subscription = await registration.pushManager.getSubscription();

      // Compare the existing subscription's application server key with the new one
      if (subscription) {
        const existingKey = arrayBufferToBase64(subscription.options.applicationServerKey as ArrayBuffer);
        const normalizedPublicKey = publicKey.replace(/=/g, ''); // Remove padding if any

        if (existingKey !== normalizedPublicKey) {
          console.debug('Application server key mismatch, unsubscribing old subscription');
          await subscription.unsubscribe();
          subscription = null;
        }
      }

      // If fingerprint changed and we have an old one, unsubscribe it from server
      if (storedFingerprint && storedFingerprint !== newFingerprint) {
        console.debug('Fingerprint changed, unsubscribing old fingerprint');
        await unsubscribeWebPush(storedFingerprint, userEmail);
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
          deviceFingerprint: newFingerprint
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
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
          console.debug('Cleaned up failed subscription');
        }
      } catch (cleanupError) {
        console.error('Failed to clean up subscription after error:', cleanupError);
      }

      toast({
        title: 'Error',
        description: 'Push subscription failed. Please reload the app and try again.',
        variant: 'destructive',
      });
      return false;
    }
  }
  return false;
}

/**
 * Initialize web push subscription
 * When forceRefresh is true, always fetches the latest VAPID key from server
 * Handles subscribing to push notifications with proper VAPID key verification
 */
export async function initializeWebPush(forceRefresh = false): Promise<boolean> {
  if (Notification.permission !== 'granted') {
    return false;
  }

  try {
    // Always fetch the latest VAPID key from server if forceRefresh is true or vapidPublicKey doesn't exist
    if (forceRefresh || !vapidPublicKey) {
      vapidPublicKey = await getVapidKey();
    }

    if (vapidPublicKey) {
      return await subscribeWebPush(vapidPublicKey);
    }

    return false;
  } catch (error) {
    console.error('Failed to initialize web push:', error);
    toast({
      title: 'Error',
      description: 'Failed to initialize push notifications. Please try again later.',
      variant: 'destructive',
    });
    return false;
  }
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
  const isLoggedIn = document.body.hasAttribute('data-user-logged-in');
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
        initializeWebPush(true);
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
