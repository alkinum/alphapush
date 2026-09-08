import { and, eq, lte, or } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { approvalProcesses } from '@/schema';

export class ApprovalProcessService {
  constructor(private db: DrizzleD1Database) {}

  async addApprovalProcess(data: { notificationId: string; webhookUrl: string; userEmail: string }) {
    return await this.db.insert(approvalProcesses).values(data).returning().get();
  }

  async claimApprovalProcess(id: string) {
    const now = new Date();
    // The lease outlasts the webhook timeout and recovers interrupted requests.
    return await this.db
      .update(approvalProcesses)
      .set({ state: 'processing', updatedAt: now })
      .where(and(eq(approvalProcesses.id, id), or(
        eq(approvalProcesses.state, 'pending'),
        and(eq(approvalProcesses.state, 'processing'), lte(approvalProcesses.updatedAt, new Date(now.getTime() - 60_000)))
      )))
      .returning()
      .get();
  }

  async finishApprovalProcess(id: string, claimedAt: Date, state: 'pending' | 'approved' | 'rejected') {
    return await this.db
      .update(approvalProcesses)
      .set({ state, updatedAt: new Date() })
      .where(and(
        eq(approvalProcesses.id, id),
        eq(approvalProcesses.state, 'processing'),
        eq(approvalProcesses.updatedAt, claimedAt)
      ))
      .returning()
      .get();
  }

  async deleteApprovalProcessByNotificationId(notificationId: string) {
    return await this.db
      .delete(approvalProcesses)
      .where(eq(approvalProcesses.notificationId, notificationId))
      .returning()
      .get();
  }

  async getApprovalProcessByNotificationId(notificationId: string) {
    return await this.db
      .select()
      .from(approvalProcesses)
      .where(eq(approvalProcesses.notificationId, notificationId))
      .get();
  }

  async getApprovalProcessById(id: string) {
    return await this.db.select().from(approvalProcesses).where(eq(approvalProcesses.id, id)).get();
  }
}
