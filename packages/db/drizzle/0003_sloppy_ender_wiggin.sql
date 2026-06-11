ALTER TABLE "revisions" ADD COLUMN "suggestion_id" uuid;--> statement-breakpoint
CREATE INDEX "revisions_suggestion_id_idx" ON "revisions" USING btree ("suggestion_id");