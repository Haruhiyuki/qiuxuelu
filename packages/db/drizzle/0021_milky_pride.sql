CREATE TABLE "collab_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"rating" integer NOT NULL,
	"body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collab_reviews_type_check" CHECK ("collab_reviews"."target_type" in ('feedback', 'suggestion', 'revision')),
	CONSTRAINT "collab_reviews_rating_check" CHECK ("collab_reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "collab_reviews" ADD CONSTRAINT "collab_reviews_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_reviews" ADD CONSTRAINT "collab_reviews_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collab_reviews_unique" ON "collab_reviews" USING btree ("target_type","target_id","author_id");--> statement-breakpoint
CREATE INDEX "collab_reviews_target_idx" ON "collab_reviews" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "collab_reviews_document_idx" ON "collab_reviews" USING btree ("document_id");