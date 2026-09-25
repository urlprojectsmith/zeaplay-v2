DROP INDEX IF EXISTS "feature_entitlements_feature_id_agency_id_workspace_id_key";

CREATE UNIQUE INDEX "feature_entitlements_platform_unique"
ON "feature_entitlements"("feature_id")
WHERE "agency_id" IS NULL AND "workspace_id" IS NULL;

CREATE UNIQUE INDEX "feature_entitlements_agency_unique"
ON "feature_entitlements"("feature_id", "agency_id")
WHERE "agency_id" IS NOT NULL AND "workspace_id" IS NULL;

CREATE UNIQUE INDEX "feature_entitlements_workspace_unique"
ON "feature_entitlements"("feature_id", "workspace_id")
WHERE "workspace_id" IS NOT NULL;

ALTER TABLE "feature_entitlements"
ADD CONSTRAINT "feature_entitlements_workspace_requires_agency_chk"
CHECK ("workspace_id" IS NULL OR "agency_id" IS NOT NULL);

ALTER TABLE "feature_entitlements"
ADD CONSTRAINT "feature_entitlements_workspace_agency_fkey"
FOREIGN KEY ("workspace_id", "agency_id")
REFERENCES "workspaces"("id", "agency_id")
ON DELETE CASCADE
ON UPDATE CASCADE;
