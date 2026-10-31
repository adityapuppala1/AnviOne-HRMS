-- LRN-01 Learning, backend only: course catalogue, assignments and completion tracking.
-- Courses: HR-managed per entity (LRN-C-000001 codes), draft -> published -> archived; archived and
-- draft courses can never be newly assigned. Assignments: HR assigns a published course to one
-- current employee or to a department/location audience (a snapshot of its current employees at
-- assign time); learners self-enrol in published non-mandatory courses. One open assignment per
-- (employee, course). Progress assigned -> in_progress -> completed; HR records a completion on
-- someone's behalf or waives an assignment with a reason, never for their own assignment
-- (four-eyes). Completions and waivers are an append-only history; the assignment status is then
-- moved by a narrow writer role. Overdue and "due for renewal" are derived, never stored.
-- Visibility: self own, team (managers) own + current direct reports (read only), manage entity.
-- Errors: LN003 bad input (400), LN004 conflict (409), LN005 forbidden (403).
CREATE ROLE anvione_learn_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE anvione_learn_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_learn_keeper, anvione_learn_writer;

CREATE TABLE lrn_course (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^LRN-C-[0-9]{6}$'),
 title text NOT NULL CHECK(char_length(title) BETWEEN 3 AND 120 AND title=btrim(title)),
 description text NOT NULL DEFAULT '' CHECK(char_length(description)<=2000 AND description=btrim(description)),
 category text NOT NULL CHECK(char_length(category) BETWEEN 2 AND 60 AND category=btrim(category)),
 delivery_mode text NOT NULL CHECK(delivery_mode IN ('online','classroom','self_study')),
 duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 1 AND 10000),
 external_url text CHECK(external_url ~ '^https://[^\s<>"]+$' AND char_length(external_url)<=500),
 status text NOT NULL CHECK(status IN ('draft','published','archived')),
 mandatory boolean NOT NULL DEFAULT false,
 validity_months integer CHECK(validity_months BETWEEN 1 AND 120),
 published_at timestamptz,
 archived_at timestamptz,
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 CHECK((status='archived')=(archived_at IS NOT NULL)),
 CHECK(status<>'published' OR published_at IS NOT NULL),
 CONSTRAINT lrn_course_code_key UNIQUE(tenant_id,entity_id,code),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX lrn_course_entity_idx ON lrn_course(tenant_id,entity_id,status,lower(title),id);

CREATE TABLE lrn_assignment (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 course_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 employee_name text NOT NULL,
 source text NOT NULL CHECK(source IN ('assigned','self_enrolled')),
 audience text NOT NULL CHECK(audience IN ('employee','department','location','self')),
 batch_id uuid,
 due_on date,
 mandatory boolean NOT NULL,
 status text NOT NULL CHECK(status IN ('assigned','in_progress','completed','waived')),
 started_at timestamptz,
 completed_at timestamptz,
 waived_at timestamptz,
 expires_on date,
 assigned_by_employee uuid NOT NULL,
 assigned_by_label text NOT NULL,
 version integer NOT NULL CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,course_id) REFERENCES lrn_course(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 CHECK((source='self_enrolled')=(audience='self')),
 CHECK(source='self_enrolled' OR due_on IS NOT NULL),
 CHECK(source='assigned' OR (due_on IS NULL AND NOT mandatory AND assigned_by_employee=employee_id)),
 CHECK((audience IN ('department','location'))=(batch_id IS NOT NULL)),
 CHECK(status<>'assigned' OR started_at IS NULL),
 CHECK((status='completed')=(completed_at IS NOT NULL)),
 CHECK((status='waived')=(waived_at IS NOT NULL)),
 CHECK(expires_on IS NULL OR status='completed'),
 UNIQUE(tenant_id,entity_id,id)
);
-- One open assignment per person and course.
CREATE UNIQUE INDEX lrn_assignment_open_key ON lrn_assignment(tenant_id,entity_id,employee_id,course_id)
 WHERE status IN ('assigned','in_progress');
CREATE INDEX lrn_assignment_employee_idx ON lrn_assignment(tenant_id,entity_id,employee_id,created_at DESC);
CREATE INDEX lrn_assignment_course_idx ON lrn_assignment(course_id,status);

-- Append-only: one completion or waiver per assignment.
CREATE TABLE lrn_completion (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 assignment_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 course_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('completed','waived')),
 recorded_by text NOT NULL CHECK(recorded_by IN ('self','hr')),
 note text CHECK(char_length(note) BETWEEN 1 AND 500 AND note=btrim(note)),
 by_employee uuid NOT NULL,
 by_label text NOT NULL,
 at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_on date,
 FOREIGN KEY(tenant_id,entity_id,assignment_id) REFERENCES lrn_assignment(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,course_id) REFERENCES lrn_course(tenant_id,entity_id,id),
 CONSTRAINT lrn_completion_once_key UNIQUE(assignment_id),
 CHECK(outcome='completed' OR recorded_by='hr'),
 CHECK(recorded_by='self' OR note IS NOT NULL),
 CHECK(recorded_by<>'self' OR (by_employee=employee_id AND (note IS NULL OR char_length(note)<=280))),
 -- Four-eyes: HR never records on-behalf completion for, or waives, their own assignment.
 CONSTRAINT lrn_completion_four_eyes CHECK(recorded_by<>'hr' OR by_employee<>employee_id),
 CHECK(expires_on IS NULL OR outcome='completed')
);
CREATE INDEX lrn_completion_employee_idx ON lrn_completion(tenant_id,entity_id,employee_id,at);

-- Helpers -----------------------------------------------------------------------------------
CREATE FUNCTION lrn_in_entity(p_tenant uuid, p_entity uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(p_tenant=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND p_entity=nullif(current_setting('app.entity_id',true),'')::uuid,false);
$$;
CREATE FUNCTION lrn_scope() RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN nullif(current_setting('app.employee_id',true),'') IS NULL
   OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN 'none'
  ELSE coalesce(nullif(current_setting('app.learn_scope',true),''),'none') END;
$$;
CREATE FUNCTION lrn_me() RETURNS uuid
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT nullif(current_setting('app.employee_id',true),'')::uuid;
$$;
-- Whether an employee is currently a direct report of the caller (team scope only).
CREATE FUNCTION lrn_is_report(p_employee uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.lrn_scope()='team' AND EXISTS(SELECT 1 FROM public.employee e
  WHERE e.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND e.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
   AND e.id=p_employee AND e.manager_id=public.lrn_me());
$$;
-- Who an assignment or completion row is visible to.
CREATE FUNCTION lrn_sees(p_tenant uuid, p_entity uuid, p_employee uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.lrn_in_entity(p_tenant,p_entity) AND CASE public.lrn_scope()
  WHEN 'manage' THEN true
  WHEN 'team' THEN p_employee=public.lrn_me() OR public.lrn_is_report(p_employee)
  WHEN 'self' THEN p_employee=public.lrn_me()
  ELSE false END;
$$;
-- Audience snapshot: current (active or on notice, already joined) employees of a department or
-- location in the caller's entity. HR only.
CREATE FUNCTION lrn_audience(p_kind text, p_unit uuid) RETURNS TABLE(employee_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT e.id FROM public.employee e
 WHERE public.lrn_scope()='manage' AND p_kind IN ('department','location')
  AND e.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND e.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND e.status IN ('active','notice') AND e.joined_on<=CURRENT_DATE
  AND CASE p_kind WHEN 'department' THEN e.department_id=p_unit ELSE e.location_id=p_unit END
 ORDER BY e.id;
$$;

-- Courses (learn.manage only) ------------------------------------------------------------------
CREATE FUNCTION guard_lrn_course() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 next_no integer;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This record belongs to another organization' USING ERRCODE='LN005';
 END IF;
 IF lrn_scope()<>'manage' THEN
  RAISE EXCEPTION 'Only HR manages the course catalogue' USING ERRCODE='LN005';
 END IF;
 IF NEW.external_url IS NOT NULL AND (NEW.external_url !~ '^https://[^\s<>"]+$' OR char_length(NEW.external_url)>500) THEN
  RAISE EXCEPTION 'Links must start with https:// and be up to 500 characters' USING ERRCODE='LN003';
 END IF;
 IF TG_OP='INSERT' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('lrn-course-code:'||NEW.tenant_id::text||':'||NEW.entity_id::text,0));
  SELECT coalesce(max(substr(c.code,7)::integer),0)+1 INTO next_no FROM lrn_course c
  WHERE c.tenant_id=NEW.tenant_id AND c.entity_id=NEW.entity_id;
  IF next_no>999999 THEN
   RAISE EXCEPTION 'Course numbers are exhausted for this entity' USING ERRCODE='LN004';
  END IF;
  NEW.code := 'LRN-C-'||lpad(next_no::text,6,'0');
  NEW.status := 'draft';
  NEW.published_at := NULL;
  NEW.archived_at := NULL;
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('lrn-course:'||OLD.id::text,0));
  IF NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'This course changed. Reload it before trying again' USING ERRCODE='LN004';
  END IF;
  IF (NEW.id,NEW.code,NEW.created_by_label,NEW.created_at,NEW.published_at,NEW.archived_at)
    IS DISTINCT FROM (OLD.id,OLD.code,OLD.created_by_label,OLD.created_at,OLD.published_at,OLD.archived_at) THEN
   RAISE EXCEPTION 'A course changes only through its own actions' USING ERRCODE='LN004';
  END IF;
  IF OLD.status='archived' THEN
   RAISE EXCEPTION 'An archived course cannot be changed' USING ERRCODE='LN004';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF (NEW.title,NEW.description,NEW.category,NEW.delivery_mode,NEW.duration_minutes,NEW.external_url,NEW.mandatory,NEW.validity_months)
     IS DISTINCT FROM (OLD.title,OLD.description,OLD.category,OLD.delivery_mode,OLD.duration_minutes,OLD.external_url,OLD.mandatory,OLD.validity_months) THEN
    RAISE EXCEPTION 'Change the course and its status in separate steps' USING ERRCODE='LN004';
   END IF;
   IF OLD.status='draft' AND NEW.status='published' THEN
    NEW.published_at := now();
   ELSIF OLD.status IN ('draft','published') AND NEW.status='archived' THEN
    NEW.archived_at := now();
   ELSE
    RAISE EXCEPTION 'A course cannot move from % to %', OLD.status, NEW.status USING ERRCODE='LN004';
   END IF;
  END IF;
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Assignments ---------------------------------------------------------------------------------
CREATE FUNCTION guard_lrn_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := public.lrn_me();
 scope text := public.lrn_scope();
 emp record;
 c record;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This record belongs to another organization' USING ERRCODE='LN005';
 END IF;
 IF me IS NULL OR scope NOT IN ('self','team','manage') THEN
  RAISE EXCEPTION 'Your current workspace cannot take courses' USING ERRCODE='LN005';
 END IF;
 IF NEW.source='assigned' THEN
  IF scope<>'manage' THEN
   RAISE EXCEPTION 'Only HR assigns courses' USING ERRCODE='LN005';
  END IF;
  IF NEW.audience IS NULL OR NEW.audience NOT IN ('employee','department','location') THEN
   RAISE EXCEPTION 'Choose who to assign the course to' USING ERRCODE='LN003';
  END IF;
  IF NEW.due_on IS NULL OR NEW.due_on<CURRENT_DATE OR NEW.due_on>CURRENT_DATE+3660 THEN
   RAISE EXCEPTION 'Choose a due date from today up to ten years ahead' USING ERRCODE='LN003';
  END IF;
 ELSIF NEW.source='self_enrolled' THEN
  IF NEW.employee_id IS DISTINCT FROM me THEN
   RAISE EXCEPTION 'You can enrol only yourself' USING ERRCODE='LN005';
  END IF;
  NEW.audience := 'self';
  NEW.batch_id := NULL;
  NEW.due_on := NULL;
  NEW.mandatory := false;
 ELSE
  RAISE EXCEPTION 'Choose how the course is assigned' USING ERRCODE='LN003';
 END IF;
 SELECT e.status, e.joined_on, p.name INTO emp FROM public.employee e
 JOIN public.person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
 WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=NEW.employee_id;
 IF NOT FOUND OR emp.status NOT IN ('active','notice') OR emp.joined_on>CURRENT_DATE THEN
  RAISE EXCEPTION 'Choose a current employee in your organization' USING ERRCODE='LN003';
 END IF;
 SELECT x.status, x.mandatory INTO c FROM public.lrn_course x
 WHERE x.tenant_id=NEW.tenant_id AND x.entity_id=NEW.entity_id AND x.id=NEW.course_id;
 IF NOT FOUND OR (c.status='draft' AND scope<>'manage') THEN
  RAISE EXCEPTION 'This course is unavailable' USING ERRCODE='LN003';
 END IF;
 IF c.status<>'published' THEN
  RAISE EXCEPTION 'Only published courses can be assigned or enrolled in' USING ERRCODE='LN004';
 END IF;
 IF NEW.source='self_enrolled' AND c.mandatory THEN
  RAISE EXCEPTION 'Mandatory courses are assigned by HR' USING ERRCODE='LN003';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lrn-open:'||NEW.employee_id::text||':'||NEW.course_id::text,0));
 IF EXISTS(SELECT 1 FROM public.lrn_assignment a WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id
   AND a.employee_id=NEW.employee_id AND a.course_id=NEW.course_id AND a.status IN ('assigned','in_progress')) THEN
  RAISE EXCEPTION 'This person already has an open assignment for this course' USING ERRCODE='LN004';
 END IF;
 NEW.employee_name := emp.name;
 NEW.mandatory := coalesce(NEW.mandatory,c.mandatory);
 NEW.status := 'assigned';
 NEW.started_at := NULL;
 NEW.completed_at := NULL;
 NEW.waived_at := NULL;
 NEW.expires_on := NULL;
 NEW.assigned_by_employee := me;
 NEW.assigned_by_label := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 NEW.version := 1;
 NEW.created_at := now();
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Runs as the caller (not SECURITY DEFINER) so it can tell the writer role apart. The learner
-- starts their own assignment; completion and waiver come only from the history (writer role).
CREATE FUNCTION guard_lrn_assignment_update() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'This assignment changed. Reload it before trying again' USING ERRCODE='LN004';
 END IF;
 IF current_user='anvione_learn_writer' THEN
  IF (to_jsonb(NEW)-ARRAY['status','completed_at','waived_at','expires_on','version','updated_at'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','completed_at','waived_at','expires_on','version','updated_at'])
    OR OLD.status NOT IN ('assigned','in_progress') OR NEW.status NOT IN ('completed','waived') THEN
   RAISE EXCEPTION 'An assignment changes only through its own actions' USING ERRCODE='LN004';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
 END IF;
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This record belongs to another organization' USING ERRCODE='LN005';
 END IF;
 IF lrn_scope() NOT IN ('self','team','manage') OR OLD.employee_id IS DISTINCT FROM lrn_me() THEN
  RAISE EXCEPTION 'Only the learner starts their own assignment' USING ERRCODE='LN005';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version'])
   OR OLD.status<>'assigned' OR NEW.status<>'in_progress' THEN
  RAISE EXCEPTION 'Only an assignment not yet started can be started' USING ERRCODE='LN004';
 END IF;
 NEW.started_at := now();
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Completion history ----------------------------------------------------------------------------
CREATE FUNCTION guard_lrn_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := public.lrn_me();
 scope text := public.lrn_scope();
 a record;
 months integer;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This record belongs to another organization' USING ERRCODE='LN005';
 END IF;
 IF me IS NULL OR scope NOT IN ('self','team','manage') THEN
  RAISE EXCEPTION 'Your current workspace cannot record completions' USING ERRCODE='LN005';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lrn-assignment:'||NEW.assignment_id::text,0));
 SELECT x.employee_id, x.course_id, x.status INTO a FROM public.lrn_assignment x
 WHERE x.tenant_id=NEW.tenant_id AND x.entity_id=NEW.entity_id AND x.id=NEW.assignment_id;
 -- One answer whether the assignment is missing, in another entity or not the caller's to act on.
 IF NOT FOUND OR (scope<>'manage' AND a.employee_id IS DISTINCT FROM me) THEN
  RAISE EXCEPTION 'This assignment is unavailable' USING ERRCODE='LN003';
 END IF;
 IF NEW.recorded_by='self' THEN
  IF a.employee_id IS DISTINCT FROM me THEN
   RAISE EXCEPTION 'Learners complete only their own assignments; HR records on their behalf' USING ERRCODE='LN005';
  END IF;
  IF NEW.outcome IS DISTINCT FROM 'completed' THEN
   RAISE EXCEPTION 'Only HR waives an assignment' USING ERRCODE='LN005';
  END IF;
  NEW.note := nullif(btrim(NEW.note),'');
  IF NEW.note IS NOT NULL AND char_length(NEW.note)>280 THEN
   RAISE EXCEPTION 'Keep the completion note to 280 characters' USING ERRCODE='LN003';
  END IF;
 ELSIF NEW.recorded_by='hr' THEN
  IF scope<>'manage' THEN
   RAISE EXCEPTION 'Only HR records a completion on someone''s behalf or waives an assignment' USING ERRCODE='LN005';
  END IF;
  IF a.employee_id=me THEN
   RAISE EXCEPTION 'Someone else in HR must record or waive your own assignment' USING ERRCODE='LN005';
  END IF;
  IF NEW.outcome IS NULL OR NEW.outcome NOT IN ('completed','waived') THEN
   RAISE EXCEPTION 'Record a completion or a waiver' USING ERRCODE='LN003';
  END IF;
  IF NEW.note IS NULL OR char_length(btrim(NEW.note)) NOT BETWEEN 3 AND 500 THEN
   RAISE EXCEPTION 'Give a reason of 3 to 500 characters' USING ERRCODE='LN003';
  END IF;
  NEW.note := btrim(NEW.note);
 ELSE
  RAISE EXCEPTION 'Record a completion or a waiver' USING ERRCODE='LN003';
 END IF;
 IF a.status NOT IN ('assigned','in_progress') THEN
  RAISE EXCEPTION 'This assignment is already %', replace(a.status,'_',' ') USING ERRCODE='LN004';
 END IF;
 NEW.employee_id := a.employee_id;
 NEW.course_id := a.course_id;
 NEW.by_employee := me;
 NEW.by_label := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 NEW.at := clock_timestamp();
 NEW.expires_on := NULL;
 IF NEW.outcome='completed' THEN
  SELECT c.validity_months INTO months FROM public.lrn_course c WHERE c.id=a.course_id;
  IF months IS NOT NULL THEN
   NEW.expires_on := (CURRENT_DATE+make_interval(months=>months))::date;
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- Writer-owned: moves the assignment to completed or waived from the history row.
CREATE FUNCTION apply_lrn_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 UPDATE public.lrn_assignment SET status=NEW.outcome,
  completed_at=CASE WHEN NEW.outcome='completed' THEN NEW.at END,
  waived_at=CASE WHEN NEW.outcome='waived' THEN NEW.at END,
  expires_on=NEW.expires_on, version=version+1
 WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND id=NEW.assignment_id;
 RETURN NULL;
END $$;

CREATE FUNCTION reject_lrn_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Learning records are kept, never deleted' USING ERRCODE='23514';
END $$;
CREATE FUNCTION reject_lrn_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Completion history is final' USING ERRCODE='LN004';
END $$;

CREATE TRIGGER lrn_course_guard BEFORE INSERT OR UPDATE ON lrn_course FOR EACH ROW EXECUTE FUNCTION guard_lrn_course();
CREATE TRIGGER lrn_assignment_guard BEFORE INSERT ON lrn_assignment FOR EACH ROW EXECUTE FUNCTION guard_lrn_assignment();
CREATE TRIGGER lrn_assignment_guard_update BEFORE UPDATE ON lrn_assignment FOR EACH ROW EXECUTE FUNCTION guard_lrn_assignment_update();
CREATE TRIGGER lrn_completion_guard BEFORE INSERT ON lrn_completion FOR EACH ROW EXECUTE FUNCTION guard_lrn_completion();
CREATE TRIGGER lrn_completion_apply AFTER INSERT ON lrn_completion FOR EACH ROW EXECUTE FUNCTION apply_lrn_completion();
CREATE TRIGGER lrn_completion_final BEFORE UPDATE ON lrn_completion FOR EACH ROW EXECUTE FUNCTION reject_lrn_rewrite();
CREATE TRIGGER lrn_course_no_delete BEFORE DELETE ON lrn_course FOR EACH ROW EXECUTE FUNCTION reject_lrn_delete();
CREATE TRIGGER lrn_assignment_no_delete BEFORE DELETE ON lrn_assignment FOR EACH ROW EXECUTE FUNCTION reject_lrn_delete();
CREATE TRIGGER lrn_completion_no_delete BEFORE DELETE ON lrn_completion FOR EACH ROW EXECUTE FUNCTION reject_lrn_delete();
CREATE TRIGGER lrn_course_no_truncate BEFORE TRUNCATE ON lrn_course FOR EACH STATEMENT EXECUTE FUNCTION reject_lrn_delete();
CREATE TRIGGER lrn_assignment_no_truncate BEFORE TRUNCATE ON lrn_assignment FOR EACH STATEMENT EXECUTE FUNCTION reject_lrn_delete();
CREATE TRIGGER lrn_completion_no_truncate BEFORE TRUNCATE ON lrn_completion FOR EACH STATEMENT EXECUTE FUNCTION reject_lrn_delete();
-- Guards, writers and delete blocks fire in replica sessions too.
DO $$
DECLARE r record;
BEGIN
 FOR r IN SELECT c.relname AS t, g.tgname AS name FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE NOT g.tgisinternal AND n.nspname='public' AND c.relname LIKE 'lrn\_%' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I', r.t, r.name);
 END LOOP;
END $$;

-- Ownership and grants -------------------------------------------------------------------------
-- keeper: reads employees, people, courses and assignments for the guards, the audience snapshot
-- and the direct-report check; writes nothing. writer: moves an assignment to completed/waived.
ALTER FUNCTION lrn_is_report(uuid) OWNER TO anvione_learn_keeper;
ALTER FUNCTION lrn_audience(text,uuid) OWNER TO anvione_learn_keeper;
ALTER FUNCTION guard_lrn_assignment() OWNER TO anvione_learn_keeper;
ALTER FUNCTION guard_lrn_completion() OWNER TO anvione_learn_keeper;
ALTER FUNCTION apply_lrn_completion() OWNER TO anvione_learn_writer;
REVOKE ALL ON FUNCTION lrn_in_entity(uuid,uuid),lrn_scope(),lrn_me(),lrn_is_report(uuid),lrn_sees(uuid,uuid,uuid),
 lrn_audience(text,uuid),guard_lrn_course(),guard_lrn_assignment(),guard_lrn_assignment_update(),
 guard_lrn_completion(),apply_lrn_completion(),reject_lrn_delete(),reject_lrn_rewrite() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lrn_in_entity(uuid,uuid),lrn_scope(),lrn_me(),lrn_is_report(uuid),lrn_sees(uuid,uuid,uuid),
 lrn_audience(text,uuid) TO anvione_app;
GRANT EXECUTE ON FUNCTION lrn_in_entity(uuid,uuid),lrn_scope(),lrn_me(),lrn_is_report(uuid),lrn_sees(uuid,uuid,uuid)
 TO anvione_learn_keeper, anvione_learn_writer;

GRANT SELECT ON employee,person,lrn_course,lrn_assignment TO anvione_learn_keeper;
GRANT SELECT ON lrn_assignment TO anvione_learn_writer;
GRANT UPDATE(status,completed_at,waived_at,expires_on,version,updated_at) ON lrn_assignment TO anvione_learn_writer;

ALTER TABLE lrn_course ENABLE ROW LEVEL SECURITY;
ALTER TABLE lrn_course FORCE ROW LEVEL SECURITY;
ALTER TABLE lrn_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE lrn_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE lrn_completion ENABLE ROW LEVEL SECURITY;
ALTER TABLE lrn_completion FORCE ROW LEVEL SECURITY;

CREATE POLICY lrn_keeper_emp ON employee FOR SELECT TO anvione_learn_keeper USING(true);
CREATE POLICY lrn_keeper_person ON person FOR SELECT TO anvione_learn_keeper USING(true);
CREATE POLICY lrn_keeper ON lrn_course FOR SELECT TO anvione_learn_keeper USING(true);
CREATE POLICY lrn_keeper ON lrn_assignment FOR SELECT TO anvione_learn_keeper USING(true);
CREATE POLICY lrn_writer_read ON lrn_assignment FOR SELECT TO anvione_learn_writer USING(true);
CREATE POLICY lrn_writer_update ON lrn_assignment FOR UPDATE TO anvione_learn_writer USING(true) WITH CHECK(true);

-- HR sees every course; others published ones and any course they can see an assignment for.
CREATE POLICY lrn_course_visible ON lrn_course FOR SELECT TO anvione_app
 USING(lrn_in_entity(tenant_id,entity_id) AND (lrn_scope()='manage'
  OR (lrn_scope() IN ('self','team') AND (status='published'
   OR EXISTS(SELECT 1 FROM lrn_assignment a WHERE a.course_id=lrn_course.id)))));
CREATE POLICY lrn_course_insert ON lrn_course FOR INSERT TO anvione_app
 WITH CHECK(lrn_in_entity(tenant_id,entity_id) AND lrn_scope()='manage');
CREATE POLICY lrn_course_update ON lrn_course FOR UPDATE TO anvione_app
 USING(lrn_in_entity(tenant_id,entity_id) AND lrn_scope()='manage') WITH CHECK(lrn_in_entity(tenant_id,entity_id));
CREATE POLICY lrn_assignment_visible ON lrn_assignment FOR SELECT TO anvione_app
 USING(lrn_sees(tenant_id,entity_id,employee_id));
CREATE POLICY lrn_assignment_insert ON lrn_assignment FOR INSERT TO anvione_app
 WITH CHECK(lrn_in_entity(tenant_id,entity_id) AND (lrn_scope()='manage'
  OR (lrn_scope() IN ('self','team') AND employee_id=lrn_me())));
CREATE POLICY lrn_assignment_update ON lrn_assignment FOR UPDATE TO anvione_app
 USING(lrn_in_entity(tenant_id,entity_id) AND lrn_scope() IN ('self','team','manage') AND employee_id=lrn_me())
 WITH CHECK(lrn_in_entity(tenant_id,entity_id) AND employee_id=lrn_me());
CREATE POLICY lrn_completion_visible ON lrn_completion FOR SELECT TO anvione_app
 USING(lrn_sees(tenant_id,entity_id,employee_id));
CREATE POLICY lrn_completion_insert ON lrn_completion FOR INSERT TO anvione_app
 WITH CHECK(lrn_in_entity(tenant_id,entity_id) AND lrn_scope() IN ('self','team','manage')
  AND by_employee=lrn_me());

GRANT SELECT ON lrn_course,lrn_assignment,lrn_completion TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,title,description,category,delivery_mode,duration_minutes,external_url,mandatory,validity_months)
 ON lrn_course TO anvione_app;
GRANT UPDATE(title,description,category,delivery_mode,duration_minutes,external_url,mandatory,validity_months,status,version)
 ON lrn_course TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,course_id,employee_id,source,audience,batch_id,due_on,mandatory) ON lrn_assignment TO anvione_app;
GRANT UPDATE(status,version) ON lrn_assignment TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,assignment_id,outcome,recorded_by,note) ON lrn_completion TO anvione_app;

-- Outbox event types: rebuilt from the constraint as it stands when this runs (so types added by
-- any migration applied before this one are kept), plus the learning events.
DO $$
DECLARE
 def text;
 types text[];
BEGIN
 SELECT pg_get_constraintdef(c.oid) INTO def FROM pg_constraint c
 WHERE c.conrelid='public.outbox_event'::regclass AND c.conname='outbox_event_event_type_check';
 SELECT coalesce(array_agg(DISTINCT m[1]),'{}') INTO types FROM regexp_matches(coalesce(def,''),'''([a-z0-9_.]+)''','g') AS m;
 IF cardinality(types)<100 THEN
  RAISE EXCEPTION 'Could not read the existing outbox event types';
 END IF;
 types := types||ARRAY['learn.course_created.v1','learn.course_updated.v1','learn.course_published.v1',
  'learn.course_archived.v1','learn.assigned.v1','learn.audience_assigned.v1','learn.enrolled.v1',
  'learn.started.v1','learn.completed.v1','learn.completion_recorded.v1','learn.waived.v1'];
 ALTER TABLE public.outbox_event DROP CONSTRAINT outbox_event_event_type_check;
 EXECUTE format('ALTER TABLE public.outbox_event ADD CONSTRAINT outbox_event_event_type_check CHECK(event_type IN (%s))',
  (SELECT string_agg(quote_literal(x),',' ORDER BY x) FROM (SELECT DISTINCT unnest(types) AS x) u));
END $$;
