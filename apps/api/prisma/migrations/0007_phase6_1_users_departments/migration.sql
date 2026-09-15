CREATE TYPE "DepartmentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "departments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" VARCHAR(500),
  "status" "DepartmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "manager_membership_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "workspace_memberships" ADD COLUMN "department_id" UUID;

CREATE UNIQUE INDEX "departments_workspace_id_name_key" ON "departments"("workspace_id", "name");
CREATE UNIQUE INDEX "departments_id_workspace_id_key" ON "departments"("id", "workspace_id");
CREATE INDEX "departments_workspace_id_status_idx" ON "departments"("workspace_id", "status");
CREATE INDEX "departments_workspace_id_manager_membership_id_idx" ON "departments"("workspace_id", "manager_membership_id");
CREATE INDEX "workspace_memberships_workspace_id_status_idx" ON "workspace_memberships"("workspace_id", "status");
CREATE INDEX "workspace_memberships_workspace_id_role_id_idx" ON "workspace_memberships"("workspace_id", "role_id");
CREATE INDEX "workspace_memberships_workspace_id_department_id_idx" ON "workspace_memberships"("workspace_id", "department_id");

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_manager_membership_id_fkey"
  FOREIGN KEY ("manager_membership_id") REFERENCES "workspace_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workspace_memberships"
  ADD CONSTRAINT "workspace_memberships_department_id_workspace_id_fkey"
  FOREIGN KEY ("department_id", "workspace_id") REFERENCES "departments"("id", "workspace_id") ON DELETE SET NULL ON UPDATE CASCADE;
