-- RPT-01 reports: report rows come from each domain's own tables under that domain's
-- row-level security, so nothing here widens what anyone can read. This migration only
-- stores per-person saved report definitions (whitelisted keys, never SQL). A definition
-- is private to its owner, is archived instead of deleted, and archiving is final.
-- Sharing and scheduling are not modelled.
CREATE ROLE anvione_report_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_report_keeper;

CREATE TABLE report_definition (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 owner_employee_id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 3 AND 80 AND name=btrim(name)),
 dataset text NOT NULL CHECK(dataset IN ('people','leave','attendance','expenses','assets','policyAcknowledgements','exits')),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object' AND definition->>'dataset'=dataset
   AND octet_length(definition::text)<=8192),
 archived boolean NOT NULL DEFAULT false,
 archived_at timestamptz,
 version integer NOT NULL CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,owner_employee_id) REFERENCES employee(tenant_id,entity_id,id),
 CHECK(archived=(archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX report_definition_owner_name ON report_definition(tenant_id,entity_id,owner_employee_id,lower(name))
 WHERE NOT archived;
CREATE INDEX report_definition_owner_idx ON report_definition(tenant_id,entity_id,owner_employee_id,updated_at DESC);

CREATE FUNCTION guard_report_definition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.report_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 managed text[] := ARRAY['name','dataset','definition','archived','archived_at','version','updated_at'];
 saved integer;
BEGIN
 IF scope NOT IN ('team','entity') OR me IS NULL OR NEW.owner_employee_id IS DISTINCT FROM me
   OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'You can only keep your own saved reports' USING ERRCODE='RP005';
 END IF;
 -- Team reporting never covers the HR-only datasets (archiving one is still allowed).
 IF scope='team' AND NEW.dataset IN ('assets','policyAcknowledgements','exits') AND NOT NEW.archived THEN
  RAISE EXCEPTION 'This report is not available in your current workspace' USING ERRCODE='RP005';
 END IF;
 IF TG_OP='INSERT' THEN
  -- One owner at a time, so the cap holds under concurrent saves.
  PERFORM pg_advisory_xact_lock(hashtextextended('report-owner:'||NEW.owner_employee_id::text,0));
  SELECT count(*) INTO saved FROM public.report_definition
   WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND owner_employee_id=NEW.owner_employee_id AND NOT archived;
  IF saved>=50 THEN
   RAISE EXCEPTION 'You can keep up to 50 saved reports. Archive one first' USING ERRCODE='RP003';
  END IF;
  NEW.version := 1;
  NEW.archived := false;
  NEW.archived_at := NULL;
  NEW.created_at := now();
 ELSE
  IF OLD.archived THEN
   RAISE EXCEPTION 'An archived report cannot change' USING ERRCODE='RP001';
  END IF;
  IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'A saved report changes only through its own actions' USING ERRCODE='RP001';
  END IF;
  NEW.archived_at := CASE WHEN NEW.archived THEN now() END;
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

CREATE FUNCTION reject_report_definition_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Saved reports are archived, never deleted' USING ERRCODE='23514';
END $$;

CREATE TRIGGER report_definition_guard BEFORE INSERT OR UPDATE ON report_definition
FOR EACH ROW EXECUTE FUNCTION guard_report_definition();
CREATE TRIGGER report_definition_no_delete BEFORE DELETE ON report_definition
FOR EACH ROW EXECUTE FUNCTION reject_report_definition_delete();

ALTER FUNCTION guard_report_definition() OWNER TO anvione_report_keeper;
REVOKE ALL ON FUNCTION guard_report_definition(),reject_report_definition_delete() FROM PUBLIC;
GRANT SELECT ON report_definition TO anvione_report_keeper;

ALTER TABLE report_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY report_definition_keeper ON report_definition FOR SELECT TO anvione_report_keeper USING(true);

-- Owner-only, and only while the caller's role may run reports at all.
CREATE POLICY report_definition_visible ON report_definition FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND owner_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
 AND current_setting('app.report_scope',true) IN ('team','entity')
);
CREATE POLICY report_definition_insert ON report_definition FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND owner_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
 AND current_setting('app.report_scope',true) IN ('team','entity')
);
CREATE POLICY report_definition_update ON report_definition FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND owner_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
  AND current_setting('app.report_scope',true) IN ('team','entity')
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND owner_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
 );

GRANT SELECT ON report_definition TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,owner_employee_id,name,dataset,definition) ON report_definition TO anvione_app;
GRANT UPDATE(name,dataset,definition,archived,version) ON report_definition TO anvione_app;

ALTER TABLE outbox_event DROP CONSTRAINT outbox_event_event_type_check;
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_event_type_check CHECK(event_type IN (
 'branding.published.v1','organization.created.v1','organization.updated.v1','organization.merged.v1',
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
 'policy.acknowledged.v1',
 'exit.submitted.v1','exit.accepted.v1','exit.rejected.v1','exit.withdrawn.v1',
 'exit.clearance_updated.v1','exit.completed.v1',
 'expense.submitted.v1','expense.approved.v1','expense.rejected.v1','expense.cancelled.v1',
 'expense.paid.v1','expense.category_created.v1','expense.category_updated.v1',
 'profile.change_submitted.v1','profile.change_approved.v1','profile.change_rejected.v1',
 'profile.change_withdrawn.v1','profile.change_applied.v1','profile.change_cancelled.v1',
 'report.exported.v1','report.saved.v1','report.updated.v1','report.archived.v1'
));
