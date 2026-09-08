import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createAuth } from '@/lib/auth';
import { logger } from '@/utils/logger';

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

export const POST: APIRoute = async (context) => {
  try {
    const origin = context.request.headers.get('origin');
    if ((origin && origin !== context.url.origin) || context.request.headers.get('sec-fetch-site') === 'cross-site') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: jsonHeaders });
    }

    const auth = createAuth(env.DB, { baseURL: context.url.origin });
    const { response: session, headers } = await auth.api.getSession({
      method: 'POST',
      headers: context.request.headers,
      query: { disableCookieCache: true },
      returnHeaders: true,
    });
    // Forward every cookie, including chunked session caches and expired cookies.
    const responseHeaders = new Headers(jsonHeaders);
    for (const cookie of headers.getSetCookie()) {
      responseHeaders.append('Set-Cookie', cookie);
    }

    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: responseHeaders,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        expiresAt: session.session.expiresAt,
      }),
      {
        status: 200,
        headers: responseHeaders,
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
