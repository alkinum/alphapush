import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

// Better Auth tables
// Schema follows Better Auth's expected structure for compatibility
export const user = sqliteTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text('name'), // nullable to match Better Auth
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).default(false),
  image: text('image'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  role: text('role').default('user'),
});

export const session = sqliteTable('session', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('createdAt', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = sqliteTable('account', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const verification = sqliteTable('verification', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const userCredentials = sqliteTable('user_credentials', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  email: text('email').notNull().unique(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  pushToken: text('push_token').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const groups = sqliteTable('groups', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text('name').notNull(),
  userEmail: text('user_email').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const categories = sqliteTable('categories', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text('name').notNull(),
  userEmail: text('user_email').notNull(),
  groupId: text('group_id').references(() => groups.id).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const pushNotifications = sqliteTable('push_notifications', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  content: text('content').notNull(),
  title: text('title'),
  subtitle: text('subtitle'),
  categoryId: text('category_id').references(() => categories.id),
  groupId: text('group_id').references(() => groups.id),
  userEmail: text('user_email').notNull(),
  type: text('type'),
  iconUrl: text('icon_url'),
  navigate_url: text('navigate_url'),
  extraInfo: text('extra_info'),
  webPushSentAt: integer('web_push_sent_at', { mode: 'timestamp' }),
  webPushDisplayedAt: integer('web_push_displayed_at', { mode: 'timestamp' }),
  webPushOpenedAt: integer('web_push_opened_at', { mode: 'timestamp' }),
  barkFallbackSentAt: integer('bark_fallback_sent_at', { mode: 'timestamp' }),
  barkFallbackReason: text('bark_fallback_reason'),
  barkFallbackError: text('bark_fallback_error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const subscriptions = sqliteTable('subscriptions', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  userEmail: text('user_email').notNull(),
  deviceFingerprint: text('device_fingerprint').notNull(),
  subscription: text('subscription').notNull(),
  isSafari: integer('is_safari', { mode: 'boolean' }).default(false),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  lastSuccessAt: integer('last_success_at', { mode: 'timestamp' }),
  lastFailureAt: integer('last_failure_at', { mode: 'timestamp' }),
  failureCount: integer('failure_count').default(0),
  lastStatusCode: integer('last_status_code'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const approvalProcesses = sqliteTable('approval_processes', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  userEmail: text('user_email').notNull(),
  notificationId: text('notification_id').notNull(),
  webhookUrl: text('webhook_url').notNull(),
  state: text('state')
    .notNull()
    .$default(() => 'pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const userPreferences = sqliteTable('user_preferences', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  userEmail: text('user_email').notNull().unique(),
  preferences: text('preferences').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const categoriesRelations = relations(categories, ({ many, one }) => ({
  notifications: many(pushNotifications),
  group: one(groups, {
    fields: [categories.groupId],
    references: [groups.id],
  }),
}));

export const groupsRelations = relations(groups, ({ many }) => ({
  notifications: many(pushNotifications),
  categories: many(categories),
}));

export const pushNotificationsRelations = relations(pushNotifications, ({ one }) => ({
  category: one(categories, {
    fields: [pushNotifications.categoryId],
    references: [categories.id],
  }),
  group: one(groups, {
    fields: [pushNotifications.groupId],
    references: [groups.id],
  }),
}));
