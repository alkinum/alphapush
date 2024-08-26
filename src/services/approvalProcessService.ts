import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { approvalProcesses } from '@/schema';

export class ApprovalProcessService {
  constructor(private db: DrizzleD1Database) {}

  async addApprovalProcess(data: { notificationId: string; webhookUrl: string; userEmail: string }) {
    return await this.db.insert(approvalProcesses).values(data).returning().get();
  }

  async updateApprovalProcessState(id: string, state: 'approved' | 'rejected') {
    const currentProcess = await this.getApprovalProcessById(id);

    if (!currentProcess) {
      throw new Error('Approval process not found');
    }

    if (currentProcess.state !== 'pending') {
      throw new Error('Cannot update a non-pending approval process');
    }

    return await this.db
      .update(approvalProcesses)
      .set({ state, updatedAt: new Date() })
      .where(eq(approvalProcesses.id, id))
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
