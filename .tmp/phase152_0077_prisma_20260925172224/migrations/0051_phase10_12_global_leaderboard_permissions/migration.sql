INSERT INTO "permissions" ("key", "description")
VALUES
  ('gamification.global_leaderboard.view_agency', 'gamification.global_leaderboard.view_agency permission'),
  ('gamification.global_leaderboard.view_platform', 'gamification.global_leaderboard.view_platform permission')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'gamification.global_leaderboard.view_agency'
WHERE r."scope" = 'AGENCY'
  AND r."key" IN ('AGENCY_OWNER', 'AGENCY_ADMIN')
ON CONFLICT DO NOTHING;
