CREATE OR REPLACE FUNCTION "dashboard_widgets_limit_30"()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW."dashboard_id"::text)::bigint);

  IF (
    SELECT COUNT(*)
    FROM "dashboard_widgets"
    WHERE "dashboard_id" = NEW."dashboard_id"
  ) >= 30 THEN
    RAISE EXCEPTION 'DASHBOARD_WIDGET_LIMIT_EXCEEDED';
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql;
