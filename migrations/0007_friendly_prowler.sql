CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_email` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_email` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
-- First, insert existing categories and groups into the new tables
INSERT INTO `categories` (
		`id`,
		`name`,
		`user_email`,
		`created_at`,
		`updated_at`
	)
SELECT DISTINCT hex(randomblob(16)) as id,
	`category` as name,
	`user_email`,
	unixepoch() as created_at,
	unixepoch() as updated_at
FROM `push_notifications`
WHERE `category` IS NOT NULL
	AND `category` != '';
--> statement-breakpoint
INSERT INTO `groups` (
		`id`,
		`name`,
		`user_email`,
		`created_at`,
		`updated_at`
	)
SELECT DISTINCT hex(randomblob(16)) as id,
	`group` as name,
	`user_email`,
	unixepoch() as created_at,
	unixepoch() as updated_at
FROM `push_notifications`
WHERE `group` IS NOT NULL
	AND `group` != '';
--> statement-breakpoint
PRAGMA foreign_keys = OFF;
--> statement-breakpoint
CREATE TABLE `__new_push_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`title` text,
	`subtitle` text,
	`category_id` text,
	`group_id` text,
	`user_email` text NOT NULL,
	`type` text,
	`icon_url` text,
	`navigate_url` text,
	`extra_info` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Insert data with proper category_id and group_id references
INSERT INTO `__new_push_notifications` (
		`id`,
		`content`,
		`title`,
		`subtitle`,
		`category_id`,
		`group_id`,
		`user_email`,
		`type`,
		`icon_url`,
		`navigate_url`,
		`extra_info`,
		`created_at`,
		`updated_at`
	)
SELECT pn.`id`,
	pn.`content`,
	pn.`title`,
	pn.`subtitle`,
	(
		SELECT c.`id`
		FROM `categories` c
		WHERE c.`name` = pn.`category`
			AND c.`user_email` = pn.`user_email`
		LIMIT 1
	) as category_id,
	(
		SELECT g.`id`
		FROM `groups` g
		WHERE g.`name` = pn.`group`
			AND g.`user_email` = pn.`user_email`
		LIMIT 1
	) as group_id,
	pn.`user_email`,
	pn.`type`,
	pn.`icon_url`,
	pn.`navigate_url`,
	pn.`extra_info`,
	pn.`created_at`,
	pn.`updated_at`
FROM `push_notifications` pn;
--> statement-breakpoint
DROP TABLE `push_notifications`;
--> statement-breakpoint
ALTER TABLE `__new_push_notifications`
	RENAME TO `push_notifications`;
--> statement-breakpoint
PRAGMA foreign_keys = ON;