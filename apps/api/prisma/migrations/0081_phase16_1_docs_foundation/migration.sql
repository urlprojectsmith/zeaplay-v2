-- Phase 16.1: Workspace-owned Docs foundation.
-- Docs are operational Workspace data; Agency and Super Agency lineage is derived through Workspace.

CREATE TYPE "DocVisibility" AS ENUM ('PRIVATE', 'SELECTED_MEMBERS', 'WORKSPACE');
CREATE TYPE "DocStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "DocType" AS ENUM ('PAGE', 'TEMPLATE');
CREATE TYPE "DocAccessRole" AS ENUM ('VIEWER', 'EDITOR');
CREATE TYPE "DocCommentStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'ARCHIVED');
CREATE TYPE "DocShareStatus" AS ENUM ('ACTIVE', 'REVOKED');

ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'DOCS';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DOC_MENTIONED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DOC_COMMENT_MENTIONED';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'DOC';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'DOC_COMMENT';

CREATE TABLE "doc_folders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "parent_folder_id" UUID,
  "name" VARCHAR(160) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "archived_at" TIMESTAMPTZ(6),
  "created_by_membership_id" UUID NOT NULL,
  "updated_by_membership_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "doc_folders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "doc_folders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "doc_folders_created_by_membership_id_workspace_id_fkey" FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "doc_folders_updated_by_membership_id_workspace_id_fkey" FOREIGN KEY ("updated_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "doc_folders_no_self_parent_check" CHECK ("parent_folder_id" IS NULL OR "parent_folder_id" <> "id")
);

CREATE UNIQUE INDEX "doc_folders_id_workspace_id_key" ON "doc_folders"("id", "workspace_id");
ALTER TABLE "doc_folders" ADD CONSTRAINT "doc_folders_parent_folder_id_workspace_id_fkey" FOREIGN KEY ("parent_folder_id", "workspace_id") REFERENCES "doc_folders"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "doc_folders_workspace_id_archived_at_sort_order_idx" ON "doc_folders"("workspace_id", "archived_at", "sort_order");
CREATE INDEX "doc_folders_workspace_id_parent_folder_id_archived_at_sort_order_idx" ON "doc_folders"("workspace_id", "parent_folder_id", "archived_at", "sort_order");

CREATE TABLE "docs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "folder_id" UUID,
  "parent_doc_id" UUID,
  "title" VARCHAR(220) NOT NULL,
  "content" JSONB NOT NULL,
  "content_revision" INTEGER NOT NULL DEFAULT 1,
  "visibility" "DocVisibility" NOT NULL DEFAULT 'WORKSPACE',
  "type" "DocType" NOT NULL DEFAULT 'PAGE',
  "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_by_membership_id" UUID NOT NULL,
  "updated_by_membership_id" UUID,
  "archived_by_membership_id" UUID,
  "archived_at" TIMESTAMPTZ(6),
  "last_snapshot_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "docs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "docs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "docs_folder_id_workspace_id_fkey" FOREIGN KEY ("folder_id", "workspace_id") REFERENCES "doc_folders"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "docs_created_by_membership_id_workspace_id_fkey" FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "docs_updated_by_membership_id_workspace_id_fkey" FOREIGN KEY ("updated_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "docs_archived_by_membership_id_workspace_id_fkey" FOREIGN KEY ("archived_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "docs_revision_positive_check" CHECK ("content_revision" > 0),
  CONSTRAINT "docs_no_self_parent_check" CHECK ("parent_doc_id" IS NULL OR "parent_doc_id" <> "id")
);

CREATE UNIQUE INDEX "docs_id_workspace_id_key" ON "docs"("id", "workspace_id");
ALTER TABLE "docs" ADD CONSTRAINT "docs_parent_doc_id_workspace_id_fkey" FOREIGN KEY ("parent_doc_id", "workspace_id") REFERENCES "docs"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "docs_workspace_id_status_type_updated_at_idx" ON "docs"("workspace_id", "status", "type", "updated_at");
CREATE INDEX "docs_workspace_id_folder_id_status_sort_order_idx" ON "docs"("workspace_id", "folder_id", "status", "sort_order");
CREATE INDEX "docs_workspace_id_parent_doc_id_status_sort_order_idx" ON "docs"("workspace_id", "parent_doc_id", "status", "sort_order");
CREATE INDEX "docs_workspace_id_visibility_status_idx" ON "docs"("workspace_id", "visibility", "status");

CREATE TABLE "doc_access" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "doc_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "role" "DocAccessRole" NOT NULL DEFAULT 'VIEWER',
  "granted_by_membership_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "doc_access_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "doc_access_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "doc_access_doc_id_workspace_id_fkey" FOREIGN KEY ("doc_id", "workspace_id") REFERENCES "docs"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "doc_access_membership_id_workspace_id_fkey" FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "doc_access_granted_by_membership_id_workspace_id_fkey" FOREIGN KEY ("granted_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "doc_access_doc_id_membership_id_key" ON "doc_access"("doc_id", "membership_id");
CREATE INDEX "doc_access_workspace_id_membership_id_idx" ON "doc_access"("workspace_id", "membership_id");

CREATE TABLE "doc_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "doc_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "title_snapshot" VARCHAR(220) NOT NULL,
  "content_snapshot" JSONB NOT NULL,
  "source" VARCHAR(40) NOT NULL DEFAULT 'SNAPSHOT',
  "created_by_membership_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "doc_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "doc_versions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "doc_versions_doc_id_workspace_id_fkey" FOREIGN KEY ("doc_id", "workspace_id") REFERENCES "docs"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "doc_versions_created_by_membership_id_workspace_id_fkey" FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "doc_versions_revision_positive_check" CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "doc_versions_doc_id_revision_key" ON "doc_versions"("doc_id", "revision");
CREATE INDEX "doc_versions_workspace_id_doc_id_revision_idx" ON "doc_versions"("workspace_id", "doc_id", "revision");

CREATE TABLE "doc_comments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "doc_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "parent_comment_id" UUID,
  "body" VARCHAR(4000) NOT NULL,
  "anchor" JSONB,
  "status" "DocCommentStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_by_membership_id" UUID NOT NULL,
  "updated_by_membership_id" UUID,
  "resolved_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "doc_comments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "doc_comments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "doc_comments_doc_id_workspace_id_fkey" FOREIGN KEY ("doc_id", "workspace_id") REFERENCES "docs"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "doc_comments_created_by_membership_id_workspace_id_fkey" FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "doc_comments_updated_by_membership_id_workspace_id_fkey" FOREIGN KEY ("updated_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "doc_comments_id_workspace_id_key" ON "doc_comments"("id", "workspace_id");
ALTER TABLE "doc_comments" ADD CONSTRAINT "doc_comments_parent_comment_id_workspace_id_fkey" FOREIGN KEY ("parent_comment_id", "workspace_id") REFERENCES "doc_comments"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "doc_comments_workspace_id_doc_id_status_created_at_idx" ON "doc_comments"("workspace_id", "doc_id", "status", "created_at");
CREATE INDEX "doc_comments_doc_id_created_at_idx" ON "doc_comments"("doc_id", "created_at");

CREATE TABLE "doc_mentions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "doc_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "comment_id" UUID,
  "target_membership_id" UUID NOT NULL,
  "created_by_membership_id" UUID NOT NULL,
  "source" VARCHAR(40) NOT NULL DEFAULT 'CONTENT',
  "dedupe_key" VARCHAR(180) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "doc_mentions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "doc_mentions_doc_id_workspace_id_fkey" FOREIGN KEY ("doc_id", "workspace_id") REFERENCES "docs"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "doc_mentions_comment_id_workspace_id_fkey" FOREIGN KEY ("comment_id", "workspace_id") REFERENCES "doc_comments"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "doc_mentions_target_membership_id_workspace_id_fkey" FOREIGN KEY ("target_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "doc_mentions_created_by_membership_id_workspace_id_fkey" FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "doc_mentions_workspace_id_target_membership_id_dedupe_key_key" ON "doc_mentions"("workspace_id", "target_membership_id", "dedupe_key");
CREATE INDEX "doc_mentions_workspace_id_doc_id_created_at_idx" ON "doc_mentions"("workspace_id", "doc_id", "created_at");

CREATE TABLE "doc_favorites" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "doc_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "doc_favorites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "doc_favorites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "doc_favorites_doc_id_workspace_id_fkey" FOREIGN KEY ("doc_id", "workspace_id") REFERENCES "docs"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "doc_favorites_membership_id_workspace_id_fkey" FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "doc_favorites_membership_id_doc_id_key" ON "doc_favorites"("membership_id", "doc_id");
CREATE INDEX "doc_favorites_workspace_id_membership_id_created_at_idx" ON "doc_favorites"("workspace_id", "membership_id", "created_at");

CREATE TABLE "doc_shares" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "doc_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "token_hash" VARCHAR(128) NOT NULL,
  "status" "DocShareStatus" NOT NULL DEFAULT 'ACTIVE',
  "expires_at" TIMESTAMPTZ(6),
  "password_hash" VARCHAR(255),
  "created_by_membership_id" UUID NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  "last_accessed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "doc_shares_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "doc_shares_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "doc_shares_doc_id_workspace_id_fkey" FOREIGN KEY ("doc_id", "workspace_id") REFERENCES "docs"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "doc_shares_created_by_membership_id_workspace_id_fkey" FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "doc_shares_token_hash_key" ON "doc_shares"("token_hash");
CREATE INDEX "doc_shares_doc_id_status_idx" ON "doc_shares"("doc_id", "status");
CREATE INDEX "doc_shares_workspace_id_status_created_at_idx" ON "doc_shares"("workspace_id", "status", "created_at");

CREATE TABLE "doc_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "doc_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "linked_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "doc_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "doc_attachments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "doc_attachments_doc_id_workspace_id_fkey" FOREIGN KEY ("doc_id", "workspace_id") REFERENCES "docs"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "doc_attachments_asset_id_workspace_id_fkey" FOREIGN KEY ("asset_id", "workspace_id") REFERENCES "assets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "doc_attachments_linked_by_membership_id_workspace_id_fkey" FOREIGN KEY ("linked_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "doc_attachments_doc_id_asset_id_key" ON "doc_attachments"("doc_id", "asset_id");
CREATE INDEX "doc_attachments_workspace_id_asset_id_idx" ON "doc_attachments"("workspace_id", "asset_id");
