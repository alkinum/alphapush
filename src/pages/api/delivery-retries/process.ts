import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getDb } from '@/db';
import { DeliveryRetryService } from '@/services/deliveryRetryService';
import { logger } from '@/utils/logger';

type DeliveryRetryEnv = typeof env & {
  DELIVERY_RETRY_SECRET?: string;
};

const deliveryRetryEnv = env as DeliveryRetryEnv;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function isAuthorized(request: Request): boolean {
  const secret = deliveryRetryEnv.DELIVERY_RETRY_SECRET;
  if (!secret) {
    return false;
  }

  const authorization = request.headers.get('Authorization') || '';
  const cronSecret = request.headers.get('x-cron-secret') || '';
  return authorization === `Bearer ${secret}` || cronSecret === secret;
}

export const POST: APIRoute = async (context) => {
  try {
    if (!deliveryRetryEnv.DELIVERY_RETRY_SECRET) {
      return jsonResponse({ error: 'DELIVERY_RETRY_SECRET is not configured' }, 503);
    }

    if (!isAuthorized(context.request)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const url = new URL(context.request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || '50'), 1), 200);
    const deliveryRetryService = new DeliveryRetryService(getDb(env.DB), env);
    const result = await deliveryRetryService.processDueFallbacks(limit);

    return jsonResponse({ success: true, ...result });
  } catch (error) {
    logger.error('Error processing delivery retries:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};
