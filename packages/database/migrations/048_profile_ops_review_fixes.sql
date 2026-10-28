-- Review fixes for 045/046 (both stay as applied):
-- * profile_apply_due_scheduled() processes each candidate in its own subtransaction, so one
--   failing request is skipped (reported by id only) instead of aborting the batch. The
--   return type changes (applied, skipped, skipped_ids), so the function is dropped and
--   recreated with the same owner and grants (CREATE OR REPLACE cannot change it).
-- * Candidates are selected by their entity-local date (legal_entity.timezone) in the WHERE,
--   so rows not yet due in their own entity can no longer fill the batch ahead of due rows.
-- * 046 granted EXECUTE on the re-seal functions to the migration role; assert here that
--   migrations never run as a runtime role.
DO $$ BEGIN
 IF current_user IN ('anvione_app','anvione_worker','anvione_candidate','anvione_identity_operator') THEN
  RAISE EXCEPTION 'Migrations must run as the migration role, not %', current_user;
 END IF;
END $$;

GRANT SELECT(tenant_id,id,timezone) ON legal_entity TO anvione_profile_scheduler;

DROP FUNCTION profile_apply_due_scheduled(integer,uuid);
CREATE FUNCTION profile_apply_due_scheduled(p_limit integer, p_request uuid,
 OUT applied integer, OUT skipped integer, OUT skipped_ids uuid[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 r record;
 cur record;
BEGIN
 applied := 0;
 skipped := 0;
 skipped_ids := ARRAY[]::uuid[];
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 OR p_request IS NULL THEN
  RAISE EXCEPTION 'Choose a batch of 1-500 and a request id' USING ERRCODE='22023';
 END IF;
 FOR r IN SELECT q.id,q.tenant_id,q.entity_id,q.employee_id,q.effective_on
   FROM public.profile_change_request q
   JOIN public.legal_entity le ON le.tenant_id=q.tenant_id AND le.id=q.entity_id
   WHERE q.status='approved' AND q.effective_on<=(now() AT TIME ZONE le.timezone)::date
   ORDER BY q.effective_on,q.created_at,q.id LIMIT p_limit LOOP
  BEGIN
   PERFORM set_config('app.tenant_id',r.tenant_id::text,true),
    set_config('app.entity_id',r.entity_id::text,true),
    set_config('app.employee_id','',true),
    set_config('app.actor_id','',true),
    set_config('app.actor_label','Scheduler',true),
    set_config('app.profile_scope','entity',true);
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
  EXCEPTION WHEN others THEN
   -- The subtransaction is rolled back; only the request id is reported, never values.
   skipped := skipped+1;
   skipped_ids := skipped_ids||r.id;
  END;
 END LOOP;
 PERFORM set_config('app.tenant_id','',true),set_config('app.entity_id','',true),
  set_config('app.actor_label','',true),set_config('app.profile_scope','',true);
END $$;
ALTER FUNCTION profile_apply_due_scheduled(integer,uuid) OWNER TO anvione_profile_scheduler;
REVOKE ALL ON FUNCTION profile_apply_due_scheduled(integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION profile_apply_due_scheduled(integer,uuid) TO anvione_worker;
