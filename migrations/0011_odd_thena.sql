ALTER TABLE `subscriptions` ADD `last_seen_at` integer;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `last_success_at` integer;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `last_failure_at` integer;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `failure_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `last_status_code` integer;