-- ORG-02: more masters (designation, grade, cost centre), effective windows on every
-- master, and a safe merge of departments or locations.
-- Employees can still be assigned only to departments and locations; the employee
-- foreign keys pin those kinds through generated columns and stay unchanged.
CREATE ROLE anvione_org_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE anvione_org_merger NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_org_keeper, anvione_org_merger;

DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.org_unit'::regclass
    AND contype='c' AND pg_get_constraintdef(oid) LIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.org_unit DROP CONSTRAINT %I',c);
  END LOOP;
END $$;
ALTER TABLE org_unit ADD CONSTRAINT org_unit_kind_check
  CHECK (kind IN ('department','location','designation','grade','cost_center'));

-- The business date of an entity, for callers that name the entity explicitly
-- (row triggers). leave_entity_today() remains the session-scoped variant.
CREATE FUNCTION org_entity_today(p_tenant uuid, p_entity uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT (now() AT TIME ZONE le.timezone)::date FROM public.legal_entity le
  WHERE le.tenant_id=p_tenant AND le.id=p_entity;
$$;
GRANT SELECT(tenant_id,id,timezone) ON legal_entity TO anvione_org_keeper;
ALTER FUNCTION org_entity_today(uuid,uuid) OWNER TO anvione_org_keeper;
REVOKE ALL ON FUNCTION org_entity_today(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org_entity_today(uuid,uuid) TO anvione_app, anvione_org_merger;

ALTER TABLE org_unit ADD COLUMN effective_from date;
ALTER TABLE org_unit ADD COLUMN effective_to date;
ALTER TABLE org_unit ADD COLUMN merged_into_id uuid;
ALTER TABLE org_unit ADD COLUMN merged_at timestamptz;
-- Backfill is not an HR edit: existing masters keep their version.
ALTER TABLE org_unit DISABLE TRIGGER org_unit_update_guard;
UPDATE org_unit u SET effective_from=(u.created_at AT TIME ZONE le.timezone)::date
FROM legal_entity le WHERE le.tenant_id=u.tenant_id AND le.id=u.entity_id;
ALTER TABLE org_unit ENABLE TRIGGER org_unit_update_guard;
ALTER TABLE org_unit ALTER COLUMN effective_from SET NOT NULL;
ALTER TABLE org_unit ADD CONSTRAINT org_unit_window_check
  CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE org_unit ADD CONSTRAINT org_unit_merge_shape_check CHECK (
  (merged_into_id IS NULL) = (merged_at IS NULL)
  AND (merged_into_id IS NULL OR (merged_into_id <> id AND NOT active
    AND effective_to IS NOT NULL AND kind IN ('department','location')))
);
ALTER TABLE org_unit ADD CONSTRAINT org_unit_merged_into_fk
  FOREIGN KEY (tenant_id,entity_id,kind,merged_into_id) REFERENCES org_unit(tenant_id,entity_id,kind,id);
CREATE INDEX org_unit_merged_into_idx ON org_unit(tenant_id,entity_id,merged_into_id)
  WHERE merged_into_id IS NOT NULL;

-- A new master starts today (entity time) unless HR says otherwise.
CREATE FUNCTION default_org_unit_window() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.effective_from IS NULL THEN
    NEW.effective_from := public.org_entity_today(NEW.tenant_id,NEW.entity_id);
  END IF;
  IF NEW.merged_into_id IS NOT NULL OR NEW.merged_at IS NOT NULL THEN
    RAISE EXCEPTION 'A new master cannot start as merged' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER org_unit_window_default BEFORE INSERT ON org_unit
FOR EACH ROW EXECUTE FUNCTION default_org_unit_window();

-- Identity stays immutable, every update increments version, and a merged master is
-- closed for good: its merge link, window and state never change again.
CREATE OR REPLACE FUNCTION guard_org_unit_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (NEW.id,NEW.tenant_id,NEW.entity_id,NEW.kind,NEW.code,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.entity_id,OLD.kind,OLD.code,OLD.created_at)
      OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Organization identity is immutable and updates must increment version' USING ERRCODE='23514';
  END IF;
  IF OLD.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'This record was merged into another and can no longer change' USING ERRCODE='OG004';
  END IF;
  IF NEW.merged_into_id IS NOT NULL AND current_user <> 'anvione_org_merger' THEN
    RAISE EXCEPTION 'Only a merge can record a merge' USING ERRCODE='OG005';
  END IF;
  NEW.updated_at=now();
  RETURN NEW;
END;
$$;

-- "In effect" = active, not merged, and the entity's today inside the inclusive window.
CREATE OR REPLACE FUNCTION guard_employment_assignments() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE today date;
BEGIN
  IF TG_OP='INSERT' OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    today := public.org_entity_today(NEW.tenant_id,NEW.entity_id);
  END IF;
  IF TG_OP='INSERT' OR NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    PERFORM id FROM public.org_unit WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
      AND id=NEW.department_id AND kind='department' AND active AND merged_into_id IS NULL
      AND effective_from<=today AND (effective_to IS NULL OR effective_to>=today) FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'New department assignments require a department in effect in this entity' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='INSERT' OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    PERFORM id FROM public.org_unit WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
      AND id=NEW.location_id AND kind='location' AND active AND merged_into_id IS NULL
      AND effective_from<=today AND (effective_to IS NULL OR effective_to>=today) FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'New location assignments require a location in effect in this entity' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Offers to new joiners name the same masters they will be employed under.
CREATE FUNCTION guard_candidate_assignments() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE today date;
BEGIN
  IF TG_OP='INSERT' OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    today := public.org_entity_today(NEW.tenant_id,NEW.entity_id);
    IF (SELECT count(*) FROM public.org_unit WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
        AND id IN (NEW.department_id,NEW.location_id) AND active AND merged_into_id IS NULL
        AND effective_from<=today AND (effective_to IS NULL OR effective_to>=today)) <> 2 THEN
      RAISE EXCEPTION 'Candidates can be assigned only to departments and locations in effect' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER candidate_assignment_guard BEFORE INSERT OR UPDATE OF department_id,location_id ON candidate_case
FOR EACH ROW EXECUTE FUNCTION guard_candidate_assignments();

-- Merge: one transaction moves every employee from source to target and closes the
-- source. Advisory locks are taken in id order so opposite merges cannot deadlock;
-- row locks then serialize against assignments (which take FOR SHARE on the unit).
CREATE FUNCTION merge_org_units(p_source uuid, p_target uuid, p_version integer, p_target_version integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  tenant uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
  entity uuid := nullif(current_setting('app.entity_id',true),'')::uuid;
  s public.org_unit;
  t public.org_unit;
  today date;
  moved integer;
BEGIN
  IF tenant IS NULL OR entity IS NULL OR current_setting('app.hr_scope',true) IS DISTINCT FROM 'write' THEN
    RAISE EXCEPTION 'Only HR can merge organization records' USING ERRCODE='OG005';
  END IF;
  IF p_source=p_target THEN
    RAISE EXCEPTION 'Choose a different record to merge into' USING ERRCODE='OG002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('org_unit:'||least(p_source,p_target)::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('org_unit:'||greatest(p_source,p_target)::text,0));
  PERFORM 1 FROM public.org_unit WHERE id IN (p_source,p_target) AND tenant_id=tenant AND entity_id=entity
    ORDER BY id FOR UPDATE;
  SELECT * INTO s FROM public.org_unit WHERE id=p_source AND tenant_id=tenant AND entity_id=entity;
  SELECT * INTO t FROM public.org_unit WHERE id=p_target AND tenant_id=tenant AND entity_id=entity;
  IF s.id IS NULL OR t.id IS NULL THEN
    RAISE EXCEPTION 'This organization record is unavailable' USING ERRCODE='OG003';
  END IF;
  IF s.kind NOT IN ('department','location') THEN
    RAISE EXCEPTION 'Only departments and locations can be merged' USING ERRCODE='OG002';
  END IF;
  IF s.kind<>t.kind THEN
    RAISE EXCEPTION 'Both records must be the same kind' USING ERRCODE='OG002';
  END IF;
  IF s.version<>p_version OR (p_target_version IS NOT NULL AND t.version<>p_target_version) THEN
    RAISE EXCEPTION 'This record changed. Reload it before merging again' USING ERRCODE='OG001';
  END IF;
  IF s.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'This record was already merged' USING ERRCODE='OG004';
  END IF;
  today := public.org_entity_today(tenant,entity);
  IF NOT (t.active AND t.merged_into_id IS NULL AND t.effective_from<=today
          AND (t.effective_to IS NULL OR t.effective_to>=today)) THEN
    RAISE EXCEPTION 'Merge into a record that is in effect today' USING ERRCODE='OG002';
  END IF;
  IF s.kind='department' THEN
    UPDATE public.employee SET department_id=t.id
      WHERE tenant_id=tenant AND entity_id=entity AND department_id=s.id;
  ELSE
    UPDATE public.employee SET location_id=t.id
      WHERE tenant_id=tenant AND entity_id=entity AND location_id=s.id;
  END IF;
  GET DIAGNOSTICS moved = ROW_COUNT;
  UPDATE public.org_unit SET active=false,
    effective_from=least(effective_from,today),
    effective_to=least(coalesce(effective_to,today),today),
    merged_into_id=t.id, merged_at=now(), version=version+1
  WHERE id=s.id;
  RETURN jsonb_build_object('moved',moved,'kind',s.kind,'version',s.version+1);
END $$;

-- The merger is the only role that may rewrite employee department/location or
-- record a merge link; it reads nothing beyond what the merge needs.
GRANT SELECT(id,tenant_id,entity_id,department_id,location_id) ON employee TO anvione_org_merger;
GRANT UPDATE(department_id,location_id) ON employee TO anvione_org_merger;
GRANT SELECT ON org_unit TO anvione_org_merger;
GRANT UPDATE(active,effective_from,effective_to,merged_into_id,merged_at,version) ON org_unit TO anvione_org_merger;
CREATE POLICY org_merger_emp_read ON employee FOR SELECT TO anvione_org_merger USING(true);
CREATE POLICY org_merger_emp_update ON employee FOR UPDATE TO anvione_org_merger USING(true) WITH CHECK(true);
CREATE POLICY org_merger_unit_read ON org_unit FOR SELECT TO anvione_org_merger USING(true);
CREATE POLICY org_merger_unit_update ON org_unit FOR UPDATE TO anvione_org_merger USING(true) WITH CHECK(true);
ALTER FUNCTION merge_org_units(uuid,uuid,integer,integer) OWNER TO anvione_org_merger;
REVOKE ALL ON FUNCTION merge_org_units(uuid,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merge_org_units(uuid,uuid,integer,integer) TO anvione_app;
REVOKE ALL ON FUNCTION default_org_unit_window(),guard_candidate_assignments() FROM PUBLIC;

-- HR sets the window directly; the merge link is never an app column.
GRANT INSERT(effective_from,effective_to) ON org_unit TO anvione_app;
GRANT UPDATE(effective_from,effective_to) ON org_unit TO anvione_app;

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
 'profile.change_withdrawn.v1','profile.change_applied.v1','profile.change_cancelled.v1'
));
