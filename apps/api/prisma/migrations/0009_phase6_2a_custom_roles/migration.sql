ALTER TABLE "roles"
  ADD COLUMN "name_normalized" VARCHAR(80),
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

UPDATE "roles"
SET "name_normalized" = lower(btrim("name"))
WHERE "workspace_id" IS NOT NULL;

CREATE INDEX "roles_workspace_id_is_active_idx" ON "roles"("workspace_id", "is_active");

CREATE UNIQUE INDEX "roles_workspace_id_name_normalized_key"
  ON "roles"("workspace_id", "name_normalized");
