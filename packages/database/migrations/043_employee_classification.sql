-- Employees can now carry a designation, a grade and a cost centre (all optional).
-- The three links are pinned to tenant + entity + kind like department/location, and
-- they change only through classify_employee(), owned by a dedicated minimal role.
-- classification_version counts those changes (outbox aggregate version); nothing
-- else on the employee row is bumped.
CREATE ROLE anvione_org_classifier NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_org_classifier;

ALTER TABLE employee ADD COLUMN designation_id uuid;
ALTER TABLE employee ADD COLUMN grade_id uuid;
ALTER TABLE employee ADD COLUMN cost_center_id uuid;
ALTER TABLE employee ADD COLUMN classification_version integer NOT NULL DEFAULT 0
  CHECK (classification_version >= 0);
ALTER TABLE employee ADD COLUMN designation_kind text GENERATED ALWAYS AS ('designation'::text) STORED;
ALTER TABLE employee ADD COLUMN grade_kind text GENERATED ALWAYS AS ('grade'::text) STORED;
ALTER TABLE employee ADD COLUMN cost_center_kind text GENERATED ALWAYS AS ('cost_center'::text) STORED;
ALTER TABLE employee ADD CONSTRAINT employee_designation_fk FOREIGN KEY (tenant_id,entity_id,designation_kind,designation_id)
  REFERENCES org_unit(tenant_id,entity_id,kind,id);
ALTER TABLE employee ADD CONSTRAINT employee_grade_fk FOREIGN KEY (tenant_id,entity_id,grade_kind,grade_id)
  REFERENCES org_unit(tenant_id,entity_id,kind,id);
ALTER TABLE employee ADD CONSTRAINT employee_cost_center_fk FOREIGN KEY (tenant_id,entity_id,cost_center_kind,cost_center_id)
  REFERENCES org_unit(tenant_id,entity_id,kind,id);
CREATE INDEX employee_designation_idx ON employee(tenant_id,entity_id,designation_id) WHERE designation_id IS NOT NULL;
CREATE INDEX employee_grade_idx ON employee(tenant_id,entity_id,grade_id) WHERE grade_id IS NOT NULL;
CREATE INDEX employee_cost_center_idx ON employee(tenant_id,entity_id,cost_center_id) WHERE cost_center_id IS NOT NULL;

-- Any role, the table owner included, is refused unless it is the classifier.
CREATE FUNCTION guard_employee_classification() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF current_user <> 'anvione_org_classifier' AND (
     (TG_OP='INSERT' AND (NEW.designation_id IS NOT NULL OR NEW.grade_id IS NOT NULL
        OR NEW.cost_center_id IS NOT NULL OR NEW.classification_version <> 0))
     OR (TG_OP='UPDATE' AND (NEW.designation_id,NEW.grade_id,NEW.cost_center_id,NEW.classification_version)
        IS DISTINCT FROM (OLD.designation_id,OLD.grade_id,OLD.cost_center_id,OLD.classification_version))) THEN
    RAISE EXCEPTION 'Designation, grade and cost centre change only through classification' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_employee_classification() FROM PUBLIC;
CREATE TRIGGER employee_classification_guard BEFORE INSERT OR UPDATE ON employee
FOR EACH ROW EXECUTE FUNCTION guard_employee_classification();

-- Assign or clear the three links of one current employee. A changed link must name a
-- unit of the right kind that is active, not merged and in effect on the entity's
-- business date; an unchanged link is kept even if its unit has since ended.
-- The employee is serialized by an advisory lock plus a row lock; the units are
-- locked FOR SHARE, so a concurrent end/postpone (FOR UPDATE) waits and then sees them.
CREATE FUNCTION classify_employee(p_employee uuid, p_designation uuid, p_grade uuid, p_cost_center uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  tenant uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
  entity uuid := nullif(current_setting('app.entity_id',true),'')::uuid;
  e record;
  today date;
  k text;
  wanted uuid;
  current_id uuid;
BEGIN
  IF tenant IS NULL OR entity IS NULL OR current_setting('app.hr_scope',true) IS DISTINCT FROM 'write' THEN
    RAISE EXCEPTION 'Only HR can classify employees' USING ERRCODE='OG005';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('employee_classification:'||p_employee::text,0));
  SELECT id,status,designation_id,grade_id,cost_center_id,classification_version INTO e
    FROM public.employee WHERE id=p_employee AND tenant_id=tenant AND entity_id=entity FOR UPDATE;
  IF e.id IS NULL OR e.status NOT IN ('active','notice') THEN
    RAISE EXCEPTION 'This employee is unavailable' USING ERRCODE='OG003';
  END IF;
  IF (p_designation,p_grade,p_cost_center) IS NOT DISTINCT FROM (e.designation_id,e.grade_id,e.cost_center_id) THEN
    RETURN jsonb_build_object('changed',false,'version',e.classification_version,
      'before',jsonb_build_object('designationId',e.designation_id,'gradeId',e.grade_id,'costCenterId',e.cost_center_id));
  END IF;
  today := public.org_entity_today(tenant,entity);
  FOREACH k IN ARRAY ARRAY['designation','grade','cost_center'] LOOP
    wanted := CASE k WHEN 'designation' THEN p_designation WHEN 'grade' THEN p_grade ELSE p_cost_center END;
    current_id := CASE k WHEN 'designation' THEN e.designation_id WHEN 'grade' THEN e.grade_id ELSE e.cost_center_id END;
    IF wanted IS NOT NULL AND wanted IS DISTINCT FROM current_id THEN
      PERFORM 1 FROM public.org_unit WHERE tenant_id=tenant AND entity_id=entity AND id=wanted AND kind=k
        AND active AND merged_into_id IS NULL
        AND effective_from<=today AND (effective_to IS NULL OR effective_to>=today) FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Choose a % that is in effect in this entity', replace(k,'_',' ') USING ERRCODE='OG002';
      END IF;
    END IF;
  END LOOP;
  UPDATE public.employee SET designation_id=p_designation, grade_id=p_grade, cost_center_id=p_cost_center,
    classification_version=classification_version+1
  WHERE id=e.id;
  RETURN jsonb_build_object('changed',true,'version',e.classification_version+1,
    'before',jsonb_build_object('designationId',e.designation_id,'gradeId',e.grade_id,'costCenterId',e.cost_center_id));
END $$;

GRANT SELECT(id,tenant_id,entity_id,status,designation_id,grade_id,cost_center_id,classification_version)
  ON employee TO anvione_org_classifier;
GRANT UPDATE(designation_id,grade_id,cost_center_id,classification_version) ON employee TO anvione_org_classifier;
CREATE POLICY org_classifier_emp_read ON employee FOR SELECT TO anvione_org_classifier USING(true);
CREATE POLICY org_classifier_emp_update ON employee FOR UPDATE TO anvione_org_classifier USING(true) WITH CHECK(true);
-- FOR SHARE needs an UPDATE privilege and policy; WITH CHECK(false) keeps units read-only.
GRANT SELECT(id,tenant_id,entity_id,kind,active,merged_into_id,effective_from,effective_to) ON org_unit TO anvione_org_classifier;
GRANT UPDATE(id) ON org_unit TO anvione_org_classifier;
CREATE POLICY org_classifier_unit_read ON org_unit FOR SELECT TO anvione_org_classifier USING(true);
CREATE POLICY org_classifier_unit_lock ON org_unit FOR UPDATE TO anvione_org_classifier USING(true) WITH CHECK(false);
GRANT EXECUTE ON FUNCTION org_entity_today(uuid,uuid) TO anvione_org_classifier;
ALTER FUNCTION classify_employee(uuid,uuid,uuid,uuid) OWNER TO anvione_org_classifier;
REVOKE ALL ON FUNCTION classify_employee(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classify_employee(uuid,uuid,uuid,uuid) TO anvione_app;

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
 'employee.classified.v1'
));
