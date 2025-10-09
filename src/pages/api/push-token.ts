import type { APIRoute } from 'astro';
import { getSessionFromContext } from '@/lib/auth';
import { PushTokenService } from '@/services/pushTokenService';

export const GET: APIRoute = async (context) => {
  try {
    const session = await getSessionFromContext(context);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const pushTokenService = new PushTokenService(context.locals.runtime.env.DB);

    const pushToken = await pushTokenService.getPushToken(userEmail);

    if (!pushToken) {
      return new Response(JSON.stringify({ error: 'Failed to get or generate push token' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

export const POST: APIRoute = async (context) => {
  try {
    const session = await getSessionFromContext(context);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const pushTokenService = new PushTokenService(context.locals.runtime.env.DB);

    const body = await context.request.json();
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