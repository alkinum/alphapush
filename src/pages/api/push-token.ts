import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { eq } from 'drizzle-orm';

import { getDb } from '@/db';
import { userCredentials } from '@/schema';
import { generatePushToken } from '@/utils/vapid-helper';

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

    const userCreds = await db.select().from(userCredentials).where(eq(userCredentials.email, userEmail)).get();

    if (!userCreds) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ pushToken: userCreds.pushToken }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error while fetching push token:', error);
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

    const body = (await request.json()) as { oldPushToken?: string };
    const { oldPushToken } = body;

    if (!oldPushToken) {
      return new Response(JSON.stringify({ error: 'Old push token is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userCreds = await db.select().from(userCredentials).where(eq(userCredentials.email, userEmail)).get();

    if (!userCreds || userCreds.pushToken !== oldPushToken) {
      return new Response(JSON.stringify({ error: 'Invalid old push token' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const newPushToken = generatePushToken();

    await db.update(userCredentials).set({ pushToken: newPushToken }).where(eq(userCredentials.email, userEmail)).run();

    return new Response(JSON.stringify({ pushToken: newPushToken }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error while resetting push token:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
