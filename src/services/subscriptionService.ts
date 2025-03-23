import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions } from '@/schema';
import type { D1Database } from '@cloudflare/workers-types';
import { logger } from '@/utils/logger';

export class SubscriptionService {
  private db: ReturnType<typeof getDb>;

  constructor(d1: D1Database) {
    this.db = getDb(d1);
    logger.debug('SubscriptionService initialized');
  }

  async deleteSubscriptionById(id: string): Promise<boolean> {
    try {
      logger.debug(`Attempting to delete subscription with ID: ${id}`);
      const result = await this.db
        .delete(subscriptions)
        .where(eq(subscriptions.id, id))
        .returning({ deletedId: subscriptions.id })
        .get();

      const success = !!result;
      if (success) {
        logger.info(`Successfully deleted subscription with ID: ${id}`);
      } else {
        logger.warn(`No subscription found with ID: ${id}`);
      }
      return success;
    } catch (error) {
      logger.error(`Error deleting subscription with ID: ${id}:`, error);
      return false;
    }
  }
}
