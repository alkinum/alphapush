import { getDb } from '@/db';
import { PushService } from '@/services/pushService';
import { NotificationService } from '@/services/notificationService';
import type { PushResult, PushServiceEnv } from '@/services/pushService';
import { logger } from '@/utils/logger';

export interface BarkParams {
  title?: string;
  subtitle?: string;
  body: string;
  category?: string;
  group?: string;
  icon?: string;
  sound?: string;
  url?: string;
  isArchive?: boolean;
  level?: 'active' | 'timeSensitive' | 'passive' | 'critical';
  badge?: number;
  autoCopy?: string;
  copy?: string;
}

export class BarkEndpointService {
  private pushService: PushService;
  private notificationService: NotificationService;

  constructor(db: ReturnType<typeof getDb>, env: PushServiceEnv) {
    this.pushService = new PushService(db, env);
    this.notificationService = new NotificationService(db);
  }

  /**
   * Process a Bark push notification request
   */
  async processBarkPush(pushToken: string, params: BarkParams): Promise<PushResult> {
    logger.debug('Processing Bark push', {
      hasTitle: !!params.title,
      hasSubtitle: !!params.subtitle,
      level: params.level
    });

    try {
      // Validate push token
      const user = await this.pushService.validatePushToken(pushToken);
      if (!user) {
        logger.error('Invalid push token');
        return { success: false, error: 'Invalid push token' };
      }

      // Convert Bark parameters to our notification format
      const notificationData = {
        content: params.body,
        title: params.title,
        subtitle: params.subtitle,
        category: params.level || params.category,
        notification_group: params.group,
        userEmail: user.email,
        iconUrl: params.icon,
        navigate_url: params.url,
        type: params.level === 'critical' ? 'critical' : undefined,
        extraInfo: this.buildExtraInfo(params),
      };

      logger.debug(`Creating notification from Bark parameters for user: ${user.email}`, {
        category: notificationData.category,
        type: notificationData.type
      });

      // Insert notification directly using notificationService
      const notification = await this.notificationService.createNotification(notificationData);

      if (!notification) {
        logger.error(`Failed to create notification from Bark push for user: ${user.email}`);
        throw new Error('Failed to create notification');
      }

      // Handle webhook URL if present
      let approvalId: string | undefined;
      let tempAccessToken: string | undefined;

      if (params.url && notificationData.type === 'approval-process') {
        logger.debug(`Creating approval process for notification: ${notification.id} with URL: ${params.url}`);
        try {
          const result = await this.pushService.createApprovalProcess(
            notification,
            params.url,
            user.email
          );
          approvalId = result.approvalId;
          tempAccessToken = result.tempAccessToken;
        } catch (error) {
          logger.error(`Failed to create approval process for notification: ${notification.id}`, {
            error: (error as Error).message
          });
          return { success: false, error: (error as Error).message };
        }
      }

      // Send push notifications
      logger.debug(`Sending push notifications for Bark request: ${notification.id}`);
      return await this.pushService.sendPushNotifications(
        user,
        notification,
        {
          approvalId,
          tempAccessToken,
          approvalState: notificationData.type === 'approval-process' ? 'pending' : undefined,
          topic: undefined,
          urgency: params.level === 'critical' ? 'high' : 'normal',
        }
      );
    } catch (error) {
      logger.error('Error in Bark push service:', error);
      return { success: false, error: 'Internal Server Error' };
    }
  }

  /**
   * Build extra info JSON from Bark parameters
   */
  private buildExtraInfo(params: BarkParams): string | null {
    const extraInfo: Record<string, unknown> = {};
    let hasExtra = false;

    if (params.sound) {
      extraInfo.sound = params.sound;
      hasExtra = true;
    }

    if (params.isArchive !== undefined) {
      extraInfo.isArchive = params.isArchive;
      hasExtra = true;
    }

    if (params.badge !== undefined) {
      extraInfo.badge = params.badge;
      hasExtra = true;
    }

    if (params.autoCopy) {
      extraInfo.autoCopy = params.autoCopy;
      hasExtra = true;
    }

    if (params.copy) {
      extraInfo.copy = params.copy;
      hasExtra = true;
    }

    logger.debug('Built extra info from Bark parameters', {
      hasExtra,
      extraKeys: hasExtra ? Object.keys(extraInfo) : []
    });

    return hasExtra ? JSON.stringify(extraInfo) : null;
  }
} 
