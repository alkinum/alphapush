import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';

// Get the database instance from D1
export function getDb(d1: D1Database) {
  return drizzle(d1);
}
