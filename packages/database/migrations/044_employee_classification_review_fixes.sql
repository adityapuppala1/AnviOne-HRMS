-- Review fixes for 043 (043 stays as applied):
-- * classify_employee takes the expected classification_version (lost-update guard, OG001).
-- * The owner-path guard also fires under session_replication_role=replica.
DROP FUNCTION classify_employee(uuid,uuid,uuid,uuid);

CREATE FUNCTION classify_employee(p_employee uuid, p_designation uuid, p_grade uuid, p_cost_center uuid, p_version integer)
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
  IF p_version IS NULL OR p_version <> e.classification_version THEN
    RAISE EXCEPTION 'This classification changed. Reload it before saving again' USING ERRCODE='OG001';
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
ALTER FUNCTION classify_employee(uuid,uuid,uuid,uuid,integer) OWNER TO anvione_org_classifier;
REVOKE ALL ON FUNCTION classify_employee(uuid,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classify_employee(uuid,uuid,uuid,uuid,integer) TO anvione_app;

ALTER TABLE employee ENABLE ALWAYS TRIGGER employee_classification_guard;
