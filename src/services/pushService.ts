import { eq } from 'drizzle-orm';
import type { PushSubscription } from '@block65/webcrypto-web-push';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '@/db';
import { userCredentials, pushNotifications, subscriptions } from '@/schema';
import { WebPushService } from '@/services/webPushService';
import { SubscriptionService } from '@/services/subscriptionService';
import { ApprovalProcessService } from '@/services/approvalProcessService';
import type { Notification } from '@/types/notification';
import { isLocalNetworkUrl } from '@/utils/network';
import { sendSSEvent } from '@/pages/api/stream';
import { logger } from '@/utils/logger';

export const MAX_MESSAGE_SIZE = 4096; // 4KB in bytes

export interface PushResult {
  success: boolean;
  notificationId?: string;
  approvalId?: string;
  error?: string;
  failedPushes?: Array<{ subscriptionId: string; reason: string }>;
}

/**
 * Checks if a webhook URL is valid and not a local network URL.
 * @param url The webhook URL to check
 * @returns An object with a boolean indicating if the URL is valid and a possible error message
 */
export function validateWebhookUrl(url: string): { isValid: boolean; error?: string } {
  if (!url) {
    return { isValid: false, error: 'Webhook URL is required' };
  }

  try {
    new URL(url);
  } catch (error) {
    return { isValid: false, error: 'Invalid URL format' };
  }

  if (isLocalNetworkUrl(url)) {
    return { isValid: false, error: 'Local network URLs are not allowed for webhooks' };
  }

  return { isValid: true };
}

export class PushService {
  private db: ReturnType<typeof getDb>;
  private env: any;

  constructor(db: ReturnType<typeof getDb>, env: any) {
    this.db = db;
    this.env = env;
  }

  /**
   * Validate push token and get user
   * @param pushToken User's push token
   * @returns User or null if token is invalid
   */
  async validatePushToken(pushToken: string) {
    logger.debug(`Validating push token: ${pushToken}`);
    return await this.db.select().from(userCredentials).where(eq(userCredentials.pushToken, pushToken)).get();
  }

  /**
   * Create a notification in the database
   * @param notificationData Notification data to insert
   * @returns Created notification or undefined if failed
   */
  async createNotification(notificationData: {
    content: string;
    title?: string;
    subtitle?: string;
    category?: string;
    group?: string;
    userEmail: string;
    iconUrl?: string;
    navigate_url?: string;
    type?: string;
    extraInfo?: string | null;
  }) {
    logger.debug(`Creating notification for user: ${notificationData.userEmail}`, {
      type: notificationData.type,
      hasTitle: !!notificationData.title
    });
    return await this.db.insert(pushNotifications).values(notificationData).returning().get();
  }

  /**
   * Create an approval process for a notification
   * @param notification The notification
   * @param webhookUrl Webhook URL for the approval process
   * @param userEmail User's email
   * @returns Object containing approvalId and tempAccessToken
   */
  async createApprovalProcess(notification: Notification, webhookUrl: string, userEmail: string) {
    logger.debug(`Creating approval process for notification: ${notification.id}`, {
      webhookUrl,
      userEmail
    });

    const approvalProcessService = new ApprovalProcessService(this.db);

    // SSRF check
    const { isValid, error } = validateWebhookUrl(webhookUrl);
    if (!isValid && import.meta.env.DISABLE_SSRF_PROTECTION !== 'true') {
      logger.error(`Invalid webhook URL: ${error}`, { webhookUrl });
      throw new Error(error);
    }

    // Insert approval process
    const approvalProcess = await approvalProcessService.addApprovalProcess({
      notificationId: notification.id,
      webhookUrl,
      userEmail,
    });

    if (!approvalProcess) {
      logger.error(`Failed to create approval process for notification: ${notification.id}`);
      throw new Error('Failed to create approval process');
    }

    // Generate and store temporary access token
    const tempAccessToken = createId();
    await this.env.KV.put(
      `approval_token:${approvalProcess.id}`,
      tempAccessToken,
      { expirationTtl: 300 }, // 5 minutes in seconds
    );

    logger.debug(`Approval process created: ${approvalProcess.id}`);
    return {
      approvalId: approvalProcess.id,
      tempAccessToken
    };
  }

  /**
   * Send push notifications to all user subscriptions
   * @param user User to send notifications to
   * @param notification Notification to send
   * @param options Additional options for the notification
   * @returns Result of the push operation
   */
  async sendPushNotifications(
    user: { email: string; publicKey: string; privateKey: string },
    notification: Notification,
    options: {
      approvalId?: string;
      tempAccessToken?: string;
      approvalState?: string;
      topic?: string;
      urgency?: 'normal' | 'high';
    } = {}
  ): Promise<PushResult> {
    logger.debug(`Sending push notifications for user: ${user.email}`, {
      notificationId: notification.id,
      approvalId: options.approvalId,
      topic: options.topic
    });

    try {
      // Get user subscriptions
      const userSubscriptions = await this.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userEmail, user.email))
        .all();

      logger.debug(`Found ${userSubscriptions.length} subscriptions for user: ${user.email}`);

      const failedPushes: Array<{ subscriptionId: string; reason: string }> = [];
      const webPushService = new WebPushService(user.publicKey, user.privateKey, `mailto:${user.email}`);
      const subscriptionService = new SubscriptionService(this.env.DB);
      const subscriptionsToRemove: string[] = [];

      // Construct the message
      const message = JSON.stringify({
        ...notification,
        approvalState: options.approvalState,
        approvalId: options.approvalId,
        tempAccessToken: options.tempAccessToken,
      });

      // Check message size
      if (new TextEncoder().encode(message).length > MAX_MESSAGE_SIZE) {
        logger.error(`Message size exceeds 4KB limit for notification: ${notification.id}`);
        return { success: false, error: 'Message size exceeds 4KB limit' };
      }

      // Send notifications to all subscriptions
      for (const sub of userSubscriptions) {
        const subscription: PushSubscription = JSON.parse(sub.subscription);

        try {
          logger.debug(`Sending notification to subscription: ${sub.id}`);
          await webPushService.sendNotification(subscription, message, {
            ttl: 60,
            topic: options.topic || 'Default',
            urgency: options.urgency || 'normal',
          });
        } catch (error) {
          logger.error(`Failed to send push notification to subscription ${sub.id}:`, error);
          failedPushes.push({
            subscriptionId: sub.id,
            reason: (error as Error).message,
          });

          if (error instanceof Error && 'statusCode' in error && (error as any).statusCode === 410) {
            subscriptionsToRemove.push(sub.id);
          }
        }
      }

      // Clean up expired subscriptions
      for (const subscriptionId of subscriptionsToRemove) {
        logger.debug(`Removing expired subscription: ${subscriptionId}`);
        const isDeleted = await subscriptionService.deleteSubscriptionById(subscriptionId);
        if (isDeleted) {
          logger.info(`Removed expired subscription: ${subscriptionId}`);
        } else {
          logger.error(`Failed to remove expired subscription: ${subscriptionId}`);
        }
      }

      // Send server-sent event
      sendSSEvent(user.email, 'newNotification', {
        ...notification,
        approvalState: options.approvalState,
        approvalId: options.approvalId,
      });

      // Return result
      if (failedPushes.length > 0) {
        logger.warn(`Some push notifications failed to send for notification: ${notification.id}`, {
          failedCount: failedPushes.length,
          totalCount: userSubscriptions.length
        });

        return {
          success: false,
          error: 'Some push notifications failed to send',
          failedPushes,
          notificationId: notification.id,
          approvalId: options.approvalId,
        };
      }

      logger.debug(`Successfully sent all push notifications for notification: ${notification.id}`);
      return {
        success: true,
        notificationId: notification.id,
        approvalId: options.approvalId,
      };
    } catch (error) {
      logger.error(`Error in push service for notification: ${notification.id}:`, error);
      return { success: false, error: 'Internal Server Error' };
    }
  }
}
