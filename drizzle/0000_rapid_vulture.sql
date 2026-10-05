CREATE TABLE `analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`classroom_id` text NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_analyses_classroom_created` ON `analyses` (`classroom_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `classrooms` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_classrooms_owner_created` ON `classrooms` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `segments` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`owner` text NOT NULL,
	`offset_ms` integer NOT NULL,
	`english` text NOT NULL,
	`chinese` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `segments_id_unique` ON `segments` (`id`);--> statement-breakpoint
CREATE INDEX `idx_segments_classroom_seq` ON `segments` (`classroom_id`,`seq`);