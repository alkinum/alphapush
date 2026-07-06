import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getSessionFromContext } from '@/lib/auth';
import { getDb } from '@/db';
import { NotificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

export const GET: APIRoute = async (context) => {
  try {
    const session = await getSessionFromContext(context);
    if (!session?.user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const notificationService = new NotificationService(getDb(env.DB));
    const unreadCount = await notificationService.getUnreadCount(session.user.email);

    return jsonResponse({ unreadCount });
  } catch (error) {
    logger.error('Error getting unread notification count:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};
