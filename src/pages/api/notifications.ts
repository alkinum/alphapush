import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { eq, desc, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { pushNotifications } from '@/schema';

interface NotificationResponse {
  notifications: (typeof pushNotifications.$inferSelect)[];
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

    const totalCount = totalCountResult?.count ?? 0;
    const totalPages = Math.ceil(Number(totalCount) / pageSize);

    const response: NotificationResponse = {
      notifications: notificationsResult,
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
