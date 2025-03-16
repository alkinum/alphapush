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
    const url = new URL(request.url);
    const group = url.searchParams.get('group') || 'all';

    const db = getDb(locals.runtime.env.DB);
    const notificationService = new NotificationService(db);

    // Create a map to store categories by group
    const categoriesByGroup: Record<string, any[]> = {};

    if (group === 'all') {
      // Get all groups first
      const groups = await notificationService.getGroups(userEmail);

      // Get categories for 'all' group
      const allCategories = await notificationService.getCategories(userEmail);
      categoriesByGroup['all'] = allCategories;

      // Get categories for each specific group
      for (const groupItem of groups) {
        if (groupItem.id !== 'all') {
          const groupCategories = await notificationService.getCategoriesByGroup(userEmail, groupItem.name);
          categoriesByGroup[groupItem.name] = groupCategories;
        }
      }
    } else {
      // Get categories only for the specified group
      const groupCategories = await notificationService.getCategoriesByGroup(userEmail, group);
      categoriesByGroup[group] = groupCategories;
    }

    return new Response(JSON.stringify({ categoriesByGroup }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching notification categories:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}; 