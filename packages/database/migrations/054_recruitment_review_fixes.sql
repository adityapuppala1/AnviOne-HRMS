-- REC-01 review fixes.
-- * Generated *_kind columns are not yet computed in a BEFORE trigger (NEW holds NULL), so the
--   requisition and offer guards compared them as changed and refused every update. They are
--   now left out of the "nothing else changed" comparison (they are constants anyway).
CREATE OR REPLACE FUNCTION guard_job_requisition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.recruit_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Manager');
 today date := org_entity_today(NEW.tenant_id,NEW.entity_id);
 managed text[] := ARRAY['title','department_id','location_id','designation_id','headcount','employment_type',
  'hiring_manager_id','hiring_manager_name','description','target_start','status','status_note',
  'approved_by_employee','approved_by_label','approved_at','closed_at','version','updated_by_label','updated_at',
  'department_kind','location_kind','designation_kind'];
 details text[] := ARRAY['title','department_id','location_id','designation_id','headcount','employment_type',
  'hiring_manager_id','description','target_start'];
 next_no integer;
 hired integer;
 who text;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This requisition belongs to another organization' USING ERRCODE='RC005';
 END IF;
 IF me IS NULL OR scope NOT IN ('team','entity') OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Only hiring managers and HR raise requisitions' USING ERRCODE='RC005';
 END IF;
 IF today IS NULL THEN
  RAISE EXCEPTION 'The organization''s current date is unavailable' USING ERRCODE='RC003';
 END IF;
 IF TG_OP='INSERT' THEN
  IF scope='team' AND NEW.hiring_manager_id IS DISTINCT FROM me THEN
   RAISE EXCEPTION 'Managers raise requisitions for their own team; HR can name another hiring manager' USING ERRCODE='RC005';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('recruit-req-code:'||NEW.tenant_id::text||':'||NEW.entity_id::text,0));
  SELECT coalesce(max(substr(r.code,5)::integer),0)+1 INTO next_no FROM job_requisition r
  WHERE r.tenant_id=NEW.tenant_id AND r.entity_id=NEW.entity_id;
  IF next_no>999999 THEN
   RAISE EXCEPTION 'Requisition numbers are exhausted for this entity' USING ERRCODE='RC004';
  END IF;
  NEW.code := 'REQ-'||lpad(next_no::text,6,'0');
  NEW.status := 'draft';
  NEW.status_note := NULL;
  NEW.requested_by_employee := me;
  NEW.approved_by_employee := NULL;
  NEW.approved_by_label := NULL;
  NEW.approved_at := NULL;
  NEW.closed_at := NULL;
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('recruit-req:'||OLD.id::text,0));
  IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'A requisition changes only through its own actions and its code never changes' USING ERRCODE='RC004';
  END IF;
  IF NOT (scope='entity' OR OLD.hiring_manager_id=me OR OLD.requested_by_employee=me) THEN
   RAISE EXCEPTION 'Only the hiring manager, the requester or HR can change this requisition' USING ERRCODE='RC005';
  END IF;
  NEW.approved_by_employee := OLD.approved_by_employee;
  NEW.approved_by_label := OLD.approved_by_label;
  NEW.approved_at := OLD.approved_at;
  NEW.closed_at := OLD.closed_at;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF (SELECT jsonb_object_agg(k,to_jsonb(NEW)->k) FROM unnest(details) k)
     IS DISTINCT FROM (SELECT jsonb_object_agg(k,to_jsonb(OLD)->k) FROM unnest(details) k) THEN
    RAISE EXCEPTION 'Change the details and the status in separate steps' USING ERRCODE='RC004';
   END IF;
   IF (OLD.status='draft' AND NEW.status IN ('pending_approval','cancelled'))
     OR (OLD.status='pending_approval' AND NEW.status='cancelled') THEN
    NULL; -- requester, hiring manager or HR (checked above)
   ELSIF OLD.status='pending_approval' AND NEW.status IN ('approved','rejected') THEN
    IF scope<>'entity' OR me=OLD.requested_by_employee OR me=OLD.hiring_manager_id THEN
     RAISE EXCEPTION 'Someone in HR other than the requester or hiring manager must decide this requisition' USING ERRCODE='RC005';
    END IF;
    IF NEW.status='approved' THEN
     NEW.approved_by_employee := me;
     NEW.approved_by_label := label;
     NEW.approved_at := now();
    END IF;
   ELSIF (OLD.status='approved' AND NEW.status IN ('open','cancelled'))
     OR (OLD.status='open' AND NEW.status IN ('on_hold','closed'))
     OR (OLD.status='on_hold' AND NEW.status IN ('open','closed')) THEN
    IF scope<>'entity' THEN
     RAISE EXCEPTION 'Only HR opens, holds, closes or cancels an approved requisition' USING ERRCODE='RC005';
    END IF;
   ELSE
    RAISE EXCEPTION 'A requisition cannot move from % to %', OLD.status, NEW.status USING ERRCODE='RC004';
   END IF;
   IF NEW.status IN ('closed','rejected') AND (NEW.status_note IS NULL OR char_length(btrim(NEW.status_note))<3) THEN
    RAISE EXCEPTION 'Say why the requisition is %', NEW.status USING ERRCODE='RC003';
   END IF;
   IF NEW.status='closed' THEN
    NEW.closed_at := now();
   END IF;
  ELSE
   NEW.status_note := OLD.status_note;
   IF NOT (OLD.status='draft' OR (scope='entity' AND OLD.status IN ('approved','open','on_hold'))) THEN
    RAISE EXCEPTION 'A requisition is edited as a draft; HR may adjust an approved or open one' USING ERRCODE='RC004';
   END IF;
   IF NEW.hiring_manager_id IS DISTINCT FROM OLD.hiring_manager_id AND scope<>'entity' THEN
    RAISE EXCEPTION 'Only HR can name another hiring manager' USING ERRCODE='RC005';
   END IF;
   SELECT count(*) INTO hired FROM recruit_application a WHERE a.requisition_id=OLD.id AND a.stage='hired';
   IF NEW.headcount<hired THEN
    RAISE EXCEPTION 'Headcount cannot drop below the % already hired', hired USING ERRCODE='RC003';
   END IF;
  END IF;
 END IF;
 IF (TG_OP='INSERT' OR NEW.department_id IS DISTINCT FROM OLD.department_id)
   AND NOT recruit_unit_in_effect(NEW.tenant_id,NEW.entity_id,'department',NEW.department_id) THEN
  RAISE EXCEPTION 'Choose a department in effect in this entity' USING ERRCODE='RC003';
 END IF;
 IF (TG_OP='INSERT' OR NEW.location_id IS DISTINCT FROM OLD.location_id)
   AND NOT recruit_unit_in_effect(NEW.tenant_id,NEW.entity_id,'location',NEW.location_id) THEN
  RAISE EXCEPTION 'Choose a location in effect in this entity' USING ERRCODE='RC003';
 END IF;
 IF NEW.designation_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.designation_id IS DISTINCT FROM OLD.designation_id)
   AND NOT recruit_unit_in_effect(NEW.tenant_id,NEW.entity_id,'designation',NEW.designation_id) THEN
  RAISE EXCEPTION 'Choose a designation in effect in this entity' USING ERRCODE='RC003';
 END IF;
 IF TG_OP='INSERT' OR NEW.hiring_manager_id IS DISTINCT FROM OLD.hiring_manager_id THEN
  who := recruit_employee_name(NEW.tenant_id,NEW.entity_id,NEW.hiring_manager_id);
  IF who IS NULL OR NOT EXISTS(SELECT 1 FROM identity_binding b WHERE b.tenant_id=NEW.tenant_id
    AND b.entity_id=NEW.entity_id AND b.employee_id=NEW.hiring_manager_id AND b.active
    AND b.roles && ARRAY['manager','hr_admin']) THEN
   RAISE EXCEPTION 'The hiring manager must be a current manager or HR' USING ERRCODE='RC003';
  END IF;
  NEW.hiring_manager_name := who;
 ELSE
  NEW.hiring_manager_name := OLD.hiring_manager_name;
 END IF;
 IF NEW.target_start IS NOT NULL AND (TG_OP='INSERT' OR NEW.target_start IS DISTINCT FROM OLD.target_start)
   AND NEW.target_start<today THEN
  RAISE EXCEPTION 'The target start date cannot be in the past' USING ERRCODE='RC003';
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION guard_recruit_offer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.recruit_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 today date := org_entity_today(NEW.tenant_id,NEW.entity_id);
 managed text[] := ARRAY['status','status_note','approved_by_employee','approved_by_label','approved_at','sent_at',
  'responded_on','candidate_case_id','version','updated_by_label','updated_at',
  'department_kind','location_kind','designation_kind'];
 app record;
 who text;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid
   OR me IS NULL OR scope<>'entity' OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Only HR makes offers' USING ERRCODE='RC005';
 END IF;
 IF today IS NULL THEN
  RAISE EXCEPTION 'The organization''s current date is unavailable' USING ERRCODE='RC003';
 END IF;
 IF TG_OP='INSERT' THEN
  SELECT a.requisition_id, a.candidate_id, a.stage, r.status AS req_status, r.title, r.department_id, r.location_id,
   r.designation_id, r.hiring_manager_id INTO app
  FROM recruit_application a JOIN job_requisition r ON r.id=a.requisition_id
  WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id AND a.id=NEW.application_id;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'This application is unavailable' USING ERRCODE='RC003';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('recruit-req:'||app.requisition_id::text,0));
  IF app.stage NOT IN ('interview','assessment') THEN
   RAISE EXCEPTION 'Offers are made to applications in the interview or assessment stage' USING ERRCODE='RC004';
  END IF;
  IF app.req_status<>'open' THEN
   RAISE EXCEPTION 'The requisition is not open' USING ERRCODE='RC004';
  END IF;
  NEW.requisition_id := app.requisition_id;
  NEW.candidate_id := app.candidate_id;
  NEW.title := app.title;
  NEW.department_id := coalesce(NEW.department_id,app.department_id);
  NEW.location_id := coalesce(NEW.location_id,app.location_id);
  NEW.designation_id := coalesce(NEW.designation_id,app.designation_id);
  NEW.manager_id := coalesce(NEW.manager_id,app.hiring_manager_id);
  IF NOT recruit_unit_in_effect(NEW.tenant_id,NEW.entity_id,'department',NEW.department_id)
    OR NOT recruit_unit_in_effect(NEW.tenant_id,NEW.entity_id,'location',NEW.location_id)
    OR (NEW.designation_id IS NOT NULL AND NOT recruit_unit_in_effect(NEW.tenant_id,NEW.entity_id,'designation',NEW.designation_id)) THEN
   RAISE EXCEPTION 'Choose a department, location and designation in effect in this entity' USING ERRCODE='RC003';
  END IF;
  who := recruit_employee_name(NEW.tenant_id,NEW.entity_id,NEW.manager_id);
  IF who IS NULL THEN
   RAISE EXCEPTION 'The reporting manager must be a current employee' USING ERRCODE='RC003';
  END IF;
  NEW.manager_name := who;
  IF NEW.proposed_joining_date IS NULL OR NEW.proposed_joining_date<today THEN
   RAISE EXCEPTION 'The joining date cannot be in the past' USING ERRCODE='RC003';
  END IF;
  NEW.status := 'draft';
  NEW.status_note := NULL;
  NEW.created_by_employee := me;
  NEW.approved_by_employee := NULL;
  NEW.approved_by_label := NULL;
  NEW.approved_at := NULL;
  NEW.sent_at := NULL;
  NEW.responded_on := NULL;
  NEW.candidate_case_id := NULL;
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('recruit-req:'||OLD.requisition_id::text,0));
  IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'An offer changes only through its own actions' USING ERRCODE='RC004';
  END IF;
  NEW.approved_by_employee := OLD.approved_by_employee;
  NEW.approved_by_label := OLD.approved_by_label;
  NEW.approved_at := OLD.approved_at;
  NEW.sent_at := OLD.sent_at;
  IF NEW.candidate_case_id IS DISTINCT FROM OLD.candidate_case_id AND NEW.status<>'accepted' THEN
   RAISE EXCEPTION 'A pre-boarding record is linked only when the offer is accepted' USING ERRCODE='RC004';
  END IF;
  IF NEW.status NOT IN ('accepted','declined','expired') THEN
   NEW.responded_on := OLD.responded_on;
  END IF;
  IF OLD.status='draft' AND NEW.status='pending_approval' THEN
   NULL;
  ELSIF OLD.status='pending_approval' AND NEW.status IN ('approved','draft') THEN
   IF NEW.status='approved' THEN
    IF me=OLD.created_by_employee THEN
     RAISE EXCEPTION 'Another HR person must approve this offer' USING ERRCODE='RC005';
    END IF;
    NEW.approved_by_employee := me;
    NEW.approved_by_label := label;
    NEW.approved_at := now();
   END IF;
  ELSIF OLD.status='approved' AND NEW.status='sent' THEN
   NEW.sent_at := now();
  ELSIF OLD.status='sent' AND NEW.status IN ('accepted','declined','expired') THEN
   IF NEW.responded_on IS NULL OR NEW.responded_on>today OR NEW.responded_on<OLD.sent_at::date-1 THEN
    RAISE EXCEPTION 'The response date must be between the date it was sent and today' USING ERRCODE='RC003';
   END IF;
   IF NEW.status='accepted' AND (NEW.candidate_case_id IS NULL OR NOT EXISTS(SELECT 1 FROM candidate_case c
     WHERE c.tenant_id=NEW.tenant_id AND c.entity_id=NEW.entity_id AND c.id=NEW.candidate_case_id)) THEN
    RAISE EXCEPTION 'An accepted offer needs its pre-boarding record' USING ERRCODE='RC003';
   END IF;
  ELSIF OLD.status IN ('draft','pending_approval','approved','sent') AND NEW.status='withdrawn' THEN
   IF NEW.status_note IS NULL OR char_length(btrim(NEW.status_note))<3 THEN
    RAISE EXCEPTION 'Say why the offer is withdrawn' USING ERRCODE='RC003';
   END IF;
  ELSE
   RAISE EXCEPTION 'An offer cannot move from % to %', OLD.status, NEW.status USING ERRCODE='RC004';
  END IF;
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

