import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { UserPreferenceService, type UserPreference } from '@/services/userPreferenceService';

export const GET: APIRoute = async (context) => {
  try {
    // Verify user identity
    const session = await getSession(context.request);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    // Create service instance
    const userPreferenceService = new UserPreferenceService(context.locals.runtime.env.DB);

    // Get user preferences
    const preferences = await userPreferenceService.getUserPreferences(session.user.email);

    return new Response(JSON.stringify({ preferences }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error getting user preferences:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
};

export const POST: APIRoute = async (context) => {
  try {
    // Verify user identity
    const session = await getSession(context.request);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    // Create service instance
    const userPreferenceService = new UserPreferenceService(context.locals.runtime.env.DB);

    // Parse request body
    const body = await context.request.json();
    const { preferences } = body as { preferences: Partial<UserPreference> };

    if (!preferences) {
      return new Response(JSON.stringify({ error: 'Missing preferences' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    // Update user preferences
    const updatedPreferences = await userPreferenceService.updateUserPreferences(session.user.email, preferences);

    return new Response(JSON.stringify({ preferences: updatedPreferences }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error updating user preferences:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
};

// Handle syncing a single preference
export const PUT: APIRoute = async (context) => {
  try {
    // Verify user identity
    const session = await getSession(context.request);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    // Create service instance
    const userPreferenceService = new UserPreferenceService(context.locals.runtime.env.DB);

    // Parse request body
    const body = await context.request.json();
    const { key, value } = body as { key: keyof UserPreference; value: any };

    if (!key) {
      return new Response(JSON.stringify({ error: 'Missing preference key' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    // Sync single preference
    const updatedPreferences = await userPreferenceService.syncPreference(session.user.email, key, value);

    return new Response(JSON.stringify({ preferences: updatedPreferences }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error syncing user preference:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}; 