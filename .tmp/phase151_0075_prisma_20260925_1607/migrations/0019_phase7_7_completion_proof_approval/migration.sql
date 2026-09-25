CREATE TYPE "TaskCompletionProofRequirementMode" AS ENUM ('NONE', 'ANY', 'SPECIFIC');
CREATE TYPE "TaskCompletionProofType" AS ENUM ('TEXT', 'ATTACHMENT', 'URL', 'CHECKLIST_CONFIRMATION');
CREATE TYPE "TaskCompletionApproverMode" AS ENUM ('ANY_ONE', 'ALL_REQUIRED');
CREATE TYPE "TaskCompletionSubmissionStatus" AS ENUM ('PENDING_APPROVAL', 'ACCEPTED', 'REJECTED');
CREATE TYPE "TaskCompletionDecision" AS ENUM ('APPROVED', 'REJECTED');

ALTER TABLE "tasks"
  ADD COLUMN "pending_completion_submission_id" UUID;

CREATE TABLE "task_completion_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "proof_requirement_mode" "TaskCompletionProofRequirementMode" NOT NULL DEFAULT 'NONE',
  "required_proof_types" "TaskCompletionProofType"[] NOT NULL DEFAULT ARRAY[]::"TaskCompletionProofType"[],
  "approval_required" BOOLEAN NOT NULL DEFAULT false,
  "approver_mode" "TaskCompletionApproverMode",
  "include_task_creator" BOOLEAN NOT NULL DEFAULT false,
  "include_permission_approvers" BOOLEAN NOT NULL DEFAULT false,
  "include_project_owners_managers" BOOLEAN NOT NULL DEFAULT false,
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "task_completion_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_completion_policy_specific_types_check" CHECK (
    ("proof_requirement_mode" <> 'SPECIFIC' AND array_length("required_proof_types", 1) IS NULL)
    OR ("proof_requirement_mode" = 'SPECIFIC' AND array_length("required_proof_types", 1) >= 1)
  ),
  CONSTRAINT "task_completion_policy_approval_mode_check" CHECK (
    ("approval_required" = true AND "approver_mode" IS NOT NULL)
    OR ("approval_required" = false)
  )
);

CREATE TABLE "task_completion_policy_approvers" (
  "workspace_id" UUID NOT NULL,
  "policy_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_completion_policy_approvers_pkey" PRIMARY KEY ("policy_id", "membership_id")
);

CREATE TABLE "task_completion_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "TaskCompletionSubmissionStatus" NOT NULL,
  "requested_terminal_status_definition_id" UUID NOT NULL,
  "previous_status_definition_id" UUID NOT NULL,
  "submitted_by_membership_id" UUID NOT NULL,
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "proof_requirement_mode_snapshot" "TaskCompletionProofRequirementMode" NOT NULL,
  "required_proof_types_snapshot" "TaskCompletionProofType"[] NOT NULL DEFAULT ARRAY[]::"TaskCompletionProofType"[],
  "approval_required_snapshot" BOOLEAN NOT NULL,
  "approver_mode_snapshot" "TaskCompletionApproverMode",
  "resolved_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_completion_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_completion_proof_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "type" "TaskCompletionProofType" NOT NULL,
  "text_value" VARCHAR(4000),
  "url" VARCHAR(2048),
  "checklist_confirmed" BOOLEAN,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_completion_proof_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_completion_proof_item_shape_check" CHECK (
    ("type" = 'TEXT' AND "text_value" IS NOT NULL AND "url" IS NULL AND "checklist_confirmed" IS NULL)
    OR ("type" = 'URL' AND "url" IS NOT NULL AND "text_value" IS NULL AND "checklist_confirmed" IS NULL)
    OR ("type" = 'CHECKLIST_CONFIRMATION' AND "checklist_confirmed" = true AND "text_value" IS NULL AND "url" IS NULL)
    OR ("type" = 'ATTACHMENT' AND "text_value" IS NULL AND "url" IS NULL AND "checklist_confirmed" IS NULL)
  )
);

CREATE TABLE "task_completion_proof_attachments" (
  "workspace_id" UUID NOT NULL,
  "proof_item_id" UUID NOT NULL,
  "attachment_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_completion_proof_attachments_pkey" PRIMARY KEY ("proof_item_id", "attachment_id")
);

CREATE TABLE "task_completion_submission_approvers" (
  "workspace_id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "sources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_completion_submission_approvers_pkey" PRIMARY KEY ("submission_id", "membership_id")
);

CREATE TABLE "task_completion_approval_decisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "approver_membership_id" UUID NOT NULL,
  "decision" "TaskCompletionDecision" NOT NULL,
  "reason" VARCHAR(1000),
  "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_completion_approval_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_completion_rejection_reason_check" CHECK (
    "decision" = 'APPROVED' OR ("reason" IS NOT NULL AND length(trim("reason")) > 0)
  )
);

CREATE UNIQUE INDEX "task_completion_policies_task_id_key" ON "task_completion_policies"("task_id");
CREATE UNIQUE INDEX "task_completion_policies_task_id_workspace_id_key" ON "task_completion_policies"("task_id", "workspace_id");
CREATE UNIQUE INDEX "task_completion_policies_id_workspace_id_key" ON "task_completion_policies"("id", "workspace_id");
CREATE INDEX "task_completion_policies_workspace_id_task_id_idx" ON "task_completion_policies"("workspace_id", "task_id");
CREATE INDEX "task_completion_policy_approvers_workspace_id_membership_id_idx" ON "task_completion_policy_approvers"("workspace_id", "membership_id");

CREATE UNIQUE INDEX "task_completion_submissions_id_workspace_id_key" ON "task_completion_submissions"("id", "workspace_id");
CREATE UNIQUE INDEX "task_completion_submissions_task_id_version_key" ON "task_completion_submissions"("task_id", "version");
CREATE UNIQUE INDEX "task_completion_submissions_one_pending_idx" ON "task_completion_submissions"("task_id") WHERE "status" = 'PENDING_APPROVAL';
CREATE INDEX "task_completion_submissions_workspace_id_task_id_created_at_idx" ON "task_completion_submissions"("workspace_id", "task_id", "created_at");
CREATE INDEX "task_completion_submissions_workspace_id_status_created_at_idx" ON "task_completion_submissions"("workspace_id", "status", "created_at");
CREATE INDEX "task_completion_submissions_workspace_id_submitted_by_membership_id_idx" ON "task_completion_submissions"("workspace_id", "submitted_by_membership_id");

CREATE UNIQUE INDEX "task_completion_proof_items_id_workspace_id_key" ON "task_completion_proof_items"("id", "workspace_id");
CREATE INDEX "task_completion_proof_items_workspace_id_submission_id_type_idx" ON "task_completion_proof_items"("workspace_id", "submission_id", "type");
CREATE INDEX "task_completion_proof_attachments_workspace_id_attachment_id_idx" ON "task_completion_proof_attachments"("workspace_id", "attachment_id");
CREATE INDEX "task_completion_submission_approvers_workspace_id_membership_id_idx" ON "task_completion_submission_approvers"("workspace_id", "membership_id");
CREATE INDEX "task_completion_submission_approvers_workspace_id_submission_id_idx" ON "task_completion_submission_approvers"("workspace_id", "submission_id");
CREATE UNIQUE INDEX "task_completion_approval_decisions_submission_id_approver_membership_id_key" ON "task_completion_approval_decisions"("submission_id", "approver_membership_id");
CREATE INDEX "task_completion_approval_decisions_workspace_id_approver_membership_id_decided_at_idx" ON "task_completion_approval_decisions"("workspace_id", "approver_membership_id", "decided_at");
CREATE INDEX "task_completion_approval_decisions_workspace_id_submission_id_idx" ON "task_completion_approval_decisions"("workspace_id", "submission_id");
CREATE INDEX "tasks_workspace_id_pending_completion_submission_id_idx" ON "tasks"("workspace_id", "pending_completion_submission_id");

ALTER TABLE "task_completion_policies" ADD CONSTRAINT "task_completion_policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_policies" ADD CONSTRAINT "task_completion_policies_task_id_workspace_id_fkey" FOREIGN KEY ("task_id", "workspace_id") REFERENCES "tasks"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_policies" ADD CONSTRAINT "task_completion_policies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_policies" ADD CONSTRAINT "task_completion_policies_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_completion_policy_approvers" ADD CONSTRAINT "task_completion_policy_approvers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_policy_approvers" ADD CONSTRAINT "task_completion_policy_approvers_policy_id_workspace_id_fkey" FOREIGN KEY ("policy_id", "workspace_id") REFERENCES "task_completion_policies"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_policy_approvers" ADD CONSTRAINT "task_completion_policy_approvers_membership_id_workspace_id_fkey" FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_completion_submissions" ADD CONSTRAINT "task_completion_submissions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_submissions" ADD CONSTRAINT "task_completion_submissions_task_id_workspace_id_fkey" FOREIGN KEY ("task_id", "workspace_id") REFERENCES "tasks"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_submissions" ADD CONSTRAINT "task_completion_submissions_requested_status_fkey" FOREIGN KEY ("requested_terminal_status_definition_id", "workspace_id") REFERENCES "status_definitions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_submissions" ADD CONSTRAINT "task_completion_submissions_previous_status_fkey" FOREIGN KEY ("previous_status_definition_id", "workspace_id") REFERENCES "status_definitions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_submissions" ADD CONSTRAINT "task_completion_submissions_submitted_by_fkey" FOREIGN KEY ("submitted_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_completion_proof_items" ADD CONSTRAINT "task_completion_proof_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_proof_items" ADD CONSTRAINT "task_completion_proof_items_submission_id_workspace_id_fkey" FOREIGN KEY ("submission_id", "workspace_id") REFERENCES "task_completion_submissions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_proof_attachments" ADD CONSTRAINT "task_completion_proof_attachments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_proof_attachments" ADD CONSTRAINT "task_completion_proof_attachments_proof_item_id_workspace_id_fkey" FOREIGN KEY ("proof_item_id", "workspace_id") REFERENCES "task_completion_proof_items"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_proof_attachments" ADD CONSTRAINT "task_completion_proof_attachments_attachment_id_workspace_id_fkey" FOREIGN KEY ("attachment_id", "workspace_id") REFERENCES "attachments"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_completion_submission_approvers" ADD CONSTRAINT "task_completion_submission_approvers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_submission_approvers" ADD CONSTRAINT "task_completion_submission_approvers_submission_id_workspace_id_fkey" FOREIGN KEY ("submission_id", "workspace_id") REFERENCES "task_completion_submissions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_submission_approvers" ADD CONSTRAINT "task_completion_submission_approvers_membership_id_workspace_id_fkey" FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_completion_approval_decisions" ADD CONSTRAINT "task_completion_approval_decisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_approval_decisions" ADD CONSTRAINT "task_completion_approval_decisions_submission_id_workspace_id_fkey" FOREIGN KEY ("submission_id", "workspace_id") REFERENCES "task_completion_submissions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completion_approval_decisions" ADD CONSTRAINT "task_completion_approval_decisions_approver_membership_id_workspace_id_fkey" FOREIGN KEY ("approver_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_pending_completion_submission_id_workspace_id_fkey" FOREIGN KEY ("pending_completion_submission_id", "workspace_id") REFERENCES "task_completion_submissions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
