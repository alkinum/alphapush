import { env } from 'cloudflare:workers';
import type { APIContext } from 'astro';
import { createAuth } from './config';

export type UserRole = 'admin' | 'user';

type BetterAuthSession = Awaited<ReturnType<ReturnType<typeof createAuth>['api']['getSession']>>;
type SessionWithRole = NonNullable<BetterAuthSession> & {
  user: NonNullable<BetterAuthSession>['user'] & {
    role?: UserRole;
  };
};
export type AuthSession = SessionWithRole | null;

export interface GetSessionOptions {
  disableCookieCache?: boolean;
}

/**
 * Get the current session from Better Auth
 */
export async function getSession(request: Request, db: D1Database, options: GetSessionOptions = {}): Promise<AuthSession> {
  const auth = createAuth(db, { baseURL: new URL(request.url).origin });

  try {
    const session = await auth.api.getSession({
      headers: request.headers,
      query: options.disableCookieCache ? { disableCookieCache: true } : undefined,
    });

    return session as SessionWithRole | null;
  } catch (error) {
    console.error('Error getting session:', error);
    return null;
  }
}

/**
 * Get session for Astro API routes
 */
export async function getSessionFromContext(context: APIContext, options: GetSessionOptions = {}) {
  return getSession(context.request, env.DB, options);
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
export function isAdmin(session: { user: { email: string; role?: UserRole } } | null): boolean {
  if (!session?.user) return false;

  const ADMIN_EMAILS = import.meta.env.ADMIN_EMAILS?.split(',').map((email: string) => email.trim()).filter(Boolean) || [];
  return session.user.role === 'admin' || ADMIN_EMAILS.includes(session.user.email);
}
