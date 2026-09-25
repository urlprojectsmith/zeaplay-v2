INSERT INTO "permissions" ("key", "description")
VALUES
  ('gamification.developer.diagnostics', 'gamification.developer.diagnostics permission')
ON CONFLICT ("key") DO NOTHING;
