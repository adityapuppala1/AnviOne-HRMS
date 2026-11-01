-- LRN-01 self security review fixes (forward-only; 065 is unchanged).
-- * Uniform refusal: for anyone but HR, a draft, archived, missing or other-entity course now
--   answers the same "This course is unavailable" (LN003) when enrolling through a direct
--   statement; previously an archived course answered differently, confirming it exists.
-- * Audience integrity: an assignment labelled department or location now records the unit it was
--   snapshotted from, and the guard checks the employee belongs to that unit at assign time, so a
--   direct HR statement cannot label an arbitrary person as part of an audience.
-- Errors: LN003 bad input (400), LN004 conflict (409), LN005 forbidden (403).
ALTER TABLE lrn_assignment ADD COLUMN audience_unit_id uuid;
ALTER TABLE lrn_assignment ADD CONSTRAINT lrn_assignment_audience_unit
 CHECK((audience IN ('department','location'))=(audience_unit_id IS NOT NULL));
GRANT INSERT(audience_unit_id) ON lrn_assignment TO anvione_app;

CREATE OR REPLACE FUNCTION guard_lrn_assignment() RETURNS trigger
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
  IF NEW.audience='employee' THEN
   NEW.audience_unit_id := NULL;
   NEW.batch_id := NULL;
  END IF;
  IF NEW.due_on IS NULL OR NEW.due_on<CURRENT_DATE OR NEW.due_on>CURRENT_DATE+3660 THEN
   RAISE EXCEPTION 'Choose a due date from today up to ten years ahead' USING ERRCODE='LN003';
  END IF;
 ELSIF NEW.source='self_enrolled' THEN
  IF NEW.employee_id IS DISTINCT FROM me THEN
   RAISE EXCEPTION 'You can enrol only yourself' USING ERRCODE='LN005';
  END IF;
  NEW.audience := 'self';
  NEW.audience_unit_id := NULL;
  NEW.batch_id := NULL;
  NEW.due_on := NULL;
  NEW.mandatory := false;
 ELSE
  RAISE EXCEPTION 'Choose how the course is assigned' USING ERRCODE='LN003';
 END IF;
 SELECT e.status, e.joined_on, e.department_id, e.location_id, p.name INTO emp FROM public.employee e
 JOIN public.person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
 WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=NEW.employee_id;
 IF NOT FOUND OR emp.status NOT IN ('active','notice') OR emp.joined_on>CURRENT_DATE THEN
  RAISE EXCEPTION 'Choose a current employee in your organization' USING ERRCODE='LN003';
 END IF;
 IF (NEW.audience='department' AND NEW.audience_unit_id IS DISTINCT FROM emp.department_id)
   OR (NEW.audience='location' AND NEW.audience_unit_id IS DISTINCT FROM emp.location_id) THEN
  RAISE EXCEPTION 'This person is not in that department or location' USING ERRCODE='LN003';
 END IF;
 SELECT x.status, x.mandatory INTO c FROM public.lrn_course x
 WHERE x.tenant_id=NEW.tenant_id AND x.entity_id=NEW.entity_id AND x.id=NEW.course_id;
 -- One answer for learners whether the course is missing, a draft or archived.
 IF NOT FOUND OR (c.status<>'published' AND scope<>'manage') THEN
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
ALTER FUNCTION guard_lrn_assignment() OWNER TO anvione_learn_keeper;
REVOKE ALL ON FUNCTION guard_lrn_assignment() FROM PUBLIC;
