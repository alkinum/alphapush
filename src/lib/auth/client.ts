import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : '',
});

type AuthClientError = {
  message?: string;
  error?: string;
  status?: number;
  statusText?: string;
};

function getAuthErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const authError = error as AuthClientError;
    return authError.message || authError.error || authError.statusText;
  }

  return undefined;
}

/**
 * Sign in with OAuth provider
 */
export async function signIn(provider: 'github', callbackURL = getCurrentCallbackURL()) {
  try {
    const result = await authClient.signIn.social({
      provider,
      callbackURL,
    });

    if (result && typeof result === 'object' && 'error' in result && result.error) {
      throw new Error(getAuthErrorMessage(result.error) || 'Unable to start GitHub sign-in.');
    }
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  }
}

function getCurrentCallbackURL(): string {
  if (typeof window === 'undefined') {
    return '/';
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
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
