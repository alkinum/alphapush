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
  category: text('category'),
  group: text('group'),
  userEmail: text('user_email').notNull(),
  type: text('type'),
  iconUrl: text('icon_url'),
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
