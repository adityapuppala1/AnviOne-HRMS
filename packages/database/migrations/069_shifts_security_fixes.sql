-- SHF-01 self security review fixes (forward-only; 068 is unchanged).
-- * Leave flag: shf_on_leave() is callable by the app and runs as the keeper, so any employee could
--   ask it whether any colleague had approved leave on a date. It now answers only for people whose
--   roster the caller may see (HR: anyone in the entity; a manager: themselves and current direct
--   reports; an employee: themselves) and false otherwise.
-- * Open-shift poster: shf_open_poster() returned the posting manager of any open shift id, visible
--   or not. It now returns the poster only to that poster (the only comparison the claim policies
--   make), and NULL to everyone else.
-- * Swap proposals: a refusal because of the colleague's side no longer tells the proposer the
--   colleague's leave or the dates of their other shifts (including draft weeks); it gives one
--   generic message. The proposer's own conflicts keep their detail.
-- Errors: SF003 bad input (400), SF004 conflict (409), SF005 forbidden (403).
CREATE OR REPLACE FUNCTION shf_on_leave(p_employee uuid, p_day date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT (public.shf_scope()='manage' OR (public.shf_scope() IN ('self','team') AND p_employee=public.shf_me())
   OR public.shf_is_report(p_employee))
  AND EXISTS(SELECT 1 FROM public.leave_request l
  WHERE l.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND l.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
   AND l.employee_id=p_employee AND l.state='approved' AND p_day BETWEEN l.start_date AND l.end_date);
$$;
ALTER FUNCTION shf_on_leave(uuid,date) OWNER TO anvione_shift_keeper;
REVOKE ALL ON FUNCTION shf_on_leave(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shf_on_leave(uuid,date) TO anvione_app, anvione_shift_keeper, anvione_shift_writer;

CREATE OR REPLACE FUNCTION shf_open_poster(p_open uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT s.manager_id FROM public.shf_open_shift s
 WHERE s.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND s.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid AND s.id=p_open
  AND s.manager_id=public.shf_me();
$$;
ALTER FUNCTION shf_open_poster(uuid) OWNER TO anvione_shift_keeper;
REVOKE ALL ON FUNCTION shf_open_poster(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shf_open_poster(uuid) TO anvione_app;

CREATE OR REPLACE FUNCTION guard_shf_swap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := public.shf_me();
 scope text := public.shf_scope();
 mine record;
 theirs record;
 who record;
 n integer;
 problem text;
BEGIN
 PERFORM public.shf_entity_check(NEW.tenant_id,NEW.entity_id);
 IF me IS NULL OR scope NOT IN ('self','team','manage') THEN
  RAISE EXCEPTION 'Your current workspace cannot swap shifts' USING ERRCODE='SF005';
 END IF;
 SELECT a.* INTO mine FROM public.shf_assignment a
 WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id AND a.id=NEW.requester_assignment_id;
 -- One answer whether the shift is missing, someone else's, cancelled, past or unpublished.
 IF NOT FOUND OR mine.employee_id<>me OR mine.status<>'active' OR mine.work_date<public.shf_today()
   OR NOT public.shf_published(mine.work_date) THEN
  RAISE EXCEPTION 'Choose one of your own upcoming published shifts' USING ERRCODE='SF003';
 END IF;
 SELECT * INTO who FROM public.shf_person(NEW.target_id,mine.work_date);
 IF NEW.target_id IS NULL OR NEW.target_id=me OR NOT FOUND THEN
  RAISE EXCEPTION 'This colleague has no published shift that day' USING ERRCODE='SF003';
 END IF;
 SELECT count(*)::integer INTO n FROM public.shf_assignment a
 WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id AND a.employee_id=NEW.target_id
  AND a.work_date=mine.work_date AND a.status='active';
 IF n=0 THEN
  RAISE EXCEPTION 'This colleague has no published shift that day' USING ERRCODE='SF003';
 ELSIF n>1 THEN
  RAISE EXCEPTION 'This colleague has more than one shift that day; ask your manager' USING ERRCODE='SF004';
 END IF;
 SELECT a.* INTO theirs FROM public.shf_assignment a
 WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id AND a.employee_id=NEW.target_id
  AND a.work_date=mine.work_date AND a.status='active';
 PERFORM pg_advisory_xact_lock(hashtextextended('shf-swap-shift:'||least(mine.id,theirs.id)::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('shf-swap-shift:'||greatest(mine.id,theirs.id)::text,0));
 IF EXISTS(SELECT 1 FROM public.shf_swap x WHERE x.status IN ('proposed','accepted')
   AND (x.requester_assignment_id IN (mine.id,theirs.id) OR x.target_assignment_id IN (mine.id,theirs.id))) THEN
  RAISE EXCEPTION 'One of these shifts is already in an open swap' USING ERRCODE='SF004';
 END IF;
 -- The colleague's side: never say which rule, when or why.
 IF public.shf_conflict(NEW.target_id,mine.work_date,mine.start_at,mine.end_at,ARRAY[mine.id,theirs.id]) IS NOT NULL THEN
  RAISE EXCEPTION 'This swap would break the overlap, rest or leave rules for your colleague' USING ERRCODE='SF004';
 END IF;
 problem := public.shf_conflict(me,theirs.work_date,theirs.start_at,theirs.end_at,ARRAY[mine.id,theirs.id]);
 IF problem IS NOT NULL THEN
  RAISE EXCEPTION '%', replace(problem,'This person is','You are') USING ERRCODE='SF004';
 END IF;
 NEW.work_date := mine.work_date;
 NEW.requester_id := me;
 NEW.requester_name := (SELECT p.name FROM public.shf_person(me,mine.work_date) p);
 NEW.requester_template_id := mine.template_id;
 NEW.target_assignment_id := theirs.id;
 NEW.target_name := who.name;
 NEW.target_template_id := theirs.template_id;
 IF NEW.requester_name IS NULL THEN
  RAISE EXCEPTION 'Your current workspace cannot swap shifts' USING ERRCODE='SF005';
 END IF;
 NEW.status := 'proposed';
 NEW.responded_at := NULL;
 NEW.decided_by_employee := NULL;
 NEW.decided_by_label := NULL;
 NEW.decided_at := NULL;
 NEW.decision_reason := NULL;
 NEW.version := 1;
 NEW.created_at := now();
 NEW.updated_at := now();
 RETURN NEW;
END $$;
ALTER FUNCTION guard_shf_swap() OWNER TO anvione_shift_keeper;
REVOKE ALL ON FUNCTION guard_shf_swap() FROM PUBLIC;
