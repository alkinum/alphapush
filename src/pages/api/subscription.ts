import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getSessionFromContext } from '@/lib/auth';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions } from '@/schema';
import { defaultPreferences } from '@/services/userPreferenceService';
import { validateBarkTarget } from '@/services/barkFallbackService';
import { logger } from '@/utils/logger';

interface BarkFallbackConfigInput {
  enabled?: boolean;
  always?: boolean;
  serverUrl?: string;
  deviceKey?: string;
}

// Helper function: Validate SHA256 hash
function isValidSHA256(hash: string): boolean {
  const sha256Regex = /^[a-f0-9]{64}$/i;
  return sha256Regex.test(hash);
}

function getSubscriptionEndpoint(subscription: unknown): string | null {
  if (!subscription || typeof subscription !== 'object') {
    return null;
  }

  const endpoint = (subscription as { endpoint?: unknown }).endpoint;
  return typeof endpoint === 'string' && endpoint.length > 0 ? endpoint : null;
}

async function sha256Hex(value: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function parseStoredSubscriptionEndpoint(subscription: string): string | null {
  try {
    return getSubscriptionEndpoint(JSON.parse(subscription));
  } catch {
    return null;
  }
}

function normalizeBarkFallbackConfig(input?: BarkFallbackConfigInput) {
  if (!input) {
    return {};
  }

  const enabled = input.enabled === true;
  const always = input.always === true;
  const serverUrl = typeof input.serverUrl === 'string' && input.serverUrl.trim()
    ? input.serverUrl.trim()
    : defaultPreferences.barkServerUrl;
  const deviceKey = typeof input.deviceKey === 'string' ? input.deviceKey.trim() : '';

  if (enabled) {
    const validation = validateBarkTarget({
      barkServerUrl: serverUrl,
      barkDeviceKey: deviceKey,
    });

    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    return {
      barkFallbackEnabled: true,
      barkFallbackAlways: always,
      barkServerUrl: validation.serverUrl,
      barkDeviceKey: validation.deviceKey,
    };
  }

  return {
    barkFallbackEnabled: false,
    barkFallbackAlways: false,
    barkServerUrl: serverUrl,
    barkDeviceKey: deviceKey,
  };
}

const STALE_SUBSCRIPTION_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_NO_ACK_FAILURE_THRESHOLD = 3;

type SubscriptionEnv = typeof env & {
  PUSH_NO_ACK_FAILURE_THRESHOLD?: string;
};

const subscriptionEnv = env as SubscriptionEnv;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async (context) => {
  try {
    const session = await getSessionFromContext(context);
    if (!session?.user?.email) {
      logger.warn('Unauthorized subscription health request');
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const userEmail = session.user.email;
    const fingerprint = context.url.searchParams.get('fingerprint');
    if (fingerprint && !isValidSHA256(fingerprint)) {
      return jsonResponse({ error: 'Invalid device fingerprint' }, 400);
    }
    const db = getDb(env.DB);
    const userSubscriptions = await db
      .select()
      .from(subscriptions)
      .where(and(
        eq(subscriptions.userEmail, userEmail),
        fingerprint ? eq(subscriptions.deviceFingerprint, fingerprint) : undefined
      ))
      .all();

    const now = Date.now();
    const healthSubscriptions = userSubscriptions.map((subscription) => {
      const lastSeenAt = subscription.lastSeenAt?.getTime() || null;
      const lastSuccessAt = subscription.lastSuccessAt?.getTime() || null;
      const lastFailureAt = subscription.lastFailureAt?.getTime() || null;
      const failureCount = subscription.failureCount || 0;
      const hasRecentSeen = !!lastSeenAt && now - lastSeenAt < STALE_SUBSCRIPTION_THRESHOLD_MS;
      const hasRecentSuccess = !!lastSuccessAt && now - lastSuccessAt < STALE_SUBSCRIPTION_THRESHOLD_MS;
      const isStale = !hasRecentSeen && !hasRecentSuccess;
      const noAckCount = subscription.noAckCount || 0;
      const noAckThreshold = Number(subscriptionEnv.PUSH_NO_ACK_FAILURE_THRESHOLD || DEFAULT_NO_ACK_FAILURE_THRESHOLD);
      const isFailing =
        (failureCount >= 3 && (!lastSuccessAt || (!!lastFailureAt && lastFailureAt >= lastSuccessAt))) ||
        noAckCount >= noAckThreshold;

      return {
        id: subscription.id,
        isSafari: !!subscription.isSafari,
        barkFallbackEnabled: !!subscription.barkFallbackEnabled,
        hasBarkDeviceKey: !!subscription.barkDeviceKey,
        noAckCount,
        lastNoAckAt: subscription.lastNoAckAt,
        lastAckAt: subscription.lastAckAt,
        lastSeenAt: subscription.lastSeenAt,
        lastSuccessAt: subscription.lastSuccessAt,
        lastFailureAt: subscription.lastFailureAt,
        failureCount,
        lastStatusCode: subscription.lastStatusCode,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
        isStale,
        isFailing,
      };
    });

    const failingCount = healthSubscriptions.filter((subscription) => subscription.isFailing).length;
    const staleCount = healthSubscriptions.filter((subscription) => subscription.isStale).length;
    const safariCount = healthSubscriptions.filter((subscription) => subscription.isSafari).length;
    const total = healthSubscriptions.length;
    const needsRepair = total === 0 || failingCount > 0 || (total > 0 && staleCount === total);

    return jsonResponse({
      total,
      hasServerSubscription: total > 0,
      failingCount,
      staleCount,
      safariCount,
      needsRepair,
      subscriptions: healthSubscriptions,
    });
  } catch (error) {
    logger.error('Error getting subscription health:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};

export const PUT: APIRoute = async (context) => {
  try {
    const session = await getSessionFromContext(context);
    if (!session?.user?.email) {
      logger.warn('Unauthorized subscription update attempt');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const body = (await context.request.json()) as {
      subscription?: unknown;
      deviceFingerprint?: string;
      oldEndpoint?: string;
      isSafari?: boolean;
      barkFallback?: BarkFallbackConfigInput;
    };
    const { subscription, oldEndpoint, isSafari = false } = body;
    let { deviceFingerprint } = body;
    const barkFallbackConfig = normalizeBarkFallbackConfig(body.barkFallback);

    if (!subscription || typeof subscription !== 'object') {
      logger.warn('Invalid subscription data received:', { userEmail, hasSubscription: !!subscription });
      return new Response(JSON.stringify({ error: 'Missing or invalid subscription data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const subscriptionEndpoint = getSubscriptionEndpoint(subscription);
    if (!subscriptionEndpoint) {
      logger.warn('Invalid subscription endpoint received:', { userEmail });
      return new Response(JSON.stringify({ error: 'Missing or invalid subscription endpoint' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb(env.DB);
    let existingSubscription: typeof subscriptions.$inferSelect | undefined;
    let userSubscriptionsCache: Array<typeof subscriptions.$inferSelect> | undefined;
    const getUserSubscriptions = async () => {
      if (!userSubscriptionsCache) {
        userSubscriptionsCache = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.userEmail, userEmail))
          .all();
      }

      return userSubscriptionsCache;
    };

    if (oldEndpoint) {
      const userSubscriptions = await getUserSubscriptions();
      existingSubscription = userSubscriptions.find((storedSubscription) => {
        return parseStoredSubscriptionEndpoint(storedSubscription.subscription) === oldEndpoint;
      });

      if (existingSubscription) {
        deviceFingerprint ||= existingSubscription.deviceFingerprint;
      }
    }

    if (!deviceFingerprint) {
      deviceFingerprint = await sha256Hex(`push-endpoint:${subscriptionEndpoint}`);
    }

    // Validate device fingerprint as a valid SHA256 hash
    if (!isValidSHA256(deviceFingerprint)) {
      logger.warn('Invalid device fingerprint format:', { userEmail, deviceFingerprint });
      return new Response(JSON.stringify({ error: 'Invalid device fingerprint format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    logger.debug('Processing subscription update:', { userEmail, deviceFingerprint, isSafari });

    existingSubscription = existingSubscription || await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userEmail, userEmail), eq(subscriptions.deviceFingerprint, deviceFingerprint)))
      .get();

    if (!existingSubscription) {
      const userSubscriptions = await getUserSubscriptions();
      existingSubscription = userSubscriptions.find((storedSubscription) => {
        return parseStoredSubscriptionEndpoint(storedSubscription.subscription) === subscriptionEndpoint;
      });
    }

    if (existingSubscription) {
      logger.debug('Updating existing subscription:', { userEmail, deviceFingerprint, isSafari });
      const result = await db
        .update(subscriptions)
        .set({
          deviceFingerprint,
          subscription: JSON.stringify(subscription),
          isSafari: isSafari,
          lastSeenAt: new Date(),
          failureCount: 0,
          lastStatusCode: null,
          ...barkFallbackConfig,
          updatedAt: new Date(),
        })
        .where(and(eq(subscriptions.userEmail, userEmail), eq(subscriptions.id, existingSubscription.id)))
        .returning({ updatedAt: subscriptions.updatedAt })
        .get();

      logger.info('Subscription updated successfully:', { userEmail, deviceFingerprint, isSafari, updatedAt: result.updatedAt });
      return new Response(
        JSON.stringify({ message: 'Subscription updated successfully', updatedAt: result.updatedAt }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } else {
      logger.debug('Creating new subscription:', { userEmail, deviceFingerprint, isSafari });
      const result = await db
        .insert(subscriptions)
        .values({
          userEmail,
          deviceFingerprint,
          subscription: JSON.stringify(subscription),
          isSafari: isSafari,
          lastSeenAt: new Date(),
          ...barkFallbackConfig,
        })
        .returning({ createdAt: subscriptions.createdAt })
        .get();

      logger.info('Subscription created successfully:', { userEmail, deviceFingerprint, isSafari, createdAt: result.createdAt });
      return new Response(
        JSON.stringify({ message: 'Subscription created successfully', createdAt: result.createdAt }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  } catch (error) {
    logger.error('Error processing subscription:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async (context) => {
  try {
    const session = await getSessionFromContext(context);
    if (!session?.user?.email) {
      logger.warn('Unauthorized subscription deletion attempt');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const body = (await context.request.json()) as { deviceFingerprint?: string };
    const { deviceFingerprint } = body;

    if (!deviceFingerprint) {
      logger.warn('Missing device fingerprint for deletion:', { userEmail });
      return new Response(JSON.stringify({ error: 'Missing device fingerprint' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate device fingerprint as a valid SHA256 hash
    if (!isValidSHA256(deviceFingerprint)) {
      logger.warn('Invalid device fingerprint format for deletion:', { userEmail, deviceFingerprint });
      return new Response(JSON.stringify({ error: 'Invalid device fingerprint format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    logger.debug('Processing subscription deletion:', { userEmail, deviceFingerprint });
    const db = getDb(env.DB);

    const result = await db
      .delete(subscriptions)
      .where(and(eq(subscriptions.userEmail, userEmail), eq(subscriptions.deviceFingerprint, deviceFingerprint)))
      .returning({ deletedId: subscriptions.id })
      .get();

    if (result) {
      logger.info('Subscription deleted successfully:', { userEmail, deviceFingerprint, deletedId: result.deletedId });
      return new Response(
        JSON.stringify({ message: 'Subscription deleted successfully', deletedId: result.deletedId }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } else {
      logger.warn('Subscription not found for deletion:', { userEmail, deviceFingerprint });
      return new Response(JSON.stringify({ error: 'Subscription not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    logger.error('Error deleting subscription:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
