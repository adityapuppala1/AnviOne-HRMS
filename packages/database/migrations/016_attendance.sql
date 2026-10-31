-- F0.11 attendance: server-stamped daily punches and a versioned correction workflow.
-- Times are local wall-clock times in the legal entity's time zone; overnight
-- shifts are out of scope. Provisional LOP is derived on read and never stored.
CREATE ROLE anvione_attendance_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_attendance_keeper;

CREATE TABLE attendance_correction (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 work_date date NOT NULL,
 check_in time(0) NOT NULL,
 check_out time(0) NOT NULL,
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 3 AND 300),
 state text NOT NULL CHECK(state IN ('pending','approved','rejected','cancelled')),
 approver text NOT NULL CHECK(approver IN ('manager','hr')),
 manager_id uuid,
 version integer NOT NULL CHECK(version>0),
 requested_by_actor uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 decided_by_employee uuid,
 decided_by_label text,
 decision_note text CHECK(decision_note IS NULL OR char_length(btrim(decision_note)) BETWEEN 3 AND 300),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,manager_id) REFERENCES employee(tenant_id,entity_id,id),
 CHECK(check_out>check_in),
 CHECK((approver='manager')=(manager_id IS NOT NULL)),
 CHECK((state='pending')=(decided_at IS NULL)),
 CHECK(state<>'rejected' OR decision_note IS NOT NULL)
);
CREATE UNIQUE INDEX attendance_correction_pending_key
 ON attendance_correction(tenant_id,employee_id,work_date) WHERE state='pending';
CREATE INDEX attendance_correction_queue_idx
 ON attendance_correction(tenant_id,entity_id,state,manager_id);

CREATE TABLE attendance_record (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 work_date date NOT NULL,
 check_in time(0) NOT NULL,
 check_out time(0),
 source text NOT NULL CHECK(source IN ('web','correction')),
 correction_id uuid REFERENCES attendance_correction(id),
 version integer NOT NULL CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 UNIQUE(tenant_id,employee_id,work_date),
 CHECK(check_out IS NULL OR check_out>check_in),
 CHECK((source='correction')=(correction_id IS NOT NULL))
);
CREATE INDEX attendance_record_day_idx ON attendance_record(tenant_id,entity_id,work_date);

-- Local wall-clock time for the caller's legal entity; exposes no other entity data.
CREATE FUNCTION attendance_entity_now() RETURNS timestamp
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT now() AT TIME ZONE le.timezone FROM public.legal_entity le
 WHERE le.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND le.id=nullif(current_setting('app.entity_id',true),'')::uuid;
$$;

CREATE FUNCTION guard_attendance_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 scope text := coalesce(current_setting('app.attendance_scope',true),'none');
 applying uuid := nullif(current_setting('attendance.applying',true),'')::uuid;
 local timestamp;
BEGIN
 -- Correction path: the write must reproduce an approved correction exactly.
 IF applying IS NOT NULL THEN
  IF NEW.source<>'correction' OR NEW.correction_id IS DISTINCT FROM applying OR NOT EXISTS(
   SELECT 1 FROM attendance_correction c
   WHERE c.id=applying AND c.state='approved' AND c.tenant_id=NEW.tenant_id
    AND c.entity_id=NEW.entity_id AND c.employee_id=NEW.employee_id
    AND c.work_date=NEW.work_date AND c.check_in=NEW.check_in AND c.check_out=NEW.check_out
  ) THEN
   RAISE EXCEPTION 'Attendance changes only through an approved correction' USING ERRCODE='AT006';
  END IF;
  NEW.version := CASE WHEN TG_OP='INSERT' THEN 1 ELSE OLD.version+1 END;
  NEW.updated_at := now();
  RETURN NEW;
 END IF;

 -- Punch path: self only, today only, stamped from the server clock.
 IF me IS NULL OR scope NOT IN ('self','team') OR NEW.employee_id<>me
   OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'You can only record your own attendance' USING ERRCODE='AT006';
 END IF;
 SELECT now() AT TIME ZONE le.timezone INTO local FROM legal_entity le
 WHERE le.tenant_id=NEW.tenant_id AND le.id=NEW.entity_id;
 IF local IS NULL THEN
  RAISE EXCEPTION 'Your workspace calendar is unavailable' USING ERRCODE='AT006';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM employee e WHERE e.tenant_id=NEW.tenant_id
    AND e.entity_id=NEW.entity_id AND e.id=me AND e.status IN ('active','notice')) THEN
   RAISE EXCEPTION 'Only current employees can record attendance' USING ERRCODE='AT006';
  END IF;
  NEW.work_date := local::date;
  NEW.check_in := date_trunc('minute',local)::time;
  NEW.check_out := NULL;
  NEW.source := 'web';
  NEW.correction_id := NULL;
  NEW.version := 1;
  NEW.updated_at := now();
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['check_out','version','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['check_out','version','updated_at'])
   OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'Attendance changes only by checking out' USING ERRCODE='AT004';
 END IF;
 IF OLD.check_out IS NOT NULL THEN
  RAISE EXCEPTION 'You have already checked out today' USING ERRCODE='AT001';
 END IF;
 IF OLD.work_date<>local::date THEN
  RAISE EXCEPTION 'Request a correction to change a past day' USING ERRCODE='AT007';
 END IF;
 NEW.check_out := date_trunc('minute',local)::time;
 IF NEW.check_out<=OLD.check_in THEN
  RAISE EXCEPTION 'Wait a minute after checking in before checking out' USING ERRCODE='AT003';
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

CREATE FUNCTION guard_attendance_correction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 scope text := coalesce(current_setting('app.attendance_scope',true),'none');
 today date;
 manager uuid;
BEGIN
 SELECT (now() AT TIME ZONE le.timezone)::date INTO today
 FROM legal_entity le WHERE le.tenant_id=NEW.tenant_id AND le.id=NEW.entity_id;
 IF today IS NULL THEN
  RAISE EXCEPTION 'Your workspace calendar is unavailable' USING ERRCODE='AT006';
 END IF;

 IF TG_OP='INSERT' THEN
  IF me IS NULL OR NEW.employee_id<>me OR scope NOT IN ('self','team')
    OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
    OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
   RAISE EXCEPTION 'You can only correct your own attendance' USING ERRCODE='AT006';
  END IF;
  IF nullif(current_setting('app.actor_id',true),'') IS NULL THEN
   RAISE EXCEPTION 'Sign in again before requesting a correction' USING ERRCODE='AT006';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance:'||NEW.employee_id::text,0));
  SELECT e.manager_id INTO manager FROM employee e
  WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=me
   AND e.status IN ('active','notice');
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Only current employees can request corrections' USING ERRCODE='AT006';
  END IF;
  IF NEW.work_date>=today OR NEW.work_date<today-30 THEN
   RAISE EXCEPTION 'Corrections cover one of the previous 30 days' USING ERRCODE='AT003';
  END IF;
  IF NEW.check_out<=NEW.check_in THEN
   RAISE EXCEPTION 'Check-out must be after check-in' USING ERRCODE='AT003';
  END IF;
  IF EXISTS(SELECT 1 FROM attendance_correction c WHERE c.tenant_id=NEW.tenant_id
    AND c.employee_id=NEW.employee_id AND c.work_date=NEW.work_date AND c.state='pending') THEN
   RAISE EXCEPTION 'A correction for this day is already awaiting a decision' USING ERRCODE='AT001';
  END IF;
  NEW.manager_id := manager;
  NEW.approver := CASE WHEN manager IS NULL THEN 'hr' ELSE 'manager' END;
  NEW.state := 'pending';
  NEW.version := 1;
  NEW.requested_by_actor := nullif(current_setting('app.actor_id',true),'')::uuid;
  NEW.created_at := now();
  NEW.decided_at := NULL;
  NEW.decided_by_employee := NULL;
  NEW.decided_by_label := NULL;
  NEW.decision_note := NULL;
  RETURN NEW;
 END IF;

 IF (to_jsonb(NEW)-ARRAY['state','version','decided_at','decided_by_employee','decided_by_label','decision_note'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','decided_at','decided_by_employee','decided_by_label','decision_note'])
   OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'Corrections change only through their workflow' USING ERRCODE='AT004';
 END IF;
 IF OLD.state<>'pending' THEN
  RAISE EXCEPTION 'This correction is already final' USING ERRCODE='AT004';
 END IF;
 IF NEW.state IN ('approved','rejected') THEN
  IF me IS NULL OR me=OLD.employee_id THEN
   RAISE EXCEPTION 'You cannot decide your own correction' USING ERRCODE='AT005';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM employee d WHERE d.tenant_id=OLD.tenant_id
    AND d.entity_id=OLD.entity_id AND d.id=me AND d.status IN ('active','notice')) THEN
   RAISE EXCEPTION 'Only current employees can decide corrections' USING ERRCODE='AT006';
  END IF;
  IF NOT ((OLD.approver='manager' AND scope='team' AND OLD.manager_id=me
      AND EXISTS(SELECT 1 FROM employee e WHERE e.tenant_id=OLD.tenant_id
        AND e.entity_id=OLD.entity_id AND e.id=OLD.employee_id AND e.manager_id=me))
    OR (OLD.approver='hr' AND scope='entity')
    -- A request whose manager no longer manages the requester falls to HR.
    OR (OLD.approver='manager' AND scope='entity' AND NOT EXISTS(
      SELECT 1 FROM employee e WHERE e.tenant_id=OLD.tenant_id
        AND e.entity_id=OLD.entity_id AND e.id=OLD.employee_id AND e.manager_id=OLD.manager_id))) THEN
   RAISE EXCEPTION 'This correction is routed to another approver' USING ERRCODE='AT006';
  END IF;
  IF NEW.state='rejected' AND NEW.decision_note IS NULL THEN
   RAISE EXCEPTION 'Explain why the correction is declined' USING ERRCODE='AT003';
  END IF;
 ELSIF NEW.state='cancelled' THEN
  IF me IS NULL OR me<>OLD.employee_id OR scope NOT IN ('self','team') THEN
   RAISE EXCEPTION 'Only the requester can cancel a correction' USING ERRCODE='AT006';
  END IF;
 ELSE
  RAISE EXCEPTION 'Unsupported correction transition' USING ERRCODE='AT004';
 END IF;
 NEW.decided_at := now();
 NEW.decided_by_employee := me;
 NEW.decided_by_label := nullif(current_setting('app.actor_label',true),'');
 RETURN NEW;
END $$;

CREATE FUNCTION apply_attendance_correction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF OLD.state='pending' AND NEW.state='approved' THEN
  PERFORM set_config('attendance.applying',NEW.id::text,true);
  INSERT INTO attendance_record(id,tenant_id,entity_id,employee_id,work_date,check_in,check_out,source,correction_id,version)
  VALUES(gen_random_uuid(),NEW.tenant_id,NEW.entity_id,NEW.employee_id,NEW.work_date,
   NEW.check_in,NEW.check_out,'correction',NEW.id,1)
  ON CONFLICT(tenant_id,employee_id,work_date) DO UPDATE SET
   check_in=EXCLUDED.check_in, check_out=EXCLUDED.check_out,
   source='correction', correction_id=EXCLUDED.correction_id;
  PERFORM set_config('attendance.applying','',true);
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION reject_attendance_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Attendance history is append-only' USING ERRCODE='23514';
END $$;

CREATE TRIGGER attendance_record_guard BEFORE INSERT OR UPDATE ON attendance_record
FOR EACH ROW EXECUTE FUNCTION guard_attendance_record();
CREATE TRIGGER attendance_record_no_delete BEFORE DELETE ON attendance_record
FOR EACH ROW EXECUTE FUNCTION reject_attendance_delete();
CREATE TRIGGER attendance_correction_guard BEFORE INSERT OR UPDATE ON attendance_correction
FOR EACH ROW EXECUTE FUNCTION guard_attendance_correction();
CREATE TRIGGER attendance_correction_apply AFTER UPDATE OF state ON attendance_correction
FOR EACH ROW EXECUTE FUNCTION apply_attendance_correction();
CREATE TRIGGER attendance_correction_no_delete BEFORE DELETE ON attendance_correction
FOR EACH ROW EXECUTE FUNCTION reject_attendance_delete();

ALTER FUNCTION attendance_entity_now() OWNER TO anvione_attendance_keeper;
ALTER FUNCTION guard_attendance_record() OWNER TO anvione_attendance_keeper;
ALTER FUNCTION guard_attendance_correction() OWNER TO anvione_attendance_keeper;
ALTER FUNCTION apply_attendance_correction() OWNER TO anvione_attendance_keeper;
REVOKE ALL ON FUNCTION attendance_entity_now(),guard_attendance_record(),guard_attendance_correction(),
 apply_attendance_correction(),reject_attendance_delete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attendance_entity_now() TO anvione_app;
GRANT SELECT ON legal_entity,employee,attendance_record,attendance_correction TO anvione_attendance_keeper;
GRANT INSERT,UPDATE ON attendance_record TO anvione_attendance_keeper;

ALTER TABLE attendance_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_record FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_correction ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_correction FORCE ROW LEVEL SECURITY;
CREATE POLICY employee_attendance_keeper ON employee FOR SELECT TO anvione_attendance_keeper USING(true);
CREATE POLICY attendance_record_keeper ON attendance_record TO anvione_attendance_keeper USING(true) WITH CHECK(true);
CREATE POLICY attendance_correction_keeper ON attendance_correction FOR SELECT TO anvione_attendance_keeper USING(true);

-- Managers see direct reports through the employee policy; HR sees the entity.
CREATE POLICY attendance_record_visible ON attendance_record FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  (current_setting('app.attendance_scope',true) IN ('self','team')
   AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
  OR (current_setting('app.attendance_scope',true)='team' AND EXISTS(
   SELECT 1 FROM employee e WHERE e.id=attendance_record.employee_id
    AND e.manager_id=nullif(current_setting('app.employee_id',true),'')::uuid))
  OR current_setting('app.attendance_scope',true)='entity'
 )
);
CREATE POLICY attendance_record_punch ON attendance_record FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
 AND current_setting('app.attendance_scope',true) IN ('self','team')
);
CREATE POLICY attendance_record_checkout ON attendance_record FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
  AND current_setting('app.attendance_scope',true) IN ('self','team')
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
 );
CREATE POLICY attendance_correction_visible ON attendance_correction FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  (current_setting('app.attendance_scope',true) IN ('self','team')
   AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
  OR (current_setting('app.attendance_scope',true)='team'
   AND manager_id=nullif(current_setting('app.employee_id',true),'')::uuid)
  OR current_setting('app.attendance_scope',true)='entity'
 )
);
CREATE POLICY attendance_correction_submit ON attendance_correction FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
 AND current_setting('app.attendance_scope',true) IN ('self','team')
);
CREATE POLICY attendance_correction_transition ON attendance_correction FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND (
   (current_setting('app.attendance_scope',true) IN ('self','team')
    AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
   OR (current_setting('app.attendance_scope',true)='team'
    AND manager_id=nullif(current_setting('app.employee_id',true),'')::uuid)
   OR current_setting('app.attendance_scope',true)='entity'
  )
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );

GRANT SELECT ON attendance_record,attendance_correction TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,employee_id,work_date,check_in,source,version) ON attendance_record TO anvione_app;
GRANT UPDATE(check_out,version) ON attendance_record TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,employee_id,work_date,check_in,check_out,reason,
 state,approver,version,requested_by_actor) ON attendance_correction TO anvione_app;
GRANT UPDATE(state,version,decision_note) ON attendance_correction TO anvione_app;

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
 'attendance.correction_rejected.v1','attendance.correction_cancelled.v1'
));

-- Leave guard hardening from the F0.11 review: fail closed without an entity
-- calendar, and let HR decide requests whose manager no longer manages the requester.
CREATE OR REPLACE FUNCTION guard_leave_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 scope text := coalesce(current_setting('app.leave_scope',true),'none');
 today date;
 kind record;
 used numeric;
 reserved numeric;
 manager uuid;
BEGIN
 SELECT (now() AT TIME ZONE le.timezone)::date INTO today
 FROM legal_entity le WHERE le.tenant_id=NEW.tenant_id AND le.id=NEW.entity_id;
 IF today IS NULL THEN
  RAISE EXCEPTION 'Your workspace calendar is unavailable' USING ERRCODE='LV006';
 END IF;

 IF TG_OP='INSERT' THEN
  IF me IS NULL OR NEW.employee_id<>me OR scope NOT IN ('self','team')
    OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
    OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
   RAISE EXCEPTION 'Leave can only be requested for yourself' USING ERRCODE='LV006';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('leave:'||NEW.employee_id::text,0));
  SELECT e.manager_id INTO manager FROM employee e
  WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=NEW.employee_id
   AND e.status IN ('active','notice');
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Only current employees can request leave' USING ERRCODE='LV006';
  END IF;
  IF nullif(current_setting('app.actor_id',true),'') IS NULL THEN
   RAISE EXCEPTION 'Sign in again before requesting leave' USING ERRCODE='LV006';
  END IF;
  IF NEW.end_date < NEW.start_date OR NEW.end_date-NEW.start_date > 31
    OR date_part('year',NEW.start_date)<>date_part('year',NEW.end_date) THEN
   RAISE EXCEPTION 'Choose up to 31 days within one calendar year' USING ERRCODE='LV003';
  END IF;
  IF NEW.start_date < today-7 OR NEW.start_date > today+365 THEN
   RAISE EXCEPTION 'Leave must start within the last 7 days or the next year' USING ERRCODE='LV003';
  END IF;
  NEW.days := leave_working_days(NEW.start_date,NEW.end_date);
  IF NEW.days=0 THEN
   RAISE EXCEPTION 'Choose dates that include a working day' USING ERRCODE='LV003';
  END IF;
  SELECT * INTO kind FROM leave_type t
  WHERE t.tenant_id=NEW.tenant_id AND t.entity_id=NEW.entity_id AND t.id=NEW.leave_type_id AND t.active;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'This leave type is unavailable' USING ERRCODE='LV003';
  END IF;
  IF EXISTS(
   SELECT 1 FROM leave_request r
   WHERE r.tenant_id=NEW.tenant_id AND r.employee_id=NEW.employee_id
    AND r.state IN ('pending','approved')
    AND daterange(r.start_date,r.end_date,'[]') && daterange(NEW.start_date,NEW.end_date,'[]')
  ) THEN
   RAISE EXCEPTION 'These dates overlap another leave request' USING ERRCODE='LV001';
  END IF;
  IF kind.annual_days IS NOT NULL THEN
   SELECT coalesce(sum(CASE WHEN l.kind='debit' THEN l.days ELSE -l.days END),0) INTO used
   FROM leave_ledger l
   WHERE l.tenant_id=NEW.tenant_id AND l.employee_id=NEW.employee_id
    AND l.leave_type_id=NEW.leave_type_id AND l.leave_year=date_part('year',NEW.start_date);
   SELECT coalesce(sum(r.days),0) INTO reserved FROM leave_request r
   WHERE r.tenant_id=NEW.tenant_id AND r.employee_id=NEW.employee_id
    AND r.leave_type_id=NEW.leave_type_id AND r.state='pending'
    AND date_part('year',r.start_date)=date_part('year',NEW.start_date);
   IF kind.annual_days-used-reserved < NEW.days THEN
    RAISE EXCEPTION 'Not enough leave balance for these dates' USING ERRCODE='LV002';
   END IF;
  END IF;
  NEW.manager_id := manager;
  NEW.approver := CASE WHEN manager IS NULL THEN 'hr' ELSE 'manager' END;
  NEW.state := 'pending';
  NEW.version := 1;
  NEW.requested_by_actor := nullif(current_setting('app.actor_id',true),'')::uuid;
  NEW.created_at := now();
  NEW.decided_at := NULL;
  NEW.decided_by_employee := NULL;
  NEW.decided_by_label := NULL;
  NEW.decision_note := NULL;
  RETURN NEW;
 END IF;

 -- UPDATE: only the workflow columns may change, one version at a time.
 IF (to_jsonb(NEW)-ARRAY['state','version','decided_at','decided_by_employee','decided_by_label','decision_note'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','decided_at','decided_by_employee','decided_by_label','decision_note'])
   OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'Leave requests change only through their workflow' USING ERRCODE='LV004';
 END IF;
 IF OLD.state IN ('rejected','cancelled') OR NEW.state=OLD.state THEN
  RAISE EXCEPTION 'This leave request is already final' USING ERRCODE='LV004';
 END IF;
 IF NEW.state IN ('approved','rejected') THEN
  IF OLD.state<>'pending' THEN
   RAISE EXCEPTION 'Only pending requests can be decided' USING ERRCODE='LV004';
  END IF;
  IF me IS NULL OR me=OLD.employee_id THEN
   RAISE EXCEPTION 'You cannot decide your own leave' USING ERRCODE='LV005';
  END IF;
  -- The decider must still be employed, and a manager must still manage the requester.
  IF NOT EXISTS(SELECT 1 FROM employee d WHERE d.tenant_id=OLD.tenant_id
    AND d.entity_id=OLD.entity_id AND d.id=me AND d.status IN ('active','notice')) THEN
   RAISE EXCEPTION 'Only current employees can decide leave' USING ERRCODE='LV006';
  END IF;
  IF NOT ((OLD.approver='manager' AND scope='team' AND OLD.manager_id=me
      AND EXISTS(SELECT 1 FROM employee e WHERE e.tenant_id=OLD.tenant_id
        AND e.entity_id=OLD.entity_id AND e.id=OLD.employee_id AND e.manager_id=me))
    OR (OLD.approver='hr' AND scope='entity')
    -- A request whose manager no longer manages the requester falls to HR.
    OR (OLD.approver='manager' AND scope='entity' AND NOT EXISTS(
      SELECT 1 FROM employee e WHERE e.tenant_id=OLD.tenant_id
        AND e.entity_id=OLD.entity_id AND e.id=OLD.employee_id AND e.manager_id=OLD.manager_id))) THEN
   RAISE EXCEPTION 'This request is routed to another approver' USING ERRCODE='LV006';
  END IF;
  IF NEW.state='rejected' AND NEW.decision_note IS NULL THEN
   RAISE EXCEPTION 'Explain why the request is declined' USING ERRCODE='LV003';
  END IF;
 ELSIF NEW.state='cancelled' THEN
  IF me IS NULL OR me<>OLD.employee_id OR scope NOT IN ('self','team') THEN
   RAISE EXCEPTION 'Only the requester can cancel leave' USING ERRCODE='LV006';
  END IF;
  IF NOT (OLD.state='pending' OR (OLD.state='approved' AND OLD.start_date>today)) THEN
   RAISE EXCEPTION 'Leave that has started cannot be cancelled here' USING ERRCODE='LV007';
  END IF;
 ELSE
  RAISE EXCEPTION 'Unsupported leave transition' USING ERRCODE='LV004';
 END IF;
 NEW.decided_at := now();
 NEW.decided_by_employee := me;
 NEW.decided_by_label := nullif(current_setting('app.actor_label',true),'');
 RETURN NEW;
END $$;
