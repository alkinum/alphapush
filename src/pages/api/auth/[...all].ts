import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createAuth, isGitHubOAuthConfigured } from '@/lib/auth';

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isSocialSignInRequest(request: Request) {
  const url = new URL(request.url);
  return request.method === 'POST' && url.pathname.endsWith('/api/auth/sign-in/social');
}

export const ALL: APIRoute = async (context) => {
  const db = env.DB as D1Database | undefined;

  if (!db) {
    return jsonResponse({ error: 'Cloudflare D1 binding DB is not configured' }, 503);
  }

  if (isSocialSignInRequest(context.request) && !isGitHubOAuthConfigured()) {
    return jsonResponse(
      {
        error: 'GitHub OAuth is not configured',
        message: 'Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET before starting GitHub sign-in.',
      },
      503
    );
  }

  const auth = createAuth(db, { baseURL: context.url.origin });

  return auth.handler(context.request);
};
