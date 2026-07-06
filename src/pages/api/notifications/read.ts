import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getSessionFromContext } from '@/lib/auth';
import { getDb } from '@/db';
import { NotificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

interface MarkReadBody {
  all?: boolean;
  notificationIds?: string[];
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

export const POST: APIRoute = async (context) => {
  try {
    const session = await getSessionFromContext(context);
    if (!session?.user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = (await context.request.json().catch(() => ({}))) as MarkReadBody;
    const notificationIds = Array.isArray(body.notificationIds)
      ? body.notificationIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : undefined;

    if (!body.all && (!notificationIds || notificationIds.length === 0)) {
      return jsonResponse({ error: 'Missing notificationIds or all=true' }, 400);
    }

    const notificationService = new NotificationService(getDb(env.DB));
    const result = await notificationService.markNotificationsRead(
      session.user.email,
      body.all ? undefined : notificationIds
    );
    const unreadCount = await notificationService.getUnreadCount(session.user.email);

    return jsonResponse({
      success: true,
      all: !!body.all,
      readAt: result.readAt,
      updatedCount: result.updatedCount,
      notificationIds: result.notificationIds,
      unreadCount,
    });
  } catch (error) {
    logger.error('Error marking notifications read:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};
