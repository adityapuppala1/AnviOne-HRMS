-- PERF-01 independent security review fixes (forward-only; 056 and 057 are unchanged).
-- * perf_sees_entry is callable by the app role with arbitrary arguments. Its EXISTS lookups
--   ran as the keeper over every tenant, so passing any review id answered "is this review
--   finalised?" and "does it have a manager entry?" across tenants and entities. The lookups
--   now only consider a review in the caller's tenant and entity whose employee and manager
--   match the arguments, so the function only answers about reviews the caller is party to.
-- * Aligning a goal to a parent the caller may not align to returned different errors for
--   "no such goal", "not draft or active" and "not yours or your manager's", which let anyone
--   probe the existence and status of any goal id in the entity. A new trigger that fires
--   before the goal guard (triggers fire in name order) refuses every such parent with one
--   message before any status is looked at.
-- * Progress on a percent key result was unbounded (key result start and target are already
--   limited to 0..100). Recorded values for percent key results are now limited to 0..100.
-- * TRUNCATE skipped the row-level delete blocks. No application role holds TRUNCATE, but the
--   performance history is now protected against it as well (defence in depth, as in 049).

CREATE OR REPLACE FUNCTION perf_sees_entry(p_review uuid, p_kind text, p_employee uuid, p_manager uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.perf_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 tenant uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
 entity uuid := nullif(current_setting('app.entity_id',true),'')::uuid;
BEGIN
 IF scope NOT IN ('self','team','entity') OR me IS NULL OR tenant IS NULL OR entity IS NULL THEN
  RETURN false;
 END IF;
 IF p_employee=me THEN
  RETURN p_kind='self' OR EXISTS(SELECT 1 FROM public.perf_review r WHERE r.id=p_review
   AND r.tenant_id=tenant AND r.entity_id=entity AND r.employee_id=p_employee AND r.status='finalised');
 END IF;
 IF p_manager=me THEN
  RETURN scope IN ('team','entity') AND (p_kind='manager'
   OR EXISTS(SELECT 1 FROM public.perf_review_entry x WHERE x.review_id=p_review AND x.kind='manager'
    AND x.tenant_id=tenant AND x.entity_id=entity AND x.manager_id=p_manager));
 END IF;
 RETURN scope='entity';
END $$;
ALTER FUNCTION perf_sees_entry(uuid,text,uuid,uuid) OWNER TO anvione_perf_keeper;
REVOKE ALL ON FUNCTION perf_sees_entry(uuid,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION perf_sees_entry(uuid,text,uuid,uuid) TO anvione_app, anvione_perf_keeper;

-- Fires before perf_objective_guard ("align" sorts before "guard").
CREATE FUNCTION guard_perf_objective_align_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.perf_scope',true),'none');
 parent_owner uuid;
 owner_manager uuid;
BEGIN
 IF NEW.parent_objective_id IS NULL
   OR (TG_OP='UPDATE' AND NEW.parent_objective_id IS NOT DISTINCT FROM OLD.parent_objective_id) THEN
  RETURN NEW;
 END IF;
 SELECT o.owner_employee_id INTO parent_owner FROM perf_objective o
 WHERE o.id=NEW.parent_objective_id
  AND o.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND o.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid;
 SELECT e.manager_id INTO owner_manager FROM employee e
 WHERE e.id=NEW.owner_employee_id AND e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id;
 IF parent_owner IS NULL
   OR NOT (scope='entity' OR parent_owner=NEW.owner_employee_id OR parent_owner IS NOT DISTINCT FROM owner_manager) THEN
  RAISE EXCEPTION 'Align to one of the goals listed as alignable' USING ERRCODE='PF003';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_perf_objective_align_scope() OWNER TO anvione_perf_keeper;
REVOKE ALL ON FUNCTION guard_perf_objective_align_scope() FROM PUBLIC;
CREATE TRIGGER perf_objective_align_scope BEFORE INSERT OR UPDATE OF parent_objective_id ON perf_objective
 FOR EACH ROW EXECUTE FUNCTION guard_perf_objective_align_scope();
ALTER TABLE perf_objective ENABLE ALWAYS TRIGGER perf_objective_align_scope;

-- Fires after perf_kr_update_guard ("range" sorts after "guard").
CREATE FUNCTION guard_perf_kr_update_range() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF (SELECT k.unit FROM perf_key_result k WHERE k.id=NEW.key_result_id)='percent'
   AND NEW.value NOT BETWEEN 0 AND 100 THEN
  RAISE EXCEPTION 'Percentages run from 0 to 100' USING ERRCODE='PF003';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_perf_kr_update_range() OWNER TO anvione_perf_keeper;
REVOKE ALL ON FUNCTION guard_perf_kr_update_range() FROM PUBLIC;
CREATE TRIGGER perf_kr_update_range BEFORE INSERT ON perf_kr_update
 FOR EACH ROW EXECUTE FUNCTION guard_perf_kr_update_range();
ALTER TABLE perf_kr_update ENABLE ALWAYS TRIGGER perf_kr_update_range;

CREATE TRIGGER perf_objective_no_truncate BEFORE TRUNCATE ON perf_objective
 FOR EACH STATEMENT EXECUTE FUNCTION reject_perf_delete();
CREATE TRIGGER perf_key_result_no_truncate BEFORE TRUNCATE ON perf_key_result
 FOR EACH STATEMENT EXECUTE FUNCTION reject_perf_delete();
CREATE TRIGGER perf_kr_update_no_truncate BEFORE TRUNCATE ON perf_kr_update
 FOR EACH STATEMENT EXECUTE FUNCTION reject_perf_delete();
CREATE TRIGGER perf_cycle_no_truncate BEFORE TRUNCATE ON perf_cycle
 FOR EACH STATEMENT EXECUTE FUNCTION reject_perf_delete();
CREATE TRIGGER perf_review_no_truncate BEFORE TRUNCATE ON perf_review
 FOR EACH STATEMENT EXECUTE FUNCTION reject_perf_delete();
CREATE TRIGGER perf_review_entry_no_truncate BEFORE TRUNCATE ON perf_review_entry
 FOR EACH STATEMENT EXECUTE FUNCTION reject_perf_delete();
ALTER TABLE perf_objective ENABLE ALWAYS TRIGGER perf_objective_no_truncate;
ALTER TABLE perf_key_result ENABLE ALWAYS TRIGGER perf_key_result_no_truncate;
ALTER TABLE perf_kr_update ENABLE ALWAYS TRIGGER perf_kr_update_no_truncate;
ALTER TABLE perf_cycle ENABLE ALWAYS TRIGGER perf_cycle_no_truncate;
ALTER TABLE perf_review ENABLE ALWAYS TRIGGER perf_review_no_truncate;
ALTER TABLE perf_review_entry ENABLE ALWAYS TRIGGER perf_review_entry_no_truncate;
