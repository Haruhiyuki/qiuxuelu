ALTER TABLE "announcements" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "body_doc" jsonb;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL;