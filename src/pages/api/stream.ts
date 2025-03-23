import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions } from '@/schema';
import { logger } from '@/utils/logger';

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

  if (userClients.size === 0) {
    logger.debug(`No active SSE connections for user: ${userEmail}`);
    return;
  }

  logger.debug(`Sending SSE event "${event}" to ${userClients.size} connection(s) for user: ${userEmail}`);
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();

  // Use Promise.allSettled to handle all promises, even if some fail
  const sendPromises = Array.from(userClients.entries()).map(async ([deviceFingerprint, writer]) => {
    try {
      await writer.ready;
      await writer.write(encoder.encode(message));
      logger.debug(`Successfully sent SSE event "${event}" to device: ${deviceFingerprint}`);
      return { success: true, deviceFingerprint };
    } catch (error: unknown) {
      logger.error(`Error sending SSE event [${StreamErrorCode.SEND_EVENT_FAILED}] to device ${deviceFingerprint}:`, error);
      userClients.delete(deviceFingerprint);
      try {
        await writer.close();
      } catch (closeError: unknown) {
        if (closeError && (closeError as Error).message !== 'Invalid state: WritableStream is closed') {
          logger.error(`Error closing writer [${StreamErrorCode.WRITER_CLOSE_FAILED}] for device ${deviceFingerprint}:`, closeError);
        }
      }
      return { success: false, deviceFingerprint, error };
    }
  });

  // Cleanup empty userClients map
  Promise.allSettled(sendPromises).then(results => {
    const failures = results.filter(result =>
      result.status === 'fulfilled' && !(result.value as any).success
    ).length;

    if (failures > 0) {
      logger.warn(`Failed to send SSE event "${event}" to ${failures}/${userClients.size} devices for user: ${userEmail}`);
    }

    if (userClients.size === 0) {
      logger.debug(`Removing empty userClients map for user: ${userEmail}`);
      clients.delete(userEmail);
    }
  });
}

export const GET: APIRoute = async ({ request, locals }) => {
  const session = await getSession(request);
  if (!session?.user?.email) {
    logger.warn(`SSE connection attempt without authentication`);
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
    logger.warn(`SSE connection attempt from user ${userEmail} without device fingerprint`);
    return new Response(JSON.stringify({
      error: 'Missing device fingerprint',
      code: StreamErrorCode.MISSING_FINGERPRINT
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  logger.debug(`SSE connection attempt from user ${userEmail} with fingerprint ${deviceFingerprint}`);

  const subscription = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.deviceFingerprint, deviceFingerprint))
    .get();

  if (!subscription || subscription.userEmail !== userEmail) {
    logger.warn(`SSE connection attempt with invalid fingerprint: ${deviceFingerprint} for user: ${userEmail}`);
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
    logger.debug(`Created new clients map for user: ${userEmail}`);
  }
  const userClients = clients.get(userEmail)!;

  // Close existing connection for this device if it exists
  const existingWriter = userClients.get(deviceFingerprint);
  if (existingWriter) {
    logger.debug(`Closing existing SSE connection for device: ${deviceFingerprint}`);
    userClients.delete(deviceFingerprint);
    try {
      await existingWriter.close();
      logger.debug(`Successfully closed existing connection for device: ${deviceFingerprint}`);
    } catch (error) {
      if (error && (error as Error).message !== 'Invalid state: WritableStream is closed') {
        logger.error(`Error closing existing writer [${StreamErrorCode.CLOSE_EXISTING_FAILED}] for device ${deviceFingerprint}:`, error);
      }
    }
    if (userClients.size === 0) {
      clients.delete(userEmail);
      logger.debug(`Removed empty clients map for user: ${userEmail}`);
    }
  }

  userClients.set(deviceFingerprint, writer);
  logger.info(`Established new SSE connection for user: ${userEmail}, device: ${deviceFingerprint}. Total connections for user: ${userClients.size}`);

  const cleanup = async () => {
    logger.debug(`Cleaning up SSE connection for device: ${deviceFingerprint}`);
    clearInterval(heartbeatInterval);
    const userClients = clients.get(userEmail);
    if (userClients) {
      userClients.delete(deviceFingerprint);
      if (userClients.size === 0) {
        clients.delete(userEmail);
        logger.debug(`Removed empty clients map for user: ${userEmail}`);
      } else {
        logger.debug(`Remaining ${userClients.size} connection(s) for user: ${userEmail}`);
      }
    }
    try {
      await writer.close();
      logger.debug(`Successfully closed writer for device: ${deviceFingerprint}`);
    } catch (error: unknown) {
      if (error && (error as Error).message !== 'Invalid state: WritableStream is closed') {
        logger.error(`Error closing writer [${StreamErrorCode.WRITER_CLOSE_FAILED}] for device ${deviceFingerprint}:`, error);
      }
    }
  };

  let heartbeatFailures = 0;

  const heartbeatInterval = setInterval(async () => {
    try {
      await writer.ready;
      await writer.write(encoder.encode(`event: heartbeat\ndata: ${new Date().toISOString()}\n\n`));
      heartbeatFailures = 0;
    } catch (error: unknown) {
      heartbeatFailures++;
      if (error) {
        logger.error(`Error sending heartbeat [${StreamErrorCode.HEARTBEAT_FAILED}] to device ${deviceFingerprint} (attempt ${heartbeatFailures}/5):`, (error as Error).message);
      }
      if (heartbeatFailures >= 5) {
        logger.error(`Max heartbeat failures reached [${StreamErrorCode.MAX_HEARTBEAT_FAILURES}] for device ${deviceFingerprint}`);
        await cleanup();
      }
    }
  }, 30 * 1000);

  setTimeout(async () => {
    try {
      await writer.ready;
      await writer.write(encoder.encode('event: connected\ndata: SSE connection established\n\n'));
      logger.debug(`Sent connected event to device: ${deviceFingerprint} for user: ${userEmail}`);
    } catch (error) {
      logger.error(`Error initializing SSE connection [${StreamErrorCode.INIT_CONNECTION_FAILED}] for device ${deviceFingerprint}:`, error);
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

