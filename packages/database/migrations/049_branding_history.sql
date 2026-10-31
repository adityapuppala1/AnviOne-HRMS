-- ADM-02 branding configuration history and rollback.
-- * branding_history keeps one immutable row per published branding version. It is written
--   only by a trigger on branding (so every path is covered), by a keeper role; the runtime
--   can read it (platform_admin scope only) but never insert, update or delete it.
-- * A rollback publishes a NEW branding version whose values equal a chosen historical
--   version; history is never rewritten. The trigger checks that claim.
-- * The current branding is backfilled as a 'baseline' row.
DO $$ BEGIN
 IF current_user IN ('anvione_app','anvione_worker','anvione_candidate','anvione_identity_operator') THEN
  RAISE EXCEPTION 'Migrations must run as the migration role, not %', current_user;
 END IF;
END $$;

CREATE ROLE anvione_branding_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_branding_keeper;

CREATE TABLE branding_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 platform_name text NOT NULL,
 employee_name text NOT NULL,
 organization_name text NOT NULL,
 theme text NOT NULL CHECK(theme IN ('ocean','iris','forest')),
 source text NOT NULL CHECK(source IN ('baseline','edit','rollback')),
 restored_version integer CHECK((source='rollback')=(restored_version IS NOT NULL)),
 changed_by text NOT NULL CHECK(char_length(changed_by) BETWEEN 1 AND 200),
 -- Nullable: baseline rows and edits made without a reason.
 reason text CHECK(reason IS NULL OR char_length(reason) BETWEEN 10 AND 300),
 occurred_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,entity_id,version),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id)
);

INSERT INTO branding_history(tenant_id,entity_id,version,platform_name,employee_name,organization_name,theme,source,changed_by)
SELECT tenant_id,entity_id,version,platform_name,employee_name,organization_name,theme,'baseline','Baseline'
FROM branding;

CREATE FUNCTION record_branding_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 src text := coalesce(nullif(current_setting('app.branding_source',true),''),'edit');
 why text := nullif(current_setting('app.branding_reason',true),'');
 restored integer := nullif(current_setting('app.branding_restored_version',true),'')::integer;
 old_row record;
BEGIN
 IF TG_OP='UPDATE' AND NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'Branding publishes exactly one new version at a time' USING ERRCODE='BR001';
 END IF;
 IF src NOT IN ('edit','rollback') THEN
  RAISE EXCEPTION 'Unknown branding change source' USING ERRCODE='BR001';
 END IF;
 IF src='rollback' THEN
  SELECT * INTO old_row FROM public.branding_history h
  WHERE h.tenant_id=NEW.tenant_id AND h.entity_id=NEW.entity_id AND h.version=restored;
  IF NOT FOUND OR (old_row.platform_name,old_row.employee_name,old_row.organization_name,old_row.theme)
     IS DISTINCT FROM (NEW.platform_name,NEW.employee_name,NEW.organization_name,NEW.theme) THEN
   RAISE EXCEPTION 'A rollback must restore a recorded version exactly' USING ERRCODE='BR001';
  END IF;
 ELSE
  restored := NULL;
 END IF;
 INSERT INTO public.branding_history(tenant_id,entity_id,version,platform_name,employee_name,
  organization_name,theme,source,restored_version,changed_by,reason)
 VALUES (NEW.tenant_id,NEW.entity_id,NEW.version,NEW.platform_name,NEW.employee_name,
  NEW.organization_name,NEW.theme,src,restored,
  coalesce(nullif(current_setting('app.actor_label',true),''),'System'),why);
 RETURN NULL;
END $$;

CREATE FUNCTION reject_branding_history_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Branding history is immutable' USING ERRCODE='BR002';
END $$;

CREATE TRIGGER branding_history_record AFTER INSERT OR UPDATE ON branding
FOR EACH ROW EXECUTE FUNCTION record_branding_history();
CREATE TRIGGER branding_history_immutable BEFORE UPDATE OR DELETE ON branding_history
FOR EACH ROW EXECUTE FUNCTION reject_branding_history_change();
CREATE TRIGGER branding_history_no_truncate BEFORE TRUNCATE ON branding_history
FOR EACH STATEMENT EXECUTE FUNCTION reject_branding_history_change();

ALTER FUNCTION record_branding_history() OWNER TO anvione_branding_keeper;
REVOKE ALL ON FUNCTION record_branding_history(),reject_branding_history_change() FROM PUBLIC;
GRANT SELECT, INSERT ON branding_history TO anvione_branding_keeper;
GRANT SELECT ON branding_history TO anvione_app;

ALTER TABLE branding_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE branding_history FORCE ROW LEVEL SECURITY;
CREATE POLICY branding_history_keeper_read ON branding_history FOR SELECT TO anvione_branding_keeper USING(true);
CREATE POLICY branding_history_keeper_write ON branding_history FOR INSERT TO anvione_branding_keeper WITH CHECK(true);
-- Same tenant/entity keying as branding, and only for roles holding branding.write.
CREATE POLICY branding_history_visible ON branding_history FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.branding_scope',true)='entity'
);

-- Recreated from the latest definition (043) plus the rollback event.
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
 'report.exported.v1','report.saved.v1','report.updated.v1','report.archived.v1',
 'employee.classified.v1','branding.rolled_back.v1'
));
