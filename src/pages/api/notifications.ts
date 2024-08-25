import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { eq, desc, sql, and } from 'drizzle-orm';
import { getDb } from '@/db';
import { pushNotifications } from '@/schema';
import { ApprovalProcessService } from '@/services/approvalProcessService';
import type { Notification } from '@/types/notification';
import type { ApprovalState } from '@/types/approval';

interface NotificationResponse {
  notifications: Notification[];
  totalCount: number;
  totalPages: number;
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const db = getDb(locals.runtime.env.DB);
    const approvalProcessService = new ApprovalProcessService(locals.runtime.env.DB);

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10);

    const offset = (page - 1) * pageSize;

    const [notificationsResult, totalCountResult] = await Promise.all([
      db
        .select()
        .from(pushNotifications)
        .where(eq(pushNotifications.userEmail, userEmail))
        .orderBy(desc(pushNotifications.createdAt))
        .limit(pageSize)
        .offset(offset)
        .all(),
      db
        .select({ count: sql`count(*)` })
        .from(pushNotifications)
        .where(eq(pushNotifications.userEmail, userEmail))
        .get(),
    ]);

    const notificationsWithApprovalState = await Promise.all(
      notificationsResult.map(async (notification) => {
        if (notification.type === 'approval-process') {
          const approvalProcess = await approvalProcessService.getApprovalProcessByNotificationId(notification.id);
          return {
            ...notification,
            approvalState: approvalProcess?.state as ApprovalState,
          };
        }
        return notification;
      }),
    );

    const totalCount = totalCountResult?.count ?? 0;
    const totalPages = Math.ceil(Number(totalCount) / pageSize);

    const response: NotificationResponse = {
      notifications: notificationsWithApprovalState,
      totalCount: Number(totalCount),
      totalPages,
    };

    return new Response(JSON.stringify(response), {
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

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const db = getDb(locals.runtime.env.DB);
    const approvalProcessService = new ApprovalProcessService(locals.runtime.env.DB);

    const url = new URL(request.url);
    const notificationId = url.searchParams.get('id');

    if (!notificationId) {
      return new Response(JSON.stringify({ error: 'Missing notification ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let result: { deletedId: string } | undefined;

    await db.transaction(async (trx) => {
      const notification = await trx
        .select()
        .from(pushNotifications)
        .where(and(eq(pushNotifications.id, notificationId), eq(pushNotifications.userEmail, userEmail)))
        .get();

      if (!notification) {
        throw new Error('Notification not found or you do not have permission to delete it');
      }

      if (notification.type === 'approval-process') {
        await approvalProcessService.deleteApprovalProcessByNotificationId(trx, notificationId);
      }

      result = await trx
        .delete(pushNotifications)
        .where(and(eq(pushNotifications.id, notificationId), eq(pushNotifications.userEmail, userEmail)))
        .returning({ deletedId: pushNotifications.id })
        .get();
    });

    if (result) {
      return new Response(
        JSON.stringify({ message: 'Notification deleted successfully', deletedId: result.deletedId }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } else {
      return new Response(
        JSON.stringify({ error: 'Notification not found or you do not have permission to delete it' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  } catch (error) {
    console.error('Error deleting notification:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
