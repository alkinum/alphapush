import { eq } from 'drizzle-orm';

import type { D1Database } from '@cloudflare/workers-types';
import { SQLiteTransaction } from 'drizzle-orm/sqlite-core';

import { getDb } from '@/db';
import { approvalProcesses } from '@/schema';

export class ApprovalProcessService {
  private db: ReturnType<typeof getDb>;

  constructor(d1: D1Database) {
    this.db = getDb(d1);
  }

  async addApprovalProcess(
    trx: SQLiteTransaction<any, any, any, any>,
    data: { userEmail: string; notificationId: string; webhookUrl: string },
  ) {
    try {
      const result = await trx
        .insert(approvalProcesses)
        .values({
          userEmail: data.userEmail,
          notificationId: data.notificationId,
          webhookUrl: data.webhookUrl,
          state: 'pending',
        })
        .returning()
        .get();

      return result;
    } catch (error) {
      console.error('Error adding approval process:', error);
      throw error;
    }
  }

  async updateApprovalProcessState(id: string, state: 'approved' | 'rejected') {
    try {
      const currentProcess = await this.getApprovalProcessById(id);

      if (!currentProcess) {
        throw new Error('Approval process not found');
      }

      if (currentProcess.state !== 'pending') {
        throw new Error('Cannot update a non-pending approval process');
      }

      const result = await this.db
        .update(approvalProcesses)
        .set({ state, updatedAt: new Date() })
        .where(eq(approvalProcesses.id, id))
        .returning()
        .get();

      return result;
    } catch (error) {
      console.error('Error updating approval process state:', error);
      throw error;
    }
  }

  async deleteApprovalProcessByNotificationId(trx: SQLiteTransaction<any, any, any, any>, notificationId: string) {
    try {
      const result = await trx
        .delete(approvalProcesses)
        .where(eq(approvalProcesses.notificationId, notificationId))
        .returning()
        .get();

      return result;
    } catch (error) {
      console.error('Error deleting approval process:', error);
      throw error;
    }
  }

  async getApprovalProcessByNotificationId(notificationId: string) {
    try {
      const result = await this.db
        .select()
        .from(approvalProcesses)
        .where(eq(approvalProcesses.notificationId, notificationId))
        .get();

      return result;
    } catch (error) {
      console.error('Error getting approval process:', error);
      throw error;
    }
  }

  async getApprovalProcessById(id: string) {
    try {
      const result = await this.db.select().from(approvalProcesses).where(eq(approvalProcesses.id, id)).get();

      return result;
    } catch (error) {
      console.error('Error getting approval process by ID:', error);
      throw error;
    }
  }
}
