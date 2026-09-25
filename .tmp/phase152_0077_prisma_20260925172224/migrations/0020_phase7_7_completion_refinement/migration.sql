ALTER TABLE "task_recurrence_series"
  ADD COLUMN "completion_proof_requirement_mode" "TaskCompletionProofRequirementMode" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "completion_required_proof_types" "TaskCompletionProofType"[] NOT NULL DEFAULT ARRAY[]::"TaskCompletionProofType"[],
  ADD COLUMN "completion_approval_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "completion_approver_mode" "TaskCompletionApproverMode",
  ADD COLUMN "completion_include_task_creator" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "completion_include_permission_approvers" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "completion_include_project_owners_managers" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "task_recurrence_completion_approvers" (
  "series_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "task_recurrence_completion_approvers_pkey" PRIMARY KEY ("series_id", "membership_id")
);

CREATE INDEX "task_recurrence_completion_approvers_workspace_id_membership_id_idx"
  ON "task_recurrence_completion_approvers"("workspace_id", "membership_id");

ALTER TABLE "task_recurrence_completion_approvers"
  ADD CONSTRAINT "task_recurrence_completion_approvers_series_id_workspace_id_fkey"
  FOREIGN KEY ("series_id", "workspace_id")
  REFERENCES "task_recurrence_series"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_recurrence_completion_approvers"
  ADD CONSTRAINT "task_recurrence_completion_approvers_workspace_id_fkey"
  FOREIGN KEY ("workspace_id")
  REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_recurrence_completion_approvers"
  ADD CONSTRAINT "task_recurrence_completion_approvers_membership_id_workspace_id_fkey"
  FOREIGN KEY ("membership_id", "workspace_id")
  REFERENCES "workspace_memberships"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
