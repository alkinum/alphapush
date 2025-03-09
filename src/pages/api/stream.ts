import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions } from '@/schema';

// Define error codes enum for better error handling
export enum StreamErrorCode {
  // Authentication errors
  UNAUTHORIZED = 'SSE_UNAUTHORIZED',

  // Request validation errors
  MISSING_FINGERPRINT = 'SSE_MISSING_FINGERPRINT',
  INVALID_FINGERPRINT = 'SSE_INVALID_FINGERPRINT',

  // Stream operation errors
  SEND_EVENT_FAILED = 'SSE_SEND_EVENT_FAILED',
  WRITER_CLOSE_FAILED = 'SSE_WRITER_CLOSE_FAILED',

  // Heartbeat errors
  HEARTBEAT_FAILED = 'SSE_HEARTBEAT_FAILED',
  MAX_HEARTBEAT_FAILURES = 'SSE_MAX_HEARTBEAT_FAILURES',

  // Connection errors
  INIT_CONNECTION_FAILED = 'SSE_INIT_CONNECTION_FAILED',
  CLOSE_EXISTING_FAILED = 'SSE_CLOSE_EXISTING_FAILED'
}

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
      console.error(`Error sending SSE event [${StreamErrorCode.SEND_EVENT_FAILED}]:`, error);
      userClients.delete(deviceFingerprint);
      try {
        await writer.close();
      } catch (closeError: unknown) {
        if (closeError && (closeError as Error).message !== 'Invalid state: WritableStream is closed') {
          console.error(`Error closing writer [${StreamErrorCode.WRITER_CLOSE_FAILED}]:`, closeError);
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
    return new Response(JSON.stringify({
      error: 'Unauthorized',
      code: StreamErrorCode.UNAUTHORIZED
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userEmail = session.user.email;
  const db = getDb(locals.runtime.env.DB);

  const url = new URL(request.url);
  const deviceFingerprint = url.searchParams.get('fingerprint');

  if (!deviceFingerprint) {
    return new Response(JSON.stringify({
      error: 'Missing device fingerprint',
      code: StreamErrorCode.MISSING_FINGERPRINT
    }), {
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
    return new Response(JSON.stringify({
      error: 'Invalid device fingerprint',
      code: StreamErrorCode.INVALID_FINGERPRINT
    }), {
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
        console.error(`Error closing existing writer [${StreamErrorCode.CLOSE_EXISTING_FAILED}]:`, error);
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
        console.error(`Error closing writer [${StreamErrorCode.WRITER_CLOSE_FAILED}]:`, error);
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
        console.error(`Error sending heartbeat [${StreamErrorCode.HEARTBEAT_FAILED}]:`, (error as Error).message);
      }
      heartbeatFailures++;
      if (heartbeatFailures >= 5) {
        console.error(`Max heartbeat failures reached [${StreamErrorCode.MAX_HEARTBEAT_FAILURES}]`);
        await cleanup();
      }
    }
  }, 30 * 1000);

  setTimeout(async () => {
    try {
      await writer.ready;
      await writer.write(encoder.encode('event: connected\ndata: SSE connection established\n\n'));
    } catch (error) {
      console.error(`Error initializing SSE connection [${StreamErrorCode.INIT_CONNECTION_FAILED}]:`, error);
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
