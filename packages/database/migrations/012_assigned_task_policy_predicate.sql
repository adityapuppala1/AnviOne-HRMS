DROP POLICY candidate_assignee_read ON candidate_case;
DROP POLICY candidate_assignee_version ON candidate_case;

CREATE POLICY task_assignment_auth ON candidate_task_assignment
 TO anvione_candidate_auth USING(true);
GRANT SELECT ON candidate_task_assignment TO anvione_candidate_auth;

CREATE FUNCTION is_candidate_task_assignee(p_candidate_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.candidate_task t
  JOIN public.candidate_task_assignment a ON a.task_id=t.id
  WHERE t.candidate_id=p_candidate_id
   AND a.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND a.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
   AND a.employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
 );
$$;
ALTER FUNCTION is_candidate_task_assignee(uuid) OWNER TO anvione_candidate_auth;
REVOKE ALL ON FUNCTION is_candidate_task_assignee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_candidate_task_assignee(uuid) TO anvione_app;

CREATE POLICY candidate_assignee_read ON candidate_case FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.onboarding_task_scope',true)='self'
 AND is_candidate_task_assignee(id)
);
CREATE POLICY candidate_assignee_version ON candidate_case FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.onboarding_task_scope',true)='self'
  AND is_candidate_task_assignee(id)
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.onboarding_task_scope',true)='self'
 );
