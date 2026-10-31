-- AST-01: the commit-time consistency check read NEW.asset_id on both tables, but the
-- asset table has no such column. Read the id from the row's JSON form instead.
CREATE OR REPLACE FUNCTION check_asset_consistency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 target uuid := CASE WHEN TG_TABLE_NAME='asset' THEN (to_jsonb(NEW)->>'id')::uuid
                     ELSE (to_jsonb(NEW)->>'asset_id')::uuid END;
 held record;
BEGIN
 SELECT a.status, a.custodian_id INTO held FROM asset a WHERE a.id=target;
 IF NOT FOUND THEN
  RETURN NULL;
 END IF;
 IF (held.status='assigned') IS DISTINCT FROM EXISTS(SELECT 1 FROM asset_assignment s
   WHERE s.asset_id=target AND s.returned_on IS NULL AND s.employee_id=held.custodian_id) THEN
  RAISE EXCEPTION 'An asset is issued exactly when it has an open assignment' USING ERRCODE='AS004';
 END IF;
 RETURN NULL;
END $$;
