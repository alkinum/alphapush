import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions } from '@/schema';

// Change the clients map to use a nested structure
const clients = new Map<string, Map<string, WritableStreamDefaultWriter<Uint8Array>>>();

export function sendSSEvent(userEmail: string, event: string, data: any) {
  let userClients = clients.get(userEmail);
  if (!userClients) {
    userClients = new Map<string, WritableStreamDefaultWriter<Uint8Array>>();
    clients.set(userEmail, userClients);
  }

  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  userClients.forEach(async (writer, deviceFingerprint) => {
    try {
      await writer.ready;
      await writer.write(encoder.encode(message));
    } catch (error: unknown) {
      console.error('Error sending SSE event:', error);
      userClients.delete(deviceFingerprint);
      try {
        await writer.close();
      } catch (closeError: unknown) {
        if (closeError && (closeError as Error).message !== 'Invalid state: WritableStream is closed') {
          console.error('Error closing writer:', closeError);
        }
      }
      if (userClients.size === 0) {
        clients.delete(userEmail);
      }
    }
  });
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
    clients.set(userEmail, new Map());
  }
  const userClients = clients.get(userEmail)!;

  // Close existing connection for this device if it exists
  const existingWriter = userClients.get(deviceFingerprint);
  if (existingWriter) {
    userClients.delete(deviceFingerprint);
    try {
      await existingWriter.close();
    } catch (error) {
      if (error && (error as Error).message !== 'Invalid state: WritableStream is closed') {
        console.error('Error closing existing writer:', error);
      }
    }
    if (userClients.size === 0) {
      clients.delete(userEmail);
    }
  }

  userClients.set(deviceFingerprint, writer);

  const cleanup = async () => {
    clearInterval(heartbeatInterval);
    const userClients = clients.get(userEmail);
    if (userClients) {
      userClients.delete(deviceFingerprint);
      if (userClients.size === 0) {
        clients.delete(userEmail);
      }
    }
    try {
      await writer.close();
    } catch (error: unknown) {
      if (error && (error as Error).message !== 'Invalid state: WritableStream is closed') {
        console.error('Error closing writer:', error);
      }
    }
  };

  let heartbeatFailures = 0;

  const heartbeatInterval = setInterval(async () => {
    try {
      await writer.ready;
      await writer.write(encoder.encode(`event: heartbeat\ndata: ${new Date().toISOString()}\n\n`));
      heartbeatFailures = 0; // Reset on successful heartbeat
    } catch (error: unknown) {
      if (error) {
        if ((error as Error).message === 'Invalid state: WritableStream is closed') {
          await cleanup();
          return;
        } else {
          console.error('Error sending heartbeat:', (error as Error).message);
        }
      }
      heartbeatFailures++;
      if (heartbeatFailures >= 5) {
        await cleanup();
      }
    }
  }, 30 * 1000);

  setTimeout(async () => {
    try {
      await writer.ready;
      await writer.write(encoder.encode('event: connected\ndata: SSE connection established\n\n'));
    } catch (error) {
      console.error('Error initializing SSE connection:', error);
      await cleanup();
    }
  }, 500);

  request.signal.addEventListener('abort', cleanup);

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
};
