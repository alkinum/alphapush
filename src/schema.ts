import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
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

export const categories = sqliteTable('categories', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text('name').notNull(),
  userEmail: text('user_email').notNull(),
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
  preferences: text('preferences').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const categoriesRelations = relations(categories, ({ many }) => ({
  notifications: many(pushNotifications),
}));

export const groupsRelations = relations(groups, ({ many }) => ({
  notifications: many(pushNotifications),
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
