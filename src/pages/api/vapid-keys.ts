import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { eq } from 'drizzle-orm';

import { getDb } from '@/db';
import { userCredentials } from '@/schema';
import { generateUserCredentials } from '@/utils/vapid-helper';

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const db = getDb(locals.runtime.env.DB);

    let userCreds = await db.select().from(userCredentials).where(eq(userCredentials.email, userEmail)).get();

    if (!userCreds) {
      const { publicKey, privateKey, pushToken } = await generateUserCredentials();

      userCreds = await db
        .insert(userCredentials)
        .values({
          email: userEmail,
          publicKey,
          privateKey,
          pushToken,
        })
        .returning()
        .get();
    }

    return new Response(JSON.stringify({ publicKey: userCreds.publicKey, pushToken: userCreds.pushToken }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error while fetching user credentials:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const db = getDb(locals.runtime.env.DB);

    const body = await request.json();
    const { action } = body as { action?: string };

    if (action !== 'reset') {
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { publicKey, privateKey } = await generateUserCredentials();

    const updatedUser = await db
      .update(userCredentials)
      .set({
        publicKey,
        privateKey,
        updatedAt: new Date(),
      })
      .where(eq(userCredentials.email, userEmail))
      .returning()
      .get();

    if (!updatedUser) {
      throw new Error('Failed to update user credentials');
    }

    return new Response(JSON.stringify({ publicKey: updatedUser.publicKey }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error while resetting VAPID keys:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
