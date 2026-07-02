import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '@/db';
import * as schema from '@/schema';

const ADMIN_EMAILS = import.meta.env.ADMIN_EMAILS?.split(',') || [];

export function createAuth(db: D1Database) {
  return betterAuth({
    database: drizzleAdapter(getDb(db), {
      provider: 'sqlite',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: false, // We're using OAuth only
    },
    socialProviders: {
      github: {
        clientId: import.meta.env.GITHUB_CLIENT_ID || '',
        clientSecret: import.meta.env.GITHUB_CLIENT_SECRET || '',
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // 1 day
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'user',
          input: false, // Don't allow users to set their own role
        },
      },
      modelName: 'user',
    },
    advanced: {
      database: {
        generateId: () => {
          return createId();
        },
      },
    },
    callbacks: {
      after: {
        signIn: async (user: { user: { email: string; role?: string }; session: any }) => {
          // Set role based on admin emails
          const role = ADMIN_EMAILS.includes(user.user.email) ? 'admin' : 'user';

          // Update user role if needed
          if (user.user.role !== role) {
            // The user object will be updated automatically
            return {
              user: {
                ...user.user,
                role,
              },
            };
          }
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
