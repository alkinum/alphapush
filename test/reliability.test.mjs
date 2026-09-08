import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import * as orm from 'drizzle-orm';
import * as sqliteCore from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import Database from 'better-sqlite3';
import * as vue from 'vue';
import sanitizeHtml from 'sanitize-html';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';

const quiet = { log() {}, debug() {}, info() {}, warn() {}, error() {} };
function loadTS(path, modules = {}, globals = {}) {
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8').replaceAll('import.meta.env', '({})');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = createContext({ exports: {}, console: quiet, URL, Headers, Request, Response, AbortSignal, TextEncoder, crypto, setTimeout, clearTimeout,
    require(name) { if (!(name in modules)) throw new Error('Unexpected import: ' + name); return modules[name]; }, ...globals });
  runInContext(compiled, context);
  return context.exports;
}

test('SSR does not consume renewal; keepalive renews the database and forwards session cookies', async () => {
  const db = new Database(':memory:');
  let options;
  const config = loadTS('src/lib/auth/config.ts', {
    'better-auth': { betterAuth(value) { options = value; return value; } },
    'better-auth/adapters/drizzle': { drizzleAdapter: () => db },
    '@paralleldrive/cuid2': { createId: () => crypto.randomUUID() },
    '@/db': { getDb: () => db }, '@/schema': {},
  });
  config.createAuth(db, { baseURL: 'http://localhost:4321' });
  options.secret = 'test-only-session-signing-secret-0123456789abcdef';
  options.emailAndPassword = { enabled: true };
  options.logger = { disabled: true };
  await (await getMigrations(options)).runMigrations();
  const auth = betterAuth(options);
  const signup = await auth.api.signUpEmail({ body: { email: 'test@example.com', name: 'Test', password: 'test-password-123456' }, returnHeaders: true });
  const cookie = signup.headers.getSetCookie().find(value => value.startsWith('better-auth.session_token=')).split(';')[0];
  const headers = new Headers({ cookie, origin: 'http://localhost:4321' });
  // Make the existing session due for renewal, without expiring it.
  const expiresAt = new Date(Date.now() + (options.session.expiresIn - options.session.updateAge - 60) * 1000);
  db.prepare('UPDATE session SET expiresAt = ?').run(expiresAt.toISOString());
  await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  assert.equal(db.prepare('SELECT expiresAt FROM session').get().expiresAt, expiresAt.toISOString());
  const route = loadTS('src/pages/api/session/keepalive.ts', {
    'cloudflare:workers': { env: { DB: db } }, '@/lib/auth': { createAuth: () => auth }, '@/utils/logger': { logger: quiet },
  });
  const request = new Request('http://localhost:4321/api/session/keepalive', { method: 'POST', headers });
  const response = await route.POST({ request, url: new URL(request.url) });
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some(value => value.startsWith('better-auth.session_token=') && value.includes('Max-Age=15552000')));
  assert.ok(cookies.some(value => value.startsWith('better-auth.session_data=')));
  assert.ok(new Date((await response.json()).expiresAt) > expiresAt);
  const crossSite = new Request(request.url, { method: 'POST', headers: { cookie, origin: 'https://other.example' } });
  assert.equal((await route.POST({ request: crossSite, url: new URL(request.url) })).status, 403);
  db.prepare('DELETE FROM session').run();
  assert.equal((await route.POST({ request, url: new URL(request.url) })).status, 401);
  db.close();
});

test('push transport retries transient failures and respects permanent errors and Retry-After', async () => {
  let responses = [];
  let calls = 0;
  let builtMessage;
  const { WebPushService } = loadTS('src/services/webPushService.ts', {
    '@block65/webcrypto-web-push': { buildPushPayload: async message => { builtMessage = message; return { method: 'POST', headers: {}, body: 'encrypted' }; } },
  }, { setTimeout: callback => { callback(); return 0; }, fetch: async () => { calls++; const result = responses.shift(); if (result instanceof Error) throw result; return result; } });
  const service = new WebPushService('public', 'private', 'mailto:test@example.com');
  const subscription = { endpoint: 'https://push.example/subscription' };
  responses = [new TypeError('offline'), new Response('', { status: 503 }), new Response('', { status: 201 })];
  assert.equal(await service.sendNotification(subscription, 'message', { urgency: 'high' }), true);
  assert.equal(calls, 3);
  assert.equal(builtMessage.options.ttl, 2419200);
  for (const status of [400, 401, 403, 404, 410, 413]) {
    calls = 0; responses = [new Response('invalid', { status })];
    await assert.rejects(service.sendNotification(subscription, 'message'), error => error.statusCode === status);
    assert.equal(calls, 1);
  }
  calls = 0; responses = [new Response('', { status: 429, headers: { 'Retry-After': '60' } })];
  await assert.rejects(service.sendNotification(subscription, 'message'), error => error.statusCode === 429);
  assert.equal(calls, 1);
  calls = 0; responses = [new Response('', { status: 429, headers: { 'Retry-After': '0' } }), new Response('', { status: 201 })];
  assert.equal(await service.sendNotification(subscription, 'message'), true);
  assert.equal(calls, 2);
});

test('fingerprint changes and failed server writes preserve the browser subscription', async () => {
  for (const safari of [false, true]) {
    let unsubscribed = 0;
    let uploaded;
    let ok = true;
    const storage = new Map([['userFingerprints', JSON.stringify({ 'test@example.com': 'old-fingerprint' })]]);
    const subscription = { endpoint: 'https://push.example/existing', options: {}, expirationTime: null, unsubscribe: async () => { unsubscribed++; } };
    const pushManager = { getSubscription: async () => subscription };
    const document = { body: { getAttribute: () => 'test@example.com' }, dispatchEvent() {} };
    const { subscribeWebPush } = loadTS('src/modules/pushSubscription.ts', {
      '@/lib/auth/client': {}, '@/components/ui/sonner/use-toast': { toast() {} },
      '@/utils/fingerprint': { getCombinedFingerprint: async () => 'new-fingerprint' }, '@/types/stream': {}, '@/lib/utils': { isSafari: () => safari },
    }, { document, window: safari ? { pushManager: { ...pushManager, subscribe() {} } } : { PushManager: {} },
      navigator: { serviceWorker: { ready: Promise.resolve({ pushManager }) } },
      localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
      CustomEvent: class {}, fetch: async (_url, init) => { uploaded = JSON.parse(init.body); return { ok, status: ok ? 200 : 503 }; },
    });
    assert.equal(await subscribeWebPush('public', { silent: true }), true);
    assert.equal(unsubscribed, 0);
    assert.equal(uploaded.subscription.endpoint, subscription.endpoint);
    assert.equal(uploaded.oldEndpoint, subscription.endpoint);
    assert.equal(uploaded.isSafari, safari);
    ok = false;
    assert.equal(await subscribeWebPush('public', { silent: true }), false);
    assert.equal(unsubscribed, 0);
  }
});

test('service worker queues failed receipts and replays them after a worker restart', async () => {
  const entries = new Map();
  const cache = { put: async (key, value) => entries.set(key, value), delete: async key => entries.delete(key), keys: async () => [...entries.keys()], match: async key => entries.get(key)?.clone() };
  let offline = true;
  const sent = [];
  function startWorker() {
    const context = createContext({ console: quiet, URL, Response, AbortSignal,
      caches: { open: async () => cache },
      self: { location: { origin: 'https://app.example' }, registration: {}, addEventListener() {} },
      fetch: async (_url, init) => { if (offline) throw new Error('offline'); sent.push(JSON.parse(init.body)); return new Response('{}'); },
    });
    runInContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
    return context;
  }
  await startWorker().reportDeliveryEvent('notification', 'displayed', 'subscription', 'attempt', 'receipt-token');
  assert.equal(entries.size, 1);
  await assert.rejects(startWorker().flushDeliveryReceipts(), /offline/);
  assert.equal(entries.size, 1);
  offline = false;
  await startWorker().flushDeliveryReceipts();
  assert.equal(entries.size, 0);
  assert.deepEqual(sent[0], { notificationId: 'notification', subscriptionId: 'subscription', attemptId: 'attempt', receiptToken: 'receipt-token', event: 'displayed' });
});


test('display then open receipts preserve timestamps and late fallback cannot overwrite acknowledgement', async () => {
  const sqlite = new Database(':memory:');
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  }
  const schema = loadTS('src/schema.ts', { 'drizzle-orm': orm, 'drizzle-orm/sqlite-core': sqliteCore, '@paralleldrive/cuid2': { createId: () => crypto.randomUUID() } }, { Date });
  const db = drizzle(sqlite);
  const { DeliveryRetryService } = loadTS('src/services/deliveryRetryService.ts', {
    'drizzle-orm': orm, '@/db': {}, '@/schema': schema,
    '@/services/barkFallbackService': {}, '@/services/notificationService': {},
  }, { Date });
  const email = 'test@example.com';
  db.insert(schema.pushNotifications).values({ id: 'notification', userEmail: email, content: 'test' }).run();
  db.insert(schema.subscriptions).values({ id: 'subscription', userEmail: email, deviceFingerprint: 'fingerprint', subscription: '{}' }).run();
  const service = new DeliveryRetryService(db);
  const attempt = await service.createAttempt({ notificationId: 'notification', subscriptionId: 'subscription', userEmail: email });
  assert.equal(await service.recordAck('notification', email, 'displayed', 'subscription', attempt.id), true);
  const before = sqlite.prepare('SELECT displayed_at, acked_at FROM push_delivery_attempts').get();
  assert.equal(await service.recordAck('notification', email, 'opened', 'subscription', attempt.id), true);
  assert.equal(await service.recordAck('notification', email, 'displayed', 'subscription', attempt.id), false);
  await service.updateAttemptFallbackResult(attempt.id, 'ack-timeout', true);
  const after = sqlite.prepare('SELECT displayed_at, acked_at, opened_at, status FROM push_delivery_attempts').get();
  assert.equal(after.displayed_at, before.displayed_at);
  assert.equal(after.acked_at, before.acked_at);
  assert.ok(after.opened_at);
  assert.equal(after.status, 'acked');
  assert.equal(await service.recordAck('notification', 'another@example.com', 'opened', 'subscription', attempt.id), false);
  sqlite.close();
});


test('pagination retries the failed page, deduplicates and preserves loaded pages during refresh', async () => {
  const requested = [];
  let fail = true;
  const { useNotificationsData } = loadTS('src/components/notification/composable/useNotificationsData.ts', {
    vue, '@/components/ui/sonner/use-toast': { useToast: () => ({ toast() {} }) },
  }, { AbortController, fetch: async url => {
    requested.push(new URL(url, 'https://app.example').searchParams.get('page'));
    if (fail) return new Response('', { status: 503 });
    return Response.json({ notifications: [{ id: 'one' }, { id: 'two' }, { id: 'two' }], totalPages: 3 });
  } });
  const data = useNotificationsData([{ id: 'one' }], 3);
  assert.equal(data.hasMoreNotifications.value, true);
  assert.equal(await data.loadMoreNotifications(), false);
  assert.equal(data.currentPage.value, 1);
  fail = false;
  assert.equal(await data.retryFetchNotifications(), true);
  assert.deepEqual(requested, ['2', '2']);
  assert.deepEqual(Array.from(data.notifications.value, n => n.id), ['one', 'two']);
  data.notifications.value = [...data.notifications.value, { id: 'three' }];
  await data.fetchNotifications(1, '', '', { preserveExisting: true });
  assert.equal(data.currentPage.value, 2);
  assert.ok(data.notifications.value.some(n => n.id === 'three'));
});

test('a stale filter failure cannot overwrite the latest successful result', async () => {
  let rejectOld;
  const { useNotificationsData } = loadTS('src/components/notification/composable/useNotificationsData.ts', {
    vue, '@/components/ui/sonner/use-toast': { useToast: () => ({ toast() {} }) },
  }, { AbortController, fetch: url => url.includes('group=old')
    ? new Promise((_resolve, reject) => { rejectOld = reject; })
    : Promise.resolve(Response.json({ notifications: [{ id: 'new' }], totalPages: 1 })) });
  const data = useNotificationsData();
  const oldRequest = data.fetchNotifications(1, 'old');
  await data.fetchNotifications(1, 'new');
  rejectOld(new Error('old request failed after navigation'));
  await oldRequest;
  assert.equal(data.isLoadFailed.value, false);
  assert.equal(data.isLoading.value, false);
  assert.equal(data.notifications.value[0].id, 'new');
});

test('message HTML keeps Markdown and code formatting while removing executable markup', () => {
  const { sanitizeNotificationHtml } = loadTS('src/utils/notificationHtml.ts', { 'sanitize-html': sanitizeHtml });
  const result = sanitizeNotificationHtml('<p><strong>Title</strong><a href="javascript:alert(1)">unsafe</a></p><img src="https://example.com/image.png" onerror="alert(1)"><script>alert(1)</script><style>body{display:none}</style><svg onload="alert(1)"></svg><pre class="code-block"><code class="hljs language-js"><span class="hljs-keyword">const</span></code></pre>');
  assert.match(result, /<strong>Title<\/strong>/);
  assert.match(result, /hljs-keyword/);
  assert.match(result, /https:\/\/example.com\/image.png/);
  assert.doesNotMatch(result, /javascript:|onerror|<script|<style|<svg|alert\(1\)/);
});
