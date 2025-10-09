import type { APIRoute } from 'astro';
import { getSessionFromContext } from '@/lib/auth';
import { getDb } from '@/db';
import { NotificationService } from '@/services/notificationService';
import { StreamService } from '@/services/streamService';

export const GET: APIRoute = async (context) => {
  try {
    const session = await getSessionFromContext(context);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const url = new URL(context.request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '10');
    const group = url.searchParams.get('group') || undefined;
    const category = url.searchParams.get('category') || undefined;

    const db = getDb(context.locals.runtime.env.DB);
    const notificationService = new NotificationService(db);

    const result = await notificationService.getNotifications(userEmail, {
      page,
      pageSize,
      group,
      category,
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async (context) => {
  try {
    const session = await getSessionFromContext(context);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const url = new URL(context.request.url);
    const notificationId = url.searchParams.get('id');

    if (!notificationId) {
      return new Response(JSON.stringify({ error: 'Notification ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb(context.locals.runtime.env.DB);
    const notificationService = new NotificationService(db);

    const deletedNotification = await notificationService.deleteNotification(notificationId, userEmail);

    if (!deletedNotification) {
      return new Response(JSON.stringify({ error: 'Notification not found or already deleted' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const streamService = new StreamService();
    await streamService.sendDeleteNotificationEvent(userEmail, notificationId);

    return new Response(JSON.stringify({
      message: 'Notification deleted successfully',
      notification: deletedNotification
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error deleting notification:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
