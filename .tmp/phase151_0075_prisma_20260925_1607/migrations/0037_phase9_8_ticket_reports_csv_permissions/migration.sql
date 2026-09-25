INSERT INTO "permissions" ("key", "description")
VALUES
  ('tickets.reports.view', 'tickets.reports.view permission'),
  ('tickets.reports.export', 'tickets.reports.export permission')
ON CONFLICT ("key") DO NOTHING;

WITH ticket_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN (
    'tickets.reports.view',
    'tickets.reports.export'
  )
),
system_role_permission_keys AS (
  SELECT *
  FROM (
    VALUES
      ('OWNER', 'tickets.reports.view'),
      ('OWNER', 'tickets.reports.export'),
      ('ADMIN', 'tickets.reports.view'),
      ('ADMIN', 'tickets.reports.export'),
      ('MANAGER', 'tickets.reports.view'),
      ('MANAGER', 'tickets.reports.export')
  ) AS grants("role_key", "permission_key")
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", ticket_permissions."id"
FROM "roles"
JOIN system_role_permission_keys ON system_role_permission_keys."role_key" = roles."key"
JOIN ticket_permissions ON ticket_permissions."key" = system_role_permission_keys."permission_key"
WHERE roles."scope" = 'WORKSPACE'::"RoleScope"
  AND roles."is_system" = true
  AND roles."workspace_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
