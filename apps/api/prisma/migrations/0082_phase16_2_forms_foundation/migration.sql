ALTER TYPE "AutomationTriggerType" ADD VALUE IF NOT EXISTS 'FORM_SUBMITTED';
ALTER TYPE "AutomationDomainEventEntityType" ADD VALUE IF NOT EXISTS 'FORM_SUBMISSION';

CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "FormType" AS ENUM ('FORM', 'TEMPLATE');
CREATE TYPE "FormVisibility" AS ENUM ('INTERNAL', 'PUBLIC');
CREATE TYPE "FormVersionState" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "FormSubmissionSource" AS ENUM ('INTERNAL', 'PUBLIC');
CREATE TYPE "FormSubmissionStatus" AS ENUM ('RECEIVED');
CREATE TYPE "FormSubmissionAutomationStatus" AS ENUM ('PENDING', 'QUEUED', 'SKIPPED', 'FAILED');
CREATE TYPE "FormSubmissionAssetKind" AS ENUM ('FILE', 'SIGNATURE');

CREATE TABLE "forms" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "public_id" VARCHAR(48) NOT NULL,
  "title" VARCHAR(220) NOT NULL,
  "description" VARCHAR(1000),
  "status" "FormStatus" NOT NULL DEFAULT 'DRAFT',
  "type" "FormType" NOT NULL DEFAULT 'FORM',
  "visibility" "FormVisibility" NOT NULL DEFAULT 'INTERNAL',
  "public_enabled" BOOLEAN NOT NULL DEFAULT false,
  "published_version_number" INTEGER,
  "created_by_membership_id" UUID NOT NULL,
  "updated_by_membership_id" UUID,
  "archived_by_membership_id" UUID,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "form_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "form_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "state" "FormVersionState" NOT NULL DEFAULT 'DRAFT',
  "title_snapshot" VARCHAR(220) NOT NULL,
  "description_snapshot" VARCHAR(1000),
  "schema" JSONB NOT NULL,
  "settings" JSONB,
  "created_by_membership_id" UUID NOT NULL,
  "published_by_membership_id" UUID,
  "published_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "form_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "form_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "form_id" UUID NOT NULL,
  "form_version_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "source" "FormSubmissionSource" NOT NULL,
  "status" "FormSubmissionStatus" NOT NULL DEFAULT 'RECEIVED',
  "submitted_by_membership_id" UUID,
  "idempotency_key_hash" VARCHAR(128),
  "public_client_hash" VARCHAR(128),
  "answers" JSONB NOT NULL,
  "answer_summary" JSONB,
  "automation_status" "FormSubmissionAutomationStatus" NOT NULL DEFAULT 'PENDING',
  "automation_error_code" VARCHAR(120),
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "form_submission_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "form_submission_id" UUID NOT NULL,
  "form_id" UUID NOT NULL,
  "form_version_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "field_id" VARCHAR(80) NOT NULL,
  "kind" "FormSubmissionAssetKind" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "form_submission_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "forms_public_id_key" ON "forms"("public_id");
CREATE UNIQUE INDEX "forms_id_workspace_id_key" ON "forms"("id", "workspace_id");
CREATE INDEX "forms_workspace_id_status_type_updated_at_idx" ON "forms"("workspace_id", "status", "type", "updated_at");
CREATE INDEX "forms_workspace_id_visibility_status_idx" ON "forms"("workspace_id", "visibility", "status");
CREATE INDEX "forms_workspace_id_public_enabled_status_idx" ON "forms"("workspace_id", "public_enabled", "status");

CREATE UNIQUE INDEX "form_versions_id_workspace_id_key" ON "form_versions"("id", "workspace_id");
CREATE UNIQUE INDEX "form_versions_form_id_version_number_key" ON "form_versions"("form_id", "version_number");
CREATE INDEX "form_versions_workspace_id_form_id_state_version_number_idx" ON "form_versions"("workspace_id", "form_id", "state", "version_number");
CREATE INDEX "form_versions_workspace_id_state_published_at_idx" ON "form_versions"("workspace_id", "state", "published_at");

CREATE UNIQUE INDEX "form_submissions_id_workspace_id_key" ON "form_submissions"("id", "workspace_id");
CREATE UNIQUE INDEX "form_submissions_workspace_id_form_id_idempotency_key_hash_key" ON "form_submissions"("workspace_id", "form_id", "idempotency_key_hash");
CREATE INDEX "form_submissions_workspace_id_form_id_submitted_at_idx" ON "form_submissions"("workspace_id", "form_id", "submitted_at");
CREATE INDEX "form_submissions_workspace_id_form_version_id_submitted_at_idx" ON "form_submissions"("workspace_id", "form_version_id", "submitted_at");
CREATE INDEX "form_submissions_workspace_id_submitted_by_membership_id_submitted_at_idx" ON "form_submissions"("workspace_id", "submitted_by_membership_id", "submitted_at");

CREATE UNIQUE INDEX "form_submission_assets_form_submission_id_asset_id_field_id_key" ON "form_submission_assets"("form_submission_id", "asset_id", "field_id");
CREATE INDEX "form_submission_assets_workspace_id_asset_id_idx" ON "form_submission_assets"("workspace_id", "asset_id");
CREATE INDEX "form_submission_assets_workspace_id_form_id_field_id_idx" ON "form_submission_assets"("workspace_id", "form_id", "field_id");

ALTER TABLE "forms" ADD CONSTRAINT "forms_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "forms" ADD CONSTRAINT "forms_created_by_membership_id_workspace_id_fkey" FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "forms" ADD CONSTRAINT "forms_updated_by_membership_id_workspace_id_fkey" FOREIGN KEY ("updated_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "forms" ADD CONSTRAINT "forms_archived_by_membership_id_workspace_id_fkey" FOREIGN KEY ("archived_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_workspace_id_fkey" FOREIGN KEY ("form_id", "workspace_id") REFERENCES "forms"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_created_by_membership_id_workspace_id_fkey" FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_published_by_membership_id_workspace_id_fkey" FOREIGN KEY ("published_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_workspace_id_fkey" FOREIGN KEY ("form_id", "workspace_id") REFERENCES "forms"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_version_id_workspace_id_fkey" FOREIGN KEY ("form_version_id", "workspace_id") REFERENCES "form_versions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_submitted_by_membership_id_workspace_id_fkey" FOREIGN KEY ("submitted_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "form_submission_assets" ADD CONSTRAINT "form_submission_assets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "form_submission_assets" ADD CONSTRAINT "form_submission_assets_form_submission_id_workspace_id_fkey" FOREIGN KEY ("form_submission_id", "workspace_id") REFERENCES "form_submissions"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_submission_assets" ADD CONSTRAINT "form_submission_assets_form_id_workspace_id_fkey" FOREIGN KEY ("form_id", "workspace_id") REFERENCES "forms"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "form_submission_assets" ADD CONSTRAINT "form_submission_assets_form_version_id_workspace_id_fkey" FOREIGN KEY ("form_version_id", "workspace_id") REFERENCES "form_versions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "form_submission_assets" ADD CONSTRAINT "form_submission_assets_asset_id_workspace_id_fkey" FOREIGN KEY ("asset_id", "workspace_id") REFERENCES "assets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
