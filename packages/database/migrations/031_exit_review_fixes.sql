-- EXT-01 review fixes. The asset issue guard (latest in 024) now takes the per-employee
-- assets lock before reading employee.status, so an issue cannot slip in after an exit completes.
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
  -- Lock first, then read the status, so an issue cannot slip past a completing exit.
  PERFORM pg_advisory_xact_lock(hashtextextended('assets:'||NEW.employee_id::text,0));
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

-- Completion and clearance changes serialize on one per-case lock and re-count after it.
-- A withdrawal of an accepted case needs its own new reason; HR cannot withdraw their
-- own accepted case; completion before the last working day needs an explicit early
-- release (transaction-local app.exit_early_release='on', set by the HR-only API path) and a reason.
CREATE OR REPLACE FUNCTION guard_exit_case() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.exit_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 today date := leave_entity_today();
 managed text[] := ARRAY['status','version','last_working_day','decision_note','decided_at','decided_by_label','closed_at','closed_by_label'];
 hr boolean := scope='entity';
 own boolean;
 early boolean := coalesce(current_setting('app.exit_early_release',true),'')='on';
 new_note boolean;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This exit case belongs to another organization' USING ERRCODE='EX005';
 END IF;
 own := me IS NOT NULL AND NEW.employee_id=me;
 IF TG_OP='INSERT' THEN
  IF NOT hr AND NOT (scope IN ('self','team') AND own) THEN
   RAISE EXCEPTION 'You can only submit your own resignation' USING ERRCODE='EX005';
  END IF;
  IF NOT hr THEN
   IF NEW.kind<>'resignation' THEN
    RAISE EXCEPTION 'Employees can only submit a resignation' USING ERRCODE='EX005';
   END IF;
   NEW.notice_given_on := today;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM employee e WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id
    AND e.id=NEW.employee_id AND e.status IN ('active','notice')) THEN
   RAISE EXCEPTION 'Exit cases are only for current employees' USING ERRCODE='EX003';
  END IF;
  IF NEW.notice_given_on>today OR NEW.notice_given_on<today-90 THEN
   RAISE EXCEPTION 'The notice date must be within the last 90 days' USING ERRCODE='EX003';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('exit:'||NEW.employee_id::text,0));
  IF EXISTS(SELECT 1 FROM exit_case c WHERE c.employee_id=NEW.employee_id AND c.status IN ('submitted','accepted')) THEN
   RAISE EXCEPTION 'This person already has an open exit case' USING ERRCODE='EX004';
  END IF;
  NEW.status := 'submitted';
  NEW.last_working_day := NULL;
  NEW.decision_note := NULL;
  NEW.version := 1;
  NEW.submitted_by_label := label;
  NEW.created_at := now();
  NEW.decided_at := NULL;
  NEW.decided_by_label := NULL;
  NEW.closed_at := NULL;
  NEW.closed_by_label := NULL;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'An exit case changes only through its own actions' USING ERRCODE='EX004';
 END IF;
 IF OLD.status NOT IN ('submitted','accepted') THEN
  RAISE EXCEPTION 'A closed exit case is final' USING ERRCODE='EX004';
 END IF;
 IF NEW.status=OLD.status THEN
  RAISE EXCEPTION 'An exit case changes only by moving to its next step' USING ERRCODE='EX004';
 END IF;
 IF NEW.status<>'accepted' AND NEW.last_working_day IS DISTINCT FROM OLD.last_working_day THEN
  RAISE EXCEPTION 'The last working day is set when the case is accepted' USING ERRCODE='EX004';
 END IF;
 IF NOT hr AND NOT (scope IN ('self','team') AND own AND OLD.status='submitted' AND NEW.status='withdrawn') THEN
  RAISE EXCEPTION 'Only HR manages exit cases' USING ERRCODE='EX005';
 END IF;
 IF hr AND own AND (NEW.status IN ('accepted','rejected','completed')
   OR (NEW.status='withdrawn' AND OLD.status='accepted')) THEN
  RAISE EXCEPTION 'Someone else in HR must decide your own exit' USING ERRCODE='EX005';
 END IF;
 IF NOT (
  (OLD.status='submitted' AND NEW.status IN ('accepted','rejected','withdrawn'))
  OR (OLD.status='accepted' AND NEW.status IN ('completed','withdrawn'))
 ) THEN
  RAISE EXCEPTION 'That exit step is not allowed' USING ERRCODE='EX004';
 END IF;
 IF NEW.status='accepted' THEN
  IF NEW.last_working_day IS NULL OR NEW.last_working_day<OLD.notice_given_on
    OR NEW.last_working_day>OLD.notice_given_on+180 THEN
   RAISE EXCEPTION 'The last working day must be on or after the notice date and within 180 days of it' USING ERRCODE='EX003';
  END IF;
  NEW.decided_at := now();
  NEW.decided_by_label := label;
  RETURN NEW;
 END IF;
 new_note := NEW.decision_note IS NOT NULL AND NEW.decision_note IS DISTINCT FROM OLD.decision_note
  AND char_length(btrim(NEW.decision_note))>=3;
 IF (NEW.status='rejected' OR (NEW.status='withdrawn' AND OLD.status='accepted')) AND NOT new_note THEN
  RAISE EXCEPTION 'Give a reason' USING ERRCODE='EX003';
 END IF;
 IF NEW.status='completed' THEN
  IF today<OLD.last_working_day THEN
   IF NOT early THEN
    RAISE EXCEPTION 'The last working day has not been reached; use an early release' USING ERRCODE='EX004';
   END IF;
   IF NOT new_note THEN
    RAISE EXCEPTION 'Give a reason for the early release' USING ERRCODE='EX003';
   END IF;
  ELSE
   NEW.decision_note := OLD.decision_note;
  END IF;
  -- Same keys as the clearance guard and the asset issue guard; counts are read after the locks.
  PERFORM pg_advisory_xact_lock(hashtextextended('exit-case:'||OLD.id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('assets:'||OLD.employee_id::text,0));
  IF (SELECT count(*) FROM exit_clearance x WHERE x.case_id=OLD.id AND x.status IN ('cleared','waived'))<5
    OR EXISTS(SELECT 1 FROM exit_clearance x WHERE x.case_id=OLD.id AND x.status='pending') THEN
   RAISE EXCEPTION 'Every clearance must be cleared or waived first' USING ERRCODE='EX004';
  END IF;
  IF EXISTS(SELECT 1 FROM asset_assignment a WHERE a.tenant_id=OLD.tenant_id AND a.employee_id=OLD.employee_id
    AND a.returned_on IS NULL) THEN
   RAISE EXCEPTION 'Receive every company asset back first' USING ERRCODE='EX004';
  END IF;
 END IF;
 IF NEW.status='rejected' THEN
  NEW.decided_at := now();
  NEW.decided_by_label := label;
 ELSE
  NEW.decided_at := OLD.decided_at;
  NEW.decided_by_label := OLD.decided_by_label;
 END IF;
 NEW.closed_at := now();
 NEW.closed_by_label := label;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_exit_clearance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 managed text[] := ARRAY['status','note','version','cleared_by_label','cleared_at'];
 c record;
BEGIN
 IF coalesce(current_setting('app.exit_scope',true),'none')<>'entity'
   OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'Only HR manages exit clearances' USING ERRCODE='EX005';
 END IF;
 -- Lock before reading the case, so a clearance change and a completion never interleave.
 PERFORM pg_advisory_xact_lock(hashtextextended('exit-case:'||NEW.case_id::text,0));
 SELECT x.status, x.employee_id INTO c FROM exit_case x
  WHERE x.id=NEW.case_id AND x.tenant_id=NEW.tenant_id AND x.entity_id=NEW.entity_id;
 IF NOT FOUND OR c.status<>'accepted' THEN
  RAISE EXCEPTION 'Clearances change only while the case is accepted' USING ERRCODE='EX004';
 END IF;
 IF me IS NOT NULL AND c.employee_id=me THEN
  RAISE EXCEPTION 'Someone else in HR must clear your own exit' USING ERRCODE='EX005';
 END IF;
 IF TG_OP='INSERT' THEN
  NEW.status := 'pending';
  NEW.note := NULL;
  NEW.cleared_by_label := NULL;
  NEW.cleared_at := NULL;
  NEW.version := 1;
  NEW.created_at := now();
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'A clearance changes only through its own action' USING ERRCODE='EX004';
 END IF;
 IF NEW.status='waived' AND (NEW.note IS NULL OR char_length(btrim(NEW.note))<3) THEN
  RAISE EXCEPTION 'Say why this clearance is waived' USING ERRCODE='EX003';
 END IF;
 IF NEW.item='assets' AND NEW.status IN ('cleared','waived') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('assets:'||c.employee_id::text,0));
  IF EXISTS(SELECT 1 FROM asset_assignment a WHERE a.tenant_id=NEW.tenant_id AND a.employee_id=c.employee_id
    AND a.returned_on IS NULL) THEN
   RAISE EXCEPTION 'Receive every company asset back before clearing assets' USING ERRCODE='EX004';
  END IF;
 END IF;
 IF NEW.status='pending' THEN
  NEW.cleared_at := NULL;
  NEW.cleared_by_label := NULL;
 ELSE
  NEW.cleared_at := now();
  NEW.cleared_by_label := label;
 END IF;
 RETURN NEW;
END $$;
