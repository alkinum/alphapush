import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { createId } from '@paralleldrive/cuid2';

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

export const pushNotifications = sqliteTable('push_notifications', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  content: text('content').notNull(),
  title: text('title'),
  subtitle: text('subtitle'),
  category: text('category'),
  notification_group: text('notification_group'),
  userEmail: text('user_email').notNull(),
  type: text('type'),
  iconUrl: text('icon_url'),
  navigate_url: text('navigate_url'),
  extraInfo: text('extra_info'),
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
  preferences: text('preferences').notNull(), // 存储为 JSON 字符串
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
