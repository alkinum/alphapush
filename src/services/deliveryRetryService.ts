import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { pushDeliveryAttempts, pushNotifications, subscriptions } from '@/schema';
import { BarkFallbackService } from '@/services/barkFallbackService';
import { NotificationService } from '@/services/notificationService';
import type { Notification } from '@/types/notification';

export type DeliveryAckEvent = 'displayed' | 'opened';

const DEFAULT_ACK_TIMEOUT_SECONDS = 5 * 60;
const DEFAULT_NO_ACK_FAILURE_THRESHOLD = 3;
const DEFAULT_PROCESS_LIMIT = 50;
const DEFAULT_PROCESSING_STALE_SECONDS = 10 * 60;

export interface DeliveryAttemptCreateData {
  notificationId: string;
  subscriptionId: string;
  userEmail: string;
}

export interface DeliveryRetryEnv {
  APP_URL?: string;
  PUSH_ACK_TIMEOUT_SECONDS?: string;
  PUSH_NO_ACK_FAILURE_THRESHOLD?: string;
  PUSH_DELIVERY_PROCESSING_STALE_SECONDS?: string;
}

export class DeliveryRetryService {
  private db: ReturnType<typeof getDb>;
  private ackTimeoutSeconds: number;
  private noAckFailureThreshold: number;
  private processingStaleSeconds: number;

  constructor(db: ReturnType<typeof getDb>, private readonly env: DeliveryRetryEnv = {}) {
    this.db = db;
    this.ackTimeoutSeconds = getPositiveInteger(env.PUSH_ACK_TIMEOUT_SECONDS, DEFAULT_ACK_TIMEOUT_SECONDS);
    this.noAckFailureThreshold = getPositiveInteger(
      env.PUSH_NO_ACK_FAILURE_THRESHOLD,
      DEFAULT_NO_ACK_FAILURE_THRESHOLD
    );
    this.processingStaleSeconds = getPositiveInteger(
      env.PUSH_DELIVERY_PROCESSING_STALE_SECONDS,
      DEFAULT_PROCESSING_STALE_SECONDS
    );
  }

  async createAttempt(data: DeliveryAttemptCreateData) {
    const sentAt = new Date();
    const ackDeadlineAt = new Date(sentAt.getTime() + this.ackTimeoutSeconds * 1000);
    const receiptToken = crypto.randomUUID();

    return await this.db
      .insert(pushDeliveryAttempts)
      .values({
        notificationId: data.notificationId,
        subscriptionId: data.subscriptionId,
        userEmail: data.userEmail,
        receiptToken,
        sentAt,
        ackDeadlineAt,
      })
      .returning()
      .get();
  }

  async recordAck(
    notificationId: string,
    userEmail: string,
    event: DeliveryAckEvent,
    subscriptionId?: string,
    attemptId?: string
  ): Promise<boolean> {
    if (!subscriptionId) {
      return false;
    }

    const now = new Date();
    const updateData =
      event === 'opened'
        ? {
          displayedAt: sql`coalesce(${pushDeliveryAttempts.displayedAt}, ${Math.floor(now.getTime() / 1000)})`,
          openedAt: now,
          ackedAt: sql`coalesce(${pushDeliveryAttempts.ackedAt}, ${Math.floor(now.getTime() / 1000)})`,
          status: 'acked',
          updatedAt: now,
        }
        : {
          displayedAt: sql`coalesce(${pushDeliveryAttempts.displayedAt}, ${Math.floor(now.getTime() / 1000)})`,
          ackedAt: sql`coalesce(${pushDeliveryAttempts.ackedAt}, ${Math.floor(now.getTime() / 1000)})`,
          status: 'acked',
          updatedAt: now,
        };

    const conditions = [
      eq(pushDeliveryAttempts.notificationId, notificationId),
      eq(pushDeliveryAttempts.subscriptionId, subscriptionId),
      eq(pushDeliveryAttempts.userEmail, userEmail),
      event === 'opened' ? isNull(pushDeliveryAttempts.openedAt) : isNull(pushDeliveryAttempts.ackedAt),
    ];

    if (attemptId) {
      conditions.push(eq(pushDeliveryAttempts.id, attemptId));
    }

    const result = await this.db
      .update(pushDeliveryAttempts)
      .set(updateData)
      .where(and(...conditions))
      .returning({ id: pushDeliveryAttempts.id })
      .get();

    if (result) {
      await this.db
        .update(subscriptions)
        .set({
          noAckCount: 0,
          lastAckAt: now,
          updatedAt: now,
        })
        .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userEmail, userEmail)));
    }

    return !!result;
  }

  async resolveReceiptUserEmail(
    notificationId: string,
    subscriptionId: string,
    attemptId: string,
    receiptToken: string
  ): Promise<string | null> {
    const attempt = await this.db
      .select({ userEmail: pushDeliveryAttempts.userEmail })
      .from(pushDeliveryAttempts)
      .where(and(
        eq(pushDeliveryAttempts.id, attemptId),
        eq(pushDeliveryAttempts.notificationId, notificationId),
        eq(pushDeliveryAttempts.subscriptionId, subscriptionId),
        eq(pushDeliveryAttempts.receiptToken, receiptToken)
      ))
      .get();

    return attempt?.userEmail || null;
  }

  async markAttemptTerminal(attemptId: string, status: string, reason?: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(pushDeliveryAttempts)
      .set({
        status,
        fallbackReason: reason || null,
        updatedAt: now,
      })
      .where(and(eq(pushDeliveryAttempts.id, attemptId), isNull(pushDeliveryAttempts.ackedAt)));
  }

  async shouldSendImmediateFallback(subscription: typeof subscriptions.$inferSelect): Promise<boolean> {
    return !!subscription.barkFallbackEnabled &&
      !!subscription.barkDeviceKey &&
      (subscription.barkFallbackAlways === true ||
        (subscription.noAckCount || 0) >= this.noAckFailureThreshold);
  }

  async sendFallbackForAttempt(
    attemptId: string,
    notification: Notification,
    subscription: typeof subscriptions.$inferSelect,
    reason: string,
    options: { urgency?: 'normal' | 'high' } = {}
  ): Promise<boolean> {
    const now = new Date();

    if (!subscription.barkFallbackEnabled || !subscription.barkDeviceKey) {
      await this.updateAttemptFallbackResult(attemptId, reason, false, 'Bark fallback is not configured');
      return false;
    }

    const barkFallbackService = new BarkFallbackService(this.env.APP_URL);
    const result = await barkFallbackService.sendToTarget(
      {
        barkServerUrl: subscription.barkServerUrl || 'https://api.day.app',
        barkDeviceKey: subscription.barkDeviceKey,
      },
      notification,
      options
    );

    await this.updateAttemptFallbackResult(attemptId, reason, result.sent, result.error);

    if (result.sent) {
      await this.db
        .update(pushNotifications)
        .set({
          barkFallbackSentAt: now,
          barkFallbackReason: reason,
          barkFallbackError: null,
          updatedAt: now,
        })
        .where(and(
          eq(pushNotifications.id, notification.id),
          eq(pushNotifications.userEmail, notification.userEmail)
        ));
    }

    return result.sent;
  }

  async processDueFallbacks(limit = DEFAULT_PROCESS_LIMIT): Promise<{
    processed: number;
    fallbackSent: number;
    fallbackFailed: number;
    skipped: number;
  }> {
    const now = new Date();
    const staleProcessingBefore = new Date(now.getTime() - this.processingStaleSeconds * 1000);
    const dueAttempts = await this.db
      .select()
      .from(pushDeliveryAttempts)
      .where(
        and(
          isNull(pushDeliveryAttempts.ackedAt),
          lte(pushDeliveryAttempts.ackDeadlineAt, now),
          or(
            eq(pushDeliveryAttempts.status, 'pending'),
            and(
              eq(pushDeliveryAttempts.status, 'processing'),
              lte(pushDeliveryAttempts.updatedAt, staleProcessingBefore)
            )
          )
        )
      )
      .limit(limit)
      .all();

    const notificationService = new NotificationService(this.db);
    let fallbackSent = 0;
    let fallbackFailed = 0;
    let skipped = 0;

    for (const attempt of dueAttempts) {
      const claimedAttempt = await this.claimAttemptForProcessing(attempt.id);
      if (!claimedAttempt) {
        skipped += 1;
        continue;
      }

      if (await this.isAttemptAcked(attempt.id)) {
        skipped += 1;
        continue;
      }

      const subscription = await this.db
        .select()
        .from(subscriptions)
        .where(and(
          eq(subscriptions.id, attempt.subscriptionId),
          eq(subscriptions.userEmail, attempt.userEmail)
        ))
        .get();

      if (!subscription) {
        await this.updateAttemptFallbackResult(attempt.id, 'subscription-missing', false, 'Subscription not found');
        skipped += 1;
        continue;
      }

      await this.incrementNoAck(subscription);

      const notification = await notificationService.getNotification(attempt.notificationId, attempt.userEmail);
      if (!notification) {
        await this.updateAttemptFallbackResult(attempt.id, 'notification-missing', false, 'Notification not found');
        skipped += 1;
        continue;
      }

      // Ack can arrive after this cron run has claimed the attempt.
      if (await this.isAttemptAcked(attempt.id)) {
        skipped += 1;
        continue;
      }

      if (!subscription.barkFallbackEnabled || !subscription.barkDeviceKey) {
        await this.updateAttemptFallbackResult(attempt.id, 'ack-timeout', false, 'Bark fallback is not configured');
        skipped += 1;
        continue;
      }

      const sent = await this.sendFallbackForAttempt(attempt.id, notification, subscription, 'ack-timeout');
      if (sent) {
        fallbackSent += 1;
      } else {
        fallbackFailed += 1;
      }
    }

    return {
      processed: dueAttempts.length,
      fallbackSent,
      fallbackFailed,
      skipped,
    };
  }

  private async claimAttemptForProcessing(attemptId: string): Promise<boolean> {
    const now = new Date();
    const staleProcessingBefore = new Date(now.getTime() - this.processingStaleSeconds * 1000);
    const result = await this.db
      .update(pushDeliveryAttempts)
      .set({
        status: 'processing',
        updatedAt: now,
      })
      .where(and(
        eq(pushDeliveryAttempts.id, attemptId),
        isNull(pushDeliveryAttempts.ackedAt),
        or(
          eq(pushDeliveryAttempts.status, 'pending'),
          and(
            eq(pushDeliveryAttempts.status, 'processing'),
            lte(pushDeliveryAttempts.updatedAt, staleProcessingBefore)
          )
        )
      ))
      .returning({ id: pushDeliveryAttempts.id })
      .get();

    return !!result;
  }

  private async isAttemptAcked(attemptId: string): Promise<boolean> {
    const attempt = await this.db
      .select({ ackedAt: pushDeliveryAttempts.ackedAt })
      .from(pushDeliveryAttempts)
      .where(eq(pushDeliveryAttempts.id, attemptId))
      .get();

    return !!attempt?.ackedAt;
  }

  private async incrementNoAck(subscription: typeof subscriptions.$inferSelect): Promise<void> {
    const now = new Date();
    await this.db
      .update(subscriptions)
      .set({
        noAckCount: sql`coalesce(${subscriptions.noAckCount}, 0) + 1`,
        lastNoAckAt: now,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, subscription.id));
  }

  private async updateAttemptFallbackResult(
    attemptId: string,
    reason: string,
    sent: boolean,
    error?: string
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(pushDeliveryAttempts)
      .set({
        fallbackSentAt: sent ? now : null,
        fallbackReason: reason,
        fallbackError: sent ? null : error || 'Bark fallback failed',
        status: sql`case when ${pushDeliveryAttempts.ackedAt} is not null then 'acked' else ${sent ? 'fallback_sent' : 'fallback_failed'} end`,
        updatedAt: now,
      })
      .where(eq(pushDeliveryAttempts.id, attemptId));
  }
}

function getPositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}
