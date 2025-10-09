import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : '',
});

/**
 * Sign in with OAuth provider
 */
export async function signIn(provider: 'github') {
  try {
    await authClient.signIn.social({
      provider,
      callbackURL: '/',
    });
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  }
}

/**
 * Sign out
 */
export async function signOut() {
  try {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = '/';
        },
      },
    });
  } catch (error) {
    console.error('Sign out error:', error);
    throw error;
  }
}

/**
 * Get current session
 */
export async function getSession() {
  try {
    const session = await authClient.getSession();
    return session;
  } catch (error) {
    console.error('Get session error:', error);
    return null;
  }
}

/**
 * Use session hook for Vue components
 * Returns a reactive session object from Better Auth
 */
export function useSession() {
  // Better Auth's useSession returns an atom, not a function call result
  return authClient.useSession;
}
