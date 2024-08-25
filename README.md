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
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:

   ```
   GITHUB_CLIENT_ID=your_github_client_id
   GITHUB_CLIENT_SECRET=your_github_client_secret
   ```

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

3. Note the database ID from the output and add it to your `.env` file:

   ```
   DB_ID=your_database_id
   ```

4. Generate the database schema:

   ```
   npm run db:generate
   ```

5. Apply migrations to your local development database:

   ```
   npm run db:migrate:local
   ```

6. Apply migrations to your production database:

   ```
   npm run db:migrate:prod
   ```

### Development

1. Start the development server:

   ```
   npm run dev
   ```

2. Open the link to the page from local dev server in your browser.

### Deployment

1. Build the project:

   ```
   npm run build
   ```

2. Deploy to Cloudflare Pages:

   ```
   npm run deploy
   ```

### AI-Assisted Development

This project utilizes AI-generated code to enhance development efficiency. We leverage advanced language models to assist with code generation, problem-solving, and optimization. While AI contributes to our development process, all code is reviewed and validated by human developers to ensure quality and reliability.

For information about upcoming features and our development roadmap, see the [Roadmap](#roadmap) section below.

## Roadmap

### Future Plans

- Add email authentication method
- Allow to filter notifications by category
- Add TTL (Time To Live) option for notifications
- Enable pushing encrypted notifications
- Implement a settings panel for users to reset push token and VAPID keys

For more detailed information about our development plans and progress, please check our [full roadmap](./Roadmap.md).

## License

AlphaPush is open-sourced under the MIT license. See the LICENSE file for more information.
