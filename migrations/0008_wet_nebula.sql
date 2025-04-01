CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_email` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	UNIQUE(`name`, `user_email`)
);
--> statement-breakpoint
/* First, insert existing unique groups into the groups table */
WITH RECURSIVE group_data AS (
	SELECT DISTINCT `notification_group` as name,
		`user_email`,
		MIN(`created_at`) as created_at,
		MAX(`updated_at`) as updated_at
	FROM `push_notifications`
	WHERE `notification_group` IS NOT NULL
	GROUP BY `notification_group`,
		`user_email`
)
INSERT
	OR IGNORE INTO `groups` (
		`id`,
		`name`,
		`user_email`,
		`created_at`,
		`updated_at`
	)
SELECT COALESCE(
		(
			SELECT id
			FROM `groups`
			WHERE name = group_data.name
				AND user_email = group_data.user_email
		),
		lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
	) as id,
	name,
	user_email,
	created_at,
	updated_at
FROM group_data;
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_email` text NOT NULL,
	`group_id` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	UNIQUE(`name`, `group_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
/* Then, insert existing categories with their corresponding group references */
WITH RECURSIVE category_data AS (
	SELECT DISTINCT pn.category as name,
		pn.user_email,
		g.id as group_id,
		MIN(pn.created_at) as created_at,
		MAX(pn.updated_at) as updated_at
	FROM `push_notifications` pn
		JOIN `groups` g ON g.name = pn.`notification_group`
		AND g.user_email = pn.user_email
	WHERE pn.category IS NOT NULL
		AND pn.`notification_group` IS NOT NULL
	GROUP BY pn.category,
		pn.user_email,
		g.id
)
INSERT
	OR IGNORE INTO `categories` (
		`id`,
		`name`,
		`user_email`,
		`group_id`,
		`created_at`,
		`updated_at`
	)
SELECT COALESCE(
		(
			SELECT id
			FROM `categories`
			WHERE name = category_data.name
				AND group_id = category_data.group_id
		),
		lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
	) as id,
	name,
	user_email,
	group_id,
	created_at,
	updated_at
FROM category_data;
--> statement-breakpoint
/* Add new columns */
ALTER TABLE `push_notifications`
ADD `category_id` text REFERENCES categories(id);
ALTER TABLE `push_notifications`
ADD `group_id` text REFERENCES groups(id);
--> statement-breakpoint
/* Update push_notifications with new foreign keys */
UPDATE `push_notifications`
SET `group_id` = (
		SELECT `id`
		FROM `groups`
		WHERE `groups`.`name` = `push_notifications`.`notification_group`
			AND `groups`.`user_email` = `push_notifications`.`user_email`
		LIMIT 1
	), `category_id` = (
		SELECT c.`id`
		FROM `categories` c
			JOIN `groups` g ON g.`id` = c.`group_id`
		WHERE c.`name` = `push_notifications`.`category`
			AND g.`name` = `push_notifications`.`notification_group`
			AND g.`user_email` = `push_notifications`.`user_email`
		LIMIT 1
	)
WHERE `notification_group` IS NOT NULL
	OR `category` IS NOT NULL;
--> statement-breakpoint
/* Finally, drop old columns */
ALTER TABLE `push_notifications` DROP COLUMN `category`;
ALTER TABLE `push_notifications` DROP COLUMN `notification_group`;