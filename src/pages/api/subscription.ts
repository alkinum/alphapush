import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions } from '@/schema';
import { logger } from '@/utils/logger';

// Helper function: Validate SHA256 hash
function isValidSHA256(hash: string): boolean {
  const sha256Regex = /^[a-f0-9]{64}$/i;
  return sha256Regex.test(hash);
}

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      logger.warn('Unauthorized subscription update attempt');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const body = (await request.json()) as { subscription?: unknown; deviceFingerprint?: string };
    const { subscription, deviceFingerprint } = body;

    if (!subscription || typeof subscription !== 'object' || !deviceFingerprint) {
      logger.warn('Invalid subscription data received:', { userEmail, hasSubscription: !!subscription, hasDeviceFingerprint: !!deviceFingerprint });
      return new Response(JSON.stringify({ error: 'Missing or invalid subscription data or device fingerprint' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate device fingerprint as a valid SHA256 hash
    if (!isValidSHA256(deviceFingerprint)) {
      logger.warn('Invalid device fingerprint format:', { userEmail, deviceFingerprint });
      return new Response(JSON.stringify({ error: 'Invalid device fingerprint format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    logger.debug('Processing subscription update:', { userEmail, deviceFingerprint });
    const db = getDb(locals.runtime.env.DB);

    const existingSubscription = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userEmail, userEmail), eq(subscriptions.deviceFingerprint, deviceFingerprint)))
      .get();

    if (existingSubscription) {
      logger.debug('Updating existing subscription:', { userEmail, deviceFingerprint });
      const result = await db
        .update(subscriptions)
        .set({ subscription: JSON.stringify(subscription), updatedAt: new Date() })
        .where(and(eq(subscriptions.userEmail, userEmail), eq(subscriptions.deviceFingerprint, deviceFingerprint)))
        .returning({ updatedAt: subscriptions.updatedAt })
        .get();

      logger.info('Subscription updated successfully:', { userEmail, deviceFingerprint, updatedAt: result.updatedAt });
      return new Response(
        JSON.stringify({ message: 'Subscription updated successfully', updatedAt: result.updatedAt }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } else {
      logger.debug('Creating new subscription:', { userEmail, deviceFingerprint });
      const result = await db
        .insert(subscriptions)
        .values({
          userEmail,
          deviceFingerprint,
          subscription: JSON.stringify(subscription),
        })
        .returning({ createdAt: subscriptions.createdAt })
        .get();

      logger.info('Subscription created successfully:', { userEmail, deviceFingerprint, createdAt: result.createdAt });
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

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      logger.warn('Unauthorized subscription deletion attempt');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const body = (await request.json()) as { deviceFingerprint?: string };
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
    const db = getDb(locals.runtime.env.DB);

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
