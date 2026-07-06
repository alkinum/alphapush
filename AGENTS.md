# AlphaPush Agent Guide

This file is the canonical project guide for AI agents and automation working in this repository.

## Project Snapshot

- AlphaPush is an Astro server-rendered app deployed to Cloudflare Pages.
- The frontend uses Vue 3 components, Tailwind CSS 4, and a custom PWA service worker in `public/sw.js`.
- Runtime state lives in Cloudflare D1 and KV. Database schema is defined in `src/schema.ts` and migrations live in `migrations/`.
- Push delivery is handled by `src/services/pushService.ts`, Web Push helpers, delivery receipt APIs, and `src/services/deliveryRetryService.ts`.
- Delivery retry fallback is split between the Pages API route `src/pages/api/delivery-retries/process.ts` and the standalone cron Worker in `workers/delivery-retries.ts`.
- `packages/encryption` is a pnpm workspace package consumed by the main app.

## Shell And Tooling

- When running shell commands from Codex, prefix commands with `rtk`.
- Use `rg` or `rg --files` for searching whenever possible.
- Package manager is pnpm. Do not introduce npm, yarn, or bun lockfiles.
- Common commands:
  - `pnpm install`
  - `pnpm run dev`
  - `pnpm run type-check`
  - `pnpm run build`
  - `pnpm run db:generate`
  - `pnpm run db:migrate:local`
  - `pnpm run db:migrate:prod`
  - `pnpm run workers:list`
  - `pnpm run worker:delivery-retries:deploy`

## Commit Rules

- Use `type(scope): description`.
- Keep `type` lowercase. Prefer `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, or `ci`.
- Keep `scope` short, lowercase, and project-specific, for example `push`, `workers`, `notifications`, `db`, `auth`, `ui`, or `docs`.
- Write the description in imperative English and keep it concise.
- Split unrelated work into separate commits. Keep generated migrations with the schema or feature that requires them.
- Examples:
  - `feat(push): add delivery acknowledgement retries`
  - `fix(auth): preserve session during keepalive`
  - `chore(workers): update delivery retry deploy script`
  - `docs(agents): document development conventions`

## Development Conventions

- Keep changes scoped to the feature being touched. Avoid opportunistic rewrites.
- Use the `@/*` import alias for source imports.
- API routes should validate the session with `getSessionFromContext` when user identity is required.
- Use `getDb(env.DB)` for D1 access in API routes and services.
- Return JSON responses with explicit status codes and `Content-Type: application/json`.
- Use the existing `logger` utility for server-side operational errors.
- Do not commit secrets or local deployment config. Commit templates such as `wrangler.template.jsonc` and `wrangler.*.template.toml`; keep real `wrangler.jsonc` and `wrangler.*.toml` local.
- If Cloudflare bindings or Worker config changes, update the relevant template and README/developer guidance in the same change.

## Database And Migrations

- Update `src/schema.ts` and `migrations/` together.
- Prefer `pnpm run db:generate` for Drizzle migrations.
- If a migration is adjusted manually, keep `migrations/meta/_journal.json` and the snapshot files consistent.
- Apply local migrations with `pnpm run db:migrate:local` before relying on new columns or tables in local dev.

## Push And Notification Rules

- Keep Web Push payloads under `MAX_MESSAGE_SIZE` in `src/services/pushService.ts`.
- Preserve `subscriptionId` through push payloads, Safari declarative push URLs, delivery receipts, and notification click handling.
- Bark fallback settings are device/subscription-scoped. Do not reintroduce account-level exposure of Bark device keys in user preference responses.
- Delivery acknowledgements, unread counts, app badge state, and retry attempts are coupled. Update service worker, API routes, schema, and UI state together when this flow changes.
- Service worker changes in `public/sw.js` should continue to support both standard Web Push and Safari declarative push behavior.

## Frontend Conventions

- Keep reusable Vue UI in `src/components/`, browser modules in `src/modules/`, shared services in `src/services/`, and shared types in `src/types/`.
- Prefer existing composables and UI primitives over introducing new patterns.
- Keep user-facing notification state synchronized through existing custom events such as `alphapush:new-notification` and `alphapush:notifications-read`.
- Use Tailwind utility classes consistently with the existing component style.

## Verification

- Run `pnpm run type-check` before committing TypeScript, Astro, Vue, API, Worker, or schema changes.
- Run `pnpm run build` before release-oriented changes or broad refactors.
- For Worker deploy changes, run `pnpm run workers:list` and, when a local Worker config exists, `node scripts/deploy-workers.mjs --worker delivery-retries --env production --dry-run`.
- This repository currently has no dedicated app test suite. Add targeted tests or manual verification notes when changing risky behavior.
