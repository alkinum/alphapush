ALTER TABLE `push_notifications` ADD `web_push_sent_at` integer;--> statement-breakpoint
ALTER TABLE `push_notifications` ADD `web_push_displayed_at` integer;--> statement-breakpoint
ALTER TABLE `push_notifications` ADD `web_push_opened_at` integer;--> statement-breakpoint
ALTER TABLE `push_notifications` ADD `bark_fallback_sent_at` integer;--> statement-breakpoint
ALTER TABLE `push_notifications` ADD `bark_fallback_reason` text;--> statement-breakpoint
ALTER TABLE `push_notifications` ADD `bark_fallback_error` text;