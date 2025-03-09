CREATE TABLE `user_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`preferences` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_preferences_user_email_unique` ON `user_preferences` (`user_email`);