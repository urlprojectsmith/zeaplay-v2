WITH new_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN (
    'projects.files.view',
    'projects.files.add',
    'projects.files.remove',
    'projects.files.download',
    'projects.activity.view'
  )
),
system_role_permission_keys AS (
  SELECT *
  FROM (
    VALUES
      ('OWNER', 'projects.files.view'),
      ('OWNER', 'projects.files.add'),
      ('OWNER', 'projects.files.remove'),
      ('OWNER', 'projects.files.download'),
      ('OWNER', 'projects.activity.view'),
      ('ADMIN', 'projects.files.view'),
      ('ADMIN', 'projects.files.add'),
      ('ADMIN', 'projects.files.remove'),
      ('ADMIN', 'projects.files.download'),
      ('ADMIN', 'projects.activity.view'),
      ('MANAGER', 'projects.files.view'),
      ('MANAGER', 'projects.files.add'),
      ('MANAGER', 'projects.files.remove'),
      ('MANAGER', 'projects.files.download'),
      ('MANAGER', 'projects.activity.view'),
      ('MEMBER', 'projects.files.view'),
      ('MEMBER', 'projects.files.add'),
      ('MEMBER', 'projects.files.download'),
      ('MEMBER', 'projects.activity.view')
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
