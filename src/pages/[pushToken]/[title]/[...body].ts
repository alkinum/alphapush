import type { APIRoute } from 'astro';
import { getDb } from '@/db';
import { BarkEndpointService, type BarkParams } from '@/services/barkEndpointService';

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
  try {
    const { pushToken, title, body } = params;

    if (!pushToken || !title || !body) {
      return new Response(JSON.stringify({ code: 400, message: 'Missing required parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse URL segments - ensure we're working with an array
    const bodySegments: string[] = Array.isArray(body) ? body : [body];

    // For this endpoint, we handle the /:key/:title/:body format
    // The title is already extracted from the URL params
    // The content is the first segment or joined segments if there are multiple
    const content = bodySegments.join('/');

    // Parse query parameters
    const url = new URL(request.url);
    const queryParams = url.searchParams;

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

    // Handle special parameters
    if (queryParams.has('call') && queryParams.get('call') === '1') {
      barkParams.sound = 'alarm';
    }

    if (queryParams.has('ciphertext')) {
      // We don't support encrypted messages yet, return error
      return new Response(JSON.stringify({ code: 400, message: 'Encrypted messages are not supported yet' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Process the push notification
    const db = getDb(locals.runtime.env.DB);
    const barkService = new BarkEndpointService(db, locals.runtime.env);
    const result = await barkService.processBarkPush(pushToken, barkParams);

    if (!result.success) {
      return new Response(JSON.stringify({ code: 400, message: result.error || 'Failed to send notification' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ code: 200, message: 'Success', notificationId: result.notificationId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in Bark endpoint:', error);
    return new Response(JSON.stringify({ code: 500, message: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// Also support POST requests for compatibility
export const POST: APIRoute = async (context) => {
  return GET(context);
};
