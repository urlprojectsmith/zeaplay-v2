CREATE TYPE "ReportType" AS ENUM ('SUMMARY', 'TABLE', 'TIME_SERIES');
CREATE TYPE "ReportVisibility" AS ENUM ('PRIVATE', 'SELECTED_MEMBERS', 'SCOPE');
CREATE TYPE "ReportStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "ReportExecutionType" AS ENUM ('PREVIEW', 'MANUAL_EXPORT', 'SCHEDULED_EXPORT');
CREATE TYPE "ReportExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "ReportExportFormat" AS ENUM ('CSV', 'XLSX');
CREATE TYPE "ReportExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED', 'DELETED', 'CANCELLED');
CREATE TYPE "ReportScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

CREATE TABLE "reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scope_type" "AnalyticsScopeType" NOT NULL,
  "scope_id" UUID NOT NULL,
  "workspace_id" UUID,
  "agency_id" UUID,
  "super_agency_id" UUID,
  "created_by_user_id" UUID,
  "created_by_workspace_membership_id" UUID,
  "created_by_agency_membership_id" UUID,
  "created_by_super_agency_membership_id" UUID,
  "name" VARCHAR(160) NOT NULL,
  "description" VARCHAR(500),
  "type" "ReportType" NOT NULL,
  "visibility" "ReportVisibility" NOT NULL DEFAULT 'PRIVATE',
  "configuration" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" "ReportStatus" NOT NULL DEFAULT 'ACTIVE',
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reports_scope_consistency" CHECK (
    ("scope_type" = 'WORKSPACE' AND "workspace_id" = "scope_id" AND "agency_id" IS NOT NULL AND "super_agency_id" IS NOT NULL)
    OR ("scope_type" = 'AGENCY' AND "workspace_id" IS NULL AND "agency_id" = "scope_id" AND "super_agency_id" IS NOT NULL)
    OR ("scope_type" = 'SUPER_AGENCY' AND "workspace_id" IS NULL AND "agency_id" IS NULL AND "super_agency_id" = "scope_id")
    OR ("scope_type" = 'PLATFORM' AND "workspace_id" IS NULL AND "agency_id" IS NULL AND "super_agency_id" IS NULL)
  )
);

CREATE TABLE "report_access" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_id" UUID NOT NULL,
  "scope_type" "AnalyticsScopeType" NOT NULL,
  "scope_id" UUID NOT NULL,
  "workspace_membership_id" UUID,
  "agency_membership_id" UUID,
  "super_agency_membership_id" UUID,
  "user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_access_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_access_one_subject" CHECK (
    num_nonnulls("workspace_membership_id", "agency_membership_id", "super_agency_membership_id", "user_id") = 1
  )
);

CREATE TABLE "report_executions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_id" UUID NOT NULL,
  "scope_type" "AnalyticsScopeType" NOT NULL,
  "scope_id" UUID NOT NULL,
  "report_revision" INTEGER NOT NULL,
  "config_snapshot" JSONB NOT NULL,
  "execution_type" "ReportExecutionType" NOT NULL,
  "status" "ReportExecutionStatus" NOT NULL DEFAULT 'PENDING',
  "requested_by_user_id" UUID,
  "requested_by_membership_id" UUID,
  "scheduled_occurrence_key" VARCHAR(120),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "row_count" INTEGER,
  "safe_error_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "report_exports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_id" UUID NOT NULL,
  "execution_id" UUID,
  "scope_type" "AnalyticsScopeType" NOT NULL,
  "scope_id" UUID NOT NULL,
  "format" "ReportExportFormat" NOT NULL,
  "status" "ReportExportStatus" NOT NULL DEFAULT 'QUEUED',
  "requested_by_user_id" UUID,
  "requested_by_membership_id" UUID,
  "report_revision" INTEGER NOT NULL,
  "config_snapshot" JSONB NOT NULL,
  "filename" VARCHAR(220) NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL,
  "storage_provider" VARCHAR(40),
  "storage_bucket" VARCHAR(120),
  "storage_key" VARCHAR(512),
  "size_bytes" BIGINT,
  "row_count" INTEGER,
  "idempotency_key" VARCHAR(160),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "completed_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "safe_error_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "report_schedules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_id" UUID NOT NULL,
  "scope_type" "AnalyticsScopeType" NOT NULL,
  "scope_id" UUID NOT NULL,
  "frequency" "ReportScheduleFrequency" NOT NULL,
  "timezone" VARCHAR(80) NOT NULL DEFAULT 'UTC',
  "local_time" VARCHAR(5) NOT NULL,
  "day_of_week" INTEGER,
  "day_of_month" INTEGER,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "recipient_config" JSONB NOT NULL,
  "next_run_at" TIMESTAMPTZ(6) NOT NULL,
  "last_run_at" TIMESTAMPTZ(6),
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_schedule_local_time" CHECK ("local_time" ~ '^[0-2][0-9]:[0-5][0-9]$'),
  CONSTRAINT "report_schedule_day_of_week" CHECK ("day_of_week" IS NULL OR ("day_of_week" >= 1 AND "day_of_week" <= 7)),
  CONSTRAINT "report_schedule_day_of_month" CHECK ("day_of_month" IS NULL OR ("day_of_month" >= 1 AND "day_of_month" <= 31))
);

CREATE TABLE "report_schedule_occurrences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schedule_id" UUID NOT NULL,
  "occurrence_key" VARCHAR(120) NOT NULL,
  "status" "ReportExecutionStatus" NOT NULL DEFAULT 'PENDING',
  "execution_id" UUID,
  "export_id" UUID,
  "claimed_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "safe_error_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_schedule_occurrences_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "report_access" ADD CONSTRAINT "report_access_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_executions" ADD CONSTRAINT "report_executions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "report_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_schedule_occurrences" ADD CONSTRAINT "report_schedule_occurrences_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "report_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "reports_scope_status_updated_idx" ON "reports"("scope_type", "scope_id", "status", "updated_at");
CREATE INDEX "reports_workspace_status_idx" ON "reports"("workspace_id", "status");
CREATE INDEX "reports_agency_status_idx" ON "reports"("agency_id", "status");
CREATE INDEX "reports_super_agency_status_idx" ON "reports"("super_agency_id", "status");

CREATE UNIQUE INDEX "report_access_workspace_member_key" ON "report_access"("report_id", "workspace_membership_id");
CREATE UNIQUE INDEX "report_access_agency_member_key" ON "report_access"("report_id", "agency_membership_id");
CREATE UNIQUE INDEX "report_access_super_agency_member_key" ON "report_access"("report_id", "super_agency_membership_id");
CREATE UNIQUE INDEX "report_access_user_key" ON "report_access"("report_id", "user_id");
CREATE INDEX "report_access_scope_idx" ON "report_access"("scope_type", "scope_id");

CREATE UNIQUE INDEX "report_executions_occurrence_key" ON "report_executions"("report_id", "scheduled_occurrence_key");
CREATE INDEX "report_executions_scope_created_idx" ON "report_executions"("scope_type", "scope_id", "created_at");
CREATE INDEX "report_executions_status_created_idx" ON "report_executions"("status", "created_at");

CREATE UNIQUE INDEX "report_exports_user_idempotency_key" ON "report_exports"("report_id", "requested_by_user_id", "idempotency_key");
CREATE INDEX "report_exports_scope_status_created_idx" ON "report_exports"("scope_type", "scope_id", "status", "created_at");
CREATE INDEX "report_exports_status_expires_idx" ON "report_exports"("status", "expires_at");

CREATE INDEX "report_schedules_enabled_next_idx" ON "report_schedules"("enabled", "next_run_at");
CREATE INDEX "report_schedules_scope_enabled_idx" ON "report_schedules"("scope_type", "scope_id", "enabled");

CREATE UNIQUE INDEX "report_schedule_occurrences_once_key" ON "report_schedule_occurrences"("schedule_id", "occurrence_key");
CREATE INDEX "report_schedule_occurrences_status_claimed_idx" ON "report_schedule_occurrences"("status", "claimed_at");

INSERT INTO "permissions" ("key", "description")
VALUES
  ('reports.view', 'View saved analytics reports'),
  ('reports.create', 'Create saved analytics reports'),
  ('reports.edit', 'Edit saved analytics reports'),
  ('reports.export', 'Export saved analytics reports'),
  ('reports.schedule', 'Manage scheduled report delivery'),
  ('reports.manage', 'Manage report visibility and lifecycle'),
  ('reports.platform.read', 'View platform report surfaces')
ON CONFLICT ("key") DO NOTHING;
