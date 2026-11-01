-- ORG-02 review fixes: merges leave no live reference on the source, both versions
-- are mandatory, the moved count separates current from former employees, candidate
-- checks lock the unit, and the app may read only its own entity's business date.

-- The runtime login may only ask about its own tenant and entity; guard triggers
-- reached through the merge run inside that same context, so they still resolve.
CREATE OR REPLACE FUNCTION org_entity_today(p_tenant uuid, p_entity uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT (now() AT TIME ZONE le.timezone)::date FROM public.legal_entity le
  WHERE le.tenant_id=p_tenant AND le.id=p_entity
    AND (session_user <> 'anvione_app'
      OR (p_tenant=nullif(current_setting('app.tenant_id',true),'')::uuid
        AND p_entity=nullif(current_setting('app.entity_id',true),'')::uuid));
$$;

CREATE OR REPLACE FUNCTION guard_candidate_assignments() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE today date; found_count integer;
BEGIN
  IF TG_OP='INSERT' OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    today := public.org_entity_today(NEW.tenant_id,NEW.entity_id);
    SELECT count(*) INTO found_count FROM (
      SELECT id FROM public.org_unit WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
        AND id IN (NEW.department_id,NEW.location_id) AND active AND merged_into_id IS NULL
        AND effective_from<=today AND (effective_to IS NULL OR effective_to>=today) FOR SHARE) u;
    IF found_count <> 2 THEN
      RAISE EXCEPTION 'Candidates can be assigned only to departments and locations in effect' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION merge_org_units(p_source uuid, p_target uuid, p_version integer, p_target_version integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  tenant uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
  entity uuid := nullif(current_setting('app.entity_id',true),'')::uuid;
  s public.org_unit;
  t public.org_unit;
  today date;
  moved_active integer;
  moved_inactive integer;
  candidates integer;
  policies integer := 0;
  holidays integer := 0;
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
  IF p_version IS NULL OR p_target_version IS NULL
     OR s.version IS DISTINCT FROM p_version OR t.version IS DISTINCT FROM p_target_version THEN
    RAISE EXCEPTION 'One of these records changed. Reload them before merging again' USING ERRCODE='OG001';
  END IF;
  IF s.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'This record was already merged' USING ERRCODE='OG004';
  END IF;
  today := public.org_entity_today(tenant,entity);
  IF NOT (t.active AND t.merged_into_id IS NULL AND t.effective_from<=today
          AND (t.effective_to IS NULL OR t.effective_to>=today)) THEN
    RAISE EXCEPTION 'Merge into a record that is in effect today' USING ERRCODE='OG002';
  END IF;
  -- Policies and holidays carry their own meaning; HR re-targets them deliberately.
  IF s.kind='department' THEN
    SELECT count(*) INTO policies FROM public.policy_version
      WHERE tenant_id=tenant AND entity_id=entity AND audience_department_id=s.id
        AND status IN ('draft','published');
  ELSE
    SELECT count(*) INTO holidays FROM public.holiday
      WHERE tenant_id=tenant AND entity_id=entity AND location_id=s.id AND active;
  END IF;
  IF policies>0 OR holidays>0 THEN
    RAISE EXCEPTION 'Move % draft or published policy version(s) and % active holiday(s) off this record before merging',
      policies, holidays USING ERRCODE='OG002';
  END IF;
  -- Former employees move too: nothing should keep pointing at a closed record.
  IF s.kind='department' THEN
    SELECT count(*) FILTER (WHERE status IN ('active','notice')), count(*) FILTER (WHERE status NOT IN ('active','notice'))
      INTO moved_active, moved_inactive FROM public.employee
      WHERE tenant_id=tenant AND entity_id=entity AND department_id=s.id;
    UPDATE public.employee SET department_id=t.id
      WHERE tenant_id=tenant AND entity_id=entity AND department_id=s.id;
    UPDATE public.candidate_case SET department_id=t.id, version=version+1
      WHERE tenant_id=tenant AND entity_id=entity AND department_id=s.id
        AND state NOT IN ('approved','cancelled');
  ELSE
    SELECT count(*) FILTER (WHERE status IN ('active','notice')), count(*) FILTER (WHERE status NOT IN ('active','notice'))
      INTO moved_active, moved_inactive FROM public.employee
      WHERE tenant_id=tenant AND entity_id=entity AND location_id=s.id;
    UPDATE public.employee SET location_id=t.id
      WHERE tenant_id=tenant AND entity_id=entity AND location_id=s.id;
    UPDATE public.candidate_case SET location_id=t.id, version=version+1
      WHERE tenant_id=tenant AND entity_id=entity AND location_id=s.id
        AND state NOT IN ('approved','cancelled');
  END IF;
  GET DIAGNOSTICS candidates = ROW_COUNT;
  UPDATE public.org_unit SET active=false,
    effective_from=least(effective_from,today),
    effective_to=least(coalesce(effective_to,today),today),
    merged_into_id=t.id, merged_at=now(), version=version+1
  WHERE id=s.id;
  RETURN jsonb_build_object('moved',moved_active+moved_inactive,'movedActive',moved_active,
    'movedInactive',moved_inactive,'movedCandidates',candidates,'kind',s.kind,'version',s.version+1);
END $$;

GRANT SELECT(id,tenant_id,entity_id,department_id,location_id,state,version) ON candidate_case TO anvione_org_merger;
GRANT UPDATE(department_id,location_id,version) ON candidate_case TO anvione_org_merger;
GRANT SELECT(status) ON employee TO anvione_org_merger;
GRANT SELECT(tenant_id,entity_id,audience_department_id,status) ON policy_version TO anvione_org_merger;
GRANT SELECT(tenant_id,entity_id,location_id,active) ON holiday TO anvione_org_merger;
CREATE POLICY org_merger_candidate_read ON candidate_case FOR SELECT TO anvione_org_merger USING(true);
CREATE POLICY org_merger_candidate_update ON candidate_case FOR UPDATE TO anvione_org_merger USING(true) WITH CHECK(true);
CREATE POLICY org_merger_policy_read ON policy_version FOR SELECT TO anvione_org_merger USING(true);
CREATE POLICY org_merger_holiday_read ON holiday FOR SELECT TO anvione_org_merger USING(true);
