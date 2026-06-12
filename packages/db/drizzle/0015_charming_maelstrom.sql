CREATE TABLE "user_name_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"old_name" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_username_unique";--> statement-breakpoint
ALTER TABLE "user_name_history" ADD CONSTRAINT "user_name_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_name_history_old_name_idx" ON "user_name_history" USING btree ("old_name");--> statement-breakpoint
CREATE INDEX "user_name_history_user_id_idx" ON "user_name_history" USING btree ("user_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_name_lower_uq" ON "user" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "username";