CREATE TYPE "DashboardVisibility" AS ENUM (
  'PRIVATE',
  'SELECTED_MEMBERS',
  'WORKSPACE',
  'SCOPE'
);

CREATE TYPE "DashboardStatus" AS ENUM (
  'ACTIVE',
  'ARCHIVED'
);

CREATE TYPE "DashboardWidgetType" AS ENUM (
  'METRIC_CARD',
  'LINE_CHART',
  'BAR_CHART',
  'AREA_CHART',
  'PIE_CHART',
  'DONUT_CHART',
  'TABLE',
  'GOAL_PROGRESS',
  'GAMIFICATION_SUMMARY'
);

CREATE TYPE "DashboardWidgetDataSourceType" AS ENUM (
  'ANALYTICS_QUERY',
  'SAVED_REPORT'
);

CREATE TABLE "custom_dashboards" (
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
  "visibility" "DashboardVisibility" NOT NULL DEFAULT 'PRIVATE',
  "global_filters" JSONB NOT NULL DEFAULT '{}',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" "DashboardStatus" NOT NULL DEFAULT 'ACTIVE',
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "custom_dashboards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custom_dashboards_scope_consistency" CHECK (
    ("scope_type" = 'WORKSPACE' AND "workspace_id" = "scope_id" AND "agency_id" IS NOT NULL AND "super_agency_id" IS NOT NULL)
    OR ("scope_type" = 'AGENCY' AND "workspace_id" IS NULL AND "agency_id" = "scope_id" AND "super_agency_id" IS NOT NULL)
    OR ("scope_type" = 'SUPER_AGENCY' AND "workspace_id" IS NULL AND "agency_id" IS NULL AND "super_agency_id" = "scope_id")
    OR ("scope_type" = 'PLATFORM' AND "workspace_id" IS NULL AND "agency_id" IS NULL AND "super_agency_id" IS NULL)
  ),
  CONSTRAINT "custom_dashboards_visibility_scope" CHECK (
    ("scope_type" = 'WORKSPACE' AND "visibility" IN ('PRIVATE', 'SELECTED_MEMBERS', 'WORKSPACE'))
    OR ("scope_type" IN ('AGENCY', 'SUPER_AGENCY', 'PLATFORM') AND "visibility" IN ('PRIVATE', 'SELECTED_MEMBERS', 'SCOPE'))
  )
);

CREATE TABLE "dashboard_access" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "dashboard_id" UUID NOT NULL,
  "scope_type" "AnalyticsScopeType" NOT NULL,
  "scope_id" UUID NOT NULL,
  "workspace_membership_id" UUID,
  "agency_membership_id" UUID,
  "super_agency_membership_id" UUID,
  "user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dashboard_access_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dashboard_access_one_subject" CHECK (
    num_nonnulls("workspace_membership_id", "agency_membership_id", "super_agency_membership_id", "user_id") = 1
  ),
  CONSTRAINT "dashboard_access_subject_scope" CHECK (
    ("scope_type" = 'WORKSPACE' AND "workspace_membership_id" IS NOT NULL)
    OR ("scope_type" = 'AGENCY' AND "agency_membership_id" IS NOT NULL)
    OR ("scope_type" = 'SUPER_AGENCY' AND "super_agency_membership_id" IS NOT NULL)
    OR ("scope_type" = 'PLATFORM' AND "user_id" IS NOT NULL)
  )
);

CREATE TABLE "dashboard_widgets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "dashboard_id" UUID NOT NULL,
  "type" "DashboardWidgetType" NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "description" VARCHAR(500),
  "data_source_type" "DashboardWidgetDataSourceType" NOT NULL,
  "configuration" JSONB NOT NULL,
  "layout" JSONB NOT NULL,
  "refresh_seconds" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dashboard_widgets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dashboard_widgets_refresh_min" CHECK ("refresh_seconds" IS NULL OR "refresh_seconds" >= 60)
);

CREATE TABLE "dashboard_preferences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "dashboard_id" UUID NOT NULL,
  "scope_type" "AnalyticsScopeType" NOT NULL,
  "scope_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "is_favorite" BOOLEAN NOT NULL DEFAULT FALSE,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "context_key" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dashboard_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dashboard_preferences_has_meaning" CHECK ("is_favorite" = TRUE OR "is_default" = TRUE)
);

ALTER TABLE "dashboard_access" ADD CONSTRAINT "dashboard_access_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "custom_dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "custom_dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dashboard_preferences" ADD CONSTRAINT "dashboard_preferences_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "custom_dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "custom_dashboards_scope_status_updated_idx" ON "custom_dashboards"("scope_type", "scope_id", "status", "updated_at");
CREATE INDEX "custom_dashboards_workspace_status_idx" ON "custom_dashboards"("workspace_id", "status");
CREATE INDEX "custom_dashboards_agency_status_idx" ON "custom_dashboards"("agency_id", "status");
CREATE INDEX "custom_dashboards_super_agency_status_idx" ON "custom_dashboards"("super_agency_id", "status");

CREATE UNIQUE INDEX "dashboard_access_workspace_member_key" ON "dashboard_access"("dashboard_id", "workspace_membership_id");
CREATE UNIQUE INDEX "dashboard_access_agency_member_key" ON "dashboard_access"("dashboard_id", "agency_membership_id");
CREATE UNIQUE INDEX "dashboard_access_super_agency_member_key" ON "dashboard_access"("dashboard_id", "super_agency_membership_id");
CREATE UNIQUE INDEX "dashboard_access_user_key" ON "dashboard_access"("dashboard_id", "user_id");
CREATE INDEX "dashboard_access_scope_idx" ON "dashboard_access"("scope_type", "scope_id");

CREATE INDEX "dashboard_widgets_dashboard_updated_idx" ON "dashboard_widgets"("dashboard_id", "updated_at");
CREATE UNIQUE INDEX "dashboard_widgets_max_30_idx" ON "dashboard_widgets"("dashboard_id", "id");

CREATE UNIQUE INDEX "dashboard_preferences_dashboard_user_key" ON "dashboard_preferences"("dashboard_id", "user_id");
CREATE INDEX "dashboard_preferences_user_context_idx" ON "dashboard_preferences"("user_id", "context_key");
CREATE INDEX "dashboard_preferences_user_scope_idx" ON "dashboard_preferences"("user_id", "scope_type", "scope_id");
CREATE UNIQUE INDEX "dashboard_preferences_one_default_per_context"
ON "dashboard_preferences"("user_id", "context_key")
WHERE "is_default" = TRUE;

CREATE OR REPLACE FUNCTION "dashboard_widgets_limit_30"()
RETURNS trigger AS $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM "dashboard_widgets"
    WHERE "dashboard_id" = NEW."dashboard_id"
  ) >= 30 THEN
    RAISE EXCEPTION 'DASHBOARD_WIDGET_LIMIT_EXCEEDED';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "dashboard_widgets_limit_30_trg"
BEFORE INSERT ON "dashboard_widgets"
FOR EACH ROW
EXECUTE FUNCTION "dashboard_widgets_limit_30"();

INSERT INTO "permissions" ("key", "description")
VALUES
  ('dashboards.view', 'View custom dashboards'),
  ('dashboards.create', 'Create custom dashboards'),
  ('dashboards.edit', 'Edit custom dashboards and widgets'),
  ('dashboards.manage', 'Manage custom dashboard visibility and lifecycle'),
  ('dashboards.platform.read', 'View platform custom dashboard surfaces')
ON CONFLICT ("key") DO NOTHING;

WITH dashboard_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN ('dashboards.view', 'dashboards.create', 'dashboards.edit', 'dashboards.manage')
),
system_role_permission_keys AS (
  SELECT *
  FROM (VALUES
    ('SUPER_AGENCY_OWNER', 'dashboards.view'),
    ('SUPER_AGENCY_OWNER', 'dashboards.create'),
    ('SUPER_AGENCY_OWNER', 'dashboards.edit'),
    ('SUPER_AGENCY_OWNER', 'dashboards.manage'),
    ('SUPER_AGENCY_ADMIN', 'dashboards.view'),
    ('SUPER_AGENCY_ADMIN', 'dashboards.create'),
    ('SUPER_AGENCY_ADMIN', 'dashboards.edit'),
    ('SUPER_AGENCY_ADMIN', 'dashboards.manage'),
    ('SUPER_AGENCY_MANAGER', 'dashboards.view'),
    ('AGENCY_OWNER', 'dashboards.view'),
    ('AGENCY_OWNER', 'dashboards.create'),
    ('AGENCY_OWNER', 'dashboards.edit'),
    ('AGENCY_OWNER', 'dashboards.manage'),
    ('AGENCY_ADMIN', 'dashboards.view'),
    ('AGENCY_ADMIN', 'dashboards.create'),
    ('AGENCY_ADMIN', 'dashboards.edit'),
    ('AGENCY_ADMIN', 'dashboards.manage'),
    ('AGENCY_MANAGER', 'dashboards.view'),
    ('OWNER', 'dashboards.view'),
    ('OWNER', 'dashboards.create'),
    ('OWNER', 'dashboards.edit'),
    ('OWNER', 'dashboards.manage'),
    ('ADMIN', 'dashboards.view'),
    ('ADMIN', 'dashboards.create'),
    ('ADMIN', 'dashboards.edit'),
    ('ADMIN', 'dashboards.manage'),
    ('MANAGER', 'dashboards.view'),
    ('MANAGER', 'dashboards.create'),
    ('MANAGER', 'dashboards.edit'),
    ('MEMBER', 'dashboards.view')
  ) AS grants("role_key", "permission_key")
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", dashboard_permissions."id"
FROM system_role_permission_keys
JOIN "roles" roles ON roles."key" = system_role_permission_keys."role_key"
JOIN dashboard_permissions ON dashboard_permissions."key" = system_role_permission_keys."permission_key"
ON CONFLICT DO NOTHING;

WITH platform_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN (
    'dashboards.platform.read',
    'dashboards.view',
    'dashboards.create',
    'dashboards.edit',
    'dashboards.manage'
  )
),
platform_roles AS (
  SELECT "id"
  FROM "roles"
  WHERE "scope" = 'LEGACY_ORGANIZATION' OR "key" IN ('PLATFORM_OWNER', 'PLATFORM_ADMIN', 'DEVELOPER')
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT platform_roles."id", platform_permissions."id"
FROM platform_roles
CROSS JOIN platform_permissions
ON CONFLICT DO NOTHING;
