import type { APIContext } from 'astro';
import { createAuth } from './config';

/**
 * Get the current session from Better Auth
 */
export async function getSession(request: Request, db: D1Database) {
  const auth = createAuth(db);

  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    return session;
  } catch (error) {
    console.error('Error getting session:', error);
    return null;
  }
}

/**
 * Get session for Astro API routes
 */
export async function getSessionFromContext(context: APIContext) {
  return getSession(context.request, context.locals.runtime.env.DB);
}

/**
 * Require authentication - throws if not authenticated
 */
export async function requireAuth(context: APIContext) {
  const session = await getSessionFromContext(context);

  if (!session || !session.user) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return session;
}

/**
 * Check if user is admin
 */
export function isAdmin(session: { user: { email: string; role?: string } } | null): boolean {
  if (!session?.user) return false;

  const ADMIN_EMAILS = import.meta.env.ADMIN_EMAILS?.split(',') || [];
  return session.user.role === 'admin' || ADMIN_EMAILS.includes(session.user.email);
}
