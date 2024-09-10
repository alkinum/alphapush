import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { apiTokens } from '@/schema';
import type { D1Database } from '@cloudflare/workers-types';
import { createId } from '@paralleldrive/cuid2';
import type { ApiToken } from '@/types/api-token';

async function sha256(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class ApiTokenService {
  private db: ReturnType<typeof getDb>;

  constructor(d1: D1Database) {
    this.db = getDb(d1);
  }

  async createToken(userEmail: string, name: string, expiresAt?: Date): Promise<string> {
    const rawToken = createId();
    const token = await sha256(rawToken);
    await this.db.insert(apiTokens).values({
      userEmail,
      token,
      name,
      expiresAt,
    });
    // we need to return hash here
    return token;
  }

  async revokeToken(userEmail: string, tokenId: string): Promise<void> {
    await this.db
      .delete(apiTokens)
      .where(eq(apiTokens.id, tokenId) && eq(apiTokens.userEmail, userEmail))
      .run();
  }

  async getTokens(
    userEmail: string,
    page: number,
    pageSize: number,
  ): Promise<{ tokens: ApiToken[]; totalCount: number }> {
    const offset = (page - 1) * pageSize;

    const tokensQuery = this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userEmail, userEmail))
      .limit(pageSize)
      .offset(offset);

    const countQuery = this.db
      .select({ count: sql<number>`count(*)` })
      .from(apiTokens)
      .where(eq(apiTokens.userEmail, userEmail));

    const [tokens, [{ count }]] = await Promise.all([tokensQuery.all(), countQuery.all()]);

    return {
      tokens: tokens.map((token) => ({
        ...token,
        expiresAt: token.expiresAt ? Math.floor(new Date(token.expiresAt).getTime() / 1000) : null,
      })),
      totalCount: count,
    };
  }

  async validateToken(token: string): Promise<boolean> {
    const hashedToken = await sha256(token);
    const result = await this.db
      .select({ id: apiTokens.id, expiresAt: apiTokens.expiresAt })
      .from(apiTokens)
      .where(eq(apiTokens.token, hashedToken))
      .get();

    if (!result) return false;

    if (result.expiresAt && new Date(result.expiresAt) < new Date()) {
      // Token has expired, delete it
      await this.db.delete(apiTokens).where(eq(apiTokens.id, result.id)).run();
      return false;
    }

    return true;
  }
}
