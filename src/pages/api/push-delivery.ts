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
  attemptId?: string;
  receiptToken?: string;
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
    const body = (await context.request.json()) as DeliveryReceiptBody;
    const notificationId = typeof body.notificationId === 'string' ? body.notificationId.trim() : '';
    const event = body.event;

    if (!notificationId || (event !== 'displayed' && event !== 'opened')) {
      return jsonResponse({ error: 'Invalid delivery receipt' }, 400);
    }

    const subscriptionId = typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : '';
    const attemptId = typeof body.attemptId === 'string' ? body.attemptId.trim() : '';
    const receiptToken = typeof body.receiptToken === 'string' ? body.receiptToken.trim() : '';
    const db = getDb(env.DB);
    const deliveryRetryService = new DeliveryRetryService(db, env);
    const session = await getSessionFromContext(context);
    let userEmail = session?.user?.email || null;

    if (subscriptionId && attemptId && receiptToken) {
      userEmail = await deliveryRetryService.resolveReceiptUserEmail(
        notificationId,
        subscriptionId,
        attemptId,
        receiptToken
      ) || userEmail;
    }

    if (!userEmail) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const notificationService = new NotificationService(db);
    const updated = await notificationService.recordDeliveryEvent(notificationId, userEmail, event);

    if (!updated) {
      return jsonResponse({ error: 'Notification not found' }, 404);
    }

    const attemptUpdated = await deliveryRetryService.recordAck(
      notificationId,
      userEmail,
      event,
      subscriptionId || undefined,
      attemptId || undefined
    );

    return jsonResponse({ success: true, attemptUpdated });
  } catch (error) {
    logger.error('Error recording push delivery receipt:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};
