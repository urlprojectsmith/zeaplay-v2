CREATE TYPE "TaskRecurrenceFrequency" AS ENUM ('DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY', 'CUSTOM');
CREATE TYPE "TaskRecurrenceCustomUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');
CREATE TYPE "TaskRecurrenceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED', 'ERROR');
CREATE TYPE "TaskRecurrenceEndMode" AS ENUM ('NEVER', 'ON_DATE', 'AFTER_COUNT');
CREATE TYPE "TaskTemplateStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

ALTER TABLE "tasks"
  ADD COLUMN "recurrence_series_id" UUID,
  ADD COLUMN "recurrence_scheduled_for" TIMESTAMPTZ(6),
  ADD COLUMN "recurrence_sequence" INTEGER,
  ADD COLUMN "recurrence_is_exception" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "task_recurrence_series" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "status" "TaskRecurrenceStatus" NOT NULL DEFAULT 'ACTIVE',
  "title" VARCHAR(160) NOT NULL,
  "description" VARCHAR(4000),
  "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
  "status_definition_id" UUID NOT NULL,
  "department_id" UUID,
  "timezone" VARCHAR(80) NOT NULL,
  "frequency" "TaskRecurrenceFrequency" NOT NULL,
  "interval" INTEGER NOT NULL DEFAULT 1,
  "custom_interval_unit" "TaskRecurrenceCustomUnit",
  "start_local_date" DATE NOT NULL,
  "local_time" VARCHAR(5) NOT NULL,
  "selected_weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "monthly_day" INTEGER,
  "end_mode" "TaskRecurrenceEndMode" NOT NULL DEFAULT 'NEVER',
  "until_local_date" DATE,
  "max_occurrences" INTEGER,
  "generated_count" INTEGER NOT NULL DEFAULT 0,
  "next_occurrence_at" TIMESTAMPTZ(6),
  "last_generated_at" TIMESTAMPTZ(6),
  "paused_at" TIMESTAMPTZ(6),
  "ended_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(80),
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "task_recurrence_series_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_recurrence_series_interval_check" CHECK ("interval" >= 1 AND "interval" <= 366),
  CONSTRAINT "task_recurrence_series_generated_count_check" CHECK ("generated_count" >= 0),
  CONSTRAINT "task_recurrence_series_weekdays_check" CHECK (array_length("selected_weekdays", 1) IS NULL OR "selected_weekdays" <@ ARRAY[1,2,3,4,5,6,7]),
  CONSTRAINT "task_recurrence_series_monthly_day_check" CHECK ("monthly_day" IS NULL OR ("monthly_day" >= 1 AND "monthly_day" <= 31)),
  CONSTRAINT "task_recurrence_series_local_time_check" CHECK ("local_time" ~ '^[0-2][0-9]:[0-5][0-9]$'),
  CONSTRAINT "task_recurrence_series_custom_check" CHECK (("frequency" = 'CUSTOM' AND "custom_interval_unit" IS NOT NULL) OR ("frequency" <> 'CUSTOM' AND "custom_interval_unit" IS NULL)),
  CONSTRAINT "task_recurrence_series_on_date_check" CHECK (("end_mode" = 'ON_DATE' AND "until_local_date" IS NOT NULL) OR ("end_mode" <> 'ON_DATE' AND "until_local_date" IS NULL)),
  CONSTRAINT "task_recurrence_series_after_count_check" CHECK (("end_mode" = 'AFTER_COUNT' AND "max_occurrences" IS NOT NULL AND "max_occurrences" >= 1 AND "max_occurrences" <= 10000) OR ("end_mode" <> 'AFTER_COUNT' AND "max_occurrences" IS NULL))
);

CREATE TABLE "task_recurrence_assignees" (
  "series_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_recurrence_assignees_pkey" PRIMARY KEY ("series_id", "membership_id")
);

CREATE TABLE "task_recurrence_followers" (
  "series_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_recurrence_followers_pkey" PRIMARY KEY ("series_id", "membership_id")
);

CREATE TABLE "task_recurrence_projects" (
  "series_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_recurrence_projects_pkey" PRIMARY KEY ("series_id", "project_id")
);

CREATE TABLE "task_recurrence_tags" (
  "series_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "tag_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_recurrence_tags_pkey" PRIMARY KEY ("series_id", "tag_id")
);

CREATE TABLE "task_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "name_normalized" VARCHAR(120) NOT NULL,
  "status" "TaskTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
  "title" VARCHAR(160) NOT NULL,
  "description" VARCHAR(4000),
  "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
  "status_definition_id" UUID NOT NULL,
  "department_id" UUID,
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_template_assignees" (
  "template_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_template_assignees_pkey" PRIMARY KEY ("template_id", "membership_id")
);

CREATE TABLE "task_template_followers" (
  "template_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_template_followers_pkey" PRIMARY KEY ("template_id", "membership_id")
);

CREATE TABLE "task_template_projects" (
  "template_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_template_projects_pkey" PRIMARY KEY ("template_id", "project_id")
);

CREATE TABLE "task_template_tags" (
  "template_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "tag_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_template_tags_pkey" PRIMARY KEY ("template_id", "tag_id")
);

CREATE UNIQUE INDEX "tasks_recurrence_series_id_recurrence_sequence_key" ON "tasks"("recurrence_series_id", "recurrence_sequence");
CREATE INDEX "tasks_workspace_id_recurrence_series_id_recurrence_sequence_idx" ON "tasks"("workspace_id", "recurrence_series_id", "recurrence_sequence");
CREATE UNIQUE INDEX "task_recurrence_series_id_workspace_id_key" ON "task_recurrence_series"("id", "workspace_id");
CREATE INDEX "task_recurrence_series_workspace_id_status_next_occurrence_at_idx" ON "task_recurrence_series"("workspace_id", "status", "next_occurrence_at");
CREATE INDEX "task_recurrence_series_status_next_occurrence_at_idx" ON "task_recurrence_series"("status", "next_occurrence_at");
CREATE INDEX "task_recurrence_series_workspace_id_created_at_idx" ON "task_recurrence_series"("workspace_id", "created_at");
CREATE INDEX "task_recurrence_assignees_workspace_id_membership_id_idx" ON "task_recurrence_assignees"("workspace_id", "membership_id");
CREATE INDEX "task_recurrence_followers_workspace_id_membership_id_idx" ON "task_recurrence_followers"("workspace_id", "membership_id");
CREATE INDEX "task_recurrence_projects_workspace_id_project_id_idx" ON "task_recurrence_projects"("workspace_id", "project_id");
CREATE INDEX "task_recurrence_tags_workspace_id_tag_id_idx" ON "task_recurrence_tags"("workspace_id", "tag_id");
CREATE UNIQUE INDEX "task_templates_workspace_id_name_normalized_key" ON "task_templates"("workspace_id", "name_normalized");
CREATE UNIQUE INDEX "task_templates_id_workspace_id_key" ON "task_templates"("id", "workspace_id");
CREATE INDEX "task_templates_workspace_id_status_name_normalized_idx" ON "task_templates"("workspace_id", "status", "name_normalized");
CREATE INDEX "task_templates_workspace_id_created_at_idx" ON "task_templates"("workspace_id", "created_at");
CREATE INDEX "task_template_assignees_workspace_id_membership_id_idx" ON "task_template_assignees"("workspace_id", "membership_id");
CREATE INDEX "task_template_followers_workspace_id_membership_id_idx" ON "task_template_followers"("workspace_id", "membership_id");
CREATE INDEX "task_template_projects_workspace_id_project_id_idx" ON "task_template_projects"("workspace_id", "project_id");
CREATE INDEX "task_template_tags_workspace_id_tag_id_idx" ON "task_template_tags"("workspace_id", "tag_id");

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_series_id_workspace_id_fkey" FOREIGN KEY ("recurrence_series_id", "workspace_id") REFERENCES "task_recurrence_series"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_series" ADD CONSTRAINT "task_recurrence_series_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_series" ADD CONSTRAINT "task_recurrence_series_status_definition_id_workspace_id_fkey" FOREIGN KEY ("status_definition_id", "workspace_id") REFERENCES "status_definitions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_series" ADD CONSTRAINT "task_recurrence_series_department_id_workspace_id_fkey" FOREIGN KEY ("department_id", "workspace_id") REFERENCES "departments"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_series" ADD CONSTRAINT "task_recurrence_series_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_series" ADD CONSTRAINT "task_recurrence_series_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_assignees" ADD CONSTRAINT "task_recurrence_assignees_series_id_workspace_id_fkey" FOREIGN KEY ("series_id", "workspace_id") REFERENCES "task_recurrence_series"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_assignees" ADD CONSTRAINT "task_recurrence_assignees_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_assignees" ADD CONSTRAINT "task_recurrence_assignees_membership_id_workspace_id_fkey" FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_followers" ADD CONSTRAINT "task_recurrence_followers_series_id_workspace_id_fkey" FOREIGN KEY ("series_id", "workspace_id") REFERENCES "task_recurrence_series"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_followers" ADD CONSTRAINT "task_recurrence_followers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_followers" ADD CONSTRAINT "task_recurrence_followers_membership_id_workspace_id_fkey" FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_projects" ADD CONSTRAINT "task_recurrence_projects_series_id_workspace_id_fkey" FOREIGN KEY ("series_id", "workspace_id") REFERENCES "task_recurrence_series"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_projects" ADD CONSTRAINT "task_recurrence_projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_projects" ADD CONSTRAINT "task_recurrence_projects_project_id_workspace_id_fkey" FOREIGN KEY ("project_id", "workspace_id") REFERENCES "projects"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_tags" ADD CONSTRAINT "task_recurrence_tags_series_id_workspace_id_fkey" FOREIGN KEY ("series_id", "workspace_id") REFERENCES "task_recurrence_series"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_tags" ADD CONSTRAINT "task_recurrence_tags_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_tags" ADD CONSTRAINT "task_recurrence_tags_tag_id_workspace_id_fkey" FOREIGN KEY ("tag_id", "workspace_id") REFERENCES "workspace_tags"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_status_definition_id_workspace_id_fkey" FOREIGN KEY ("status_definition_id", "workspace_id") REFERENCES "status_definitions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_department_id_workspace_id_fkey" FOREIGN KEY ("department_id", "workspace_id") REFERENCES "departments"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_template_assignees" ADD CONSTRAINT "task_template_assignees_template_id_workspace_id_fkey" FOREIGN KEY ("template_id", "workspace_id") REFERENCES "task_templates"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_template_assignees" ADD CONSTRAINT "task_template_assignees_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_template_assignees" ADD CONSTRAINT "task_template_assignees_membership_id_workspace_id_fkey" FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_template_followers" ADD CONSTRAINT "task_template_followers_template_id_workspace_id_fkey" FOREIGN KEY ("template_id", "workspace_id") REFERENCES "task_templates"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_template_followers" ADD CONSTRAINT "task_template_followers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_template_followers" ADD CONSTRAINT "task_template_followers_membership_id_workspace_id_fkey" FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_template_projects" ADD CONSTRAINT "task_template_projects_template_id_workspace_id_fkey" FOREIGN KEY ("template_id", "workspace_id") REFERENCES "task_templates"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_template_projects" ADD CONSTRAINT "task_template_projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_template_projects" ADD CONSTRAINT "task_template_projects_project_id_workspace_id_fkey" FOREIGN KEY ("project_id", "workspace_id") REFERENCES "projects"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_template_tags" ADD CONSTRAINT "task_template_tags_template_id_workspace_id_fkey" FOREIGN KEY ("template_id", "workspace_id") REFERENCES "task_templates"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_template_tags" ADD CONSTRAINT "task_template_tags_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_template_tags" ADD CONSTRAINT "task_template_tags_tag_id_workspace_id_fkey" FOREIGN KEY ("tag_id", "workspace_id") REFERENCES "workspace_tags"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
