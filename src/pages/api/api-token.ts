import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { ApiTokenService } from '@/services/apiTokenService';
import type { ApiTokensResponse, CreateTokenBody, CreateTokenResponse } from '@/types/api-token';

const MAX_EXPIRY_DATE = new Date('2099-12-31');

function calculateExpiryDate(expiresIn: number): Date | null {
  if (expiresIn === 0) {
    return MAX_EXPIRY_DATE;
  }
  if (expiresIn < 1) {
    return null; // Invalid input
  }
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + expiresIn);
  return expiryDate;
}

function maskToken(token: string): string {
  if (token.length <= 8) return token;
  const visiblePart = 4;
  return token.slice(0, visiblePart) + '*'.repeat(token.length - 2 * visiblePart) + token.slice(-visiblePart);
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const apiTokenService = new ApiTokenService(locals.runtime.env.DB);

    const body = (await request.json()) as CreateTokenBody;
    const { name, expiresIn } = body;

    if (!name) {
      return new Response(JSON.stringify({ error: 'Token name is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const expiryDate = calculateExpiryDate(expiresIn);
    if (expiryDate === null) {
      return new Response(JSON.stringify({ error: 'Invalid expiration period. Minimum is 1 day.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const token = await apiTokenService.createToken(userEmail, name, expiryDate);

    const response: CreateTokenResponse = { token };
    return new Response(JSON.stringify(response), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error creating API token:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const apiTokenService = new ApiTokenService(locals.runtime.env.DB);

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '5', 10);

    if (isNaN(page) || page < 1 || isNaN(pageSize) || pageSize < 1) {
      return new Response(JSON.stringify({ error: 'Invalid page or pageSize' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { tokens, totalCount } = await apiTokenService.getTokens(userEmail, page, pageSize);

    // Calculate totalPages
    const totalPages = Math.ceil(totalCount / pageSize);

    // Mask the tokens before sending the response
    const maskedTokens = tokens.map((token) => ({
      ...token,
      token: maskToken(token.token),
    }));

    const response: ApiTokensResponse = {
      tokens: maskedTokens,
      pagination: {
        currentPage: page,
        pageSize,
        totalPages,
        totalCount,
      },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching API tokens:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userEmail = session.user.email;
    const apiTokenService = new ApiTokenService(locals.runtime.env.DB);

    const url = new URL(request.url);
    const tokenId = url.searchParams.get('id');

    if (!tokenId) {
      return new Response(JSON.stringify({ error: 'Token ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await apiTokenService.revokeToken(userEmail, tokenId);

    return new Response(JSON.stringify({ message: 'Token revoked successfully' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error revoking API token:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
