import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { eq, desc, sql, and, or, isNull } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
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
    const approvalProcessService = new ApprovalProcessService(db);

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10);
    const group = url.searchParams.get('group') || 'all';
    const category = url.searchParams.get('category') || 'all';

    const offset = (page - 1) * pageSize;

    // Start with the base condition
    let whereClause: SQL<unknown> = eq(pushNotifications.userEmail, userEmail);

    // Add group filter if not 'all'
    if (group !== 'all') {
      const groupCondition = or(
        eq(pushNotifications.group, group),
        isNull(pushNotifications.group)
      );
      whereClause = and(whereClause, groupCondition) as SQL<unknown>;
    }

    // Add category filter if not 'all'
    if (category !== 'all') {
      const categoryCondition = or(
        eq(pushNotifications.category, category),
        isNull(pushNotifications.category)
      );
      whereClause = and(whereClause, categoryCondition) as SQL<unknown>;
    }

    const [notificationsResult, totalCountResult] = await Promise.all([
      db
        .select()
        .from(pushNotifications)
        .where(whereClause)
        .orderBy(desc(pushNotifications.createdAt))
        .limit(pageSize)
        .offset(offset)
        .all(),
      db
        .select({ count: sql`count(*)` })
        .from(pushNotifications)
        .where(whereClause)
        .get(),
    ]);

    const notificationsWithApprovalInfo = await Promise.all(
      notificationsResult.map(async (notification) => {
        if (notification.type === 'approval-process') {
          const approvalProcess = await approvalProcessService.getApprovalProcessByNotificationId(notification.id);
          return {
            ...notification,
            approvalId: approvalProcess?.id,
            approvalState: approvalProcess?.state as ApprovalState,
          };
        }
        return notification;
      }),
    );

    const totalCount = totalCountResult?.count ?? 0;
    const totalPages = Math.ceil(Number(totalCount) / pageSize);

    const response: NotificationResponse = {
      notifications: notificationsWithApprovalInfo,
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
    const approvalProcessService = new ApprovalProcessService(db);

    const url = new URL(request.url);
    const notificationId = url.searchParams.get('id');

    if (!notificationId) {
      return new Response(JSON.stringify({ error: 'Missing notification ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const notification = await db
      .select()
      .from(pushNotifications)
      .where(and(eq(pushNotifications.id, notificationId), eq(pushNotifications.userEmail, userEmail)))
      .get();

    if (!notification) {
      return new Response(
        JSON.stringify({ error: 'Notification not found or you do not have permission to delete it' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    if (notification.type === 'approval-process') {
      await approvalProcessService.deleteApprovalProcessByNotificationId(notificationId);
    }

    const result = await db
      .delete(pushNotifications)
      .where(and(eq(pushNotifications.id, notificationId), eq(pushNotifications.userEmail, userEmail)))
      .returning({ deletedId: pushNotifications.id })
      .get();

    if (result) {
      return new Response(
        JSON.stringify({ message: 'Notification deleted successfully', deletedId: result.deletedId }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } else {
      return new Response(JSON.stringify({ error: 'Failed to delete notification' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    console.error('Error deleting notification:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
