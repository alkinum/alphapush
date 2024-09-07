import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions } from '@/schema';

// Change the clients map to use a nested structure
const clients = new Map<string, Map<string, WritableStreamDefaultWriter<Uint8Array>>>();

export function sendSSEvent(userEmail: string, event: string, data: any) {
  const userClients = clients.get(userEmail);
  if (userClients) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const encoder = new TextEncoder();
    userClients.forEach((writer, deviceFingerprint) => {
      writer.write(encoder.encode(message)).catch((error) => {
        console.error('Error sending SSE event:', error);
        userClients.delete(deviceFingerprint);
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
    clients.set(userEmail, new Map());
  }
  const userClients = clients.get(userEmail)!;

  // Close existing connection for this device if it exists
  const existingWriter = userClients.get(deviceFingerprint);
  if (existingWriter) {
    Promise.resolve(existingWriter.closed).then(
      () => {
        // Writer is already closed, no action needed
      },
      () => {
        // Writer is not closed, so we close it
        existingWriter.close().catch(console.error);
      },
    );
  }

  userClients.set(deviceFingerprint, writer);

  writer.write(encoder.encode('event: connected\ndata: SSE connection established\n\n'));

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
      // Check if the writer is already closed
      await writer.closed;
      // If we reach here, the writer is already closed
    } catch {
      // If the promise rejects, the writer is not closed, so we close it
      try {
        await writer.close();
      } catch (error) {
        console.error('Error closing writer:', error);
      }
    }
  };

  const heartbeatInterval = setInterval(async () => {
    try {
      // Check if the writer is closed
      await writer.closed;
      // If we reach here, the writer is closed, so we clean up
      await cleanup();
      return;
    } catch {
      // If the promise rejects, the writer is not closed
      // Wait for the writer to be ready
      await writer.ready;

      // Send the heartbeat
      try {
        await writer.write(encoder.encode(`event: heartbeat\ndata: ${new Date().toISOString()}\n\n`));
      } catch (error) {
        console.error('Error sending heartbeat:', error);
        await cleanup();
      }
    }
  }, 30 * 1000);

  request.signal.addEventListener('abort', cleanup);

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
