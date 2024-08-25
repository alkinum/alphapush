import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions } from '@/schema';

// Helper function: Validate SHA256 hash
function isValidSHA256(hash: string): boolean {
  const sha256Regex = /^[a-f0-9]{64}$/i;
  return sha256Regex.test(hash);
}

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const body = (await request.json()) as { subscription?: unknown; deviceFingerprint?: string };
    const { subscription, deviceFingerprint } = body;

    if (!subscription || typeof subscription !== 'object' || !deviceFingerprint) {
      return new Response(JSON.stringify({ error: 'Missing or invalid subscription data or device fingerprint' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate device fingerprint as a valid SHA256 hash
    if (!isValidSHA256(deviceFingerprint)) {
      return new Response(JSON.stringify({ error: 'Invalid device fingerprint format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb(locals.runtime.env.DB);

    const existingSubscription = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userEmail, userEmail), eq(subscriptions.deviceFingerprint, deviceFingerprint)))
      .get();

    if (existingSubscription) {
      const result = await db
        .update(subscriptions)
        .set({ subscription: JSON.stringify(subscription), updatedAt: new Date() })
        .where(and(eq(subscriptions.userEmail, userEmail), eq(subscriptions.deviceFingerprint, deviceFingerprint)))
        .returning({ updatedAt: subscriptions.updatedAt })
        .get();

      return new Response(
        JSON.stringify({ message: 'Subscription updated successfully', updatedAt: result.updatedAt }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } else {
      const result = await db
        .insert(subscriptions)
        .values({
          userEmail,
          deviceFingerprint,
          subscription: JSON.stringify(subscription),
        })
        .returning({ createdAt: subscriptions.createdAt })
        .get();

      return new Response(
        JSON.stringify({ message: 'Subscription created successfully', createdAt: result.createdAt }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  } catch (error) {
    console.error('Error updating subscription:', error);
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
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const body = (await request.json()) as { deviceFingerprint?: string };
    const { deviceFingerprint } = body;

    if (!deviceFingerprint) {
      return new Response(JSON.stringify({ error: 'Missing device fingerprint' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate device fingerprint as a valid SHA256 hash
    if (!isValidSHA256(deviceFingerprint)) {
      return new Response(JSON.stringify({ error: 'Invalid device fingerprint format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb(locals.runtime.env.DB);

    const result = await db
      .delete(subscriptions)
      .where(and(eq(subscriptions.userEmail, userEmail), eq(subscriptions.deviceFingerprint, deviceFingerprint)))
      .returning({ deletedId: subscriptions.id })
      .get();

    if (result) {
      return new Response(
        JSON.stringify({ message: 'Subscription deleted successfully', deletedId: result.deletedId }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } else {
      return new Response(JSON.stringify({ error: 'Subscription not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    console.error('Error deleting subscription:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
