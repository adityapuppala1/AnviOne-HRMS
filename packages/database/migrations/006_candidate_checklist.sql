CREATE TABLE candidate_task (
 id uuid PRIMARY KEY, candidate_id uuid NOT NULL REFERENCES candidate_case(id),
 label text NOT NULL CHECK(length(label) BETWEEN 5 AND 140),
 owner text NOT NULL CHECK(owner IN ('candidate','hr','manager','it','administration')),
 required boolean NOT NULL, due_on date NOT NULL, depends_on uuid,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','blocked','completed')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), note text CHECK(length(note) BETWEEN 10 AND 300),
 template_code text CHECK(template_code='starter_v1'),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(candidate_id,id), FOREIGN KEY(candidate_id,depends_on) REFERENCES candidate_task(candidate_id,id),
 CHECK(depends_on IS DISTINCT FROM id), CHECK(state<>'completed' OR note IS NOT NULL)
);
CREATE INDEX candidate_task_case ON candidate_task(candidate_id,created_at,id);
CREATE POLICY candidate_checklist_version ON candidate_case FOR UPDATE TO anvione_candidate
 USING(id=nullif(current_setting('candidate.id',true),'')::uuid AND state<>'cancelled' AND current_setting('candidate.operation',true)='task')
 WITH CHECK(id=nullif(current_setting('candidate.id',true),'')::uuid AND state<>'cancelled' AND current_setting('candidate.operation',true)='task');
CREATE FUNCTION enforce_candidate_case_task_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- Stored generated fields are not populated in NEW during a BEFORE trigger.
 -- Their source IDs remain part of the immutable comparison.
 IF current_user='anvione_candidate' AND current_setting('candidate.operation',true)='task' AND
 ((to_jsonb(NEW)-ARRAY['version','department_kind','location_kind']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','department_kind','location_kind']) OR NEW.version<>OLD.version+1) THEN
  RAISE EXCEPTION 'Checklist writes may only increment the case version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION enforce_candidate_case_task_version() FROM PUBLIC;
CREATE TRIGGER candidate_case_task_version BEFORE UPDATE ON candidate_case FOR EACH ROW EXECUTE FUNCTION enforce_candidate_case_task_version();
ALTER TABLE candidate_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_task FORCE ROW LEVEL SECURITY;
CREATE POLICY checklist_hr ON candidate_task TO anvione_app
 USING(EXISTS(SELECT 1 FROM candidate_case c WHERE c.id=candidate_id))
 WITH CHECK(EXISTS(SELECT 1 FROM candidate_case c WHERE c.id=candidate_id));
CREATE POLICY checklist_candidate_read ON candidate_task FOR SELECT TO anvione_candidate
 USING(owner='candidate' AND candidate_id=nullif(current_setting('candidate.id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM candidate_case c WHERE c.id=candidate_id));
CREATE POLICY checklist_candidate_write ON candidate_task FOR UPDATE TO anvione_candidate
 USING(owner='candidate' AND candidate_id=nullif(current_setting('candidate.id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM candidate_case c WHERE c.id=candidate_id))
 WITH CHECK(owner='candidate' AND candidate_id=nullif(current_setting('candidate.id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM candidate_case c WHERE c.id=candidate_id));
CREATE POLICY checklist_auth ON candidate_task TO anvione_candidate_auth USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON candidate_task TO anvione_app;
GRANT SELECT ON candidate_task TO anvione_candidate,anvione_candidate_auth;
GRANT UPDATE(state,version,note,updated_at) ON candidate_task TO anvione_candidate;

CREATE FUNCTION enforce_candidate_task() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE case_state text; BEGIN
 SELECT state INTO case_state FROM public.candidate_case WHERE id=NEW.candidate_id FOR UPDATE;
 IF case_state='cancelled' THEN RAISE EXCEPTION 'Cancelled intake is read only' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.state<>'pending' OR NEW.note IS NOT NULL THEN
   RAISE EXCEPTION 'New checklist tasks must start pending' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.candidate_id,NEW.label,NEW.owner,NEW.required,NEW.due_on,NEW.depends_on,NEW.template_code,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.candidate_id,OLD.label,OLD.owner,OLD.required,OLD.due_on,OLD.depends_on,OLD.template_code,OLD.created_at)
   OR NEW.version<>OLD.version+1 OR NEW.note IS NULL THEN
   RAISE EXCEPTION 'Task metadata is immutable and updates require a version and note' USING ERRCODE='23514'; END IF;
  IF OLD.state='completed' AND NEW.state<>'completed' AND EXISTS(
   SELECT 1 FROM public.candidate_task WHERE candidate_id=NEW.candidate_id AND depends_on=NEW.id AND state='completed') THEN
   RAISE EXCEPTION 'Reopen completed dependents first' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.state='completed' AND NEW.depends_on IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.candidate_task WHERE candidate_id=NEW.candidate_id AND id=NEW.depends_on AND state='completed') THEN
  RAISE EXCEPTION 'Complete the prerequisite first' USING ERRCODE='23514'; END IF;
 NEW.updated_at=now(); RETURN NEW;
END $$;
ALTER FUNCTION enforce_candidate_task() OWNER TO anvione_candidate_auth;
REVOKE ALL ON FUNCTION enforce_candidate_task() FROM PUBLIC;
CREATE TRIGGER candidate_task_guard BEFORE INSERT OR UPDATE ON candidate_task FOR EACH ROW EXECUTE FUNCTION enforce_candidate_task();

CREATE FUNCTION candidate_task_waiting(p_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER
 SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce((SELECT t.depends_on IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.candidate_task d WHERE d.candidate_id=t.candidate_id AND d.id=t.depends_on AND d.state='completed')
 FROM public.candidate_task t WHERE t.id=p_id AND t.owner='candidate'
 AND t.candidate_id=nullif(current_setting('candidate.id',true),'')::uuid),true);
$$;
ALTER FUNCTION candidate_task_waiting(uuid) OWNER TO anvione_candidate_auth;
REVOKE ALL ON FUNCTION candidate_task_waiting(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_task_waiting(uuid) TO anvione_candidate;
DROP POLICY candidate_event ON outbox_event;
CREATE POLICY candidate_event ON outbox_event FOR INSERT TO anvione_candidate WITH CHECK(
 event_type IN ('candidate.submitted.v1','candidate.task_updated.v1') AND aggregate_id=nullif(current_setting('candidate.id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM candidate_case c WHERE c.id=aggregate_id AND c.tenant_id=outbox_event.tenant_id AND c.entity_id=outbox_event.entity_id)
);
ALTER TABLE outbox_event DROP CONSTRAINT outbox_event_event_type_check;
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_event_type_check CHECK(event_type IN ('branding.published.v1','organization.created.v1','organization.updated.v1','candidate.created.v1','candidate.invited.v1','candidate.revoked.v1','candidate.reviewed.v1','candidate.submitted.v1','candidate.checklist_started.v1','candidate.task_created.v1','candidate.task_updated.v1'));
