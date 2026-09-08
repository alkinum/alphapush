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

   Pages uses the top-level bindings for production and `env.preview` for preview branches such as `dev`. Older configs must rename `env.dev` to `env.preview`, remove `account_id`, and set `pages_build_output_dir` to `./dist/pages`. Choose the account through Wrangler login or `CLOUDFLARE_ACCOUNT_ID`; Pages rejects `account_id` in its config. The `db:migrate:dev` script targets the preview database.

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

1. Apply the D1 migrations for the environment being deployed:

   ```
   pnpm run db:migrate:dev
   pnpm run db:migrate:prod
   ```

2. Deploy one or both Cloudflare Pages environments:

   ```
   pnpm run deploy:dev
   pnpm run deploy:prod
   pnpm run deploy:all
   ```

   These commands build the Astro Workers output and repackage it into the `_worker.js` directory format required by Cloudflare Pages Advanced Mode.

   The preparation step also removes Astro's generated `.wrangler/deploy/config.json` redirect so Pages uses the project's `wrangler.jsonc`. The generated Workers config declares an `ASSETS` binding, which is reserved by Pages and prevents deployment. Run `pnpm run prepare:pages` after each build when deploying manually.

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

### Session persistence and delivery verification

GitHub authenticates the user at sign-in; the AlphaPush session is independent of the
GitHub access token. Sessions last 180 days and renew after six hours of activity.
SSR reads defer renewal. The same-origin `POST /api/session/keepalive` refreshes D1
and forwards all Better Auth cookies to the browser. Keep `BETTER_AUTH_SECRET`
(or Better Auth's `AUTH_SECRET` fallback) stable across deployments and instances;
changing it invalidates signed cookies. Browser and installed PWA cookie stores may
be separate, and clearing site data still requires a new sign-in.

The subscription repair alert checks only the current device. Registration and
push-service acceptance do not prove display; delivery receipts are recorded separately.
Transient network failures, HTTP 429, and HTTP 5xx get up to three transport attempts
with an eight-second timeout per request. Long `Retry-After` values stop inline retries
so the existing fallback path can take over; 404/410 remain terminal subscriptions.
Transport timeouts can be ambiguous: notification tags reduce duplicate display on
standard Web Push, but exactly-once delivery is not guaranteed.

The service worker persists failed delivery receipts for up to seven days (latest
100 entries), then retries on activation, new pushes, foreground/online events, and
Background Sync where available. Safari declarative push continues to use its
navigation receipt URL when the service worker does not run. Configure device-scoped
Bark fallback and the delivery retry cron Worker for critical notifications. OS Focus,
notification permissions, offline devices, and platform policies still affect delivery.

Run targeted regression checks with `node --test test/reliability.test.mjs`.
These cover session cookie renewal, transport retries, subscription preservation,
receipt replay, acknowledgement ordering, pagination races, and message HTML filtering.
Notification Markdown is sanitized before rendering; long content expands without an
overlay and the inbox retains loaded pages during background refresh.
Before release, manually verify on a signed-in desktop and installed iOS PWA:

- After a session becomes renewal-eligible, foreground the app and confirm keepalive
  returns session `Set-Cookie` headers; reload and confirm the account stays signed in.
- Send a test notification to each platform, verify display/open receipts and badge
  updates, then temporarily interrupt receipt requests and verify later replay.
- Change a device fingerprint or renew its endpoint and confirm the subscription ID
  and Bark settings remain intact. A failed registration request must retain local push.
- At mobile and desktop widths, verify inbox filtering, selection, account settings,
  and sender validation. Sender submission must generate only one push request.
