CREATE OR REPLACE FUNCTION "prevent_gamification_xp_entry_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gamification_xp_entries are immutable'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "gamification_xp_entries_prevent_update"
BEFORE UPDATE ON "gamification_xp_entries"
FOR EACH ROW
EXECUTE FUNCTION "prevent_gamification_xp_entry_mutation"();

CREATE TRIGGER "gamification_xp_entries_prevent_delete"
BEFORE DELETE ON "gamification_xp_entries"
FOR EACH ROW
EXECUTE FUNCTION "prevent_gamification_xp_entry_mutation"();
