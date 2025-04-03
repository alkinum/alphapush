import { logger } from '@/utils/logger';
import { sendSSEvent } from '@/pages/api/stream';
import type { Notification } from '@/types/notification';

/**
 * Service for handling all Server-Sent Events (SSE) operations
 */
export class StreamService {
  /**
   * Send a notification created event
   * @param userEmail User's email
   * @param notification The notification object
   * @param options Additional options for the event
   */
  async sendNewNotificationEvent(
    userEmail: string,
    notification: Notification,
    options?: {
      approvalId?: string;
      approvalState?: string;
    }
  ): Promise<void> {
    logger.debug(`Sending SSE new notification event for notification: ${notification.id}`);
    try {
      sendSSEvent(userEmail, 'newNotification', {
        ...notification,
        approvalState: options?.approvalState,
        approvalId: options?.approvalId,
      });
      logger.debug(`Successfully sent SSE new notification event for notification: ${notification.id}`);
    } catch (error) {
      logger.error(`Error sending SSE new notification event for notification ${notification.id}:`, error);
    }
  }

  /**
   * Send a notification updated event
   * @param userEmail User's email
   * @param notification The updated notification
   */
  async sendUpdateNotificationEvent(userEmail: string, notification: Notification): Promise<void> {
    logger.debug(`Sending SSE update event for notification: ${notification.id}`);
    try {
      sendSSEvent(userEmail, 'updateNotification', notification);
      logger.debug(`Successfully sent SSE update event for notification: ${notification.id}`);
    } catch (error) {
      logger.error(`Error sending SSE update event for notification ${notification.id}:`, error);
    }
  }

  /**
   * Send a notification deleted event
   * @param userEmail User's email
   * @param notificationId Deleted notification ID
   */
  async sendDeleteNotificationEvent(userEmail: string, notificationId: string): Promise<void> {
    logger.debug(`Sending SSE delete event for notification: ${notificationId}`);
    try {
      sendSSEvent(userEmail, 'deleteNotification', { id: notificationId });
      logger.debug(`Successfully sent SSE delete event for notification: ${notificationId}`);
    } catch (error) {
      logger.error(`Error sending SSE delete event for notification ${notificationId}:`, error);
    }
  }

  /**
   * Send an approval state changed event
   * @param userEmail User's email
   * @param notificationId Notification ID
   * @param approvalId Approval process ID
   * @param state New approval state
   */
  async sendApprovalStateChangedEvent(
    userEmail: string,
    notificationId: string,
    approvalId: string,
    state: string
  ): Promise<void> {
    logger.debug(`Sending SSE approval state changed event for notification: ${notificationId}`);
    try {
      sendSSEvent(userEmail, 'approvalStateChanged', {
        notificationId,
        approvalId,
        state,
      });
      logger.debug(`Successfully sent SSE approval state changed event for notification: ${notificationId}`);
    } catch (error) {
      logger.error(`Error sending SSE approval state changed event for notification ${notificationId}:`, error);
    }
  }
}
