import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { pushNotifications } from '@/schema';
import { LRUCache } from 'lru-cache';

// Create cache instance with max items and expiration time
const cache = new LRUCache<string, any>({
  max: 100, // Maximum 100 different results to cache
  ttl: 1000 * 60 * 5, // Cache for 5 minutes
});

interface FilterResponse {
  groups: { id: string; name: string }[];
  categories: { id: string; name: string }[];
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

    // Check if filter data for this user exists in cache
    const cacheKey = `filters:${userEmail}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      return new Response(JSON.stringify(cachedData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb(locals.runtime.env.DB);

    // Get all distinct groups for the user
    const groupsResult = await db
      .select({
        group: pushNotifications.group,
      })
      .from(pushNotifications)
      .where(eq(pushNotifications.userEmail, userEmail))
      .groupBy(pushNotifications.group)
      .all();

    // Get all distinct categories for the user
    const categoriesResult = await db
      .select({
        category: pushNotifications.category,
      })
      .from(pushNotifications)
      .where(eq(pushNotifications.userEmail, userEmail))
      .groupBy(pushNotifications.category)
      .all();

    // Process results, add default "All" option
    const groups = [
      { id: 'all', name: 'All Groups' },
      ...groupsResult
        .filter(item => item.group !== null)
        .map(item => ({
          id: item.group as string,
          name: formatName(item.group as string)
        })),
    ];

    const categories = [
      { id: 'all', name: 'All' },
      ...categoriesResult
        .filter(item => item.category !== null)
        .map(item => ({
          id: item.category as string,
          name: formatName(item.category as string)
        })),
    ];

    const response: FilterResponse = {
      groups,
      categories,
    };

    // Store result in cache
    cache.set(cacheKey, response);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching notification filters:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// Helper function: Convert snake_case or kebab-case to Title Case
function formatName(str: string): string {
  if (!str) return '';

  // Handle snake_case and kebab-case
  return str
    .replace(/[-_]/g, ' ')
    .replace(/\w\S*/g, (word) => {
      return word.charAt(0).toUpperCase() + word.substring(1).toLowerCase();
    });
}

// Helper function to clear cache, can be called when creating new notifications
export function clearFilterCache(userEmail: string): void {
  const cacheKey = `filters:${userEmail}`;
  cache.delete(cacheKey);
}