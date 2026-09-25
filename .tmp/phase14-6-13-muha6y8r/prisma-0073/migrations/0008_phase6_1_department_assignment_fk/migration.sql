ALTER TABLE "workspace_memberships"
  DROP CONSTRAINT "workspace_memberships_department_id_workspace_id_fkey";

ALTER TABLE "workspace_memberships"
  ADD CONSTRAINT "workspace_memberships_department_id_workspace_id_fkey"
  FOREIGN KEY ("department_id", "workspace_id") REFERENCES "departments"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
