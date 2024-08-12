import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions } from '@/schema';
import type { D1Database } from '@cloudflare/workers-types';

export class SubscriptionService {
  private db: ReturnType<typeof getDb>;

  constructor(d1: D1Database) {
    this.db = getDb(d1);
  }

  async deleteSubscriptionById(id: string): Promise<boolean> {
    try {
      const result = await this.db
        .delete(subscriptions)
        .where(eq(subscriptions.id, id))
        .returning({ deletedId: subscriptions.id })
        .get();

      return !!result;
    } catch (error) {
      console.error('Error deleting subscription:', error);
      return false;
    }
  }
}
