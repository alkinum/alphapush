import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getSessionFromContext } from '@/lib/auth';
import { getDb } from '@/db';
import { NotificationService, type NotificationDeliveryEvent } from '@/services/notificationService';
import { DeliveryRetryService } from '@/services/deliveryRetryService';
import { logger } from '@/utils/logger';

interface DeliveryReceiptBody {
  notificationId?: string;
  subscriptionId?: string;
  event?: NotificationDeliveryEvent;
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

    const body = (await context.request.json()) as DeliveryReceiptBody;
    const notificationId = typeof body.notificationId === 'string' ? body.notificationId.trim() : '';
    const event = body.event;

    if (!notificationId || (event !== 'displayed' && event !== 'opened')) {
      return jsonResponse({ error: 'Invalid delivery receipt' }, 400);
    }

    const db = getDb(env.DB);
    const notificationService = new NotificationService(db);
    const updated = await notificationService.recordDeliveryEvent(notificationId, session.user.email, event);

    if (!updated) {
      return jsonResponse({ error: 'Notification not found' }, 404);
    }

    const subscriptionId = typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : '';
    const deliveryRetryService = new DeliveryRetryService(db, env);
    const attemptUpdated = await deliveryRetryService.recordAck(
      notificationId,
      session.user.email,
      event,
      subscriptionId || undefined
    );

    return jsonResponse({ success: true, attemptUpdated });
  } catch (error) {
    logger.error('Error recording push delivery receipt:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};
