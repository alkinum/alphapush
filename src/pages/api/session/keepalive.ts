import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { logger } from '@/utils/logger';

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

export const POST: APIRoute = async (context) => {
  try {
    const session = await getSession(context.request, env.DB, { disableCookieCache: true });

    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        expiresAt: session.session.expiresAt,
      }),
      {
        status: 200,
        headers: jsonHeaders,
      },
    );
  } catch (error) {
    logger.error('Session keepalive failed:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
};

export const GET = POST;
