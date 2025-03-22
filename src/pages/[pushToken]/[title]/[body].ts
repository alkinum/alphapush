import type { APIRoute } from 'astro';
import { getDb } from '@/db';
import { BarkEndpointService, type BarkParams } from '@/services/barkEndpointService';
import { logger } from '@/utils/logger';

/**
 * Bark compatible endpoint for format with title: /:key/:title/:body
 *
 * This endpoint handles the Bark format with title
 *
 * Query parameters:
 * - url: URL to open when notification is tapped
 * - group: Group name for the notification
 * - icon: URL to an icon image
 * - sound: Sound name to play
 * - level: Notification level (active, timeSensitive, passive, critical)
 * - badge: Badge count
 * - autoCopy: Text to automatically copy
 * - copy: Text to copy when notification is tapped
 * - isArchive: Whether to archive the notification
 */
export const GET: APIRoute = async ({ params, request, locals }) => {
  logger.debug(`Request received to /[pushToken]/[title]/[body] endpoint: ${request.url}`);

  try {
    const { pushToken, title, body } = params;
    logger.debug(`Params extracted: pushToken=${pushToken}, title=${title}, body=${body}`);

    if (!pushToken || !title || !body) {
      logger.error(`Missing required parameters: pushToken=${pushToken}, title=${title}, body=${body}`);
      return new Response(JSON.stringify({ code: 400, message: 'Missing required parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse URL segments - ensure we're working with an array
    const bodySegments: string[] = Array.isArray(body) ? body : [body];
    logger.debug(`Body segments parsed:`, bodySegments);

    // For this endpoint, we handle the /:key/:title/:body format
    // The title is already extracted from the URL params
    // The content is the first segment or joined segments if there are multiple
    const content = bodySegments.join('/');
    logger.debug(`Content extracted: ${content}`);

    // Parse query parameters
    const url = new URL(request.url);
    const queryParams = url.searchParams;
    logger.debug(`Query parameters:`, Object.fromEntries(queryParams.entries()));

    // Build Bark parameters
    const barkParams: BarkParams = {
      title,
      body: content,
      subtitle: queryParams.get('subtitle') || undefined,
      url: queryParams.get('url') || undefined,
      group: queryParams.get('group') || undefined,
      category: queryParams.get('group') || undefined, // Map group to category
      icon: queryParams.get('icon') || undefined,
      sound: queryParams.get('sound') || undefined,
      level: queryParams.get('level') as BarkParams['level'] || undefined,
      badge: queryParams.get('badge') ? parseInt(queryParams.get('badge')!) : undefined,
      autoCopy: queryParams.get('autoCopy') || undefined,
      copy: queryParams.get('copy') || undefined,
      isArchive: queryParams.has('isArchive') ? queryParams.get('isArchive') === '1' : undefined,
    };

    logger.debug(`Bark parameters created:`, barkParams);

    // Handle special parameters
    if (queryParams.has('call') && queryParams.get('call') === '1') {
      barkParams.sound = 'alarm';
      logger.debug(`Call parameter detected, setting sound to 'alarm'`);
    }

    if (queryParams.has('ciphertext')) {
      logger.error(`Encrypted message not supported: ciphertext=${queryParams.get('ciphertext')}`);
      // We don't support encrypted messages yet, return error
      return new Response(JSON.stringify({ code: 400, message: 'Encrypted messages are not supported yet' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Process the push notification
    logger.debug(`Processing push for token: ${pushToken}`);
    const db = getDb(locals.runtime.env.DB);
    const barkService = new BarkEndpointService(db, locals.runtime.env);
    const result = await barkService.processBarkPush(pushToken, barkParams);

    logger.debug(`Push processing result:`, result);

    if (!result.success) {
      logger.error(`Failed to send notification: ${result.error}`);
      return new Response(JSON.stringify({ code: 400, message: result.error || 'Failed to send notification' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    logger.debug(`Successfully sent notification with ID: ${result.notificationId}`);
    return new Response(JSON.stringify({ code: 200, message: 'Success', notificationId: result.notificationId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error(`Error in Bark endpoint:`, error);
    return new Response(JSON.stringify({ code: 500, message: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// Also support POST requests for compatibility
export const POST: APIRoute = async (context) => {
  logger.debug(`POST request received, forwarding to GET handler`);
  return GET(context);
};
