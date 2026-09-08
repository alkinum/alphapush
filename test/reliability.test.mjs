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
import { parse as parseYaml } from 'yaml';

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

function notificationDatabase(t) {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  }
  const schema = loadTS('src/schema.ts', { 'drizzle-orm': orm, 'drizzle-orm/sqlite-core': sqliteCore, '@paralleldrive/cuid2': { createId: () => crypto.randomUUID() } }, { Date });
  const db = drizzle(sqlite);
  const modules = { 'drizzle-orm': orm, '@/db': { getDb: () => db }, '@/schema': schema, '@/utils/logger': { logger: quiet } };
  const { NotificationService } = loadTS('src/services/notificationService.ts', modules, { Date });
  modules['@/services/notificationService'] = { NotificationService };
  return { sqlite, db, schema, modules, notifications: new NotificationService(db) };
}

test('JSON and Bark pushes persist the requested group and its category', async t => {
  const { db, schema, modules } = notificationDatabase(t);
  let delivered;
  class PushService {
    async validatePushToken() { return { email: 'test@example.com' }; }
    async sendPushNotifications(_user, notification) { delivered = notification; return { success: true }; }
  }
  modules['@/services/pushService'] = { PushService };
  const route = loadTS('src/pages/api/push.ts', { ...modules, 'cloudflare:workers': { env: {} }, yaml: { parse: parseYaml } });
  for (const body of [
    { pushToken: 'token', content: 'test', group: 'Deployments', category: 'Production' },
    { pushToken: 'token', content: '---\ngroup: Deployments\ncategory: Production\n---\ntest' },
    { device_key: 'token', body: 'test', group: 'Deployments', level: 'active' },
  ]) {
    const response = await route.POST({ request: new Request('https://app.example/api/push', { method: 'POST', body: JSON.stringify(body) }) });
    assert.equal(response.status, 200);
    assert.ok(delivered.groupId);
    assert.equal(db.select().from(schema.groups).where(orm.eq(schema.groups.id, delivered.groupId)).get().name, 'Deployments');
  }
  const { BarkEndpointService } = loadTS('src/services/barkEndpointService.ts', modules);
  assert.equal((await new BarkEndpointService(db, {}).processBarkPush('token', { body: 'test', group: 'Deployments' })).success, true);
  assert.equal(delivered.group, 'Deployments');
});

test('invalid push parameters do not create notifications', async t => {
  const { db, schema, modules } = notificationDatabase(t);
  modules['@/services/pushService'] = { PushService: class {
    async validatePushToken() { return { email: 'test@example.com' }; }
  }, validateWebhookUrl: () => ({ isValid: false, error: 'Invalid webhook URL' }) };
  const route = loadTS('src/pages/api/push.ts', { ...modules, 'cloudflare:workers': { env: {} }, yaml: { parse: parseYaml } });
  for (const body of [null, [], { pushToken: 'token', content: 42 },
    { pushToken: 'token', content: 'test', title: {} },
    { pushToken: 'token', content: '---\ntitle: [invalid]\n---\ntest' },
    { pushToken: 'token', content: 'test', type: 'approval-process' },
    { pushToken: 'token', content: 'test', type: 'approval-process', webhook_url: 'http://[::1]' },
  ]) {
    const response = await route.POST({ request: new Request('https://app.example/api/push', { method: 'POST', body: JSON.stringify(body) }) });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(db.select().from(schema.pushNotifications).all().length, 0);
  }
});

test('notification reads include approval details and unknown filters return no matches', async t => {
  const { db, schema, notifications } = notificationDatabase(t);
  const notification = await notifications.createNotification({ userEmail: 'test@example.com', content: 'Approve?', type: 'approval-process' });
  db.insert(schema.approvalProcesses).values({ id: 'approval', notificationId: notification.id, userEmail: notification.userEmail, webhookUrl: 'https://hooks.example/approve' }).run();
  for (const result of [await notifications.getNotification(notification.id, notification.userEmail), (await notifications.getNotifications(notification.userEmail)).notifications[0]]) {
    assert.equal(result.approvalId, 'approval');
    assert.equal(result.approvalState, 'pending');
  }
  for (const filter of [{ group: 'missing' }, { category: 'missing' }]) {
    const result = await notifications.getNotifications(notification.userEmail, filter);
    assert.equal(result.totalCount, 0);
    assert.equal(result.notifications.length, 0);
  }
});

test('notification receipt replays preserve first display, open and read timestamps', async t => {
  const { db, schema, notifications } = notificationDatabase(t);
  const first = new Date('2026-01-01T00:00:00Z');
  db.insert(schema.pushNotifications).values({ id: 'notification', userEmail: 'test@example.com', content: 'test', webPushDisplayedAt: first, webPushOpenedAt: first, readAt: first }).run();
  await notifications.recordDeliveryEvent('notification', 'test@example.com', 'opened');
  await notifications.recordDeliveryEvent('notification', 'test@example.com', 'displayed');
  const result = await notifications.getNotification('notification', 'test@example.com');
  for (const field of ['webPushDisplayedAt', 'webPushOpenedAt', 'readAt']) assert.equal(result[field].getTime(), first.getTime(), field);
});

test('page opened receipts retry failed responses and tolerate unavailable session storage', async () => {
  for (const storageUnavailable of [false, true]) {
    const listeners = new Map();
    const storage = new Map();
    let calls = 0;
    let ok = false;
    const { initializeDeliveryReceipts } = loadTS('src/modules/deliveryReceipts.ts', {}, {
      document: { body: { dataset: { notificationId: 'notification', subscriptionId: 'subscription', attemptId: 'attempt', receiptToken: 'token' } }, addEventListener: (name, handler) => listeners.set(name, handler), visibilityState: 'visible' },
      window: { addEventListener: (name, handler) => listeners.set(name, handler) },
      sessionStorage: { getItem: key => { if (storageUnavailable) throw new Error('Storage blocked'); return storage.get(key); }, setItem: (key, value) => { if (storageUnavailable) throw new Error('Storage blocked'); storage.set(key, value); } },
      fetch: async () => { calls++; return new Response('{}', { status: ok ? 200 : 503 }); },
    });
    initializeDeliveryReceipts();
    await new Promise(setImmediate);
    assert.equal(calls, 1);
    assert.equal(storage.size, 0);
    ok = true;
    assert.ok(listeners.has('online'));
    listeners.get('online')();
    await new Promise(setImmediate);
    assert.equal(calls, 2);
    listeners.get('astro:page-load')();
    await new Promise(setImmediate);
    assert.equal(calls, 2);
  }
});

test('local network URL validation covers normalized IPv4 and compressed or mapped IPv6', () => {
  const { isLocalNetworkUrl } = loadTS('src/utils/network.ts');
  for (const host of ['localhost.', 'app.localhost', '127.1', '0.0.0.0', '10.1.2.3', '172.16.1.1', '192.168.1.1', '169.254.169.254', '[::]', '[::1]', '[fc00::1]', '[fd12:3456::1]', '[fe90::1]', '[::ffff:127.0.0.1]', '[::ffff:192.168.1.1]']) {
    assert.equal(isLocalNetworkUrl(`http://${host}/`), true, host);
  }
  for (const host of ['example.com', '8.8.8.8', '172.32.1.1', '[2606:4700:4700::1111]', '[::ffff:8.8.8.8]']) {
    assert.equal(isLocalNetworkUrl(`https://${host}/`), false, host);
  }
});

test('approval submissions serialize webhooks, use the notification ID and publish token-authorized changes', async t => {
  const { db, schema, modules } = notificationDatabase(t);
  const approvalModule = loadTS('src/services/approvalProcessService.ts', modules, { Date });
  db.insert(schema.approvalProcesses).values({ id: 'approval', notificationId: 'notification', userEmail: 'test@example.com', webhookUrl: 'https://hooks.example/approve' }).run();
  const events = [];
  const revoked = [];
  let finishWebhook;
  let started;
  const webhookStarted = new Promise(resolve => { started = resolve; });
  let calls = 0;
  let payload;
  const route = loadTS('src/pages/api/approval.ts', { ...modules,
    'cloudflare:workers': { env: { KV: { get: async () => 'token', delete: async key => revoked.push(key) } } },
    '@/lib/auth': { getSessionFromContext: async () => ({ user: { email: 'test@example.com' } }) },
    '@/services/approvalProcessService': approvalModule,
    '@/services/streamService': { StreamService: class { async sendApprovalStateChangedEvent(...args) { events.push(args); } } },
  }, { fetch: async (_url, init) => { calls++; payload = JSON.parse(init.body); started(); return new Promise(resolve => { finishWebhook = resolve; }); } });
  const context = () => ({ request: new Request('https://app.example/api/approval', { method: 'POST', headers: { Authorization: 'Bearer token' }, body: JSON.stringify({ approvalId: 'approval', state: 'approved' }) }) });
  const first = route.POST(context());
  await webhookStarted;
  const second = await Promise.race([route.POST(context()), new Promise(resolve => setTimeout(() => resolve(null), 100))]);
  assert.equal(second?.status, 409);
  assert.equal(calls, 1);
  finishWebhook(new Response('{}'));
  assert.equal((await first).status, 200);
  assert.equal(payload.notificationId, 'notification');
  assert.equal(payload.approvalId, 'approval');
  assert.equal((await route.POST(context())).status, 409);
  assert.equal(calls, 1);
  assert.deepEqual(events[0], ['test@example.com', 'notification', 'approval', 'approved']);
  assert.deepEqual(revoked, ['approval_token:approval']);
});

test('a failed approval webhook releases the claim for retry and stale claims can recover', async t => {
  const { db, schema, modules } = notificationDatabase(t);
  const approvalModule = loadTS('src/services/approvalProcessService.ts', modules, { Date });
  db.insert(schema.approvalProcesses).values({ id: 'approval', notificationId: 'notification', userEmail: 'test@example.com', webhookUrl: 'https://hooks.example/approve' }).run();
  let ok = false;
  const route = loadTS('src/pages/api/approval.ts', { ...modules,
    'cloudflare:workers': { env: { KV: { delete: async () => {} } } },
    '@/lib/auth': { getSessionFromContext: async () => ({ user: { email: 'test@example.com' } }) },
    '@/services/approvalProcessService': approvalModule,
    '@/services/streamService': { StreamService: class { async sendApprovalStateChangedEvent() {} } },
  }, { fetch: async () => new Response('{}', { status: ok ? 200 : 503 }) });
  const context = () => ({ request: new Request('https://app.example/api/approval', { method: 'POST', body: JSON.stringify({ approvalId: 'approval', state: 'approved' }) }) });
  assert.equal((await route.POST(context())).status, 502);
  assert.equal(db.select().from(schema.approvalProcesses).get().state, 'pending');
  db.update(schema.approvalProcesses).set({ state: 'processing', updatedAt: new Date(Date.now() - 5 * 60_000) }).run();
  ok = true;
  assert.equal((await route.POST(context())).status, 200);
  assert.equal(db.select().from(schema.approvalProcesses).get().state, 'approved');
});

test('Safari relative links preserve receipt identifiers and webhook protocols are validated', t => {
  const { db, modules } = notificationDatabase(t);
  const network = loadTS('src/utils/network.ts');
  const { PushService, validateWebhookUrl, MAX_MESSAGE_SIZE } = loadTS('src/services/pushService.ts', {
    ...modules, '@paralleldrive/cuid2': { createId: () => crypto.randomUUID() },
    '@/services/webPushService': {}, '@/services/subscriptionService': {}, '@/services/approvalProcessService': {},
    '@/services/deliveryRetryService': {}, '@/services/streamService': { StreamService: class {} }, '@/utils/network': network,
  });
  const service = new PushService(db, { APP_URL: 'https://app.example' });
  for (const type of ['message', 'approval-process']) {
    const message = service.formatSafariMessage({ id: 'notification', content: 'test', navigate_url: 'sender', type }, {
      subscriptionId: 'subscription', attemptId: 'attempt', receiptToken: 'receipt', approvalId: 'approval', tempAccessToken: 'token',
    });
    assert.ok(new TextEncoder().encode(message).length < MAX_MESSAGE_SIZE);
    const payload = JSON.parse(message).notification;
    for (const link of [payload.navigate, ...payload.actions.map(action => action.navigate)]) {
      const url = new URL(link);
      assert.equal(url.origin, 'https://app.example');
      assert.equal(url.pathname, '/sender');
      assert.equal(url.searchParams.get('subscriptionId'), 'subscription');
      assert.equal(url.searchParams.get('attemptId'), 'attempt');
      assert.equal(url.searchParams.get('receiptToken'), 'receipt');
    }
  }
  for (const url of ['file:///tmp/hook', 'ftp://example.com', 'http://[::1]', 'http://[::ffff:127.0.0.1]']) {
    assert.equal(validateWebhookUrl(url).isValid, false, url);
  }
  assert.equal(validateWebhookUrl('https://hooks.example/approve').isValid, true);
});

test('standard push clicks resolve relative navigation URLs and retain receipt identity', async () => {
  const handlers = new Map();
  const opened = [];
  const receipts = [];
  let completion = Promise.resolve();
  const context = createContext({ console: quiet, URL, Response, AbortSignal,
    self: { location: { origin: 'https://app.example' }, registration: {}, addEventListener: (name, callback) => handlers.set(name, callback) },
    clients: { openWindow: async url => opened.push(url) },
    fetch: async (url, init) => { if (url === '/api/push-delivery') receipts.push(JSON.parse(init.body)); return Response.json({ unreadCount: 0 }); },
  });
  runInContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  handlers.get('notificationclick')({ action: '', notification: { data: { id: 'notification', navigateUrl: '/sender', subscriptionId: 'subscription', attemptId: 'attempt', receiptToken: 'receipt' }, close() {} }, waitUntil: promise => { completion = promise; } });
  await completion;
  assert.equal(opened[0], 'https://app.example/sender');
  assert.deepEqual(receipts[0], { notificationId: 'notification', subscriptionId: 'subscription', attemptId: 'attempt', receiptToken: 'receipt', event: 'opened' });
});

test('SSE approval events reach the inbox handler', async () => {
  const listeners = new Map();
  const changes = [];
  const { useSSEConnection } = loadTS('src/components/notification/composable/useSSEConnection.ts', {
    vue: { ...vue, onUnmounted() {} }, '@/utils/fingerprint': {}, '@/types/stream': {},
  }, { localStorage: { getItem: () => JSON.stringify({ 'test@example.com': 'fingerprint' }) },
    EventSource: class { addEventListener(name, callback) { listeners.set(name, callback); } close() {} },
  });
  const connection = useSSEConnection(vue.ref('test@example.com'), { onApprovalStateChanged: change => changes.push(change) });
  await connection.connect();
  listeners.get('approvalStateChanged')({ data: JSON.stringify({ notificationId: 'notification', approvalId: 'approval', state: 'approved' }) });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].state, 'approved');
  connection.disconnect();
});

test('standard push keeps filter IDs and ISO timestamps allow direct approval with a receipt-preserving fallback', async () => {
  const handlers = new Map();
  let shown;
  let completion = Promise.resolve();
  let approvalCalls = 0;
  let approvalOk = true;
  const opened = [];
  const context = createContext({ console: quiet, URL, Response, AbortSignal,
    self: { location: { origin: 'https://app.example' }, registration: { showNotification: async (_title, options) => { shown = options; } }, addEventListener: (name, handler) => handlers.set(name, handler) },
    clients: { matchAll: async () => [], openWindow: async url => opened.push(url) },
    fetch: async url => {
      if (url === '/api/approval') { approvalCalls++; return new Response('{}', { status: approvalOk ? 200 : 503 }); }
      return Response.json({ unreadCount: 0 });
    },
  });
  runInContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  const notification = { id: 'notification', content: 'Approve?', category: 'Production', categoryId: 'category-id', groupId: 'group-id', type: 'approval-process', approvalId: 'approval', tempAccessToken: 'token', subscriptionId: 'subscription', attemptId: 'attempt', receiptToken: 'receipt', createdAt: new Date().toISOString() };
  await context.handlePushEvent({ data: { json: () => notification } });
  assert.equal(shown.data.category, 'category-id');
  assert.equal(shown.data.notification_group, 'group-id');
  const click = () => handlers.get('notificationclick')({ action: 'approve', notification: { data: shown.data, close() {} }, waitUntil: promise => { completion = promise; } });
  click();
  await completion;
  assert.equal(approvalCalls, 1);
  assert.equal(opened.length, 0);
  approvalOk = false;
  click();
  await completion;
  assert.equal(approvalCalls, 2);
  const url = new URL(opened[0]);
  for (const [key, value] of Object.entries({ notificationId: 'notification', subscriptionId: 'subscription', attemptId: 'attempt', receiptToken: 'receipt' })) assert.equal(url.searchParams.get(key), value);
});
