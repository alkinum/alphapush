import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { eq, and } from 'drizzle-orm';

import { getDb } from '@/db';
import { NotificationService } from '@/services/notificationService';
import { groups, categories } from '@/schema';

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
    const groupParam = url.searchParams.get('group') || 'all';

    const db = getDb(locals.runtime.env.DB);
    const notificationService = new NotificationService(db);

    let categories;

    if (groupParam === 'all') {
      // Get all categories
      categories = await notificationService.getCategories(userEmail);
    } else {
      // Check if groupParam is a groupId (UUID format) or a group name
      // A simple check for UUID format - adjust based on your actual UUID format
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupParam);

      if (isUuid) {
        // If it's a UUID, use it directly as a groupId
        categories = await notificationService.getCategoriesByGroup(userEmail, groupParam);
      } else {
        // If it's a name, find the group first
        const group = await db
          .select()
          .from(groups)
          .where(and(eq(groups.userEmail, userEmail), eq(groups.name, groupParam)))
          .get();

        if (group) {
          categories = await notificationService.getCategoriesByGroup(userEmail, group.id);
        } else {
          // Group not found by name, return empty list with just "All" category
          categories = [{ id: 'all', name: 'All', count: 0 }];
        }
      }
    }

    return new Response(JSON.stringify({ categories }), {
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

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const body = await request.json() as { name: string; groupId: string };

    if (!body.name || !body.groupId) {
      return new Response(JSON.stringify({ error: 'Missing required fields: name and groupId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb(locals.runtime.env.DB);

    // Create a new category under the specified group
    // First we need to get the group to make sure it exists
    const group = await db
      .select()
      .from(groups)
      .where(and(
        eq(groups.id, body.groupId),
        eq(groups.userEmail, userEmail)
      ))
      .get();

    if (!group) {
      return new Response(JSON.stringify({ error: 'Group not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Then create the category
    const newCategory = await db
      .insert(categories)
      .values({
        userEmail,
        name: body.name,
        groupId: body.groupId
      })
      .returning()
      .get();

    return new Response(JSON.stringify({ category: newCategory }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error creating notification category:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};