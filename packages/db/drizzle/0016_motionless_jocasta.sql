ALTER TABLE "documents" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "publicized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "publicized_by" text;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_visibility_check" CHECK ("documents"."visibility" in ('private', 'public'));