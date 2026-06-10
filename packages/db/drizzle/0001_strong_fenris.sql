ALTER TABLE "user" ADD COLUMN "licenseConsentVersion" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "covenantConsentVersion" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "blocks_document_id_idx" ON "blocks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "comments_document_id_idx" ON "comments" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "suggestions_document_id_idx" ON "suggestions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "review_items_queue_status_idx" ON "review_items" USING btree ("queue","status","section_id");--> statement-breakpoint
CREATE INDEX "review_items_claim_expires_idx" ON "review_items" USING btree ("claim_expires_at");--> statement-breakpoint
CREATE INDEX "role_grants_user_id_idx" ON "role_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sanctions_user_id_idx" ON "sanctions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_no_self_review_check" CHECK ("suggestions"."resolved_by" is null or "suggestions"."status" = 'withdrawn' or "suggestions"."resolved_by" is distinct from "suggestions"."author_id");--> statement-breakpoint
ALTER TABLE "publish_requests" ADD CONSTRAINT "publish_requests_no_self_review_check" CHECK ("publish_requests"."reviewer_id" is null or "publish_requests"."reviewer_id" is distinct from "publish_requests"."requester_id");