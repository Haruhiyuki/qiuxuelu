CREATE TABLE "document_references" (
	"source_doc_id" uuid NOT NULL,
	"target_doc_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_references_source_doc_id_target_doc_id_pk" PRIMARY KEY("source_doc_id","target_doc_id"),
	CONSTRAINT "document_references_no_self" CHECK ("document_references"."source_doc_id" <> "document_references"."target_doc_id")
);
--> statement-breakpoint
ALTER TABLE "document_references" ADD CONSTRAINT "document_references_source_doc_id_documents_id_fk" FOREIGN KEY ("source_doc_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_references" ADD CONSTRAINT "document_references_target_doc_id_documents_id_fk" FOREIGN KEY ("target_doc_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_references_target_idx" ON "document_references" USING btree ("target_doc_id");