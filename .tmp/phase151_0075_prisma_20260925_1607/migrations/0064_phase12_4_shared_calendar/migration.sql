CREATE TYPE "CalendarSourceType" AS ENUM ('TASK', 'PROJECT', 'TICKET', 'CUSTOM_EVENT');

CREATE TYPE "CalendarEventVisibility" AS ENUM ('WORKSPACE', 'PARTICIPANTS_ONLY', 'PRIVATE');

CREATE TYPE "CalendarEventParticipantRole" AS ENUM ('OWNER', 'PARTICIPANT');

CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6),
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "timezone" VARCHAR(80),
    "visibility" "CalendarEventVisibility" NOT NULL DEFAULT 'WORKSPACE',
    "created_by_membership_id" UUID NOT NULL,
    "owner_membership_id" UUID NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calendar_event_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "calendar_event_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "participant_role" "CalendarEventParticipantRole" NOT NULL DEFAULT 'PARTICIPANT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "calendar_events_id_workspace_id_key" ON "calendar_events"("id", "workspace_id");
CREATE INDEX "calendar_events_workspace_id_start_at_idx" ON "calendar_events"("workspace_id", "start_at");
CREATE INDEX "calendar_events_workspace_id_start_at_end_at_idx" ON "calendar_events"("workspace_id", "start_at", "end_at");
CREATE INDEX "calendar_events_workspace_id_cancelled_at_start_at_idx" ON "calendar_events"("workspace_id", "cancelled_at", "start_at");
CREATE INDEX "calendar_events_workspace_id_owner_membership_id_start_at_idx" ON "calendar_events"("workspace_id", "owner_membership_id", "start_at");

CREATE UNIQUE INDEX "calendar_event_participants_calendar_event_id_membership_id_key" ON "calendar_event_participants"("calendar_event_id", "membership_id");
CREATE INDEX "calendar_event_participants_workspace_id_membership_id_idx" ON "calendar_event_participants"("workspace_id", "membership_id");
CREATE INDEX "calendar_event_participants_workspace_id_calendar_event_id_idx" ON "calendar_event_participants"("workspace_id", "calendar_event_id");

ALTER TABLE "calendar_events"
  ADD CONSTRAINT "calendar_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calendar_events"
  ADD CONSTRAINT "calendar_events_created_by_membership_id_workspace_id_fkey"
  FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calendar_events"
  ADD CONSTRAINT "calendar_events_owner_membership_id_workspace_id_fkey"
  FOREIGN KEY ("owner_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calendar_event_participants"
  ADD CONSTRAINT "calendar_event_participants_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calendar_event_participants"
  ADD CONSTRAINT "calendar_event_participants_calendar_event_id_workspace_id_fkey"
  FOREIGN KEY ("calendar_event_id", "workspace_id") REFERENCES "calendar_events"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "calendar_event_participants"
  ADD CONSTRAINT "calendar_event_participants_membership_id_workspace_id_fkey"
  FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
