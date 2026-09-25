CREATE TYPE "CloudDriveProvider" AS ENUM ('GOOGLE_DRIVE', 'ONEDRIVE', 'DROPBOX');

CREATE TYPE "CloudDriveConnectionStatus" AS ENUM (
  'CONNECTED',
  'EXPIRED',
  'REAUTH_REQUIRED',
  'REVOKED',
  'ERROR'
);

CREATE TABLE "cloud_drive_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "provider" "CloudDriveProvider" NOT NULL,
  "display_name" VARCHAR(160),
  "status" "CloudDriveConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
  "provider_account_id" VARCHAR(255),
  "provider_account_label" VARCHAR(255),
  "encrypted_access_token" TEXT,
  "encrypted_refresh_token" TEXT,
  "token_expires_at" TIMESTAMPTZ(6),
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "root_folder_id" VARCHAR(512),
  "connected_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "last_validated_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  CONSTRAINT "cloud_drive_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cloud_drive_oauth_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "state_hash" VARCHAR(128) NOT NULL,
  "workspace_id" UUID NOT NULL,
  "provider" "CloudDriveProvider" NOT NULL,
  "actor_membership_id" UUID NOT NULL,
  "redirect_path" VARCHAR(512),
  "encrypted_pkce_verifier" TEXT,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_drive_oauth_states_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "assets"
  ADD COLUMN "source_provider" "CloudDriveProvider",
  ADD COLUMN "source_connection_id" UUID,
  ADD COLUMN "source_provider_file_id" VARCHAR(512);

CREATE UNIQUE INDEX "cloud_drive_oauth_states_state_hash_key"
  ON "cloud_drive_oauth_states"("state_hash");

CREATE UNIQUE INDEX "cloud_drive_connections_id_workspace_id_key"
  ON "cloud_drive_connections"("id", "workspace_id");

CREATE UNIQUE INDEX "cloud_drive_connections_one_active_provider"
  ON "cloud_drive_connections"("workspace_id", "provider")
  WHERE "revoked_at" IS NULL AND "status" <> 'REVOKED';

CREATE INDEX "cloud_drive_connections_workspace_provider_status_idx"
  ON "cloud_drive_connections"("workspace_id", "provider", "status");

CREATE INDEX "cloud_drive_connections_connected_by_membership_id_idx"
  ON "cloud_drive_connections"("connected_by_membership_id");

CREATE INDEX "cloud_drive_oauth_states_workspace_provider_expires_at_idx"
  ON "cloud_drive_oauth_states"("workspace_id", "provider", "expires_at");

CREATE INDEX "cloud_drive_oauth_states_expires_at_idx"
  ON "cloud_drive_oauth_states"("expires_at");

CREATE INDEX "assets_workspace_source_provider_file_idx"
  ON "assets"("workspace_id", "source_provider", "source_provider_file_id");

CREATE INDEX "assets_source_connection_id_idx"
  ON "assets"("source_connection_id");

ALTER TABLE "cloud_drive_connections"
  ADD CONSTRAINT "cloud_drive_connections_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cloud_drive_connections"
  ADD CONSTRAINT "cloud_drive_connections_connected_by_membership_fkey"
  FOREIGN KEY ("connected_by_membership_id", "workspace_id")
  REFERENCES "workspace_memberships"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cloud_drive_oauth_states"
  ADD CONSTRAINT "cloud_drive_oauth_states_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cloud_drive_oauth_states"
  ADD CONSTRAINT "cloud_drive_oauth_states_actor_membership_fkey"
  FOREIGN KEY ("actor_membership_id", "workspace_id")
  REFERENCES "workspace_memberships"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_source_connection_fkey"
  FOREIGN KEY ("source_connection_id", "workspace_id")
  REFERENCES "cloud_drive_connections"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
