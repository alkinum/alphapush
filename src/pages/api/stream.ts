import type { APIRoute } from 'astro';
import { getSessionFromContext } from '@/lib/auth';
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

// Change the clients map to use a nested structure with array of connections
const clients = new Map<string, Map<string, Set<{
  writer: WritableStreamDefaultWriter<Uint8Array>;
  timestamp: number;
  id: string; // Unique connection ID
  heartbeatFailed?: boolean; // Track if heartbeat has failed for this connection
}>>>();

export function sendSSEvent(userEmail: string, event: string, data: any) {
  // Get the user's client map
  const userClients = clients.get(userEmail);
  if (!userClients || userClients.size === 0) {
    logger.debug(`No active SSE connections for user: ${userEmail}`);
    return;
  }

  // Count total connections
  let totalConnections = 0;
  for (const connections of userClients.values()) {
    totalConnections += connections.size;
  }

  logger.debug(`Sending SSE event "${event}" to ${totalConnections} connection(s) across ${userClients.size} device(s) for user: ${userEmail}`);
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();

  // Track failures for each device
  const deviceFailures = new Map<string, number>();

  // Send to all connections for all devices
  const sendPromises: Promise<any>[] = [];

  for (const [deviceFingerprint, connections] of userClients.entries()) {
    // Skip if no connections for this device
    if (connections.size === 0) continue;

    for (const connection of connections) {
      const { writer, id, heartbeatFailed } = connection;

      // Skip connections with failed heartbeats
      if (heartbeatFailed && event !== 'heartbeat') {
        logger.debug(`Skipping SSE event "${event}" for connection ${id} on device ${deviceFingerprint} due to failed heartbeat`);
        continue;
      }

      const promise = (async () => {
        try {
          // Check if writer is still valid before sending
          if (!writer) {
            logger.debug(`Writer for connection ${id} on device ${deviceFingerprint} is invalid. Removing connection.`);
            connections.delete(connection);
            return { success: false, deviceFingerprint, connectionId: id, error: 'Writer is invalid' };
          }

          // Send the event
          await writer.ready;
          await writer.write(encoder.encode(message));

          // If this is a successful heartbeat, clear the heartbeatFailed flag
          if (event === 'heartbeat') {
            connection.heartbeatFailed = false;
          }

          logger.debug(`Successfully sent SSE event "${event}" to connection ${id} on device: ${deviceFingerprint}`);
          return { success: true, deviceFingerprint, connectionId: id };
        } catch (error: unknown) {
          logger.error(`Error sending SSE event [${StreamErrorCode.SEND_EVENT_FAILED}] to connection ${id} on device ${deviceFingerprint}:`, error);

          // If this is a heartbeat event, mark the connection
          if (event === 'heartbeat') {
            connection.heartbeatFailed = true;
          }

          // Remove the failed connection
          connections.delete(connection);

          // Increment failure count for this device
          deviceFailures.set(deviceFingerprint, (deviceFailures.get(deviceFingerprint) || 0) + 1);

          // Try to close the writer gracefully
          try {
            await writer.close();
            logger.debug(`Closed writer for failed connection ${id} on device: ${deviceFingerprint}`);
          } catch (closeError: unknown) {
            if (closeError && (closeError as Error).message !== 'Invalid state: WritableStream is closed') {
              logger.error(`Error closing writer [${StreamErrorCode.WRITER_CLOSE_FAILED}] for connection ${id} on device ${deviceFingerprint}:`, closeError);
            }
          }

          return { success: false, deviceFingerprint, connectionId: id, error };
        }
      })();

      sendPromises.push(promise);
    }
  }

  // Handle results and clean up as needed
  Promise.allSettled(sendPromises).then(() => {
    // Clean up devices with no connections
    let emptyDevices = 0;
    for (const [deviceFingerprint, connections] of userClients.entries()) {
      if (connections.size === 0) {
        userClients.delete(deviceFingerprint);
        emptyDevices++;
      }
    }

    if (emptyDevices > 0) {
      logger.debug(`Removed ${emptyDevices} device(s) with no connections for user ${userEmail}`);
    }

    // Log failures by device
    if (deviceFailures.size > 0) {
      for (const [deviceFingerprint, count] of deviceFailures.entries()) {
        const remainingConnections = userClients.get(deviceFingerprint)?.size || 0;
        logger.warn(`Failed to send SSE event "${event}" to ${count} connection(s) for device ${deviceFingerprint}. Remaining connections: ${remainingConnections}`);
      }
    }

    // Remove user from clients map if no devices left
    if (userClients.size === 0) {
      logger.debug(`All devices disconnected for user ${userEmail}. Removing user from clients map.`);
      clients.delete(userEmail);
    }
  });
}

export const GET: APIRoute = async (context) => {
  const session = await getSessionFromContext(context);
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
  const db = getDb(context.locals.runtime.env.DB);

  const url = new URL(context.request.url);
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

  // Create a new transform stream for this connection
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Generate a unique ID for this connection
  const connectionId = crypto.randomUUID();

  // Initialize client maps if needed
  if (!clients.has(userEmail)) {
    clients.set(userEmail, new Map());
  }
  const userClients = clients.get(userEmail)!;

  if (!userClients.has(deviceFingerprint)) {
    userClients.set(deviceFingerprint, new Set());
  }
  const deviceConnections = userClients.get(deviceFingerprint)!;

  // Check if this is a reconnection
  const isReconnection = deviceConnections.size > 0;

  // Add this connection to our connections map
  const connection = {
    writer,
    timestamp: Date.now(),
    id: connectionId
  };
  deviceConnections.add(connection);

  // Log connection info
  const totalConnections = [...userClients.values()].reduce((sum, conns) => sum + conns.size, 0);
  logger.info(`Established new SSE connection (${connectionId}) for user: ${userEmail}, device: ${deviceFingerprint}. Active connections for device: ${deviceConnections.size}, total for user: ${totalConnections}`);

  // Setup cleanup function for this specific connection
  const cleanup = async () => {
    logger.debug(`Cleaning up SSE connection ${connectionId} for device: ${deviceFingerprint}`);
    clearInterval(heartbeatInterval);

    // Get the current maps
    const currentUserClients = clients.get(userEmail);
    if (!currentUserClients) return;

    const currentDeviceConnections = currentUserClients.get(deviceFingerprint);
    if (!currentDeviceConnections) return;

    // Find and remove this specific connection
    let found = false;
    for (const conn of currentDeviceConnections) {
      if (conn.id === connectionId) {
        currentDeviceConnections.delete(conn);
        found = true;

        // Try to close the writer
        try {
          await conn.writer.close();
          logger.debug(`Closed writer for connection ${connectionId}`);
        } catch (closeError: unknown) {
          if (closeError && (closeError as Error).message !== 'Invalid state: WritableStream is closed') {
            logger.error(`Error closing writer [${StreamErrorCode.WRITER_CLOSE_FAILED}] for connection ${connectionId}:`, closeError);
          }
        }

        break;
      }
    }

    if (found) {
      logger.debug(`Removed connection ${connectionId} for device ${deviceFingerprint}`);

      // Remove device if no connections left
      if (currentDeviceConnections.size === 0) {
        currentUserClients.delete(deviceFingerprint);
        logger.debug(`Removed device ${deviceFingerprint} with no connections`);

        // Remove user if no devices left
        if (currentUserClients.size === 0) {
          clients.delete(userEmail);
          logger.debug(`Removed user ${userEmail} with no devices`);
        }
      } else {
        logger.debug(`Device ${deviceFingerprint} still has ${currentDeviceConnections.size} active connection(s)`);
      }
    } else {
      logger.debug(`Connection ${connectionId} was already removed`);
    }
  };

  // Setup heartbeat to keep the connection alive
  let heartbeatFailures = 0;
  const heartbeatInterval = setInterval(async () => {
    try {
      // Get the current maps
      const currentUserClients = clients.get(userEmail);
      if (!currentUserClients) {
        logger.debug(`User ${userEmail} not found in clients map. Stopping heartbeat for ${connectionId}.`);
        clearInterval(heartbeatInterval);
        return;
      }

      const currentDeviceConnections = currentUserClients.get(deviceFingerprint);
      if (!currentDeviceConnections) {
        logger.debug(`Device ${deviceFingerprint} not found for user ${userEmail}. Stopping heartbeat for ${connectionId}.`);
        clearInterval(heartbeatInterval);
        return;
      }

      // Find this specific connection
      let found = false;
      for (const conn of currentDeviceConnections) {
        if (conn.id === connectionId) {
          found = true;

          // Send heartbeat for this connection
          await conn.writer.ready;
          await conn.writer.write(encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({
            timestamp: new Date().toISOString(),
            connectionId
          })}\n\n`));

          // Reset failure count and heartbeatFailed flag on successful heartbeat
          heartbeatFailures = 0;
          conn.heartbeatFailed = false;

          break;
        }
      }

      if (!found) {
        logger.debug(`Connection ${connectionId} no longer exists. Stopping heartbeat.`);
        clearInterval(heartbeatInterval);
        return;
      }
    } catch (error: unknown) {
      heartbeatFailures++;
      logger.error(`Error sending heartbeat [${StreamErrorCode.HEARTBEAT_FAILED}] for connection ${connectionId} (attempt ${heartbeatFailures}/5):`,
        error instanceof Error ? error.message : 'Unknown error');

      // Mark the connection as having a failed heartbeat
      const currentConnection = [...(clients.get(userEmail)?.get(deviceFingerprint) || [])].find(conn => conn.id === connectionId);
      if (currentConnection) {
        currentConnection.heartbeatFailed = true;
      }

      if (heartbeatFailures >= 5) {
        logger.error(`Max heartbeat failures reached [${StreamErrorCode.MAX_HEARTBEAT_FAILURES}] for connection ${connectionId}`);
        await cleanup();
      }
    }
  }, 30 * 1000);

  // Send an initial event to confirm connection
  setTimeout(async () => {
    try {
      // Check if connection still exists
      const currentUserClients = clients.get(userEmail);
      if (!currentUserClients) return;

      const currentDeviceConnections = currentUserClients.get(deviceFingerprint);
      if (!currentDeviceConnections) return;

      // Find this specific connection
      let found = false;
      for (const conn of currentDeviceConnections) {
        if (conn.id === connectionId) {
          found = true;

          // Send connection event
          await conn.writer.ready;
          await conn.writer.write(encoder.encode(`event: ${isReconnection ? 'reconnected' : 'connected'}\ndata: ${JSON.stringify({
            timestamp: new Date().toISOString(),
            isReconnect: isReconnection,
            connectionId
          })}\n\n`));

          logger.debug(`Sent ${isReconnection ? 'reconnection' : 'connection'} event to connection ${connectionId} for device ${deviceFingerprint}`);
          break;
        }
      }

      if (!found) {
        logger.debug(`Connection ${connectionId} no longer exists. Skipping initial message.`);
      }
    } catch (error) {
      logger.error(`Error sending initial event [${StreamErrorCode.INIT_CONNECTION_FAILED}] for connection ${connectionId}:`, error);
      await cleanup();
    }
  }, 500);

  // Handle request abortion
  const abortHandler = async () => {
    logger.debug(`Request aborted for connection ${connectionId} on device ${deviceFingerprint}`);
    await cleanup();
    context.request.signal.removeEventListener('abort', abortHandler);
  };
  context.request.signal.addEventListener('abort', abortHandler);

  // Return the SSE stream
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
};

