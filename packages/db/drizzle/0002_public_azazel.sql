CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"reporter_id" text NOT NULL,
	"reason_code" text NOT NULL,
	"note" text,
	"weight" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"section_id" uuid,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flags_status_check" CHECK ("flags"."status" in ('open', 'upheld', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flags_subject_reporter_uq" ON "flags" USING btree ("subject_type","subject_id","reporter_id");--> statement-breakpoint
CREATE INDEX "flags_subject_idx" ON "flags" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "flags_reporter_idx" ON "flags" USING btree ("reporter_id");