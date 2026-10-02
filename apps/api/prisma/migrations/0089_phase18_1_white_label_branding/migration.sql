CREATE TYPE "WhiteLabelScopeType" AS ENUM (
  'PLATFORM',
  'SUPER_AGENCY',
  'AGENCY',
  'WORKSPACE'
);

CREATE TABLE "white_label_branding" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scope_type" "WhiteLabelScopeType" NOT NULL,
  "scope_id" UUID NOT NULL,
  "app_name" VARCHAR(80),
  "company_name" VARCHAR(120),
  "logo_asset_id" UUID,
  "logo_asset_workspace_id" UUID,
  "dark_logo_asset_id" UUID,
  "dark_logo_asset_workspace_id" UUID,
  "favicon_asset_id" UUID,
  "favicon_asset_workspace_id" UUID,
  "login_background_asset_id" UUID,
  "login_background_asset_workspace_id" UUID,
  "primary_color" VARCHAR(7),
  "accent_color" VARCHAR(7),
  "support_email" VARCHAR(320),
  "support_url" VARCHAR(500),
  "footer_text" VARCHAR(160),
  "meta_description" VARCHAR(180),
  "agency_allowed_overrides" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "workspace_allowed_overrides" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" UUID,
  "updated_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "white_label_branding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "white_label_branding_revision_positive" CHECK ("revision" >= 1),
  CONSTRAINT "white_label_branding_platform_scope_id" CHECK (
    ("scope_type" = 'PLATFORM' AND "scope_id" = '00000000-0000-0000-0000-000000000000'::UUID)
    OR ("scope_type" <> 'PLATFORM' AND "scope_id" <> '00000000-0000-0000-0000-000000000000'::UUID)
  ),
  CONSTRAINT "white_label_branding_color_format" CHECK (
    ("primary_color" IS NULL OR "primary_color" ~ '^#[0-9A-Fa-f]{6}$')
    AND ("accent_color" IS NULL OR "accent_color" ~ '^#[0-9A-Fa-f]{6}$')
  ),
  CONSTRAINT "white_label_branding_logo_pair" CHECK (
    ("logo_asset_id" IS NULL AND "logo_asset_workspace_id" IS NULL)
    OR ("logo_asset_id" IS NOT NULL AND "logo_asset_workspace_id" IS NOT NULL)
  ),
  CONSTRAINT "white_label_branding_dark_logo_pair" CHECK (
    ("dark_logo_asset_id" IS NULL AND "dark_logo_asset_workspace_id" IS NULL)
    OR ("dark_logo_asset_id" IS NOT NULL AND "dark_logo_asset_workspace_id" IS NOT NULL)
  ),
  CONSTRAINT "white_label_branding_favicon_pair" CHECK (
    ("favicon_asset_id" IS NULL AND "favicon_asset_workspace_id" IS NULL)
    OR ("favicon_asset_id" IS NOT NULL AND "favicon_asset_workspace_id" IS NOT NULL)
  ),
  CONSTRAINT "white_label_branding_login_background_pair" CHECK (
    ("login_background_asset_id" IS NULL AND "login_background_asset_workspace_id" IS NULL)
    OR ("login_background_asset_id" IS NOT NULL AND "login_background_asset_workspace_id" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "white_label_branding_scope_key"
ON "white_label_branding"("scope_type", "scope_id");

CREATE INDEX "white_label_branding_scope_updated_idx"
ON "white_label_branding"("scope_type", "updated_at");

CREATE INDEX "white_label_branding_logo_asset_idx"
ON "white_label_branding"("logo_asset_workspace_id", "logo_asset_id");

CREATE INDEX "white_label_branding_dark_logo_asset_idx"
ON "white_label_branding"("dark_logo_asset_workspace_id", "dark_logo_asset_id");

CREATE INDEX "white_label_branding_favicon_asset_idx"
ON "white_label_branding"("favicon_asset_workspace_id", "favicon_asset_id");

CREATE INDEX "white_label_branding_login_background_asset_idx"
ON "white_label_branding"("login_background_asset_workspace_id", "login_background_asset_id");

INSERT INTO "permissions" ("key", "description")
VALUES
  ('branding.manage', 'Manage tenant white-label branding'),
  ('branding.platform.manage', 'Manage platform white-label defaults')
ON CONFLICT ("key") DO NOTHING;

WITH branding_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" = 'branding.manage'
),
system_role_permission_keys AS (
  SELECT *
  FROM (VALUES
    ('SUPER_AGENCY_OWNER', 'branding.manage'),
    ('SUPER_AGENCY_ADMIN', 'branding.manage'),
    ('AGENCY_OWNER', 'branding.manage'),
    ('AGENCY_ADMIN', 'branding.manage'),
    ('OWNER', 'branding.manage'),
    ('ADMIN', 'branding.manage')
  ) AS grants("role_key", "permission_key")
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", branding_permissions."id"
FROM system_role_permission_keys
JOIN "roles" roles ON roles."key" = system_role_permission_keys."role_key"
JOIN branding_permissions ON branding_permissions."key" = system_role_permission_keys."permission_key"
ON CONFLICT DO NOTHING;

WITH platform_permissions AS (
  SELECT "id"
  FROM "permissions"
  WHERE "key" IN ('branding.platform.manage', 'branding.manage')
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
