-- F0.13 shared approval routing. Leave and attendance corrections route and
-- authorize decisions through the same two functions; module guards keep their
-- own state machines, messages and error codes.
CREATE ROLE anvione_workflow_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_workflow_keeper;
GRANT SELECT ON employee TO anvione_workflow_keeper;
CREATE POLICY employee_workflow_keeper ON employee FOR SELECT TO anvione_workflow_keeper USING(true);

-- The current manager decides; people without one route to HR. No row means the
-- requester is not a current employee of the entity.
CREATE FUNCTION workflow_route(p_tenant uuid,p_entity uuid,p_requester uuid)
RETURNS TABLE(approver text, manager uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN e.manager_id IS NULL THEN 'hr' ELSE 'manager' END, e.manager_id
 FROM public.employee e
 WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.id=p_requester
  AND e.status IN ('active','notice');
$$;

-- NULL when the decider may decide; otherwise 'self', 'inactive' or 'routed'.
-- HR also decides manager-routed work whose manager no longer manages the requester.
CREATE FUNCTION workflow_decision_error(p_tenant uuid,p_entity uuid,p_requester uuid,
 p_approver text,p_manager uuid,p_decider uuid,p_scope text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE
  WHEN p_decider IS NULL OR p_decider=p_requester THEN 'self'
  WHEN NOT EXISTS(SELECT 1 FROM public.employee d WHERE d.tenant_id=p_tenant
    AND d.entity_id=p_entity AND d.id=p_decider AND d.status IN ('active','notice')) THEN 'inactive'
  WHEN p_approver='manager' AND p_scope='team' AND p_manager=p_decider
    AND EXISTS(SELECT 1 FROM public.employee e WHERE e.tenant_id=p_tenant
      AND e.entity_id=p_entity AND e.id=p_requester AND e.manager_id=p_decider) THEN NULL
  WHEN p_approver='hr' AND p_scope='entity' THEN NULL
  WHEN p_approver='manager' AND p_scope='entity' AND NOT EXISTS(
    SELECT 1 FROM public.employee e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity
      AND e.id=p_requester AND e.manager_id=p_manager) THEN NULL
  ELSE 'routed' END;
$$;
ALTER FUNCTION workflow_route(uuid,uuid,uuid) OWNER TO anvione_workflow_keeper;
ALTER FUNCTION workflow_decision_error(uuid,uuid,uuid,text,uuid,uuid,text) OWNER TO anvione_workflow_keeper;
REVOKE ALL ON FUNCTION workflow_route(uuid,uuid,uuid),
 workflow_decision_error(uuid,uuid,uuid,text,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workflow_route(uuid,uuid,uuid),
 workflow_decision_error(uuid,uuid,uuid,text,uuid,uuid,text)
 TO anvione_leave_keeper, anvione_attendance_keeper;

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
 routed text;
 verdict text;
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
  SELECT r.approver, r.manager INTO routed, manager
  FROM workflow_route(NEW.tenant_id,NEW.entity_id,NEW.employee_id) r;
  IF routed IS NULL THEN
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
  NEW.days := calendar_business_days(NEW.tenant_id,NEW.entity_id,NEW.employee_id,NEW.start_date,NEW.end_date);
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
  NEW.approver := routed;
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
  verdict := workflow_decision_error(OLD.tenant_id,OLD.entity_id,OLD.employee_id,
   OLD.approver,OLD.manager_id,me,scope);
  IF verdict='self' THEN
   RAISE EXCEPTION 'You cannot decide your own leave' USING ERRCODE='LV005';
  ELSIF verdict='inactive' THEN
   RAISE EXCEPTION 'Only current employees can decide leave' USING ERRCODE='LV006';
  ELSIF verdict IS NOT NULL THEN
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

CREATE OR REPLACE FUNCTION guard_attendance_correction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 scope text := coalesce(current_setting('app.attendance_scope',true),'none');
 today date;
 manager uuid;
 routed text;
 verdict text;
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
  SELECT r.approver, r.manager INTO routed, manager
  FROM workflow_route(NEW.tenant_id,NEW.entity_id,NEW.employee_id) r;
  IF routed IS NULL THEN
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
  NEW.approver := routed;
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
  verdict := workflow_decision_error(OLD.tenant_id,OLD.entity_id,OLD.employee_id,
   OLD.approver,OLD.manager_id,me,scope);
  IF verdict='self' THEN
   RAISE EXCEPTION 'You cannot decide your own correction' USING ERRCODE='AT005';
  ELSIF verdict='inactive' THEN
   RAISE EXCEPTION 'Only current employees can decide corrections' USING ERRCODE='AT006';
  ELSIF verdict IS NOT NULL THEN
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
