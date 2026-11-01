-- PRF-01 ops: the worker applies approved profile changes once their effective date has come,
-- for every tenant and entity, without gaining access to profile data. Following the session
-- janitor pattern (020) it only gets EXECUTE on one SECURITY DEFINER function, owned by a
-- dedicated NOLOGIN role that can read the request columns it needs, flip approved -> applied,
-- and add the audit and outbox rows. The 034/036 guard still decides whether the step is
-- allowed, and the apply trigger (owned by the profile writer) still writes the profile and
-- its history. Lock order matches the API: the employee's advisory lock, then the request row,
-- then a version-checked update, so a concurrent HR apply-due yields one history row.
-- Audit and outbox name the request and its fields only, never values.
CREATE ROLE anvione_profile_scheduler NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_profile_scheduler;
GRANT SELECT(id,tenant_id,entity_id,employee_id,status,version,changes,effective_on,created_at),
 UPDATE(status,version) ON profile_change_request TO anvione_profile_scheduler;
GRANT INSERT ON audit_event,outbox_event TO anvione_profile_scheduler;
GRANT EXECUTE ON FUNCTION leave_entity_today() TO anvione_profile_scheduler;
-- The updated row must stay visible to the role, so SELECT also admits 'applied'.
CREATE POLICY profile_request_scheduler_read ON profile_change_request FOR SELECT
 TO anvione_profile_scheduler USING(status IN ('approved','applied'));
CREATE POLICY profile_request_scheduler_apply ON profile_change_request FOR UPDATE
 TO anvione_profile_scheduler USING(status='approved') WITH CHECK(status='applied');
CREATE POLICY outbox_profile_scheduler ON outbox_event FOR INSERT TO anvione_profile_scheduler
 WITH CHECK(event_type='profile.change_applied.v1');

-- Applies at most p_limit (1-500) due changes; returns how many it applied. Idempotent: a
-- second run finds nothing. Settings are transaction-local and cleared before returning.
CREATE FUNCTION profile_apply_due_scheduled(p_limit integer, p_request uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 r record;
 cur record;
 today date;
 applied integer := 0;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 OR p_request IS NULL THEN
  RAISE EXCEPTION 'Choose a batch of 1-500 and a request id' USING ERRCODE='22023';
 END IF;
 -- Entity dates run up to a day ahead of UTC; each candidate is checked in its own entity.
 FOR r IN SELECT q.id,q.tenant_id,q.entity_id,q.employee_id,q.effective_on FROM public.profile_change_request q
   WHERE q.status='approved' AND q.effective_on<=current_date+1
   ORDER BY q.effective_on,q.created_at,q.id LIMIT p_limit LOOP
  PERFORM set_config('app.tenant_id',r.tenant_id::text,true),
   set_config('app.entity_id',r.entity_id::text,true),
   set_config('app.employee_id','',true),
   set_config('app.actor_id','',true),
   set_config('app.actor_label','Scheduler',true),
   set_config('app.profile_scope','entity',true);
  today := public.leave_entity_today();
  CONTINUE WHEN today IS NULL OR r.effective_on>today;
  PERFORM pg_advisory_xact_lock(hashtextextended('profile:'||r.employee_id::text,0));
  SELECT q.status,q.version,q.changes INTO cur FROM public.profile_change_request q
  WHERE q.id=r.id FOR UPDATE;
  CONTINUE WHEN NOT FOUND OR cur.status<>'approved';
  UPDATE public.profile_change_request q SET status='applied',version=q.version+1
  WHERE q.id=r.id AND q.version=cur.version;
  CONTINUE WHEN NOT FOUND;
  INSERT INTO public.audit_event(id,tenant_id,entity_id,actor_id,actor_label,role,action,target,request_id,details)
  VALUES (gen_random_uuid(),r.tenant_id,r.entity_id,'00000000-0000-0000-0000-000000000000','Scheduler','system',
   'profile.change_applied','profile-change:'||r.id,p_request,
   jsonb_build_object('employeeId',r.employee_id,'from','approved',
    'fields',(SELECT jsonb_agg(x->>'field' ORDER BY x->>'field') FROM jsonb_array_elements(cur.changes) x),
    'effectiveOn',to_char(r.effective_on,'YYYY-MM-DD'),'via','scheduler'));
  INSERT INTO public.outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version)
  VALUES (gen_random_uuid(),r.tenant_id,r.entity_id,'profile.change_applied.v1',r.id,cur.version+1);
  applied := applied+1;
 END LOOP;
 PERFORM set_config('app.tenant_id','',true),set_config('app.entity_id','',true),
  set_config('app.actor_label','',true),set_config('app.profile_scope','',true);
 RETURN applied;
END $$;
ALTER FUNCTION profile_apply_due_scheduled(integer,uuid) OWNER TO anvione_profile_scheduler;
REVOKE ALL ON FUNCTION profile_apply_due_scheduled(integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION profile_apply_due_scheduled(integer,uuid) TO anvione_worker;
