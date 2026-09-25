INSERT INTO "permissions" ("key", "description")
VALUES ('projects.reports.view', 'projects.reports.view permission')
ON CONFLICT ("key") DO NOTHING;

WITH new_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN ('projects.reports.view')
),
system_role_permission_keys AS (
  SELECT *
  FROM (
    VALUES
      ('OWNER', 'projects.reports.view'),
      ('ADMIN', 'projects.reports.view'),
      ('MANAGER', 'projects.reports.view'),
      ('MEMBER', 'projects.reports.view')
  ) AS grants("role_key", "permission_key")
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", new_permissions."id"
FROM "roles"
JOIN system_role_permission_keys ON system_role_permission_keys."role_key" = roles."key"
JOIN new_permissions ON new_permissions."key" = system_role_permission_keys."permission_key"
WHERE roles."scope" = 'WORKSPACE'
  AND roles."is_system" = true
  AND roles."workspace_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
