CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"username" text,
	"bio" text,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_username_unique" UNIQUE("username"),
	CONSTRAINT "user_status_check" CHECK ("user"."status" in ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_id" uuid,
	"stage" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sections_slug_unique" UNIQUE("slug"),
	CONSTRAINT "sections_stage_check" CHECK ("sections"."stage" in ('junior', 'senior', 'college', 'general'))
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"hash" text PRIMARY KEY NOT NULL,
	"canon_version" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"text_plain" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"redacted_at" timestamp with time zone,
	"redacted_by" text,
	"redaction_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"type" text NOT NULL,
	"derived_from_block_id" uuid,
	"born_revision_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_refs" (
	"document_id" uuid NOT NULL,
	"name" text NOT NULL,
	"revision_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_refs_document_id_name_pk" PRIMARY KEY("document_id","name")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"owner_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"edit_policy" text DEFAULT 'suggest_only' NOT NULL,
	"schema_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_slug_unique" UNIQUE("slug"),
	CONSTRAINT "documents_status_check" CHECK ("documents"."status" in ('draft', 'pending', 'published', 'archived')),
	CONSTRAINT "documents_edit_policy_check" CHECK ("documents"."edit_policy" in ('suggest_only', 'open', 'semi', 'locked'))
);
--> statement-breakpoint
CREATE TABLE "published_snapshots" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"approved_by" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revision_blocks" (
	"revision_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"block_id" uuid NOT NULL,
	"blob_hash" text NOT NULL,
	CONSTRAINT "revision_blocks_revision_id_position_pk" PRIMARY KEY("revision_id","position")
);
--> statement-breakpoint
CREATE TABLE "revision_changes" (
	"revision_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"change" text NOT NULL,
	"old_blob_hash" text,
	"new_blob_hash" text,
	"old_pos" integer,
	"new_pos" integer,
	"merged_into_block_id" uuid,
	CONSTRAINT "revision_changes_revision_id_block_id_pk" PRIMARY KEY("revision_id","block_id"),
	CONSTRAINT "revision_changes_change_check" CHECK ("revision_changes"."change" in ('add', 'modify', 'remove', 'move'))
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"parent_id" uuid,
	"merge_parent_id" uuid,
	"author_id" text,
	"committer_id" text,
	"kind" text NOT NULL,
	"message" text,
	"manifest_hash" text NOT NULL,
	"schema_version" integer NOT NULL,
	"chars_delta" integer DEFAULT 0 NOT NULL,
	"blocks_changed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revisions_kind_check" CHECK ("revisions"."kind" in ('edit', 'merge_suggestion', 'rollback', 'collab_checkpoint', 'import'))
);
--> statement-breakpoint
CREATE TABLE "slug_history" (
	"old_slug" text PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working_copies" (
	"document_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"base_revision_id" uuid,
	"content" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "working_copies_document_id_user_id_pk" PRIMARY KEY("document_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "comment_anchors" (
	"comment_id" uuid PRIMARY KEY NOT NULL,
	"block_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"quoted_text" text NOT NULL,
	"prefix" text,
	"suffix" text,
	"state" text DEFAULT 'live' NOT NULL,
	CONSTRAINT "comment_anchors_state_check" CHECK ("comment_anchors"."state" in ('live', 'remapped', 'orphaned'))
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"author_id" text,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"suggestion_id" uuid,
	"body" jsonb NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"hidden_by" text,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	CONSTRAINT "comments_kind_check" CHECK ("comments"."kind" in ('doc', 'inline', 'review')),
	CONSTRAINT "comments_status_check" CHECK ("comments"."status" in ('visible', 'hidden', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"author_id" text,
	"base_revision_id" uuid NOT NULL,
	"head_revision_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"merged_revision_id" uuid,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestions_status_check" CHECK ("suggestions"."status" in ('open', 'under_review', 'changes_requested', 'merged', 'rejected', 'outdated', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "publish_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"requester_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewer_id" text,
	"reason_code" text,
	"review_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publish_requests_status_check" CHECK ("publish_requests"."status" in ('pending', 'in_review', 'approved', 'rejected', 'withdrawn', 'changes_requested'))
);
--> statement-breakpoint
CREATE TABLE "review_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_item_id" uuid NOT NULL,
	"reviewer_id" text,
	"action" text NOT NULL,
	"reason_code" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"section_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claimed_by" text,
	"claim_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_items_queue_check" CHECK ("review_items"."queue" in ('first_post', 'new_document', 'suggestion', 'flag', 'edit_patrol')),
	CONSTRAINT "review_items_status_check" CHECK ("review_items"."status" in ('pending', 'claimed', 'done', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "role_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"section_id" uuid,
	"granted_by" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"revoke_reason" text,
	CONSTRAINT "role_grants_role_check" CHECK ("role_grants"."role" in ('superadmin', 'admin', 'section_mod', 'editor'))
);
--> statement-breakpoint
CREATE TABLE "sanctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"section_id" uuid,
	"reason" text NOT NULL,
	"issued_by" text,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "sanctions_kind_check" CHECK ("sanctions"."kind" in ('suspend', 'silence', 'no_suggest', 'no_edit'))
);
--> statement-breakpoint
CREATE TABLE "trust_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"delta" integer DEFAULT 0 NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_trust" (
	"user_id" text PRIMARY KEY NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"manual_level" integer,
	"promoted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"section_id" uuid,
	"detail" jsonb,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blob_hash" text NOT NULL,
	"requested_by" text,
	"approved_by" text,
	"reason" text NOT NULL,
	"legal_basis" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_parent_id_sections_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_redacted_by_user_id_fk" FOREIGN KEY ("redacted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_derived_from_block_id_blocks_id_fk" FOREIGN KEY ("derived_from_block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_born_revision_id_revisions_id_fk" FOREIGN KEY ("born_revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_refs" ADD CONSTRAINT "document_refs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_refs" ADD CONSTRAINT "document_refs_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_snapshots" ADD CONSTRAINT "published_snapshots_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_snapshots" ADD CONSTRAINT "published_snapshots_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_snapshots" ADD CONSTRAINT "published_snapshots_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_blocks" ADD CONSTRAINT "revision_blocks_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_blocks" ADD CONSTRAINT "revision_blocks_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_blocks" ADD CONSTRAINT "revision_blocks_blob_hash_blobs_hash_fk" FOREIGN KEY ("blob_hash") REFERENCES "public"."blobs"("hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_changes" ADD CONSTRAINT "revision_changes_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_changes" ADD CONSTRAINT "revision_changes_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_changes" ADD CONSTRAINT "revision_changes_old_blob_hash_blobs_hash_fk" FOREIGN KEY ("old_blob_hash") REFERENCES "public"."blobs"("hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_changes" ADD CONSTRAINT "revision_changes_new_blob_hash_blobs_hash_fk" FOREIGN KEY ("new_blob_hash") REFERENCES "public"."blobs"("hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_changes" ADD CONSTRAINT "revision_changes_merged_into_block_id_blocks_id_fk" FOREIGN KEY ("merged_into_block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_parent_id_revisions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_merge_parent_id_revisions_id_fk" FOREIGN KEY ("merge_parent_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_committer_id_user_id_fk" FOREIGN KEY ("committer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slug_history" ADD CONSTRAINT "slug_history_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_copies" ADD CONSTRAINT "working_copies_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_copies" ADD CONSTRAINT "working_copies_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_copies" ADD CONSTRAINT "working_copies_base_revision_id_revisions_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_anchors" ADD CONSTRAINT "comment_anchors_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_anchors" ADD CONSTRAINT "comment_anchors_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_anchors" ADD CONSTRAINT "comment_anchors_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_hidden_by_user_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_base_revision_id_revisions_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_head_revision_id_revisions_id_fk" FOREIGN KEY ("head_revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_merged_revision_id_revisions_id_fk" FOREIGN KEY ("merged_revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_requests" ADD CONSTRAINT "publish_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_requests" ADD CONSTRAINT "publish_requests_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_requests" ADD CONSTRAINT "publish_requests_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_requests" ADD CONSTRAINT "publish_requests_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_review_item_id_review_items_id_fk" FOREIGN KEY ("review_item_id") REFERENCES "public"."review_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_claimed_by_user_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_events" ADD CONSTRAINT "trust_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_trust" ADD CONSTRAINT "user_trust_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redactions" ADD CONSTRAINT "redactions_blob_hash_blobs_hash_fk" FOREIGN KEY ("blob_hash") REFERENCES "public"."blobs"("hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redactions" ADD CONSTRAINT "redactions_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redactions" ADD CONSTRAINT "redactions_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "revision_blocks_revision_id_block_id_uq" ON "revision_blocks" USING btree ("revision_id","block_id");--> statement-breakpoint
CREATE INDEX "revision_blocks_block_id_idx" ON "revision_blocks" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "revision_changes_block_id_idx" ON "revision_changes" USING btree ("block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_document_id_seq_uq" ON "revisions" USING btree ("document_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "publish_requests_one_open_per_doc_uq" ON "publish_requests" USING btree ("document_id") WHERE "publish_requests"."status" in ('pending', 'in_review');--> statement-breakpoint
CREATE UNIQUE INDEX "review_items_queue_subject_uq" ON "review_items" USING btree ("queue","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "trust_events_user_id_created_at_idx" ON "trust_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "audit_log" USING btree ("subject_type","subject_id");