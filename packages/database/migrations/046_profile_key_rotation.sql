-- PRF-01 key rotation (profile.crypto.ts v2 format: 0x02 | key id | nonce | tag | data).
-- The sealed-value CHECK (035: base64url, 40-1200 chars) already admits the one extra byte, so
-- it is unchanged. `pnpm profile:rekey` re-seals values with the newest key through two narrow
-- compare-and-swap functions that respect the existing guards:
-- * profile_reseal_current(): owned by the profile writer (the only role employee_profile's
--   guard admits); replaces sealed columns of one profile only if they still hold the values
--   the caller read, keeps null/non-null, bumps the version as every profile write does.
-- * profile_reseal_request(): owned by a dedicated NOLOGIN resealer; replaces the values of a
--   submitted or approved request only if unchanged since read. The request guard (copied from
--   036 with one added branch) admits it only with a pass row this function writes and removes
--   in the same transaction, and only when the field list and null shape are identical.
-- profile_change_history stays immutable: its rows keep the key that sealed them, so retired
-- keys must stay configured while history uses them (the script reports counts by key id).
-- Neither function is granted to the app or worker; only the migration (operations) role.
CREATE TABLE profile_reseal_pass (
 request_id uuid PRIMARY KEY,
 txid xid8 NOT NULL DEFAULT pg_current_xact_id()
);
CREATE ROLE anvione_profile_resealer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_profile_resealer;
GRANT SELECT,INSERT,DELETE ON profile_reseal_pass TO anvione_profile_resealer;
GRANT SELECT ON profile_reseal_pass TO anvione_profile_keeper;
GRANT SELECT(id,tenant_id,entity_id,employee_id,status,changes),UPDATE(changes)
 ON profile_change_request TO anvione_profile_resealer;
CREATE POLICY profile_request_resealer ON profile_change_request FOR SELECT TO anvione_profile_resealer
 USING(status IN ('submitted','approved'));
CREATE POLICY profile_request_resealer_update ON profile_change_request FOR UPDATE TO anvione_profile_resealer
 USING(status IN ('submitted','approved')) WITH CHECK(status IN ('submitted','approved'));

-- The 036 guard, unchanged except for the re-seal branch.
CREATE OR REPLACE FUNCTION guard_profile_change_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.profile_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Employee');
 today date := leave_entity_today();
 managed text[] := ARRAY['status','version','decision_note','decided_at','decided_by_label','decided_by_employee',
  'applied_at','withdrawn_at','withdrawn_by_label'];
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This profile change belongs to another organization' USING ERRCODE='PF005';
 END IF;
 IF today IS NULL THEN
  RAISE EXCEPTION 'The organization''s business date is unavailable' USING ERRCODE='PF005';
 END IF;
 IF TG_OP='INSERT' THEN
  IF me IS NULL OR NEW.employee_id<>me OR scope<>'self'
    OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
   RAISE EXCEPTION 'You can only ask to change your own profile' USING ERRCODE='PF005';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM employee e WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id
    AND e.id=NEW.employee_id AND e.status IN ('active','notice')) THEN
   RAISE EXCEPTION 'Only current employees can change their profile' USING ERRCODE='PF003';
  END IF;
  IF NEW.effective_on IS NULL OR NEW.effective_on<today OR NEW.effective_on>today+90 THEN
   RAISE EXCEPTION 'The change must take effect today or within the next 90 days' USING ERRCODE='PF003';
  END IF;
  NEW.status := 'submitted';
  NEW.decision_note := NULL;
  NEW.decided_at := NULL;
  NEW.decided_by_label := NULL;
  NEW.decided_by_employee := NULL;
  NEW.applied_at := NULL;
  NEW.withdrawn_at := NULL;
  NEW.withdrawn_by_label := NULL;
  NEW.version := 1;
  NEW.submitted_by_label := label;
  NEW.created_at := now();
  RETURN NEW;
 END IF;

 -- 046: key rotation. Only profile_reseal_request() (which records a pass for this request
 -- in this transaction) may replace the sealed values of an open request, and only with the
 -- same fields, in the same order, with the same null/non-null shape. Nothing else changes.
 IF EXISTS(SELECT 1 FROM public.profile_reseal_pass p WHERE p.request_id=OLD.id AND p.txid=pg_current_xact_id()) THEN
  IF (to_jsonb(NEW)-'changes') IS DISTINCT FROM (to_jsonb(OLD)-'changes') OR OLD.status NOT IN ('submitted','approved')
    OR (SELECT array_agg((x->>'field')||':'||jsonb_typeof(x->'value') ORDER BY o)
        FROM jsonb_array_elements(NEW.changes) WITH ORDINALITY t(x,o))
     IS DISTINCT FROM (SELECT array_agg((x->>'field')||':'||jsonb_typeof(x->'value') ORDER BY o)
        FROM jsonb_array_elements(OLD.changes) WITH ORDINALITY t(x,o)) THEN
   RAISE EXCEPTION 'A re-seal replaces values only' USING ERRCODE='PF004';
  END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'A profile change request changes only through its own actions' USING ERRCODE='PF004';
 END IF;
 IF OLD.status IN ('rejected','withdrawn','applied') THEN
  RAISE EXCEPTION 'This profile change request is final' USING ERRCODE='PF004';
 END IF;
 IF NOT ((OLD.status='submitted' AND NEW.status IN ('approved','rejected','withdrawn'))
   OR (OLD.status='approved' AND NEW.status IN ('applied','withdrawn'))) THEN
  RAISE EXCEPTION 'That profile change step is not allowed' USING ERRCODE='PF004';
 END IF;
 NEW.decided_at := OLD.decided_at;
 NEW.decided_by_label := OLD.decided_by_label;
 NEW.decided_by_employee := OLD.decided_by_employee;
 NEW.applied_at := NULL;
 NEW.withdrawn_at := NULL;
 NEW.withdrawn_by_label := NULL;

 IF NEW.status='withdrawn' THEN
  IF OLD.status='approved' AND OLD.effective_on<=today THEN
   RAISE EXCEPTION 'This change is already due and will be applied' USING ERRCODE='PF004';
  END IF;
  IF scope='self' AND me=OLD.employee_id THEN
   NEW.decision_note := OLD.decision_note;
  ELSIF scope='entity' AND OLD.status='approved' THEN
   -- HR cancels an approved change that is not yet due; submitted ones are rejected instead.
   IF me IS NULL OR me=OLD.employee_id THEN
    RAISE EXCEPTION 'Someone else must cancel your own profile change' USING ERRCODE='PF005';
   END IF;
   IF NEW.decision_note IS NULL OR NEW.decision_note IS NOT DISTINCT FROM OLD.decision_note
     OR char_length(btrim(NEW.decision_note))<3 THEN
    RAISE EXCEPTION 'Say why the approved change is cancelled' USING ERRCODE='PF003';
   END IF;
  ELSE
   RAISE EXCEPTION 'Only the employee, or HR for an approved change, can withdraw this request'
    USING ERRCODE='PF005';
  END IF;
  NEW.withdrawn_at := now();
  NEW.withdrawn_by_label := label;
  RETURN NEW;
 END IF;

 IF NEW.status='applied' THEN
  IF NOT (scope='entity' OR (scope='self' AND me=OLD.employee_id)) THEN
   RAISE EXCEPTION 'Only the employee or HR can apply this change' USING ERRCODE='PF005';
  END IF;
  IF OLD.effective_on>today THEN
   RAISE EXCEPTION 'This change takes effect on a later date' USING ERRCODE='PF004';
  END IF;
  NEW.decision_note := OLD.decision_note;
  NEW.applied_at := now();
  RETURN NEW;
 END IF;

 IF scope<>'entity' THEN
  RAISE EXCEPTION 'Only HR can decide profile changes' USING ERRCODE='PF005';
 END IF;
 IF me IS NULL OR me=OLD.employee_id THEN
  RAISE EXCEPTION 'Someone else must decide your own profile change' USING ERRCODE='PF005';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM employee d WHERE d.tenant_id=OLD.tenant_id AND d.entity_id=OLD.entity_id
   AND d.id=me AND d.status IN ('active','notice')) THEN
  RAISE EXCEPTION 'Only current employees can decide profile changes' USING ERRCODE='PF005';
 END IF;
 IF NEW.status='rejected' AND (NEW.decision_note IS NULL OR char_length(btrim(NEW.decision_note))<3) THEN
  RAISE EXCEPTION 'Say why the change is rejected' USING ERRCODE='PF003';
 END IF;
 NEW.decided_at := now();
 NEW.decided_by_label := label;
 NEW.decided_by_employee := me;
 IF NEW.status='approved' AND OLD.effective_on<=today THEN
  NEW.status := 'applied';
  NEW.applied_at := now();
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION profile_reseal_request(p_id uuid, p_old jsonb, p_new jsonb) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 r record;
BEGIN
 SELECT q.tenant_id,q.entity_id,q.employee_id INTO r FROM public.profile_change_request q WHERE q.id=p_id;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('profile:'||r.employee_id::text,0));
 PERFORM set_config('app.tenant_id',r.tenant_id::text,true),set_config('app.entity_id',r.entity_id::text,true);
 PERFORM 1 FROM public.profile_change_request q WHERE q.id=p_id AND q.changes=p_old
  AND q.status IN ('submitted','approved') FOR UPDATE;
 IF NOT FOUND THEN
  PERFORM set_config('app.tenant_id','',true),set_config('app.entity_id','',true);
  RETURN false;
 END IF;
 INSERT INTO public.profile_reseal_pass(request_id) VALUES (p_id);
 UPDATE public.profile_change_request q SET changes=p_new WHERE q.id=p_id;
 DELETE FROM public.profile_reseal_pass WHERE request_id=p_id;
 PERFORM set_config('app.tenant_id','',true),set_config('app.entity_id','',true);
 RETURN true;
END $$;

-- p_old / p_new: {column: sealed} for the columns being re-sealed (non-null on both sides).
CREATE FUNCTION profile_reseal_current(p_tenant uuid, p_entity uuid, p_employee uuid, p_old jsonb, p_new jsonb)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 cur jsonb;
BEGIN
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_old) k)
     IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_new) k)
   OR EXISTS(SELECT 1 FROM jsonb_each(p_new) n WHERE n.key<>ALL(public.profile_fields())
     OR jsonb_typeof(n.value)<>'string' OR jsonb_typeof(p_old->n.key)<>'string') THEN
  RAISE EXCEPTION 'A re-seal replaces existing values only' USING ERRCODE='PF004';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('profile:'||p_employee::text,0));
 SELECT to_jsonb(p) INTO cur FROM public.employee_profile p
 WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.employee_id=p_employee FOR UPDATE;
 IF cur IS NULL OR EXISTS(SELECT 1 FROM jsonb_each(p_old) o WHERE cur->o.key IS DISTINCT FROM o.value) THEN
  RETURN false;
 END IF;
 UPDATE public.employee_profile p SET
  personal_phone=coalesce(p_new->>'personal_phone',p.personal_phone),
  personal_email=coalesce(p_new->>'personal_email',p.personal_email),
  emergency_name=coalesce(p_new->>'emergency_name',p.emergency_name),
  emergency_phone=coalesce(p_new->>'emergency_phone',p.emergency_phone),
  emergency_relationship=coalesce(p_new->>'emergency_relationship',p.emergency_relationship),
  address_line1=coalesce(p_new->>'address_line1',p.address_line1),
  address_line2=coalesce(p_new->>'address_line2',p.address_line2),
  address_city=coalesce(p_new->>'address_city',p.address_city),
  address_postal_code=coalesce(p_new->>'address_postal_code',p.address_postal_code),
  version=p.version+1
 WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.employee_id=p_employee;
 RETURN true;
END $$;

ALTER FUNCTION profile_reseal_request(uuid,jsonb,jsonb) OWNER TO anvione_profile_resealer;
ALTER FUNCTION profile_reseal_current(uuid,uuid,uuid,jsonb,jsonb) OWNER TO anvione_profile_writer;
REVOKE ALL ON FUNCTION profile_reseal_request(uuid,jsonb,jsonb),
 profile_reseal_current(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC;
DO $$ BEGIN
 EXECUTE format('GRANT EXECUTE ON FUNCTION profile_reseal_request(uuid,jsonb,jsonb),
  profile_reseal_current(uuid,uuid,uuid,jsonb,jsonb) TO %I', current_user);
END $$;
