CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"link_href" text,
	"link_label" text,
	"author_id" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_level_check" CHECK ("announcements"."level" in ('info', 'notice')),
	CONSTRAINT "announcements_status_check" CHECK ("announcements"."status" in ('draft', 'published', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_status_published_idx" ON "announcements" USING btree ("status","published_at");