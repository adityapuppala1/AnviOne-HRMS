-- AST-01 company assets: HR keeps the inventory, issues items to employees,
-- employees acknowledge receipt, HR records returns. History is never deleted.
-- Guards run as a keeper role so rules hold whatever statement reaches the table.
CREATE ROLE anvione_asset_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_asset_keeper;

CREATE TABLE asset (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 tag text NOT NULL CHECK(tag ~ '^[A-Z0-9][A-Z0-9-]{1,23}$'),
 category text NOT NULL CHECK(category IN ('laptop','phone','monitor','accessory','access_card','other')),
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 2 AND 80 AND name=btrim(name)),
 serial_number text CHECK(serial_number IS NULL OR (char_length(btrim(serial_number)) BETWEEN 2 AND 60 AND serial_number=btrim(serial_number))),
 condition text NOT NULL CHECK(condition IN ('new','good','fair','damaged')),
 status text NOT NULL CHECK(status IN ('available','assigned','in_repair','retired','lost')),
 custodian_id uuid,
 version integer NOT NULL CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,custodian_id) REFERENCES employee(tenant_id,entity_id,id),
 UNIQUE(tenant_id,entity_id,tag),
 CHECK((status='assigned')=(custodian_id IS NOT NULL))
);
CREATE INDEX asset_status_idx ON asset(tenant_id,entity_id,status,tag);
CREATE INDEX asset_custodian_idx ON asset(tenant_id,entity_id,custodian_id) WHERE custodian_id IS NOT NULL;

CREATE TABLE asset_assignment (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 asset_id uuid NOT NULL REFERENCES asset(id),
 -- What the asset was called when it was issued, so a holder can still see it after it is returned.
 asset_tag text NOT NULL,
 asset_name text NOT NULL,
 asset_category text NOT NULL,
 asset_serial text,
 employee_id uuid NOT NULL,
 issued_on date NOT NULL,
 issue_condition text NOT NULL CHECK(issue_condition IN ('new','good','fair','damaged')),
 issued_by_label text NOT NULL,
 acknowledged_at timestamptz,
 returned_on date,
 return_condition text CHECK(return_condition IS NULL OR return_condition IN ('new','good','fair','damaged','lost')),
 return_note text CHECK(return_note IS NULL OR char_length(btrim(return_note)) BETWEEN 3 AND 300),
 received_by_label text,
 version integer NOT NULL CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 CHECK(returned_on IS NULL OR returned_on>=issued_on),
 CHECK((returned_on IS NULL)=(return_condition IS NULL)),
 CHECK(return_condition IS DISTINCT FROM 'damaged' OR return_note IS NOT NULL),
 CHECK(return_condition IS DISTINCT FROM 'lost' OR return_note IS NOT NULL)
);
CREATE UNIQUE INDEX asset_assignment_open ON asset_assignment(asset_id) WHERE returned_on IS NULL;
CREATE INDEX asset_assignment_employee_idx ON asset_assignment(tenant_id,entity_id,employee_id,issued_on DESC);

CREATE FUNCTION guard_asset() RETURNS trigger
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

CREATE FUNCTION guard_asset_assignment() RETURNS trigger
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

CREATE FUNCTION reject_asset_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Assets and their history are retired, never deleted' USING ERRCODE='23514';
END $$;

CREATE TRIGGER asset_guard BEFORE INSERT OR UPDATE ON asset
FOR EACH ROW EXECUTE FUNCTION guard_asset();
CREATE TRIGGER asset_no_delete BEFORE DELETE ON asset
FOR EACH ROW EXECUTE FUNCTION reject_asset_delete();
CREATE TRIGGER asset_assignment_guard BEFORE INSERT OR UPDATE ON asset_assignment
FOR EACH ROW EXECUTE FUNCTION guard_asset_assignment();
CREATE TRIGGER asset_assignment_no_delete BEFORE DELETE ON asset_assignment
FOR EACH ROW EXECUTE FUNCTION reject_asset_delete();

ALTER FUNCTION guard_asset() OWNER TO anvione_asset_keeper;
ALTER FUNCTION guard_asset_assignment() OWNER TO anvione_asset_keeper;
REVOKE ALL ON FUNCTION guard_asset(),guard_asset_assignment(),reject_asset_delete() FROM PUBLIC;
GRANT SELECT ON employee,asset,asset_assignment TO anvione_asset_keeper;
GRANT EXECUTE ON FUNCTION leave_entity_today() TO anvione_asset_keeper;

ALTER TABLE asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset FORCE ROW LEVEL SECURITY;
ALTER TABLE asset_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY asset_keeper_emp ON employee FOR SELECT TO anvione_asset_keeper USING(true);
CREATE POLICY asset_keeper ON asset FOR SELECT TO anvione_asset_keeper USING(true);
CREATE POLICY asset_assignment_keeper ON asset_assignment FOR SELECT TO anvione_asset_keeper USING(true);

-- HR sees the inventory; everyone else sees only what they hold.
CREATE POLICY asset_visible ON asset FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  current_setting('app.asset_scope',true)='entity'
  OR (current_setting('app.asset_scope',true) IN ('self','team')
   AND custodian_id=nullif(current_setting('app.employee_id',true),'')::uuid)
 )
);
CREATE POLICY asset_insert ON asset FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.asset_scope',true)='entity'
);
CREATE POLICY asset_update ON asset FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.asset_scope',true)='entity'
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );
CREATE POLICY asset_assignment_visible ON asset_assignment FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  current_setting('app.asset_scope',true)='entity'
  OR (current_setting('app.asset_scope',true) IN ('self','team')
   AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
 )
);
CREATE POLICY asset_assignment_insert ON asset_assignment FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.asset_scope',true)='entity'
);
CREATE POLICY asset_assignment_update ON asset_assignment FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND (
   current_setting('app.asset_scope',true)='entity'
   OR (current_setting('app.asset_scope',true) IN ('self','team')
    AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
  )
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );

GRANT SELECT ON asset,asset_assignment TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,tag,category,name,serial_number,condition,status,version) ON asset TO anvione_app;
GRANT UPDATE(name,serial_number,condition,status,custodian_id,version) ON asset TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,asset_id,employee_id,issued_on,issue_condition,issued_by_label,version) ON asset_assignment TO anvione_app;
GRANT UPDATE(acknowledged_at,returned_on,return_condition,return_note,version) ON asset_assignment TO anvione_app;

ALTER TABLE outbox_event DROP CONSTRAINT outbox_event_event_type_check;
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_event_type_check CHECK(event_type IN (
 'branding.published.v1','organization.created.v1','organization.updated.v1',
 'candidate.created.v1','candidate.invited.v1','candidate.revoked.v1','candidate.reviewed.v1',
 'candidate.submitted.v1','candidate.checklist_started.v1','candidate.task_created.v1','candidate.task_updated.v1',
 'candidate.local_review_proposed.v1','candidate.local_review_decided.v1','candidate.local_review_withdrawn.v1',
 'candidate.task_assigned.v1','candidate.assigned_task_updated.v1',
 'leave.requested.v1','leave.approved.v1','leave.rejected.v1','leave.cancelled.v1',
 'attendance.checked_in.v1','attendance.checked_out.v1',
 'attendance.correction_requested.v1','attendance.correction_approved.v1',
 'attendance.correction_rejected.v1','attendance.correction_cancelled.v1',
 'calendar.holiday_created.v1','calendar.holiday_updated.v1','calendar.work_week_updated.v1',
 'document.uploaded.v1','document.verified.v1','document.rejected.v1','document.withdrawn.v1',
 'asset.registered.v1','asset.updated.v1','asset.issued.v1','asset.acknowledged.v1',
 'asset.returned.v1','asset.status_changed.v1'
));
