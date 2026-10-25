CREATE TABLE candidate_task_assignment (
 task_id uuid PRIMARY KEY REFERENCES candidate_task(id),
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 assigned_by uuid NOT NULL,
 assigner_label text NOT NULL CHECK(length(assigner_label) BETWEEN 2 AND 120),
 assigned_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id)
);
CREATE INDEX candidate_task_assignment_employee
 ON candidate_task_assignment(tenant_id,entity_id,employee_id,updated_at DESC,task_id);

ALTER TABLE candidate_task_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_task_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY task_assignment_hr ON candidate_task_assignment TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.onboarding_scope',true)='write'
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.onboarding_scope',true)='write'
 );
CREATE POLICY task_assignment_self ON candidate_task_assignment FOR SELECT TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
  AND current_setting('app.onboarding_task_scope',true)='self'
 );

CREATE FUNCTION enforce_candidate_task_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 actor uuid := nullif(current_setting('app.actor_id',true),'')::uuid;
 actor_label text := nullif(current_setting('app.actor_label',true),'');
 task_owner text;
 task_tenant uuid;
 task_entity uuid;
BEGIN
 IF actor IS NULL OR actor_label IS NULL OR current_setting('app.onboarding_scope',true)<>'write' THEN
  RAISE EXCEPTION 'HR actor context is required' USING ERRCODE='23514';
 END IF;
 SELECT t.owner,c.tenant_id,c.entity_id INTO task_owner,task_tenant,task_entity
 FROM public.candidate_task t JOIN public.candidate_case c ON c.id=t.candidate_id
 WHERE t.id=NEW.task_id;
 IF task_owner IS NULL OR task_owner='candidate' THEN
  RAISE EXCEPTION 'Only internal checklist tasks can be assigned' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM public.employee e
  WHERE e.id=NEW.employee_id AND e.tenant_id=task_tenant AND e.entity_id=task_entity
    AND e.status IN ('active','notice')
 ) THEN
  RAISE EXCEPTION 'Assignee must be active in the same legal entity' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 THEN
   RAISE EXCEPTION 'New assignments start at version one' USING ERRCODE='23514';
  END IF;
  NEW.assigned_at=now();
 ELSE
  IF NEW.task_id<>OLD.task_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.entity_id<>OLD.entity_id
   OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'Assignment identity is immutable and updates are versioned' USING ERRCODE='23514';
  END IF;
 END IF;
 NEW.tenant_id=task_tenant;
 NEW.entity_id=task_entity;
 NEW.assigned_by=actor;
 NEW.assigner_label=actor_label;
 NEW.updated_at=now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION enforce_candidate_task_assignment() FROM PUBLIC;
CREATE TRIGGER candidate_task_assignment_guard
 BEFORE INSERT OR UPDATE ON candidate_task_assignment
 FOR EACH ROW EXECUTE FUNCTION enforce_candidate_task_assignment();

GRANT SELECT,INSERT,UPDATE ON candidate_task_assignment TO anvione_app;
