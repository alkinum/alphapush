import type { Config } from 'drizzle-kit';

const { DB_ID, D1_TOKEN, CLOUDFLARE_ACCOUNT_ID } = process.env;
const hasRemoteCredentials = !!DB_ID && !!D1_TOKEN && !!CLOUDFLARE_ACCOUNT_ID;

export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  ...(hasRemoteCredentials && {
    driver: 'd1-http' as const,
    dbCredentials: {
      databaseId: DB_ID,
      token: D1_TOKEN,
      accountId: CLOUDFLARE_ACCOUNT_ID,
    },
  }),
} satisfies Config;
