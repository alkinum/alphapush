import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { getDb } from '@/db';
import { NotificationService } from '@/services/notificationService';

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
    const notificationService = new NotificationService(db);

    const groups = await notificationService.getGroups(userEmail);

    return new Response(JSON.stringify({ groups }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching notification groups:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}; 