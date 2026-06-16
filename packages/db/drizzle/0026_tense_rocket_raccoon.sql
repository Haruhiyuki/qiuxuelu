CREATE TABLE "appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"sanction_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appeals_status_check" CHECK ("appeals"."status" in ('open', 'accepted', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_sanction_id_sanctions_id_fk" FOREIGN KEY ("sanction_id") REFERENCES "public"."sanctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appeals_status_idx" ON "appeals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "appeals_open_per_sanction_uq" ON "appeals" USING btree ("sanction_id") WHERE "appeals"."status" = 'open';