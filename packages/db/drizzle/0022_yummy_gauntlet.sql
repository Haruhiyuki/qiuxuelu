ALTER TABLE "documents" DROP CONSTRAINT "documents_edit_policy_check";--> statement-breakpoint
-- ADR-0011：把已边缘化的 suggest_only/semi 梯度统一并入 open；locked 保留（管理员锁定语义不变）
UPDATE "documents" SET "edit_policy" = 'open' WHERE "edit_policy" NOT IN ('open', 'locked');--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "edit_policy" SET DEFAULT 'open';--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_edit_policy_check" CHECK ("documents"."edit_policy" in ('open', 'locked'));
