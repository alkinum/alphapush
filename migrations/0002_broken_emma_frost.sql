CREATE TABLE `approval_processes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`notification_id` text NOT NULL,
	`webhook_url` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
ALTER TABLE `push_notifications` ADD `type` text;