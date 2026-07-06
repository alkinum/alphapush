import { buildPushPayload, type PushSubscription, type PushMessage, type VapidKeys } from '@block65/webcrypto-web-push';

const DEFAULT_PUSH_TTL_SECONDS = 60 * 60 * 24 * 28;
const MAX_PUSH_ERROR_BODY_LENGTH = 500;

export interface WebPushHttpError extends Error {
  statusCode: number;
  statusText: string;
  responseBody?: string;
}

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
      options: options || { ttl: DEFAULT_PUSH_TTL_SECONDS },
    };

    const payload = await buildPushPayload(pushMessage, subscription, this.vapid);

    const response = await fetch(subscription.endpoint, {
      method: payload.method,
      headers: payload.headers,
      body: payload.body as BodyInit,
    });

    if (!response.ok) {
      const responseBody = await readResponseBody(response);
      const statusText = response.statusText || 'Unknown status';
      const bodySuffix = responseBody ? `: ${responseBody}` : '';
      const error = new Error(`Web Push endpoint returned ${response.status} ${statusText}${bodySuffix}`) as WebPushHttpError;
      error.statusCode = response.status;
      error.statusText = statusText;
      error.responseBody = responseBody;
      throw error;
    }

    return true;
  }
}

async function readResponseBody(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.text()).trim();
    if (!body) {
      return undefined;
    }

    return body.length > MAX_PUSH_ERROR_BODY_LENGTH
      ? `${body.slice(0, MAX_PUSH_ERROR_BODY_LENGTH)}...`
      : body;
  } catch {
    return undefined;
  }
}
