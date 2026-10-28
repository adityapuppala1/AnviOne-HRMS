-- PERF-01 self-review fixes.
-- * A draft goal is unpublished work: perf_alignable listed, and the goal guard accepted, the
--   manager's draft goals, exposing their titles to direct reports. Another person's goal can
--   now be aligned to (and is listed) only once it is active; your own drafts stay alignable.
CREATE OR REPLACE FUNCTION perf_alignable(p_owner uuid)
RETURNS TABLE(id uuid, title text, owner_employee_id uuid, owner_name text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT o.id, o.title, o.owner_employee_id, o.owner_name, o.status FROM public.perf_objective o
 WHERE o.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND o.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND public.perf_sees_owner(p_owner)
  AND ((o.owner_employee_id=p_owner AND o.status IN ('draft','active'))
   OR (o.status='active' AND o.owner_employee_id=(SELECT e.manager_id FROM public.employee e WHERE e.id=p_owner
    AND e.tenant_id=o.tenant_id AND e.entity_id=o.entity_id)))
 ORDER BY lower(o.title), o.id LIMIT 200;
$$;
ALTER FUNCTION perf_alignable(uuid) OWNER TO anvione_perf_keeper;
REVOKE ALL ON FUNCTION perf_alignable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION perf_alignable(uuid) TO anvione_app;

-- Runs after perf_objective_guard (triggers fire in name order) whenever the parent is set.
CREATE FUNCTION guard_perf_objective_parent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 parent_owner uuid;
 parent_status text;
BEGIN
 IF NEW.parent_objective_id IS NULL
   OR (TG_OP='UPDATE' AND NEW.parent_objective_id IS NOT DISTINCT FROM OLD.parent_objective_id) THEN
  RETURN NEW;
 END IF;
 SELECT o.owner_employee_id, o.status INTO parent_owner, parent_status FROM perf_objective o
 WHERE o.tenant_id=NEW.tenant_id AND o.entity_id=NEW.entity_id AND o.id=NEW.parent_objective_id;
 IF parent_owner IS DISTINCT FROM NEW.owner_employee_id AND parent_status IS DISTINCT FROM 'active' THEN
  RAISE EXCEPTION 'Align to someone else''s goal only once it is active' USING ERRCODE='PF003';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_perf_objective_parent() OWNER TO anvione_perf_keeper;
REVOKE ALL ON FUNCTION guard_perf_objective_parent() FROM PUBLIC;
CREATE TRIGGER perf_objective_parent_guard BEFORE INSERT OR UPDATE OF parent_objective_id ON perf_objective
 FOR EACH ROW EXECUTE FUNCTION guard_perf_objective_parent();
ALTER TABLE perf_objective ENABLE ALWAYS TRIGGER perf_objective_parent_guard;
