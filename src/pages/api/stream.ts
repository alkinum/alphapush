import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions } from '@/schema';

const clients = new Map<string, Set<WritableStreamDefaultWriter<Uint8Array>>>();

export function sendSSEvent(userEmail: string, event: string, data: any) {
  const userClients = clients.get(userEmail);
  if (userClients) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const encoder = new TextEncoder();
    userClients.forEach((writer) => {
      writer.write(encoder.encode(message)).catch((error) => {
        console.error('Error sending SSE event:', error);
        userClients.delete(writer);
        writer.close().catch(console.error);
      });
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

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  if (!clients.has(userEmail)) {
    clients.set(userEmail, new Set());
  }
  clients.get(userEmail)!.add(writer);

  writer.write(encoder.encode('event: connected\ndata: SSE connection established\n\n'));

  const cleanup = async () => {
    clearInterval(heartbeatInterval);
    clients.get(userEmail)?.delete(writer);
    if (clients.get(userEmail)?.size === 0) {
      clients.delete(userEmail);
    }
    try {
      if (await writer.closed) {
        writer.close().catch(console.error);
      }
    } catch {
      // do nothing
    }
  };

  const heartbeatInterval = setInterval(async () => {
    try {
      try {
        if (await writer.closed) {
          cleanup();
        }
      } catch {
        // do nothing
      }
      await writer.ready;
      await writer.write(encoder.encode(`event: heartbeat\ndata: ${new Date().toISOString()}\n\n`));
    } catch (error) {
      console.debug('Error sending heartbeat:', error);
      cleanup();
    }
  }, 30 * 1000);

  writer.closed.then(() => {
    cleanup();
  });

  request.signal.addEventListener('abort', cleanup);

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
