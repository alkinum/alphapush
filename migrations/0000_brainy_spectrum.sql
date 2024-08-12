CREATE TABLE `push_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`title` text,
	`category` text,
	`group` text,
	`user_email` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`device_fingerprint` text NOT NULL,
	`subscription` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `user_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`push_token` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_credentials_email_unique` ON `user_credentials` (`email`);