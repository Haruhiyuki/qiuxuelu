CREATE TABLE "document_stats" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"view_count" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_stats" ADD CONSTRAINT "document_stats_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;