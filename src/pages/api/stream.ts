import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { getDb } from '@/db';
import { subscriptions } from '@/schema';
import { eq } from 'drizzle-orm';

const clients = new Map<string, Set<ReadableStreamDefaultController>>();

export function sendSSEvent(userEmail: string, event: string, data: any) {
  const userClients = clients.get(userEmail);
  if (userClients) {
    userClients.forEach((controller) => {
      if (controller.desiredSize !== null) {
        try {
          controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
          console.error('Error sending SSE event:', error);
          if (controller.desiredSize === null) {
            userClients.delete(controller);
          }
        }
      }
    });
  }
}

export const GET: APIRoute = async ({ request, locals }) => {
  const session = await getSession(request);
  if (!session?.user?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userEmail = session.user.email;
  const db = getDb(locals.runtime.env.DB);

  const url = new URL(request.url);
  const deviceFingerprint = url.searchParams.get('fingerprint');

  if (!deviceFingerprint) {
    return new Response(JSON.stringify({ error: 'Missing device fingerprint' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const subscription = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.deviceFingerprint, deviceFingerprint))
    .get();

  if (!subscription || subscription.userEmail !== userEmail) {
    return new Response(JSON.stringify({ error: 'Invalid device fingerprint' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      if (!clients.has(userEmail)) {
        clients.set(userEmail, new Set());
      }
      clients.get(userEmail)!.add(controller);

      controller.enqueue('event: connected\ndata: SSE connection established\n\n');

      let isConnectionClosed = false;

      const heartbeatInterval = setInterval(() => {
        if (isConnectionClosed || controller.desiredSize === null) {
          clearInterval(heartbeatInterval);
          return;
        }
        try {
          // Check if the controller is closed
          if (controller.desiredSize !== null) {
            controller.enqueue(`event: heartbeat\ndata: ${new Date().toISOString()}\n\n`);
          } else {
            throw new Error('Controller is closed');
          }
        } catch (error) {
          console.error('Error sending heartbeat:', error);
          clearInterval(heartbeatInterval);
          isConnectionClosed = true;
          clients.get(userEmail)?.delete(controller);
        }
      }, 30000);

      return () => {
        isConnectionClosed = true;
        clearInterval(heartbeatInterval);
        clients.get(userEmail)?.delete(controller);
        if (clients.get(userEmail)?.size === 0) {
          clients.delete(userEmail);
        }
      };
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
