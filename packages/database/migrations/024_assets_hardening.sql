-- AST-01 hardening after security review: retired assets are final, issue dates cannot
-- reach before the asset existed or overlap the previous holder, and an asset is
-- "assigned" exactly when it has an open assignment, checked at commit so the rule
-- holds whatever statements reached the tables.
CREATE OR REPLACE FUNCTION guard_asset() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.asset_scope',true),'none');
 immutable text[] := ARRAY['name','serial_number','condition','status','custodian_id','version','updated_at'];
BEGIN
 IF scope<>'entity'
   OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'Only HR manages assets' USING ERRCODE='AS005';
 END IF;
 IF TG_OP='INSERT' THEN
  NEW.status := 'available';
  NEW.custodian_id := NULL;
  NEW.version := 1;
  NEW.created_at := now();
  NEW.updated_at := now();
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-immutable) IS DISTINCT FROM (to_jsonb(OLD)-immutable) OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'Assets change only through their own actions' USING ERRCODE='AS004';
 END IF;
 IF OLD.status='retired' THEN
  RAISE EXCEPTION 'A retired asset is final' USING ERRCODE='AS004';
 END IF;
 NEW.updated_at := now();
 IF NEW.status<>OLD.status THEN
  IF NOT (
   (OLD.status='available' AND NEW.status IN ('assigned','in_repair','retired','lost'))
   OR (OLD.status='assigned' AND NEW.status IN ('available','in_repair','lost'))
   OR (OLD.status='in_repair' AND NEW.status IN ('available','retired','lost'))
   OR (OLD.status='lost' AND NEW.status IN ('available','retired'))
  ) THEN
   RAISE EXCEPTION 'That status change is not allowed' USING ERRCODE='AS004';
  END IF;
  IF NEW.status='assigned' THEN
   IF NEW.custodian_id IS NULL OR NOT EXISTS(SELECT 1 FROM asset_assignment a WHERE a.asset_id=NEW.id
     AND a.employee_id=NEW.custodian_id AND a.returned_on IS NULL) THEN
    RAISE EXCEPTION 'Issue the asset to someone first' USING ERRCODE='AS004';
   END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM asset_assignment a WHERE a.asset_id=NEW.id AND a.returned_on IS NULL) THEN
    RAISE EXCEPTION 'Receive the asset back before changing its status' USING ERRCODE='AS004';
   END IF;
   NEW.custodian_id := NULL;
  END IF;
 ELSIF NEW.custodian_id IS DISTINCT FROM OLD.custodian_id THEN
  RAISE EXCEPTION 'The holder changes only when the asset is issued or returned' USING ERRCODE='AS004';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_asset_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.asset_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 today date := leave_entity_today();
 immutable text[] := ARRAY['acknowledged_at','returned_on','return_condition','return_note','received_by_label','version'];
 held record;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This asset belongs to another organization' USING ERRCODE='AS005';
 END IF;
 IF TG_OP='INSERT' THEN
  IF scope<>'entity' THEN
   RAISE EXCEPTION 'Only HR issues assets' USING ERRCODE='AS005';
  END IF;
  SELECT a.tag,a.name,a.category,a.serial_number INTO held FROM asset a
   WHERE a.id=NEW.asset_id AND a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id AND a.status='available';
  IF NOT FOUND THEN
   RAISE EXCEPTION 'This asset is not available to issue' USING ERRCODE='AS004';
  END IF;
  NEW.asset_tag := held.tag;
  NEW.asset_name := held.name;
  NEW.asset_category := held.category;
  NEW.asset_serial := held.serial_number;
  IF NOT EXISTS(SELECT 1 FROM employee e WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id
    AND e.id=NEW.employee_id AND e.status IN ('active','notice')) THEN
   RAISE EXCEPTION 'Assets can only be issued to current employees' USING ERRCODE='AS003';
  END IF;
  IF NEW.issued_on>today THEN
   RAISE EXCEPTION 'The issue date cannot be in the future' USING ERRCODE='AS003';
  END IF;
  -- Backdating is allowed only within the asset's own life and after the previous holder returned it.
  IF NEW.issued_on < (SELECT a.created_at::date FROM asset a WHERE a.id=NEW.asset_id) - 7 THEN
   RAISE EXCEPTION 'The issue date cannot be before the asset was registered' USING ERRCODE='AS003';
  END IF;
  IF NEW.issued_on < coalesce((SELECT max(s.returned_on) FROM asset_assignment s WHERE s.asset_id=NEW.asset_id),'-infinity'::date) THEN
   RAISE EXCEPTION 'The issue date cannot overlap the previous holder' USING ERRCODE='AS003';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('assets:'||NEW.employee_id::text,0));
  IF (SELECT count(*) FROM asset_assignment a WHERE a.tenant_id=NEW.tenant_id AND a.employee_id=NEW.employee_id
    AND a.returned_on IS NULL)>=20 THEN
   RAISE EXCEPTION 'A person can hold up to 20 assets' USING ERRCODE='AS003';
  END IF;
  NEW.issued_by_label := label;
  NEW.acknowledged_at := NULL;
  NEW.returned_on := NULL;
  NEW.return_condition := NULL;
  NEW.return_note := NULL;
  NEW.received_by_label := NULL;
  NEW.version := 1;
  NEW.created_at := now();
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-immutable) IS DISTINCT FROM (to_jsonb(OLD)-immutable) OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'An assignment changes only by acknowledgement or return' USING ERRCODE='AS004';
 END IF;
 IF OLD.returned_on IS NOT NULL THEN
  RAISE EXCEPTION 'This assignment is already closed' USING ERRCODE='AS004';
 END IF;
 IF NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at THEN
  IF OLD.acknowledged_at IS NOT NULL THEN
   RAISE EXCEPTION 'You have already acknowledged this asset' USING ERRCODE='AS004';
  END IF;
  IF me IS NULL OR me<>OLD.employee_id OR scope NOT IN ('self','team') THEN
   RAISE EXCEPTION 'Only the person holding the asset can acknowledge it' USING ERRCODE='AS005';
  END IF;
  IF NEW.returned_on IS DISTINCT FROM OLD.returned_on OR NEW.return_condition IS DISTINCT FROM OLD.return_condition
    OR NEW.return_note IS DISTINCT FROM OLD.return_note OR NEW.received_by_label IS DISTINCT FROM OLD.received_by_label THEN
   RAISE EXCEPTION 'Acknowledge and return are separate steps' USING ERRCODE='AS004';
  END IF;
  NEW.acknowledged_at := now();
 ELSIF NEW.returned_on IS DISTINCT FROM OLD.returned_on THEN
  IF scope<>'entity' THEN
   RAISE EXCEPTION 'Only HR receives returns' USING ERRCODE='AS005';
  END IF;
  IF NEW.returned_on<OLD.issued_on OR NEW.returned_on>today THEN
   RAISE EXCEPTION 'The return date must be between the issue date and today' USING ERRCODE='AS003';
  END IF;
  NEW.received_by_label := label;
 ELSE
  RAISE EXCEPTION 'Nothing to change' USING ERRCODE='AS004';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION check_asset_consistency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 target uuid := CASE WHEN TG_TABLE_NAME='asset' THEN NEW.id ELSE NEW.asset_id END;
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
ALTER FUNCTION check_asset_consistency() OWNER TO anvione_asset_keeper;
REVOKE ALL ON FUNCTION check_asset_consistency() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER asset_consistency AFTER INSERT OR UPDATE ON asset
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_asset_consistency();
CREATE CONSTRAINT TRIGGER asset_assignment_consistency AFTER INSERT OR UPDATE ON asset_assignment
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_asset_consistency();
