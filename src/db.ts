import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';

// Get the database instance from D1
export function getDb(d1: D1Database) {
  return drizzle(d1);
}

// Middleware to add the database to the context
export function withDb(handler: any) {
  return async (context: any) => {
    const db = getDb(context.env.DB);
    context.locals.db = db;
    return handler(context);
  };
}

// Export a db instance for direct use in API routes
// This is a placeholder that will be replaced at runtime
// with the actual database instance from the context
export const db = {
  async query() {
    throw new Error('Database not initialized. Use context.locals.db instead.');
  },
  select: () => ({
    from: () => ({
      where: () => Promise.resolve([]),
    }),
  }),
  insert: () => ({
    values: () => Promise.resolve({}),
  }),
  update: () => ({
    set: () => ({
      where: () => Promise.resolve({}),
    }),
  }),
};
