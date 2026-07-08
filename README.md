# AlphaPush

AlphaPush is a general-purpose push notification service with a PWA client, based on Cloudflare's edge infrastructure.

## For Users

### Getting Started

1. Visit the AlphaPush website (URL to be added).
2. Sign in using your GitHub account.
3. Allow notifications when prompted.
4. Copy your unique push token from your user profile.
5. Use this token to send push notifications to your devices.

### Features

- Instant push notifications to multiple devices
- PWA support for easy installation on mobile and desktop
- Secure authentication via GitHub
- User-specific push tokens for targeted notifications

## For Developers

### Prerequisites

- Node.js (v20 or later) with latest npm
- Cloudflare account
- GitHub account (for OAuth authentication)

### Setup

1. Clone the repository:

   ```
   git clone https://github.com/alkinum/alphapush.git
   cd alphapush
   ```

2. Install dependencies:

   ```
   pnpm install
   ```

3. Create an OAuth application in your GitHub account and get the client ID and client secret.

4. Create a `.env` file in the root directory with the following variables:

   ```
   GITHUB_CLIENT_ID=your_github_client_id
   GITHUB_CLIENT_SECRET=your_github_client_secret
   ```

   For local development, set the OAuth callback URL in GitHub to `http://localhost:4321/api/auth/callback/github`.

### Database Configuration

AlphaPush uses Cloudflare D1 for its database. Follow these steps to set it up:

1. Log in to your Cloudflare account:

   ```
   wrangler login
   ```

2. Create a D1 database:

   ```
   wrangler d1 create alphapush-prod
   ```

3. Generate drizzle migrations:

   ```
   pnpm run db:generate
   ```

4. Apply migrations to your production database:

   ```
   pnpm run db:migrate:prod
   ```

5. Create a KV namespace:

   ```
   wrangler kv:namespace create alphapush
   ```

6. Create your local Wrangler config from the tracked template:

   ```
   cp wrangler.template.jsonc wrangler.jsonc
   ```

   Edit `wrangler.jsonc` for your own Cloudflare Pages project. The tracked template declares the required `DB`, `KV`, and `SESSION` bindings; keep those binding names intact. The real `wrangler.jsonc` is ignored by git; only `wrangler.template.jsonc` should be committed.

7. Apply migrations to the local D1 database before starting the app:

   ```
   pnpm run db:migrate:local
   ```

8. Setup the environment variables:

   ```
   DB_ID=your_database_id
   ```

### Development

1. Start the development server:

   ```
   pnpm run dev
   ```

2. Open the link to the page from local dev server in your browser.

### Deployment

1. Build the project:

   ```
   pnpm run build
   ```

2. Deploy to Cloudflare Pages:

   ```
   pnpm run deploy:prod
   ```

3. Configure the delivery retry shared secret for both the Pages app and the cron Worker:

   ```
   cp wrangler.delivery-retries.template.toml wrangler.delivery-retries.toml
   ```

   Edit `wrangler.delivery-retries.toml` for your Cloudflare account and deployment origin. This local file is ignored by git; only the template should be committed.

   ```
   wrangler pages secret put DELIVERY_RETRY_SECRET --project-name your-pages-project
   wrangler secret put DELIVERY_RETRY_SECRET -c wrangler.delivery-retries.toml --env production
   ```

4. Deploy the delivery retry cron Worker:

   ```
   pnpm run worker:delivery-retries:deploy
   ```

   The Worker runs every 5 minutes and calls the protected `/api/delivery-retries/process` endpoint. Cron schedules are UTC and can take several minutes to propagate after deployment.

### AI-Assisted Development

This project utilizes AI-generated code to enhance development efficiency. We leverage advanced language models to assist with code generation, problem-solving, and optimization. While AI contributes to our development process, all code is reviewed and validated by human developers to ensure quality and reliability.

For information about upcoming features and our development roadmap, see the [Roadmap](#roadmap) section below.

## Roadmap

### Future Plans

- Add email authentication method
- Allow to filter notifications by category
- Add TTL (Time To Live) option for notifications

For more detailed information about our development plans and progress, please check our [full roadmap](./Roadmap.md).

## License

AlphaPush is open-sourced under the MIT license. See the LICENSE file for more information.
