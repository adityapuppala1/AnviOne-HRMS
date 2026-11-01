-- POL-01 HR policies: HR drafts and publishes versioned policies, employees read
-- and acknowledge the current version, HR sees who has not. Published wording is
-- immutable (a change is a new version) and acknowledgements are permanent evidence.
CREATE ROLE anvione_policy_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_policy_keeper;

CREATE TABLE policy (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
 category text NOT NULL CHECK(category IN ('conduct','leave','it_security','safety','compliance','other')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,entity_id,code)
);

CREATE TABLE policy_version (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 policy_id uuid NOT NULL REFERENCES policy(id),
 version_number integer NOT NULL CHECK(version_number>0),
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 3 AND 120 AND title=btrim(title)),
 summary text NOT NULL CHECK(char_length(btrim(summary)) BETWEEN 10 AND 300),
 body text NOT NULL CHECK(char_length(btrim(body)) BETWEEN 20 AND 20000),
 effective_on date NOT NULL,
 requires_acknowledgement boolean NOT NULL DEFAULT true,
 audience_department_id uuid,
 status text NOT NULL CHECK(status IN ('draft','published','superseded','withdrawn')),
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 published_by_label text,
 UNIQUE(policy_id,version_number),
 CHECK((status IN ('published','superseded')) = (published_at IS NOT NULL OR status='superseded'))
);
CREATE UNIQUE INDEX policy_one_published ON policy_version(policy_id) WHERE status='published';
CREATE UNIQUE INDEX policy_one_draft ON policy_version(policy_id) WHERE status='draft';
CREATE INDEX policy_version_status_idx ON policy_version(tenant_id,entity_id,status);

CREATE TABLE policy_acknowledgement (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 policy_version_id uuid NOT NULL REFERENCES policy_version(id),
 employee_id uuid NOT NULL,
 acknowledged_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 UNIQUE(policy_version_id,employee_id)
);
CREATE INDEX policy_ack_employee_idx ON policy_acknowledgement(tenant_id,entity_id,employee_id);

CREATE FUNCTION guard_policy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF coalesce(current_setting('app.policy_scope',true),'none')<>'entity'
   OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'Only HR manages policies' USING ERRCODE='PL005';
 END IF;
 IF TG_OP='UPDATE' THEN
  RAISE EXCEPTION 'A policy is changed by publishing a new version' USING ERRCODE='PL004';
 END IF;
 NEW.created_at := now();
 RETURN NEW;
END $$;

CREATE FUNCTION guard_policy_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 managed text[] := ARRAY['title','summary','body','effective_on','requires_acknowledgement','audience_department_id','status','version','published_at','published_by_label'];
BEGIN
 IF coalesce(current_setting('app.policy_scope',true),'none')<>'entity'
   OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'Only HR manages policies' USING ERRCODE='PL005';
 END IF;
 IF NEW.audience_department_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM org_unit o
   WHERE o.tenant_id=NEW.tenant_id AND o.entity_id=NEW.entity_id AND o.id=NEW.audience_department_id
    AND o.kind='department') THEN
  RAISE EXCEPTION 'Choose a department that exists' USING ERRCODE='PL003';
 END IF;
 IF TG_OP='INSERT' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('policy:'||NEW.policy_id::text,0));
  IF NOT EXISTS(SELECT 1 FROM policy p WHERE p.id=NEW.policy_id AND p.tenant_id=NEW.tenant_id AND p.entity_id=NEW.entity_id) THEN
   RAISE EXCEPTION 'This policy does not exist' USING ERRCODE='PL004';
  END IF;
  NEW.version_number := coalesce((SELECT max(v.version_number) FROM policy_version v WHERE v.policy_id=NEW.policy_id),0)+1;
  NEW.status := 'draft';
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
  NEW.published_at := NULL;
  NEW.published_by_label := NULL;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'A policy version changes only through editing a draft, publishing or withdrawing' USING ERRCODE='PL004';
 END IF;
 IF NEW.status=OLD.status THEN
  IF OLD.status<>'draft' THEN
   RAISE EXCEPTION 'Published wording cannot be changed; publish a new version' USING ERRCODE='PL004';
  END IF;
  RETURN NEW;
 END IF;
 IF NOT (
  (OLD.status='draft' AND NEW.status IN ('published','withdrawn'))
  OR (OLD.status='published' AND NEW.status IN ('superseded','withdrawn'))
 ) THEN
  RAISE EXCEPTION 'That policy status change is not allowed' USING ERRCODE='PL004';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','version','published_at','published_by_label'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','published_at','published_by_label']) THEN
  RAISE EXCEPTION 'The wording cannot change while the status changes' USING ERRCODE='PL004';
 END IF;
 IF NEW.status='published' THEN
  NEW.published_at := now();
  NEW.published_by_label := label;
 ELSE
  NEW.published_at := OLD.published_at;
  NEW.published_by_label := OLD.published_by_label;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION guard_policy_acknowledgement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 scope text := coalesce(current_setting('app.policy_scope',true),'none');
 v record;
 department uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'Acknowledgements are permanent' USING ERRCODE='PL004';
 END IF;
 IF me IS NULL OR NEW.employee_id<>me OR scope NOT IN ('self','team')
   OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'You can only acknowledge a policy for yourself' USING ERRCODE='PL005';
 END IF;
 SELECT pv.status, pv.requires_acknowledgement, pv.audience_department_id INTO v
  FROM policy_version pv WHERE pv.id=NEW.policy_version_id AND pv.tenant_id=NEW.tenant_id AND pv.entity_id=NEW.entity_id;
 IF NOT FOUND OR v.status<>'published' THEN
  RAISE EXCEPTION 'Only the current published version can be acknowledged' USING ERRCODE='PL004';
 END IF;
 IF NOT v.requires_acknowledgement THEN
  RAISE EXCEPTION 'This policy does not need acknowledgement' USING ERRCODE='PL004';
 END IF;
 SELECT e.department_id INTO department FROM employee e
  WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=me AND e.status IN ('active','notice');
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Only current employees acknowledge policies' USING ERRCODE='PL005';
 END IF;
 IF v.audience_department_id IS NOT NULL AND v.audience_department_id IS DISTINCT FROM department THEN
  RAISE EXCEPTION 'This policy is not addressed to you' USING ERRCODE='PL005';
 END IF;
 NEW.acknowledged_at := now();
 RETURN NEW;
END $$;

CREATE FUNCTION reject_policy_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Policies and acknowledgements are withdrawn, never deleted' USING ERRCODE='23514';
END $$;

CREATE TRIGGER policy_guard BEFORE INSERT OR UPDATE ON policy
FOR EACH ROW EXECUTE FUNCTION guard_policy();
CREATE TRIGGER policy_version_guard BEFORE INSERT OR UPDATE ON policy_version
FOR EACH ROW EXECUTE FUNCTION guard_policy_version();
CREATE TRIGGER policy_ack_guard BEFORE INSERT OR UPDATE ON policy_acknowledgement
FOR EACH ROW EXECUTE FUNCTION guard_policy_acknowledgement();
CREATE TRIGGER policy_no_delete BEFORE DELETE ON policy
FOR EACH ROW EXECUTE FUNCTION reject_policy_delete();
CREATE TRIGGER policy_version_no_delete BEFORE DELETE ON policy_version
FOR EACH ROW EXECUTE FUNCTION reject_policy_delete();
CREATE TRIGGER policy_ack_no_delete BEFORE DELETE ON policy_acknowledgement
FOR EACH ROW EXECUTE FUNCTION reject_policy_delete();

ALTER FUNCTION guard_policy() OWNER TO anvione_policy_keeper;
ALTER FUNCTION guard_policy_version() OWNER TO anvione_policy_keeper;
ALTER FUNCTION guard_policy_acknowledgement() OWNER TO anvione_policy_keeper;
REVOKE ALL ON FUNCTION guard_policy(),guard_policy_version(),guard_policy_acknowledgement(),reject_policy_delete() FROM PUBLIC;
GRANT SELECT ON employee,org_unit,policy,policy_version,policy_acknowledgement TO anvione_policy_keeper;

ALTER TABLE policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy FORCE ROW LEVEL SECURITY;
ALTER TABLE policy_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_version FORCE ROW LEVEL SECURITY;
ALTER TABLE policy_acknowledgement ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_acknowledgement FORCE ROW LEVEL SECURITY;
CREATE POLICY policy_keeper_emp ON employee FOR SELECT TO anvione_policy_keeper USING(true);
CREATE POLICY policy_keeper_org ON org_unit FOR SELECT TO anvione_policy_keeper USING(true);
CREATE POLICY policy_keeper ON policy FOR SELECT TO anvione_policy_keeper USING(true);
CREATE POLICY policy_version_keeper ON policy_version FOR SELECT TO anvione_policy_keeper USING(true);
CREATE POLICY policy_ack_keeper ON policy_acknowledgement FOR SELECT TO anvione_policy_keeper USING(true);

-- HR sees every policy and version. Everyone else sees only the current published
-- version addressed to them (everyone, or their own department).
CREATE POLICY policy_version_visible ON policy_version FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  current_setting('app.policy_scope',true)='entity'
  OR (current_setting('app.policy_scope',true) IN ('self','team') AND status='published'
   AND (audience_department_id IS NULL OR audience_department_id=(
     SELECT e.department_id FROM employee e
     WHERE e.id=nullif(current_setting('app.employee_id',true),'')::uuid)))
 )
);
CREATE POLICY policy_visible ON policy FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  current_setting('app.policy_scope',true)='entity'
  OR (current_setting('app.policy_scope',true) IN ('self','team')
   AND EXISTS(SELECT 1 FROM policy_version v WHERE v.policy_id=policy.id))
 )
);
CREATE POLICY policy_insert ON policy FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.policy_scope',true)='entity'
);
CREATE POLICY policy_version_insert ON policy_version FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.policy_scope',true)='entity'
);
CREATE POLICY policy_version_update ON policy_version FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.policy_scope',true)='entity'
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );
CREATE POLICY policy_ack_visible ON policy_acknowledgement FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  current_setting('app.policy_scope',true)='entity'
  OR (current_setting('app.policy_scope',true) IN ('self','team')
   AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
 )
);
CREATE POLICY policy_ack_insert ON policy_acknowledgement FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
 AND current_setting('app.policy_scope',true) IN ('self','team')
);

GRANT SELECT ON policy,policy_version,policy_acknowledgement TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,code,category) ON policy TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,policy_id,title,summary,body,effective_on,requires_acknowledgement,
 audience_department_id,status,version,created_by_label,version_number) ON policy_version TO anvione_app;
GRANT UPDATE(title,summary,body,effective_on,requires_acknowledgement,audience_department_id,status,version)
 ON policy_version TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,policy_version_id,employee_id) ON policy_acknowledgement TO anvione_app;

ALTER TABLE outbox_event DROP CONSTRAINT outbox_event_event_type_check;
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_event_type_check CHECK(event_type IN (
 'branding.published.v1','organization.created.v1','organization.updated.v1',
 'candidate.created.v1','candidate.invited.v1','candidate.revoked.v1','candidate.reviewed.v1',
 'candidate.submitted.v1','candidate.checklist_started.v1','candidate.task_created.v1','candidate.task_updated.v1',
 'candidate.local_review_proposed.v1','candidate.local_review_decided.v1','candidate.local_review_withdrawn.v1',
 'candidate.task_assigned.v1','candidate.assigned_task_updated.v1',
 'leave.requested.v1','leave.approved.v1','leave.rejected.v1','leave.cancelled.v1',
 'attendance.checked_in.v1','attendance.checked_out.v1',
 'attendance.correction_requested.v1','attendance.correction_approved.v1',
 'attendance.correction_rejected.v1','attendance.correction_cancelled.v1',
 'calendar.holiday_created.v1','calendar.holiday_updated.v1','calendar.work_week_updated.v1',
 'document.uploaded.v1','document.verified.v1','document.rejected.v1','document.withdrawn.v1',
 'asset.registered.v1','asset.updated.v1','asset.issued.v1','asset.acknowledged.v1',
 'asset.returned.v1','asset.status_changed.v1',
 'policy.created.v1','policy.draft_updated.v1','policy.published.v1','policy.withdrawn.v1',
 'policy.acknowledged.v1'
));
