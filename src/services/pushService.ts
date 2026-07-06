import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PushSubscription } from '@block65/webcrypto-web-push';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '@/db';
import { userCredentials, subscriptions, pushNotifications } from '@/schema';
import { WebPushService } from '@/services/webPushService';
import { SubscriptionService } from '@/services/subscriptionService';
import { ApprovalProcessService } from '@/services/approvalProcessService';
import { StreamService } from '@/services/streamService';
import { DeliveryRetryService } from '@/services/deliveryRetryService';
import type { Notification } from '@/types/notification';
import { isLocalNetworkUrl } from '@/utils/network';
import { logger } from '@/utils/logger';

export const MAX_MESSAGE_SIZE = 4096; // 4KB in bytes
const DEFAULT_PUSH_TTL_SECONDS = 60 * 60 * 24 * 28;

export interface PushResult {
  success: boolean;
  notificationId?: string;
  approvalId?: string;
  error?: string;
  successfulPushes?: number;
  failedPushes?: Array<{ subscriptionId: string; reason: string }>;
  ignoredPushFailures?: Array<{ subscriptionId: string; reason: string }>;
  removedSubscriptions?: number;
  barkFallbackSent?: boolean;
  barkFallbackReason?: string;
  barkFallbackError?: string;
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
  private streamService: StreamService;

  constructor(db: ReturnType<typeof getDb>, env: any) {
    this.db = db;
    this.env = env;
    this.streamService = new StreamService();
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
   * Format message for Safari declarative push
   * @param notification The notification object
   * @param options Additional options for the notification
   * @returns Formatted message for Safari
   */
  private formatSafariMessage(
    notification: Notification,
    options: {
      approvalId?: string;
      tempAccessToken?: string;
      approvalState?: string;
      badgeCount?: number;
      subscriptionId?: string;
    } = {}
  ): string {
    // Get the app URL from environment, fallback to current origin
    const appUrl = this.env.APP_URL || 'https://push.alkinum.dev';

    // Build navigate URL with query parameters since Safari doesn't support data field
    const baseUrl = notification.navigate_url || '/';

    // Use appUrl as base for relative URLs
    const fullBaseUrl = baseUrl.startsWith('http') ? baseUrl : `${appUrl}${baseUrl}`;
    const url = new URL(fullBaseUrl);

    // Add all notification data as query parameters (matching sw.js data fields)
    url.searchParams.set('id', notification.id); // Maps to notificationData.id
    url.searchParams.set('notificationId', notification.id);

    if (options.subscriptionId) {
      url.searchParams.set('subscriptionId', options.subscriptionId);
    }

    if (notification.categoryId) {
      url.searchParams.set('categoryId', notification.categoryId);
      url.searchParams.set('category', notification.categoryId); // Maps to notificationData.category
    }

    if (notification.groupId) {
      url.searchParams.set('groupId', notification.groupId);
      url.searchParams.set('notification_group', notification.groupId); // Maps to notificationData.notification_group
    }

    if (notification.type) {
      url.searchParams.set('type', notification.type);
    }

    if (options.approvalId) {
      url.searchParams.set('approvalId', options.approvalId);
    }

    if (options.approvalState) {
      url.searchParams.set('approvalState', options.approvalState);
    }

    if (options.tempAccessToken) {
      url.searchParams.set('tempAccessToken', options.tempAccessToken);
    }

    if (typeof options.badgeCount === 'number') {
      url.searchParams.set('badgeCount', String(options.badgeCount));
    }

    if (notification.extraInfo) {
      url.searchParams.set('extraInfo', notification.extraInfo);
    }

    if (notification.navigate_url) {
      url.searchParams.set('navigateUrl', notification.navigate_url);
    }

    // Add createdAt timestamp (current time since notification is being sent now)
    url.searchParams.set('createdAt', Date.now().toString());

    const navigateUrl = url.toString();

    // Build actions based on notification type
    const actions = [];
    if (notification.type === 'approval-process' && options.approvalId && options.tempAccessToken) {
      // Create URLs for approve and reject actions
      const approveUrl = new URL(fullBaseUrl);
      approveUrl.searchParams.set('id', notification.id);
      if (options.subscriptionId) {
        approveUrl.searchParams.set('subscriptionId', options.subscriptionId);
      }
      approveUrl.searchParams.set('approvalId', options.approvalId);
      approveUrl.searchParams.set('action', 'approve');
      approveUrl.searchParams.set('tempAccessToken', options.tempAccessToken);
      approveUrl.searchParams.set('notificationId', notification.id);
      approveUrl.searchParams.set('type', notification.type);
      approveUrl.searchParams.set('createdAt', Date.now().toString());
      if (notification.categoryId) {
        approveUrl.searchParams.set('category', notification.categoryId);
      }
      if (notification.groupId) {
        approveUrl.searchParams.set('notification_group', notification.groupId);
      }

      const rejectUrl = new URL(fullBaseUrl);
      rejectUrl.searchParams.set('id', notification.id);
      if (options.subscriptionId) {
        rejectUrl.searchParams.set('subscriptionId', options.subscriptionId);
      }
      rejectUrl.searchParams.set('approvalId', options.approvalId);
      rejectUrl.searchParams.set('action', 'reject');
      rejectUrl.searchParams.set('tempAccessToken', options.tempAccessToken);
      rejectUrl.searchParams.set('notificationId', notification.id);
      rejectUrl.searchParams.set('type', notification.type);
      rejectUrl.searchParams.set('createdAt', Date.now().toString());
      if (notification.categoryId) {
        rejectUrl.searchParams.set('category', notification.categoryId);
      }
      if (notification.groupId) {
        rejectUrl.searchParams.set('notification_group', notification.groupId);
      }

      actions.push(
        {
          action: 'reject',
          title: 'Reject',
          navigate: rejectUrl.toString(),
        },
        {
          action: 'approve',
          title: 'Approve',
          navigate: approveUrl.toString(),
        }
      );
    } else {
      // Default action for non-approval notifications
      const detailUrl = new URL(fullBaseUrl);
      detailUrl.searchParams.set('id', notification.id);
      detailUrl.searchParams.set('notificationId', notification.id);
      if (options.subscriptionId) {
        detailUrl.searchParams.set('subscriptionId', options.subscriptionId);
      }
      detailUrl.searchParams.set('action', 'detail');
      if (notification.type) {
        detailUrl.searchParams.set('type', notification.type);
      }
      if (notification.categoryId) {
        detailUrl.searchParams.set('categoryId', notification.categoryId);
        detailUrl.searchParams.set('category', notification.categoryId);
      }
      if (notification.groupId) {
        detailUrl.searchParams.set('groupId', notification.groupId);
        detailUrl.searchParams.set('notification_group', notification.groupId);
      }

      actions.push({
        action: 'detail',
        title: 'View Details',
        navigate: detailUrl.toString(),
      });
    }

    // Create declarative push message format for Safari
    const declarativeMessage = {
      web_push: 8030,
      notification: {
        title: notification.title || 'Notification',
        body: notification.content,
        navigate: navigateUrl,
        silent: false,
        ...(notification.iconUrl && { icon: notification.iconUrl }),
        ...(notification.subtitle && { tag: notification.subtitle }),
        // Include data field matching sw.js notification data structure
        data: {
          id: notification.id,
          subscriptionId: options.subscriptionId,
          category: notification.categoryId,
          notification_group: notification.groupId,
          type: notification.type,
          approvalId: options.approvalId,
          createdAt: Date.now(),
          tempAccessToken: options.tempAccessToken,
          navigateUrl: notification.navigate_url,
          extraInfo: notification.extraInfo,
          approvalState: options.approvalState,
          badgeCount: options.badgeCount,
        },
        actions,
      },
    };

    return JSON.stringify(declarativeMessage);
  }

  private async recordWebPushSent(notificationId: string, userEmail: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(pushNotifications)
      .set({
        webPushSentAt: now,
        updatedAt: now,
      })
      .where(and(eq(pushNotifications.id, notificationId), eq(pushNotifications.userEmail, userEmail)));
  }

  private async getUnreadCount(userEmail: string): Promise<number> {
    const result = await this.db
      .select({ count: sql`COUNT(*)` })
      .from(pushNotifications)
      .where(and(eq(pushNotifications.userEmail, userEmail), isNull(pushNotifications.readAt)))
      .get();

    return Number(result?.count || 0);
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
      badgeCount?: number;
    } = {}
  ): Promise<PushResult> {
    logger.debug(`Sending push notifications for user: ${user.email}`, {
      notificationId: notification.id,
      approvalId: options.approvalId,
      topic: options.topic
    });

    const failedPushes: Array<{ subscriptionId: string; reason: string }> = [];
    const ignoredPushFailures: Array<{ subscriptionId: string; reason: string }> = [];
    let removedSubscriptions = 0;
    let successfulPushes = 0;
    let barkFallbackSent = false;
    let barkFallbackReason: string | undefined;
    let barkFallbackError: string | undefined;

    try {
      // Get user subscriptions
      const userSubscriptions = await this.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userEmail, user.email))
        .all();

      logger.debug(`Found ${userSubscriptions.length} subscriptions for user: ${user.email}`);

      const webPushService = new WebPushService(user.publicKey, user.privateKey, `mailto:${user.email}`);
      const subscriptionService = new SubscriptionService(this.env.DB);
      const deliveryRetryService = new DeliveryRetryService(this.db, this.env);
      const subscriptionsToRemove = new Set<string>();
      const badgeCount = options.badgeCount ?? await this.getUnreadCount(user.email);

      const sendDeviceFallback = async (
        sub: typeof subscriptions.$inferSelect,
        reason: string
      ): Promise<void> => {
        if (!sub.barkFallbackEnabled || !sub.barkDeviceKey) {
          return;
        }

        try {
          const attempt = await deliveryRetryService.createAttempt({
            notificationId: notification.id,
            subscriptionId: sub.id,
            userEmail: user.email,
          });
          const sent = await deliveryRetryService.sendFallbackForAttempt(
            attempt.id,
            notification,
            sub,
            reason,
            { urgency: options.urgency }
          );

          if (sent) {
            barkFallbackSent = true;
            barkFallbackReason ||= reason;
            barkFallbackError = undefined;
          } else if (!barkFallbackSent) {
            barkFallbackReason ||= reason;
            barkFallbackError ||= 'Bark fallback failed';
          }
        } catch (error) {
          logger.error(`Failed to send Bark fallback for subscription ${sub.id}:`, error);
          if (!barkFallbackSent) {
            barkFallbackReason ||= reason;
            barkFallbackError ||= error instanceof Error ? error.message : 'Bark fallback failed';
          }
        }
      };

      // Send notifications to all subscriptions
      for (const sub of userSubscriptions) {
        let subscription: PushSubscription;
        let message: string;

        try {
          subscription = parseStoredPushSubscription(sub.subscription);
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Invalid stored push subscription';
          logger.warn(`Removing invalid stored push subscription ${sub.id}: ${reason}`, {
            subscriptionId: sub.id,
            userEmail: user.email,
          });
          ignoredPushFailures.push({
            subscriptionId: sub.id,
            reason,
          });
          subscriptionsToRemove.add(sub.id);
          continue;
        }

        try {
          const deliveryOptions = { ...options, badgeCount, subscriptionId: sub.id };

          // Format message based on subscription type (Safari vs standard)
          message = sub.isSafari
            ? this.formatSafariMessage(notification, deliveryOptions)
            : JSON.stringify({
              ...notification,
              approvalState: options.approvalState,
              approvalId: options.approvalId,
              tempAccessToken: options.tempAccessToken,
              badgeCount,
              subscriptionId: sub.id,
            });

          // Check message size
          if (new TextEncoder().encode(message).length > MAX_MESSAGE_SIZE) {
            logger.error(`Message size exceeds 4KB limit for notification: ${notification.id}`);
            failedPushes.push({
              subscriptionId: sub.id,
              reason: 'Message size exceeds 4KB limit',
            });
            await sendDeviceFallback(sub, 'web-push-message-too-large');
            continue;
          }
        } catch (error) {
          logger.error(`Failed to prepare push notification for subscription ${sub.id}:`, error);
          failedPushes.push({
            subscriptionId: sub.id,
            reason: error instanceof Error ? error.message : 'Invalid subscription payload',
          });
          await sendDeviceFallback(sub, 'web-push-message-prepare-failed');

          continue;
        }

        try {
          logger.debug(`Sending notification to subscription: ${sub.id} (isSafari: ${sub.isSafari})`);
          await webPushService.sendNotification(subscription, message, {
            ttl: DEFAULT_PUSH_TTL_SECONDS,
            topic: options.topic || 'Default',
            urgency: options.urgency || 'normal',
          });
        } catch (error) {
          const statusCode = getPushErrorStatusCode(error);
          if (isExpiredPushSubscriptionStatusCode(statusCode)) {
            const reason = getPushErrorReason(error, `Web Push subscription expired (${statusCode})`);
            logger.info(`Removing expired push subscription ${sub.id}: ${reason}`, {
              subscriptionId: sub.id,
              userEmail: user.email,
              statusCode,
            });
            ignoredPushFailures.push({
              subscriptionId: sub.id,
              reason,
            });
            subscriptionsToRemove.add(sub.id);
            continue;
          }

          logger.error(`Failed to send push notification to subscription ${sub.id}:`, error);
          failedPushes.push({
            subscriptionId: sub.id,
            reason: getPushErrorReason(error, 'Web Push send failed'),
          });

          await sendDeviceFallback(
            sub,
            'web-push-send-failed'
          );

          try {
            await this.db
              .update(subscriptions)
              .set({
                lastFailureAt: new Date(),
                lastStatusCode: statusCode,
                failureCount: (sub.failureCount || 0) + 1,
                updatedAt: new Date(),
              })
              .where(eq(subscriptions.id, sub.id));
          } catch (updateError) {
            logger.error(`Failed to update subscription failure state for ${sub.id}:`, updateError);
          }

          continue;
        }

        successfulPushes += 1;

        let attemptId: string | undefined;
        try {
          const attempt = await deliveryRetryService.createAttempt({
            notificationId: notification.id,
            subscriptionId: sub.id,
            userEmail: user.email,
          });
          attemptId = attempt.id;
        } catch (error) {
          logger.error(`Failed to create delivery attempt for subscription ${sub.id}:`, error);
        }

        try {
          await this.db
            .update(subscriptions)
            .set({
              lastSuccessAt: new Date(),
              lastStatusCode: null,
              failureCount: 0,
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, sub.id));
        } catch (error) {
          logger.error(`Failed to update subscription success state for ${sub.id}:`, error);
        }

        try {
          if (attemptId && await deliveryRetryService.shouldSendImmediateFallback(sub)) {
            const reason = sub.barkFallbackAlways ? 'always' : 'subscription-unhealthy';
            const sent = await deliveryRetryService.sendFallbackForAttempt(
              attemptId,
              notification,
              sub,
              reason,
              { urgency: options.urgency }
            );

            if (sent) {
              barkFallbackSent = true;
              barkFallbackReason ||= reason;
              barkFallbackError = undefined;
            } else if (!barkFallbackSent) {
              barkFallbackReason ||= reason;
              barkFallbackError ||= 'Bark fallback failed';
            }
          }
        } catch (error) {
          logger.error(`Failed to send immediate Bark fallback for subscription ${sub.id}:`, error);
          if (!barkFallbackSent) {
            barkFallbackReason ||= sub.barkFallbackAlways ? 'always' : 'subscription-unhealthy';
            barkFallbackError ||= error instanceof Error ? error.message : 'Bark fallback failed';
          }
        }
      }

      // Clean up invalid or expired subscriptions after the send loop so iteration stays stable.
      for (const subscriptionId of subscriptionsToRemove) {
        logger.debug(`Removing invalid or expired subscription: ${subscriptionId}`);
        const isDeleted = await subscriptionService.deleteSubscriptionById(subscriptionId);
        if (isDeleted) {
          removedSubscriptions += 1;
          logger.info(`Removed invalid or expired subscription: ${subscriptionId}`);
        } else {
          logger.error(`Failed to remove invalid or expired subscription: ${subscriptionId}`);
        }
      }

      if (successfulPushes > 0) {
        try {
          await this.recordWebPushSent(notification.id, user.email);
        } catch (error) {
          logger.error(`Failed to record Web Push sent time for notification ${notification.id}:`, error);
        }
      }

      // Always send server-sent event for new notifications
      try {
        await this.streamService.sendNewNotificationEvent(user.email, notification, {
          approvalState: options.approvalState,
          approvalId: options.approvalId,
        });
      } catch (error) {
        logger.error(`Error sending SSE event for notification ${notification.id}:`, error);
        // Continue execution as SSE failure should not affect the web push result
      }

      // Return result
      if (failedPushes.length > 0) {
        logger.warn(`Some push notifications failed to send for notification: ${notification.id}`, {
          failedCount: failedPushes.length,
          ignoredFailureCount: ignoredPushFailures.length,
          totalCount: userSubscriptions.length
        });
      }

      const onlyIgnoredSubscriptionFailures = ignoredPushFailures.length > 0 && failedPushes.length === 0;
      const deliverySucceeded = successfulPushes > 0 || barkFallbackSent || onlyIgnoredSubscriptionFailures;
      if (!deliverySucceeded) {
        const error = getNoDeliveryError(userSubscriptions.length, failedPushes, barkFallbackError);
        logger.warn(`No push delivery channel succeeded for notification: ${notification.id}`, {
          totalCount: userSubscriptions.length,
          failedCount: failedPushes.length,
          ignoredFailureCount: ignoredPushFailures.length,
          barkFallbackError,
        });

        return {
          success: false,
          error,
          successfulPushes,
          failedPushes,
          ignoredPushFailures: ignoredPushFailures.length > 0 ? ignoredPushFailures : undefined,
          removedSubscriptions: removedSubscriptions || undefined,
          notificationId: notification.id,
          approvalId: options.approvalId,
          barkFallbackSent,
          barkFallbackReason,
          barkFallbackError,
        };
      }

      logger.debug(`Push delivery succeeded for notification: ${notification.id}`, {
        successfulPushes,
        failedPushes: failedPushes.length,
        ignoredPushFailures: ignoredPushFailures.length,
        removedSubscriptions,
        barkFallbackSent,
      });
      return {
        success: true,
        notificationId: notification.id,
        approvalId: options.approvalId,
        successfulPushes,
        failedPushes: failedPushes.length > 0 ? failedPushes : undefined,
        ignoredPushFailures: ignoredPushFailures.length > 0 ? ignoredPushFailures : undefined,
        removedSubscriptions: removedSubscriptions || undefined,
        barkFallbackSent,
        barkFallbackReason,
        barkFallbackError,
      };
    } catch (error) {
      logger.error(`Error in push service for notification: ${notification.id}:`, error);
      const deliverySucceeded =
        successfulPushes > 0 ||
        barkFallbackSent ||
        (ignoredPushFailures.length > 0 && failedPushes.length === 0);

      return {
        success: deliverySucceeded,
        error: deliverySucceeded ? undefined : 'Internal Server Error',
        notificationId: notification.id,
        approvalId: options.approvalId,
        successfulPushes,
        failedPushes: failedPushes.length > 0 ? failedPushes : undefined,
        ignoredPushFailures: ignoredPushFailures.length > 0 ? ignoredPushFailures : undefined,
        removedSubscriptions: removedSubscriptions || undefined,
        barkFallbackSent,
        barkFallbackReason,
        barkFallbackError,
      };
    }
  }
}

function getPushErrorStatusCode(error: unknown): number | null {
  if (error instanceof Error && 'statusCode' in error) {
    const statusCode = (error as Error & { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number') {
      return statusCode;
    }
  }

  return null;
}

function getPushErrorReason(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isExpiredPushSubscriptionStatusCode(statusCode: number | null): boolean {
  return statusCode === 404 || statusCode === 410;
}

function parseStoredPushSubscription(subscriptionJson: string): PushSubscription {
  let parsed: unknown;

  try {
    parsed = JSON.parse(subscriptionJson);
  } catch {
    throw new Error('Stored push subscription JSON is invalid');
  }

  const invalidReason = getInvalidPushSubscriptionReason(parsed);
  if (invalidReason) {
    throw new Error(invalidReason);
  }

  return parsed as PushSubscription;
}

function getInvalidPushSubscriptionReason(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return 'Stored push subscription is not an object';
  }

  const subscription = value as {
    endpoint?: unknown;
    keys?: {
      auth?: unknown;
      p256dh?: unknown;
    };
  };

  if (typeof subscription.endpoint !== 'string' || !subscription.endpoint.trim()) {
    return 'Stored push subscription endpoint is missing';
  }

  try {
    new URL(subscription.endpoint);
  } catch {
    return 'Stored push subscription endpoint is invalid';
  }

  if (!subscription.keys || typeof subscription.keys !== 'object') {
    return 'Stored push subscription keys are missing';
  }

  if (typeof subscription.keys.auth !== 'string' || !subscription.keys.auth.trim()) {
    return 'Stored push subscription auth key is missing';
  }

  if (typeof subscription.keys.p256dh !== 'string' || !subscription.keys.p256dh.trim()) {
    return 'Stored push subscription p256dh key is missing';
  }

  return null;
}

function getNoDeliveryError(
  subscriptionCount: number,
  failedPushes: Array<{ subscriptionId: string; reason: string }>,
  barkFallbackError?: string
): string {
  if (barkFallbackError) {
    return `No Web Push delivery succeeded; Bark fallback failed: ${barkFallbackError}`;
  }

  if (subscriptionCount === 0) {
    return 'No active Web Push subscriptions';
  }

  if (failedPushes.length > 0) {
    return 'No push delivery channels succeeded';
  }

  return 'No push delivery channels configured';
}
