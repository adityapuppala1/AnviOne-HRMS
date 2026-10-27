-- EXT-01 exits: an employee submits a resignation (or HR starts a case), HR accepts it
-- with a last working day, works through the clearance checklist and completes it.
-- Cases and clearances are never deleted and a closed case never changes.
-- Guards run as a keeper role so the rules hold whatever statement reaches the tables.
CREATE ROLE anvione_exit_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_exit_keeper;
-- A separate role may change exactly one thing outside the exit tables: employee.status.
CREATE ROLE anvione_exit_status_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_exit_status_writer;

CREATE TABLE exit_case (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('resignation','termination','end_of_contract','retirement','other')),
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 3 AND 500 AND reason=btrim(reason)),
 notice_given_on date NOT NULL,
 last_working_day date,
 status text NOT NULL CHECK(status IN ('submitted','accepted','completed','withdrawn','rejected')),
 decision_note text CHECK(decision_note IS NULL OR char_length(btrim(decision_note)) BETWEEN 3 AND 500),
 version integer NOT NULL CHECK(version>0),
 submitted_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 decided_by_label text,
 closed_at timestamptz,
 closed_by_label text,
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 CHECK(last_working_day IS NULL OR last_working_day>=notice_given_on),
 CHECK(status NOT IN ('accepted','completed') OR last_working_day IS NOT NULL),
 CHECK(status<>'rejected' OR decision_note IS NOT NULL)
);
CREATE UNIQUE INDEX exit_case_one_open ON exit_case(employee_id) WHERE status IN ('submitted','accepted');
CREATE INDEX exit_case_status_idx ON exit_case(tenant_id,entity_id,status,created_at DESC);
CREATE INDEX exit_case_employee_idx ON exit_case(tenant_id,entity_id,employee_id);

CREATE TABLE exit_clearance (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 case_id uuid NOT NULL REFERENCES exit_case(id),
 item text NOT NULL CHECK(item IN ('assets','finance','it_access','manager_handover','hr_documents')),
 status text NOT NULL CHECK(status IN ('pending','cleared','waived')),
 note text CHECK(note IS NULL OR char_length(btrim(note)) BETWEEN 3 AND 300),
 cleared_by_label text,
 cleared_at timestamptz,
 version integer NOT NULL CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(case_id,item),
 CHECK((status='pending')=(cleared_at IS NULL)),
 CHECK(status<>'waived' OR note IS NOT NULL)
);

CREATE FUNCTION guard_exit_case() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.exit_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 today date := leave_entity_today();
 managed text[] := ARRAY['status','version','last_working_day','decision_note','decided_at','decided_by_label','closed_at','closed_by_label'];
 hr boolean := scope='entity';
 own boolean;
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
 -- Only the employee's own withdrawal of a submitted resignation is open to non-HR.
 IF NOT hr AND NOT (scope IN ('self','team') AND own AND OLD.status='submitted' AND NEW.status='withdrawn') THEN
  RAISE EXCEPTION 'Only HR manages exit cases' USING ERRCODE='EX005';
 END IF;
 IF hr AND own AND NEW.status IN ('accepted','rejected','completed') THEN
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
 IF (NEW.status='rejected' OR (NEW.status='withdrawn' AND OLD.status='accepted'))
   AND (NEW.decision_note IS NULL OR char_length(btrim(NEW.decision_note))<3) THEN
  RAISE EXCEPTION 'Give a reason' USING ERRCODE='EX003';
 END IF;
 IF NEW.status='completed' THEN
  -- The asset guard takes this lock when issuing, so no asset can arrive mid-completion.
  PERFORM pg_advisory_xact_lock(hashtextextended('assets:'||OLD.employee_id::text,0));
  IF (SELECT count(*) FROM exit_clearance x WHERE x.case_id=OLD.id AND x.status IN ('cleared','waived'))<5
    OR EXISTS(SELECT 1 FROM exit_clearance x WHERE x.case_id=OLD.id AND x.status='pending') THEN
   RAISE EXCEPTION 'Every clearance must be cleared or waived first' USING ERRCODE='EX004';
  END IF;
  IF EXISTS(SELECT 1 FROM asset_assignment a WHERE a.tenant_id=OLD.tenant_id AND a.employee_id=OLD.employee_id
    AND a.returned_on IS NULL) THEN
   RAISE EXCEPTION 'Receive every company asset back first' USING ERRCODE='EX004';
  END IF;
  NEW.decision_note := OLD.decision_note;
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

CREATE FUNCTION guard_exit_clearance() RETURNS trigger
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

-- Employment status follows the case: notice once accepted, inactive once completed,
-- back to active if an accepted case is withdrawn. Sign-in (resolve_identity) and every
-- session lookup (resolve_session) already admit only active and notice employees.
CREATE FUNCTION apply_exit_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.status='accepted' THEN
  UPDATE public.employee SET status='notice' WHERE id=NEW.employee_id AND tenant_id=NEW.tenant_id
   AND entity_id=NEW.entity_id AND status='active';
 ELSIF NEW.status='completed' THEN
  UPDATE public.employee SET status='inactive' WHERE id=NEW.employee_id AND tenant_id=NEW.tenant_id
   AND entity_id=NEW.entity_id AND status IN ('active','notice');
 ELSIF NEW.status='withdrawn' AND OLD.status='accepted' THEN
  UPDATE public.employee SET status='active' WHERE id=NEW.employee_id AND tenant_id=NEW.tenant_id
   AND entity_id=NEW.entity_id AND status='notice';
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION reject_exit_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Exit cases and clearances are kept, never deleted' USING ERRCODE='23514';
END $$;

CREATE TRIGGER exit_case_guard BEFORE INSERT OR UPDATE ON exit_case
FOR EACH ROW EXECUTE FUNCTION guard_exit_case();
CREATE TRIGGER exit_case_status AFTER UPDATE OF status ON exit_case
FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status) EXECUTE FUNCTION apply_exit_status();
CREATE TRIGGER exit_clearance_guard BEFORE INSERT OR UPDATE ON exit_clearance
FOR EACH ROW EXECUTE FUNCTION guard_exit_clearance();
CREATE TRIGGER exit_case_no_delete BEFORE DELETE ON exit_case
FOR EACH ROW EXECUTE FUNCTION reject_exit_delete();
CREATE TRIGGER exit_clearance_no_delete BEFORE DELETE ON exit_clearance
FOR EACH ROW EXECUTE FUNCTION reject_exit_delete();

ALTER FUNCTION guard_exit_case() OWNER TO anvione_exit_keeper;
ALTER FUNCTION guard_exit_clearance() OWNER TO anvione_exit_keeper;
ALTER FUNCTION apply_exit_status() OWNER TO anvione_exit_status_writer;
REVOKE ALL ON FUNCTION guard_exit_case(),guard_exit_clearance(),apply_exit_status(),reject_exit_delete() FROM PUBLIC;
GRANT SELECT ON employee,asset_assignment,exit_case,exit_clearance TO anvione_exit_keeper;
GRANT EXECUTE ON FUNCTION leave_entity_today() TO anvione_exit_keeper;
GRANT SELECT(id,tenant_id,entity_id,status) ON employee TO anvione_exit_status_writer;
GRANT UPDATE(status) ON employee TO anvione_exit_status_writer;

ALTER TABLE exit_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE exit_case FORCE ROW LEVEL SECURITY;
ALTER TABLE exit_clearance ENABLE ROW LEVEL SECURITY;
ALTER TABLE exit_clearance FORCE ROW LEVEL SECURITY;
CREATE POLICY exit_keeper_emp ON employee FOR SELECT TO anvione_exit_keeper USING(true);
CREATE POLICY exit_keeper_assignment ON asset_assignment FOR SELECT TO anvione_exit_keeper USING(true);
CREATE POLICY exit_case_keeper ON exit_case FOR SELECT TO anvione_exit_keeper USING(true);
CREATE POLICY exit_clearance_keeper ON exit_clearance FOR SELECT TO anvione_exit_keeper USING(true);
CREATE POLICY exit_status_writer_read ON employee FOR SELECT TO anvione_exit_status_writer USING(true);
CREATE POLICY exit_status_writer_update ON employee FOR UPDATE TO anvione_exit_status_writer
 USING(true) WITH CHECK(true);

-- HR sees every case; everyone else sees only their own.
CREATE POLICY exit_case_visible ON exit_case FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  current_setting('app.exit_scope',true)='entity'
  OR (current_setting('app.exit_scope',true) IN ('self','team')
   AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
 )
);
CREATE POLICY exit_case_insert ON exit_case FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  current_setting('app.exit_scope',true)='entity'
  OR (current_setting('app.exit_scope',true) IN ('self','team')
   AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
 )
);
CREATE POLICY exit_case_update ON exit_case FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND (
   current_setting('app.exit_scope',true)='entity'
   OR (current_setting('app.exit_scope',true) IN ('self','team')
    AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
  )
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );
CREATE POLICY exit_clearance_visible ON exit_clearance FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  current_setting('app.exit_scope',true)='entity'
  OR (current_setting('app.exit_scope',true) IN ('self','team')
   AND EXISTS(SELECT 1 FROM exit_case c WHERE c.id=exit_clearance.case_id
    AND c.employee_id=nullif(current_setting('app.employee_id',true),'')::uuid))
 )
);
CREATE POLICY exit_clearance_insert ON exit_clearance FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.exit_scope',true)='entity'
);
CREATE POLICY exit_clearance_update ON exit_clearance FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.exit_scope',true)='entity'
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );

GRANT SELECT ON exit_case,exit_clearance TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,employee_id,kind,reason,notice_given_on) ON exit_case TO anvione_app;
GRANT UPDATE(status,last_working_day,decision_note,version) ON exit_case TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,case_id,item) ON exit_clearance TO anvione_app;
GRANT UPDATE(status,note,version) ON exit_clearance TO anvione_app;

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
 'asset.returned.v1','asset.status_changed.v1',
 'policy.created.v1','policy.draft_updated.v1','policy.published.v1','policy.withdrawn.v1',
 'policy.acknowledged.v1',
 'exit.submitted.v1','exit.accepted.v1','exit.rejected.v1','exit.withdrawn.v1',
 'exit.clearance_updated.v1','exit.completed.v1'
));
