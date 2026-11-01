-- LRN-01 independent security review fixes (forward-only; 065 and 066 are unchanged).
-- * Course links: external_url now must be https:// with a plain host name (letters, digits, dots,
--   hyphens; at least one dot), an optional port, then only RFC 3986 characters. This refuses
--   userinfo tricks (https://good.example@evil.example), backslashes, quotes, control and bidi
--   characters. The server never fetches the link; it is only shown to people.
-- * Audience size: a department or location snapshot is capped at 1000 people per call. Each
--   assignment row takes an advisory lock, and an unbounded audience could exhaust the shared
--   lock table (max_locks_per_transaction x max_connections) for every session in the cluster.
-- * Archive race: assigning or enrolling now takes the course's lock in shared mode before reading
--   its status, so a course archived at the same moment can no longer gain an open assignment.
-- Errors: LN003 bad input (400), LN004 conflict (409), LN005 forbidden (403).

CREATE FUNCTION lrn_url_ok(p_url text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT p_url IS NULL OR (char_length(p_url)<=500
  AND p_url ~ '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?([/?#][]A-Za-z0-9!#$%&()*+,./:;=?@[_~-]*)?$');
$$;
REVOKE ALL ON FUNCTION lrn_url_ok(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lrn_url_ok(text) TO anvione_app;
-- NOT VALID: existing rows keep working; every new or changed row must pass.
ALTER TABLE lrn_course ADD CONSTRAINT lrn_course_url_safe CHECK(lrn_url_ok(external_url)) NOT VALID;

CREATE OR REPLACE FUNCTION guard_lrn_course() RETURNS trigger
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
 IF NOT lrn_url_ok(NEW.external_url) THEN
  RAISE EXCEPTION 'Links must be https:// with a plain web address, up to 500 characters' USING ERRCODE='LN003';
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
REVOKE ALL ON FUNCTION guard_lrn_course() FROM PUBLIC;

-- Audience snapshot, capped. HR only.
CREATE OR REPLACE FUNCTION lrn_audience(p_kind text, p_unit uuid) RETURNS TABLE(employee_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 ids uuid[];
BEGIN
 SELECT coalesce(array_agg(e.id ORDER BY e.id),'{}') INTO ids FROM public.employee e
 WHERE public.lrn_scope()='manage' AND p_kind IN ('department','location')
  AND e.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND e.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND e.status IN ('active','notice') AND e.joined_on<=CURRENT_DATE
  AND CASE p_kind WHEN 'department' THEN e.department_id=p_unit ELSE e.location_id=p_unit END;
 IF cardinality(ids)>1000 THEN
  RAISE EXCEPTION 'Assign to at most 1000 people at a time' USING ERRCODE='LN003';
 END IF;
 RETURN QUERY SELECT unnest(ids);
END $$;
ALTER FUNCTION lrn_audience(text,uuid) OWNER TO anvione_learn_keeper;
REVOKE ALL ON FUNCTION lrn_audience(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lrn_audience(text,uuid) TO anvione_app;

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
 -- Shared with the course guard's exclusive lock: a concurrent archive waits, or is seen.
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('lrn-course:'||NEW.course_id::text,0));
 SELECT x.status, x.mandatory INTO c FROM public.lrn_course x
 WHERE x.tenant_id=NEW.tenant_id AND x.entity_id=NEW.entity_id AND x.id=NEW.course_id;
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
