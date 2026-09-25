INSERT INTO "permissions" ("key", "description")
VALUES
  ('projects.files.view', 'projects.files.view permission'),
  ('projects.files.add', 'projects.files.add permission'),
  ('projects.files.remove', 'projects.files.remove permission'),
  ('projects.files.download', 'projects.files.download permission'),
  ('projects.activity.view', 'projects.activity.view permission')
ON CONFLICT ("key") DO NOTHING;
