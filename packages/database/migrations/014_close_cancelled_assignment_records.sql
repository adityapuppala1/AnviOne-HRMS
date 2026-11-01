CREATE FUNCTION is_active_assigned_task(p_task_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.candidate_task t
  JOIN public.candidate_case c ON c.id=t.candidate_id
  WHERE t.id=p_task_id AND c.state<>'cancelled'
 );
$$;
ALTER FUNCTION is_active_assigned_task(uuid) OWNER TO anvione_candidate_auth;
REVOKE ALL ON FUNCTION is_active_assigned_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_active_assigned_task(uuid) TO anvione_app;

DROP POLICY task_assignment_self ON candidate_task_assignment;
CREATE POLICY task_assignment_self ON candidate_task_assignment FOR SELECT TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
  AND current_setting('app.onboarding_task_scope',true)='self'
  AND is_active_assigned_task(task_id)
 );
