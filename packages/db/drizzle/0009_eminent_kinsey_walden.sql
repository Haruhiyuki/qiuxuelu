CREATE TABLE "doc_reactions" (
	"user_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_reactions_user_id_document_id_kind_pk" PRIMARY KEY("user_id","document_id","kind"),
	CONSTRAINT "doc_reactions_kind_check" CHECK ("doc_reactions"."kind" in ('like', 'bookmark'))
);
--> statement-breakpoint
ALTER TABLE "doc_reactions" ADD CONSTRAINT "doc_reactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_reactions" ADD CONSTRAINT "doc_reactions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;