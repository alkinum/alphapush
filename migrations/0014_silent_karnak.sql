CREATE TABLE `push_delivery_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`user_email` text NOT NULL,
	`sent_at` integer NOT NULL,
	`ack_deadline_at` integer NOT NULL,
	`displayed_at` integer,
	`opened_at` integer,
	`acked_at` integer,
	`fallback_sent_at` integer,
	`fallback_reason` text,
	`fallback_error` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`notification_id`) REFERENCES `push_notifications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `bark_fallback_enabled` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `bark_fallback_always` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `bark_server_url` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `bark_device_key` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `no_ack_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `last_no_ack_at` integer;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `last_ack_at` integer;