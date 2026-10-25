CREATE OR REPLACE FUNCTION is_candidate_task_assignee(p_candidate_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.candidate_task t
  JOIN public.candidate_task_assignment a ON a.task_id=t.id
  JOIN public.candidate_case c ON c.id=t.candidate_id
  WHERE t.candidate_id=p_candidate_id
   AND c.state<>'cancelled'
   AND a.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND a.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
   AND a.employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
 );
$$;
ALTER FUNCTION is_candidate_task_assignee(uuid) OWNER TO anvione_candidate_auth;
REVOKE ALL ON FUNCTION is_candidate_task_assignee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_candidate_task_assignee(uuid) TO anvione_app;

DROP POLICY checklist_assignee ON candidate_task;
CREATE POLICY checklist_assignee ON candidate_task TO anvione_app
 USING(
  current_setting('app.onboarding_task_scope',true)='self'
  AND is_candidate_task_assignee(candidate_id)
  AND EXISTS(
   SELECT 1 FROM candidate_task_assignment a
   WHERE a.task_id=candidate_task.id
    AND a.employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
  )
 )
 WITH CHECK(
  current_setting('app.onboarding_task_scope',true)='self'
  AND is_candidate_task_assignee(candidate_id)
  AND EXISTS(
   SELECT 1 FROM candidate_task_assignment a
   WHERE a.task_id=candidate_task.id
    AND a.employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
  )
 );
