import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getSessionFromContext } from '@/lib/auth';
import { defaultPreferences, UserPreferenceService, type UserPreference } from '@/services/userPreferenceService';
import { isLocalNetworkUrl } from '@/utils/network';

type PreferencePatch = Partial<UserPreference>;

const preferenceKeys = new Set<keyof UserPreference>([
  'showNotificationIcons',
  'barkFallbackEnabled',
  'barkFallbackAlways',
  'barkServerUrl',
]);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function normalizeBarkServerUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Bark server URL must be a string');
  }

  const serverUrl = value.trim() || defaultPreferences.barkServerUrl;
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(serverUrl);
  } catch {
    throw new Error('Invalid Bark server URL');
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('Bark server URL must use http or https');
  }

  if (isLocalNetworkUrl(parsedUrl.toString())) {
    throw new Error('Local network Bark server URLs are not allowed');
  }

  parsedUrl.hash = '';
  parsedUrl.search = '';
  return parsedUrl.toString().replace(/\/+$/, '');
}

function normalizePreferencePatch(rawPreferences: unknown): PreferencePatch {
  if (!rawPreferences || typeof rawPreferences !== 'object' || Array.isArray(rawPreferences)) {
    throw new Error('Missing preferences');
  }

  const preferences = rawPreferences as Record<string, unknown>;
  const normalized: PreferencePatch = {};

  for (const [key, value] of Object.entries(preferences)) {
    if (!preferenceKeys.has(key as keyof UserPreference)) {
      throw new Error(`Unsupported preference key: ${key}`);
    }

    switch (key as keyof UserPreference) {
      case 'showNotificationIcons':
        if (typeof value !== 'boolean') {
          throw new Error(`${key} must be a boolean`);
        }
        normalized.showNotificationIcons = value;
        break;
      case 'barkFallbackEnabled':
        if (typeof value !== 'boolean') {
          throw new Error(`${key} must be a boolean`);
        }
        normalized.barkFallbackEnabled = value;
        break;
      case 'barkFallbackAlways':
        if (typeof value !== 'boolean') {
          throw new Error(`${key} must be a boolean`);
        }
        normalized.barkFallbackAlways = value;
        break;
      case 'barkServerUrl':
        normalized.barkServerUrl = normalizeBarkServerUrl(value);
        break;
    }
  }

  return normalized;
}

function sanitizePreferencesForResponse(preferences: UserPreference): UserPreference {
  return {
    ...preferences,
    barkDeviceKey: '',
  };
}

export const GET: APIRoute = async (context) => {
  try {
    // Verify user identity
    const session = await getSessionFromContext(context);
    if (!session?.user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Create service instance
    const userPreferenceService = new UserPreferenceService(env.DB);

    // Get user preferences
    const preferences = await userPreferenceService.getUserPreferences(session.user.email);

    return jsonResponse({ preferences: sanitizePreferencesForResponse(preferences) });
  } catch (error) {
    console.error('Error getting user preferences:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};

export const POST: APIRoute = async (context) => {
  try {
    // Verify user identity
    const session = await getSessionFromContext(context);
    if (!session?.user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Create service instance
    const userPreferenceService = new UserPreferenceService(env.DB);

    // Parse request body
    const body = await context.request.json();
    const { preferences } = body as { preferences?: Partial<UserPreference> };
    const normalizedPreferences = normalizePreferencePatch(preferences);

    // Update user preferences
    const updatedPreferences = await userPreferenceService.updateUserPreferences(session.user.email, normalizedPreferences);

    return jsonResponse({ preferences: sanitizePreferencesForResponse(updatedPreferences) });
  } catch (error) {
    console.error('Error updating user preferences:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Internal server error' ? 500 : 400;
    return jsonResponse({ error: message }, status);
  }
};

// Handle syncing a single preference
export const PUT: APIRoute = async (context) => {
  try {
    // Verify user identity
    const session = await getSessionFromContext(context);
    if (!session?.user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Create service instance
    const userPreferenceService = new UserPreferenceService(env.DB);

    // Parse request body
    const body = await context.request.json() as { key?: keyof UserPreference; value?: unknown };
    const { key, value } = body;

    if (!key || !preferenceKeys.has(key)) {
      return jsonResponse({ error: 'Missing or unsupported preference key' }, 400);
    }

    // Sync single preference
    const normalizedPreferences = normalizePreferencePatch({ [key]: value });
    const normalizedValue = normalizedPreferences[key] as UserPreference[typeof key];
    const updatedPreferences = await userPreferenceService.syncPreference(session.user.email, key, normalizedValue);

    return jsonResponse({ preferences: sanitizePreferencesForResponse(updatedPreferences) });
  } catch (error) {
    console.error('Error syncing user preference:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Internal server error' ? 500 : 400;
    return jsonResponse({ error: message }, status);
  }
};
