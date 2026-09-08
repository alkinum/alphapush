import { buildPushPayload, type PushSubscription, type PushMessage, type VapidKeys } from '@block65/webcrypto-web-push';

const DEFAULT_PUSH_TTL_SECONDS = 60 * 60 * 24 * 28;
const MAX_PUSH_ERROR_BODY_LENGTH = 500;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRY_DELAY_MS = 2000;

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
      options: { ttl: DEFAULT_PUSH_TTL_SECONDS, ...options },
    };

    const payload = await buildPushPayload(pushMessage, subscription, this.vapid);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await fetch(subscription.endpoint, {
          method: payload.method,
          headers: payload.headers,
          body: payload.body as BodyInit,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        if (attempt === MAX_ATTEMPTS - 1) throw error;
        await waitBeforeRetry(attempt);
        continue;
      }

      const retryable = response.status === 429 || response.status >= 500;
      const retryAfter = getRetryAfterMs(response.headers.get('Retry-After'));
      if (retryable && attempt < MAX_ATTEMPTS - 1 && retryAfter <= MAX_RETRY_DELAY_MS) {
        await response.body?.cancel();
        await waitBeforeRetry(attempt, retryAfter);
        continue;
      }

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
    return false;
  }
}

function getRetryAfterMs(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

async function waitBeforeRetry(attempt: number, minimum = 0): Promise<void> {
  const delay = Math.max(minimum, 250 * 2 ** attempt + Math.floor(Math.random() * 250));
  await new Promise((resolve) => setTimeout(resolve, delay));
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
