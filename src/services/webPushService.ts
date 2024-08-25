import { buildPushPayload, type PushSubscription, type PushMessage, type VapidKeys } from '@block65/webcrypto-web-push';

export class WebPushService {
  private vapid: VapidKeys;

  constructor(vapidPublicKey: string, vapidPrivateKey: string, vapidSubject: string) {
    this.vapid = {
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: vapidSubject,
    };
  }

  async sendNotification(subscription: PushSubscription, message: string, options?: PushMessage['options']) {
    const pushMessage: PushMessage = {
      data: message,
      options: options || { ttl: 60 },
    };

    try {
      const payload = await buildPushPayload(pushMessage, subscription, this.vapid);

      const response = await fetch(subscription.endpoint, payload);

      if (!response.ok) {
        const error = new Error(`HTTP error! status: ${response.status}`);
        (error as any).statusCode = response.status;
        throw error;
      }

      return true;
    } catch (error) {
      console.error('Error sending Web Push notification:', error);
      throw error;
    }
  }
}