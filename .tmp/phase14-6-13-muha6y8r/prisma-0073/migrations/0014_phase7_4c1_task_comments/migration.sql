CREATE TYPE "TaskCommentVisibility" AS ENUM ('NORMAL', 'INTERNAL');

CREATE TYPE "TaskCommentReactionType" AS ENUM ('LIKE', 'LOVE', 'CELEBRATE', 'EYES', 'CHECK');

CREATE TABLE "task_comments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "author_membership_id" UUID NOT NULL,
  "author_user_id" UUID NOT NULL,
  "parent_comment_id" UUID,
  "body" VARCHAR(4000) NOT NULL,
  "visibility" "TaskCommentVisibility" NOT NULL DEFAULT 'NORMAL',
  "edited_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_comments_not_self_parent" CHECK ("parent_comment_id" IS NULL OR "parent_comment_id" <> "id")
);

CREATE TABLE "task_comment_mentions" (
  "workspace_id" UUID NOT NULL,
  "comment_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "task_comment_mentions_pkey" PRIMARY KEY ("comment_id","membership_id")
);

CREATE TABLE "task_comment_reactions" (
  "workspace_id" UUID NOT NULL,
  "comment_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "reaction_type" "TaskCommentReactionType" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "task_comment_reactions_pkey" PRIMARY KEY ("comment_id","membership_id","reaction_type")
);

CREATE UNIQUE INDEX "task_comments_id_workspace_id_key" ON "task_comments"("id","workspace_id");
CREATE UNIQUE INDEX "task_comments_id_workspace_id_task_id_key" ON "task_comments"("id","workspace_id","task_id");
CREATE INDEX "task_comments_workspace_id_task_id_parent_comment_id_created_at_idx" ON "task_comments"("workspace_id","task_id","parent_comment_id","created_at");
CREATE INDEX "task_comments_workspace_id_task_id_created_at_idx" ON "task_comments"("workspace_id","task_id","created_at");
CREATE INDEX "task_comments_workspace_id_author_membership_id_created_at_idx" ON "task_comments"("workspace_id","author_membership_id","created_at");

CREATE INDEX "task_comment_mentions_workspace_id_membership_id_idx" ON "task_comment_mentions"("workspace_id","membership_id");
CREATE INDEX "task_comment_mentions_workspace_id_comment_id_idx" ON "task_comment_mentions"("workspace_id","comment_id");

CREATE INDEX "task_comment_reactions_workspace_id_comment_id_reaction_type_idx" ON "task_comment_reactions"("workspace_id","comment_id","reaction_type");
CREATE INDEX "task_comment_reactions_workspace_id_membership_id_idx" ON "task_comment_reactions"("workspace_id","membership_id");

ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_workspace_id_fkey" FOREIGN KEY ("task_id","workspace_id") REFERENCES "tasks"("id","workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_membership_id_workspace_id_fkey" FOREIGN KEY ("author_membership_id","workspace_id") REFERENCES "workspace_memberships"("id","workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_parent_comment_id_workspace_id_task_id_fkey" FOREIGN KEY ("parent_comment_id","workspace_id","task_id") REFERENCES "task_comments"("id","workspace_id","task_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_comment_mentions" ADD CONSTRAINT "task_comment_mentions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_comment_mentions" ADD CONSTRAINT "task_comment_mentions_comment_id_workspace_id_fkey" FOREIGN KEY ("comment_id","workspace_id") REFERENCES "task_comments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_comment_mentions" ADD CONSTRAINT "task_comment_mentions_membership_id_workspace_id_fkey" FOREIGN KEY ("membership_id","workspace_id") REFERENCES "workspace_memberships"("id","workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_comment_reactions" ADD CONSTRAINT "task_comment_reactions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_comment_reactions" ADD CONSTRAINT "task_comment_reactions_comment_id_workspace_id_fkey" FOREIGN KEY ("comment_id","workspace_id") REFERENCES "task_comments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_comment_reactions" ADD CONSTRAINT "task_comment_reactions_membership_id_workspace_id_fkey" FOREIGN KEY ("membership_id","workspace_id") REFERENCES "workspace_memberships"("id","workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("key")
VALUES
  ('tasks.comments.view'),
  ('tasks.comments.create'),
  ('tasks.comments.update_own'),
  ('tasks.comments.delete_own'),
  ('tasks.comments.moderate'),
  ('tasks.comments.internal')
ON CONFLICT ("key") DO NOTHING;
