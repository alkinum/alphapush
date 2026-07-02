import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createAuth } from '@/lib/auth';

export const ALL: APIRoute = async (context) => {
  const auth = createAuth(env.DB);

  return auth.handler(context.request);
};
