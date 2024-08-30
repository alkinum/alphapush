import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { PushTokenService } from '@/services/pushTokenService';

async function ensurePushToken(pushTokenService: PushTokenService, userEmail: string): Promise<string> {
  let pushToken = await pushTokenService.getPushToken(userEmail);
  if (!pushToken) {
    pushToken = await pushTokenService.resetPushToken(userEmail);
    if (!pushToken) {
      throw new Error('Failed to generate push token');
    }
  }
  return pushToken;
}

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
    const pushTokenService = new PushTokenService(locals.runtime.env.DB);

    const pushToken = await ensurePushToken(pushTokenService, userEmail);

    return new Response(JSON.stringify({ pushToken }), {
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
    const pushTokenService = new PushTokenService(locals.runtime.env.DB);

    const body = await request.json();
    const { action } = body as { action?: string };

    if (action !== 'reset') {
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const newPushToken = await pushTokenService.resetPushToken(userEmail);

    if (!newPushToken) {
      return new Response(JSON.stringify({ error: 'Failed to reset push token' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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