interface Env {
  APP_ORIGIN: string;
  DELIVERY_RETRY_SECRET: string;
  DELIVERY_RETRY_LIMIT?: string;
  DELIVERY_RETRY_REQUEST_TIMEOUT_MS?: string;
}

interface DeliveryRetryResult {
  success?: boolean;
  processed?: number;
  fallbackSent?: number;
  fallbackFailed?: number;
  skipped?: number;
  error?: string;
}

const DEFAULT_RETRY_LIMIT = 50;
const MAX_RETRY_LIMIT = 200;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const configError = getConfigError(env);
    if (configError) {
      console.error(`[delivery-retries] ${configError}`);
      controller.noRetry();
      return;
    }

    await processDeliveryRetries(env, {
      source: 'cron',
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    });
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return jsonResponse({
        ok: true,
        configured: !getConfigError(env),
      });
    }

    if (url.pathname !== '/run' || request.method !== 'POST') {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    const configError = getConfigError(env);
    if (configError) {
      return jsonResponse({ error: configError }, 503);
    }

    if (!await isAuthorized(request, env)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    try {
      const result = await processDeliveryRetries(env, { source: 'manual' });
      return jsonResponse({ success: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process delivery retries';
      return jsonResponse({ error: message }, 502);
    }
  },
};

async function processDeliveryRetries(
  env: Env,
  meta: {
    source: 'cron' | 'manual';
    cron?: string;
    scheduledTime?: number;
  }
): Promise<DeliveryRetryResult> {
  const startedAt = Date.now();
  const endpoint = buildProcessEndpoint(env);
  console.log('[delivery-retries] start', meta);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DELIVERY_RETRY_SECRET}`,
    },
    signal: AbortSignal.timeout(getRequestTimeoutMs(env)),
  });

  const result = await parseRetryResponse(response);
  const durationMs = Date.now() - startedAt;

  if (!response.ok || result.success === false) {
    console.error('[delivery-retries] failed', {
      status: response.status,
      durationMs,
      error: result.error,
      ...meta,
    });
    throw new Error(result.error || `Delivery retry endpoint returned ${response.status}`);
  }

  console.log('[delivery-retries] complete', {
    status: response.status,
    durationMs,
    processed: result.processed,
    fallbackSent: result.fallbackSent,
    fallbackFailed: result.fallbackFailed,
    skipped: result.skipped,
    ...meta,
  });

  return result;
}

function buildProcessEndpoint(env: Env): string {
  const origin = env.APP_ORIGIN.replace(/\/+$/, '');
  const url = new URL('/api/delivery-retries/process', origin);
  url.searchParams.set('limit', String(getRetryLimit(env)));
  return url.toString();
}

function getRetryLimit(env: Env): number {
  const parsed = Number.parseInt(env.DELIVERY_RETRY_LIMIT || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RETRY_LIMIT;
  }

  return Math.min(parsed, MAX_RETRY_LIMIT);
}

function getRequestTimeoutMs(env: Env): number {
  const parsed = Number.parseInt(env.DELIVERY_RETRY_REQUEST_TIMEOUT_MS || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  return Math.min(Math.max(parsed, 1_000), 60_000);
}

function getConfigError(env: Env): string | null {
  if (!env.APP_ORIGIN) {
    return 'APP_ORIGIN is not configured';
  }

  try {
    const origin = new URL(env.APP_ORIGIN);
    if (origin.protocol !== 'https:' && origin.protocol !== 'http:') {
      return 'APP_ORIGIN must use http or https';
    }
  } catch {
    return 'APP_ORIGIN is invalid';
  }

  if (!env.DELIVERY_RETRY_SECRET) {
    return 'DELIVERY_RETRY_SECRET is not configured';
  }

  return null;
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const authorization = request.headers.get('Authorization') || '';
  const cronSecret = request.headers.get('x-cron-secret') || '';
  return await secretsEqual(authorization, `Bearer ${env.DELIVERY_RETRY_SECRET}`) ||
    await secretsEqual(cronSecret, env.DELIVERY_RETRY_SECRET);
}

async function secretsEqual(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
  };
  return subtle.timingSafeEqual(providedHash, expectedHash);
}

async function parseRetryResponse(response: Response): Promise<DeliveryRetryResult> {
  try {
    return (await response.json()) as DeliveryRetryResult;
  } catch {
    return {
      success: response.ok,
      error: response.ok ? undefined : `Delivery retry endpoint returned ${response.status}`,
    };
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
