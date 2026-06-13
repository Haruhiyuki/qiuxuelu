ALTER TABLE "comments" DROP CONSTRAINT "comments_status_check";--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "ai_verdict" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "ai_category" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "ai_reason" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "ai_model" text;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_status_check" CHECK ("comments"."status" in ('visible', 'hidden', 'deleted', 'ai_held'));