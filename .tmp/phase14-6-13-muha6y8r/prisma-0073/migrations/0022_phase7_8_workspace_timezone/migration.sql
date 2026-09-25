-- Phase 7.8 focused refinement - authoritative Workspace timezone

ALTER TABLE "workspaces"
  ADD COLUMN "timezone" VARCHAR(80) NOT NULL DEFAULT 'UTC';
