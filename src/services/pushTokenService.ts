import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { userCredentials } from '@/schema';
import { generatePushToken } from '@/utils/vapid-helper';
import type { D1Database } from '@cloudflare/workers-types';

export class PushTokenService {
  private db: ReturnType<typeof getDb>;

  constructor(d1: D1Database) {
    this.db = getDb(d1);
  }

  async getPushToken(userEmail: string): Promise<string | null> {
    try {
      const user = await this.db
        .select({ pushToken: userCredentials.pushToken })
        .from(userCredentials)
        .where(eq(userCredentials.email, userEmail))
        .get();

      return user?.pushToken ?? null;
    } catch (error) {
      console.error('Error getting push token:', error);
      return null;
    }
  }

  async resetPushToken(userEmail: string): Promise<string | null> {
    try {
      const newPushToken = generatePushToken();

      const updatedUser = await this.db
        .update(userCredentials)
        .set({ pushToken: newPushToken })
        .where(eq(userCredentials.email, userEmail))
        .returning({ pushToken: userCredentials.pushToken })
        .get();

      return updatedUser?.pushToken ?? null;
    } catch (error) {
      console.error('Error resetting push token:', error);
      return null;
    }
  }
}
