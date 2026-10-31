-- SHF-01 independent security review fixes (forward-only; 068 and 069 are unchanged).
-- * Past open shifts: a claim could be approved after the open shift's date had passed, and the
--   approval created a shift in the past (outside the "today up to a year ahead" window that every
--   other way of planning a shift enforces, and changing planned hours for a past week). Approving a
--   claim now needs the open shift's date to be today or later. Rejecting stays possible.
-- * Draft-week dates in refusals: when an employee claimed an open shift or proposed a swap, an
--   overlap or rest refusal named the date of their other shift, even when that shift sits in a week
--   that is not published yet (which they cannot see). The date is now named only when the caller
--   may see that other shift (HR, the person's current manager, or the person in a published week).
-- Errors: SF003 bad input (400), SF004 conflict (409), SF005 forbidden (403).

CREATE OR REPLACE FUNCTION shf_conflict(p_employee uuid, p_day date, p_start timestamp, p_end timestamp, p_exclude uuid[])
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 rest integer := public.shf_min_rest_minutes();
 other record;
 shown boolean;
BEGIN
 IF EXISTS(SELECT 1 FROM public.leave_request l
   WHERE l.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
    AND l.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
    AND l.employee_id=p_employee AND l.state='approved' AND p_day BETWEEN l.start_date AND l.end_date) THEN
  RETURN format('This person is on approved leave on %s', p_day);
 END IF;
 SELECT a.start_at, a.end_at, a.work_date INTO other FROM public.shf_assignment a
 WHERE a.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND a.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND a.employee_id=p_employee AND a.status='active' AND NOT (a.id=ANY(coalesce(p_exclude,'{}')))
  AND a.start_at<p_end+make_interval(mins=>rest) AND a.end_at+make_interval(mins=>rest)>p_start
 ORDER BY a.start_at LIMIT 1;
 IF FOUND THEN
  -- Name the other shift's date only to someone who may already see that shift.
  shown := public.shf_scope()='manage' OR public.shf_is_report(p_employee)
   OR (p_employee=public.shf_me() AND public.shf_published(other.work_date));
  IF other.start_at<p_end AND other.end_at>p_start THEN
   RETURN CASE WHEN shown THEN format('This overlaps another shift for this person on %s', other.work_date)
    ELSE 'This overlaps another shift for this person' END;
  END IF;
  RETURN CASE WHEN shown THEN format('This leaves less than %s hours of rest next to the shift on %s', rest/60, other.work_date)
   ELSE format('This leaves less than %s hours of rest next to another shift for this person', rest/60) END;
 END IF;
 RETURN NULL;
END $$;
ALTER FUNCTION shf_conflict(uuid,date,timestamp,timestamp,uuid[]) OWNER TO anvione_shift_keeper;
REVOKE ALL ON FUNCTION shf_conflict(uuid,date,timestamp,timestamp,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shf_conflict(uuid,date,timestamp,timestamp,uuid[]) TO anvione_shift_keeper, anvione_shift_writer;

CREATE OR REPLACE FUNCTION guard_shf_claim_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := public.shf_me();
 scope text := public.shf_scope();
 o record;
BEGIN
 PERFORM public.shf_entity_check(NEW.tenant_id,NEW.entity_id);
 IF NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'This claim changed. Reload it before trying again' USING ERRCODE='SF004';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','decision_reason','version','decided_by_employee','decided_by_label','decided_at','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','decision_reason','version','decided_by_employee','decided_by_label','decided_at','updated_at']) THEN
  RAISE EXCEPTION 'A claim changes only through its own actions' USING ERRCODE='SF004';
 END IF;
 IF OLD.status<>'pending' THEN
  RAISE EXCEPTION 'This claim is already %', replace(OLD.status,'_',' ') USING ERRCODE='SF004';
 END IF;
 SELECT s.* INTO o FROM public.shf_open_shift s WHERE s.id=OLD.open_shift_id;
 IF NEW.status='not_selected' THEN
  IF o.status='open' THEN
   RAISE EXCEPTION 'This open shift is still open' USING ERRCODE='SF004';
  END IF;
  NEW.decision_reason := NULL;
  NEW.decided_by_employee := NULL;
  NEW.decided_by_label := NULL;
  NEW.decided_at := NULL;
  NEW.updated_at := now();
  RETURN NEW;
 END IF;
 IF me IS NULL OR scope NOT IN ('self','team','manage') THEN
  RAISE EXCEPTION 'Your current workspace cannot change claims' USING ERRCODE='SF005';
 END IF;
 IF NEW.status='withdrawn' THEN
  IF me<>OLD.employee_id THEN
   RAISE EXCEPTION 'Only the claimant withdraws a claim' USING ERRCODE='SF005';
  END IF;
  NEW.decision_reason := NULL;
  NEW.decided_by_employee := NULL;
  NEW.decided_by_label := NULL;
  NEW.decided_at := NULL;
 ELSIF NEW.status IN ('approved','rejected') THEN
  IF me=OLD.employee_id THEN
   RAISE EXCEPTION 'Someone else decides your own claim' USING ERRCODE='SF005';
  END IF;
  IF NOT (scope='manage' OR (scope='team' AND o.audience='team' AND o.manager_id=me AND public.shf_is_report(OLD.employee_id))) THEN
   RAISE EXCEPTION 'Only HR or the manager who posted this open shift decides claims' USING ERRCODE='SF005';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('shf-open:'||OLD.open_shift_id::text,0));
  SELECT s.* INTO o FROM public.shf_open_shift s WHERE s.id=OLD.open_shift_id;
  IF o.status<>'open' THEN
   RAISE EXCEPTION 'This open shift is already %', o.status USING ERRCODE='SF004';
  END IF;
  -- Never fill an open shift whose date has passed.
  IF NEW.status='approved' AND o.work_date<public.shf_today() THEN
   RAISE EXCEPTION 'This open shift''s date has passed' USING ERRCODE='SF004';
  END IF;
  IF NEW.status='rejected' THEN
   NEW.decision_reason := nullif(btrim(NEW.decision_reason),'');
   IF NEW.decision_reason IS NULL OR char_length(NEW.decision_reason) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'Give a reason of 3 to 300 characters' USING ERRCODE='SF003';
   END IF;
  ELSE
   NEW.decision_reason := NULL;
  END IF;
  NEW.decided_by_employee := me;
  NEW.decided_by_label := public.shf_label();
  NEW.decided_at := now();
 ELSE
  RAISE EXCEPTION 'A claim cannot move from % to %', OLD.status, NEW.status USING ERRCODE='SF004';
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END $$;
ALTER FUNCTION guard_shf_claim_update() OWNER TO anvione_shift_keeper;
REVOKE ALL ON FUNCTION guard_shf_claim_update() FROM PUBLIC;
