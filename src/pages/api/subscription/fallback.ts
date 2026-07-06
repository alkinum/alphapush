import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { getSessionFromContext } from '@/lib/auth';
import { getDb } from '@/db';
import { subscriptions } from '@/schema';
import { defaultPreferences } from '@/services/userPreferenceService';
import { validateBarkTarget } from '@/services/barkFallbackService';
import { logger } from '@/utils/logger';

interface FallbackConfigBody {
  deviceFingerprint?: string;
  enabled?: boolean;
  always?: boolean;
  serverUrl?: string;
  deviceKey?: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function isValidSHA256(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash);
}

function normalizeFallbackConfig(body: FallbackConfigBody) {
  const enabled = body.enabled === true;
  const always = body.always === true;
  const serverUrl = typeof body.serverUrl === 'string' && body.serverUrl.trim()
    ? body.serverUrl.trim()
    : defaultPreferences.barkServerUrl;
  const deviceKey = typeof body.deviceKey === 'string' ? body.deviceKey.trim() : '';

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

export const GET: APIRoute = async (context) => {
  try {
    const session = await getSessionFromContext(context);
    if (!session?.user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const url = new URL(context.request.url);
    const deviceFingerprint = url.searchParams.get('deviceFingerprint') || '';
    if (!isValidSHA256(deviceFingerprint)) {
      return jsonResponse({ error: 'Invalid device fingerprint' }, 400);
    }

    const db = getDb(env.DB);
    const subscription = await db
      .select()
      .from(subscriptions)
      .where(and(
        eq(subscriptions.userEmail, session.user.email),
        eq(subscriptions.deviceFingerprint, deviceFingerprint)
      ))
      .get();

    if (!subscription) {
      return jsonResponse({ error: 'Subscription not found' }, 404);
    }

    return jsonResponse({
      barkFallbackEnabled: !!subscription.barkFallbackEnabled,
      barkFallbackAlways: !!subscription.barkFallbackAlways,
      barkServerUrl: subscription.barkServerUrl || defaultPreferences.barkServerUrl,
      barkDeviceKey: subscription.barkDeviceKey || '',
      noAckCount: subscription.noAckCount || 0,
      lastNoAckAt: subscription.lastNoAckAt,
      lastAckAt: subscription.lastAckAt,
    });
  } catch (error) {
    logger.error('Error getting subscription fallback config:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};

export const PUT: APIRoute = async (context) => {
  try {
    const session = await getSessionFromContext(context);
    if (!session?.user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = (await context.request.json()) as FallbackConfigBody;
    const deviceFingerprint = typeof body.deviceFingerprint === 'string' ? body.deviceFingerprint : '';
    if (!isValidSHA256(deviceFingerprint)) {
      return jsonResponse({ error: 'Invalid device fingerprint' }, 400);
    }

    const config = normalizeFallbackConfig(body);
    const db = getDb(env.DB);
    const updatedSubscription = await db
      .update(subscriptions)
      .set({
        ...config,
        updatedAt: new Date(),
      })
      .where(and(
        eq(subscriptions.userEmail, session.user.email),
        eq(subscriptions.deviceFingerprint, deviceFingerprint)
      ))
      .returning()
      .get();

    if (!updatedSubscription) {
      return jsonResponse({ error: 'Subscription not found' }, 404);
    }

    return jsonResponse({
      barkFallbackEnabled: !!updatedSubscription.barkFallbackEnabled,
      barkFallbackAlways: !!updatedSubscription.barkFallbackAlways,
      barkServerUrl: updatedSubscription.barkServerUrl || defaultPreferences.barkServerUrl,
      barkDeviceKey: updatedSubscription.barkDeviceKey || '',
      noAckCount: updatedSubscription.noAckCount || 0,
      lastNoAckAt: updatedSubscription.lastNoAckAt,
      lastAckAt: updatedSubscription.lastAckAt,
    });
  } catch (error) {
    logger.error('Error updating subscription fallback config:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return jsonResponse({ error: message }, message === 'Internal server error' ? 500 : 400);
  }
};
