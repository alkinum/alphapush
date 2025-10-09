// Re-export auth configuration
export { createAuth } from './config';
export type { Auth } from './config';

// Re-export server helpers
export { getSession, getSessionFromContext, requireAuth, isAdmin } from './server';

// Re-export client utilities
export { authClient, signIn, signOut, getSession as getClientSession, useSession } from './client';
