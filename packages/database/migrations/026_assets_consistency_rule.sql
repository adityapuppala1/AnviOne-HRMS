-- AST-01: state the consistency rule exactly. An issued asset needs an open assignment
-- for its holder; any other asset must have no open assignment at all.
CREATE OR REPLACE FUNCTION check_asset_consistency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 target uuid := CASE WHEN TG_TABLE_NAME='asset' THEN (to_jsonb(NEW)->>'id')::uuid
                     ELSE (to_jsonb(NEW)->>'asset_id')::uuid END;
 held record;
 consistent boolean;
BEGIN
 SELECT a.status, a.custodian_id INTO held FROM asset a WHERE a.id=target;
 IF NOT FOUND THEN
  RETURN NULL;
 END IF;
 IF held.status='assigned' THEN
  consistent := EXISTS(SELECT 1 FROM asset_assignment s
   WHERE s.asset_id=target AND s.returned_on IS NULL AND s.employee_id=held.custodian_id);
 ELSE
  consistent := NOT EXISTS(SELECT 1 FROM asset_assignment s
   WHERE s.asset_id=target AND s.returned_on IS NULL);
 END IF;
 IF NOT consistent THEN
  RAISE EXCEPTION 'An asset is issued exactly when it has an open assignment' USING ERRCODE='AS004';
 END IF;
 RETURN NULL;
END $$;
