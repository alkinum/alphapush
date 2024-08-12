import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';

export function getDb(d1: D1Database) {
  return drizzle(d1);
}

export function withDb(handler: any) {
  return async (context: any) => {
    const db = getDb(context.env.DB);
    context.locals.db = db;
    return handler(context);
  };
}
