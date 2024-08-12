import type { Config } from 'drizzle-kit';

const { DB_ID, D1_TOKEN, CLOUDFLARE_ACCOUNT_ID } = process.env;

const validateDbCredentials = () => {
  if (!DB_ID || !D1_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('DB_ID, D1_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set.');
  }
};

validateDbCredentials();

export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    databaseId: DB_ID!,
    token: D1_TOKEN!,
    accountId: CLOUDFLARE_ACCOUNT_ID!,
  },
} satisfies Config;
