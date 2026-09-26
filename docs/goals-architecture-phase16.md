# Phase 16.3 Goals Architecture

Phase 16.3 adds Workspace-owned Goals for progress tracking across users, departments, and whole Workspaces. The implementation is intentionally additive to the Phase 16.1 Docs and Phase 16.2 Forms foundations.

## Scope

- Goals are owned by a Workspace.
- Goal targets are `USER`, `DEPARTMENT`, or `WORKSPACE`.
- User targets use `WorkspaceMembership` as the authority.
- Department targets reuse the existing `Department` model.
- Parent tenants have aggregate read-only oversight only.
- No Agency-owned, SuperAgency-owned, Organization-owned, or Platform-owned Goals were introduced.
- No recurrence engine is included in Phase 16.3. Period bounds are persisted as authoritative `periodStart` and `periodEnd` timestamps.

## Data Model

Migration `0083_phase16_3_goals_foundation` adds:

- `GoalOwnerType`
- `GoalMetricType`
- `GoalPeriodType`
- `GoalStatus`
- `GoalProgressSourceType`
- `goals`
- `goal_progress_events`

The database enforces:

- `target_value > 0`
- `current_progress >= 0`
- `period_end > period_start`
- exactly one valid owner shape:
  - `USER` requires `owner_membership_id`
  - `DEPARTMENT` requires `department_id`
  - `WORKSPACE` requires neither

`goal_progress_events` is the immutable progress ledger. `goals.current_progress` is a cache that can be repaired by reconciliation.

## Metrics

Supported metrics:

- `TASKS_COMPLETED`
- `PROJECTS_COMPLETED`
- `TICKETS_RESOLVED`
- `XP_EARNED`
- `GLOBAL_SCORE`
- `CUSTOM_NUMERIC`
- `MANUAL_NUMERIC`

Automatic metrics derive from canonical events and ledgers:

- task/project/ticket completion from `automation_domain_events`
- XP from `gamification_xp_entries`
- global score from `gamification_global_score_events`

Manual progress is allowed only for `MANUAL_NUMERIC`. Custom numeric progress is accepted only through controlled server-side integration, currently the existing Automation action path.

Live manual and custom progress is accepted only inside the persisted goal period. The server rejects updates before `periodStart` or at/after `periodEnd`, rejects non-finite/non-integer deltas, and keeps `targetValue` positive.

Automatic progress is recomputed from canonical ledgers during reconciliation. Phase 16.3 uses the active Workspace membership and active Department membership at reconciliation time for user and Department ownership matching; historical Department membership snapshots are not available in the canonical ledgers.

## Automation And Gamification

Phase 16.3 extends the existing automation architecture with:

- `AutomationTriggerType.GOAL_COMPLETED`
- `AutomationActionType.GOAL_PROGRESS_UPDATE`
- `AutomationDomainEventEntityType.GOAL`

Goal completion emits one idempotent `GOAL_COMPLETED` domain event using key `goal-completed:{goalId}`. Manual/custom progress writes and the completion event are committed in the same database transaction, and duplicate progress idempotency keys are checked before counters mutate.

Goals do not introduce `GoalXPService`, a new scoring engine, or automatic XP awards. Any reward behavior must be configured through the existing event/rule architecture.

## API

Workspace routes:

- `GET /workspaces/:workspaceId/goals`
- `POST /workspaces/:workspaceId/goals`
- `GET /workspaces/:workspaceId/goals/:goalId`
- `GET /workspaces/:workspaceId/goals/:goalId/progress-events`
- `POST /workspaces/:workspaceId/goals/:goalId/manual-progress`
- `POST /workspaces/:workspaceId/goals/:goalId/reconcile`
- `POST /workspaces/:workspaceId/goals/expire-due`
- `PATCH /workspaces/:workspaceId/goals/:goalId/archive`

Parent aggregate routes:

- `GET /agencies/:agencyId/parent/goals`
- `GET /super-agencies/:superAgencyId/parent/goals`

Parent responses are grouped aggregate metadata and do not expose individual users, private notes, or manual progress details.

## Frontend

Workspace UI:

- `/workspace/goals`
- compact list and detail view
- goal creation controls
- reconciliation action
- manual progress controls only for manual numeric goals

Parent UI:

- `/agency/goals`
- `/super-agency/goals`
- aggregate cards by workspace, status, owner type, and metric type

## Commercial Enforcement

Goals are documented in the Phase 15.3 feature enforcement matrix as `NOT-COMMERCIALLY-GATED` because there is no current Phase 15.3 Goals catalog key. Existing PermissionGuard, restricted-mode behavior, automation quotas, and gamification ledger authority remain in force.

## Final Certification

Phase 16.3 final certification passed with migration inventory count `83` and latest migration `0083_phase16_3_goals_foundation`. No `0084` migration was created.

Verification completed:

- `pnpm prisma:generate`: PASS
- `pnpm prisma:validate`: PASS
- `pnpm format`: PASS
- `pnpm lint`: PASS
- `pnpm typecheck`: PASS
- Focused Goals/Forms/Phase 15.3/Gamification/Automation backend regression: PASS, 7 suites / 140 tests
- Focused Goals frontend regression: PASS, 24 files / 204 tests
- Root `pnpm test`: PASS, API 61 suites / 598 tests, worker 8 suites / 28 tests, web 24 files / 204 tests
- `pnpm test:integration`: PASS, API 6 suites / 109 tests and worker 8 suites / 28 tests
- `pnpm test:e2e`: PASS, 21 tests
- `pnpm phase14:6:13:migration-compat`: PASS through 83 migrations, including clean install seed runs, legacy upgrade, populated Phase 15.2 upgrade, and zero/one/many Agency edge cases
- Fresh full web stability run: PASS, 24 files / 204 tests
- `pnpm build`: PASS, 11 tasks
- `pnpm audit --audit-level high`: PASS; two moderate advisories remain below the high threshold

Warnings retained:

- The shared development database remains read-only and was not migrated; read-only status reports pending `0081_phase16_1_docs_foundation`, `0082_phase16_2_forms_foundation`, and `0083_phase16_3_goals_foundation`.
- API Jest emitted the existing force-exited worker/open-handle warning during the root test run.
- Playwright emitted the existing `NO_COLOR` ignored because `FORCE_COLOR` is set warning during E2E.
- Next build emitted the existing missing Next.js ESLint plugin warning.
- Phase 16.3 does not include goal recurrence and does not add a Phase 15.3 commercial Goals catalog key.
