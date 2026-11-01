CREATE POLICY candidate_assignee_read ON candidate_case FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.onboarding_task_scope',true)='self'
 AND EXISTS(
  SELECT 1 FROM candidate_task t JOIN candidate_task_assignment a ON a.task_id=t.id
  WHERE t.candidate_id=candidate_case.id
   AND a.employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
 )
);
CREATE POLICY candidate_assignee_version ON candidate_case FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.onboarding_task_scope',true)='self'
  AND EXISTS(
   SELECT 1 FROM candidate_task t JOIN candidate_task_assignment a ON a.task_id=t.id
   WHERE t.candidate_id=candidate_case.id
    AND a.employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
  )
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.onboarding_task_scope',true)='self'
 );
CREATE POLICY checklist_assignee ON candidate_task TO anvione_app
 USING(
  current_setting('app.onboarding_task_scope',true)='self'
  AND EXISTS(
   SELECT 1 FROM candidate_task_assignment a
   WHERE a.task_id=candidate_task.id
    AND a.employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
  )
 )
 WITH CHECK(
  current_setting('app.onboarding_task_scope',true)='self'
  AND EXISTS(
   SELECT 1 FROM candidate_task_assignment a
   WHERE a.task_id=candidate_task.id
    AND a.employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
  )
 );

CREATE OR REPLACE FUNCTION enforce_candidate_case_task_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF (
   current_user='anvione_candidate' AND current_setting('candidate.operation',true)='task'
  ) OR (
   current_user='anvione_app' AND current_setting('app.onboarding_task_scope',true)='self'
  ) THEN
  IF (to_jsonb(NEW)-ARRAY['version','department_kind','location_kind'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','department_kind','location_kind'])
    OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'Task writes may only increment the case version' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

ALTER TABLE outbox_event DROP CONSTRAINT outbox_event_event_type_check;
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_event_type_check CHECK(event_type IN (
 'branding.published.v1','organization.created.v1','organization.updated.v1',
 'candidate.created.v1','candidate.invited.v1','candidate.revoked.v1','candidate.reviewed.v1',
 'candidate.submitted.v1','candidate.checklist_started.v1','candidate.task_created.v1','candidate.task_updated.v1',
 'candidate.local_review_proposed.v1','candidate.local_review_decided.v1','candidate.local_review_withdrawn.v1',
 'candidate.task_assigned.v1','candidate.assigned_task_updated.v1'
));
