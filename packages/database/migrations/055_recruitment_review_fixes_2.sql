-- REC-01 review fixes (second round).
-- * A material change to an approved, open or held requisition (more headcount, another
--   hiring manager, title, department, location or employment type) sends it back to
--   pending_approval; whoever made the change cannot approve it (nor the requester or the
--   hiring manager). Approval clears the marker; HR then reopens it.
-- * Offer approval is also refused to the offer's reporting manager and the requisition's
--   hiring manager. Sending and accepting need an open requisition; accepting re-checks that
--   the joining date has not passed.
-- * Candidates: consent can be withdrawn (HR, reason of 10+ characters), which blocks new
--   applications and interviews and makes the record eligible for anonymisation at once.
--   recruit_anonymise_candidate (writer role) irreversibly clears name, sealed contact
--   details, the email hash, notes, company and referrer, and the name copies on
--   applications and interviews; ids, stage history and aggregates stay. It is refused while
--   an application is open or when the candidate was hired (their record lives in Onboarding).
-- * The email hash records the key id it was made with (hash_key_id). Existing rows are
--   backfilled with 0, the key the API used until now (the oldest key in the local ring);
--   `pnpm recruit:rehash` moves rows to the configured key through recruit_rehash_candidate.
-- * Reopening an application whose previous stage was offer goes to assessment (or to offer
--   only with an open offer).
-- * The guard and delete-blocking triggers on recruitment tables fire ALWAYS, including in
--   replica sessions.
ALTER TABLE ats_candidate ADD COLUMN consent_withdrawn_at timestamptz;
ALTER TABLE ats_candidate ADD COLUMN consent_withdrawal_reason text
 CHECK(consent_withdrawal_reason IS NULL OR char_length(btrim(consent_withdrawal_reason)) BETWEEN 10 AND 500);
ALTER TABLE ats_candidate ADD COLUMN anonymised_at timestamptz;
ALTER TABLE ats_candidate ADD COLUMN anonymised_reason text
 CHECK(anonymised_reason IS NULL OR char_length(btrim(anonymised_reason)) BETWEEN 10 AND 500);
ALTER TABLE ats_candidate ADD COLUMN hash_key_id integer CHECK(hash_key_id BETWEEN 0 AND 255);
UPDATE ats_candidate SET hash_key_id=0 WHERE email_hash IS NOT NULL;
ALTER TABLE ats_candidate ALTER COLUMN email_sealed DROP NOT NULL;
ALTER TABLE ats_candidate ALTER COLUMN email_hash DROP NOT NULL;
ALTER TABLE ats_candidate DROP CONSTRAINT ats_candidate_check;
ALTER TABLE ats_candidate ADD CONSTRAINT ats_candidate_referral_check
 CHECK(source<>'referral' OR referrer_employee_id IS NOT NULL OR anonymised_at IS NOT NULL);
ALTER TABLE ats_candidate ADD CONSTRAINT ats_candidate_contact_check
 CHECK(anonymised_at IS NOT NULL OR (email_sealed IS NOT NULL AND email_hash IS NOT NULL));
ALTER TABLE ats_candidate ADD CONSTRAINT ats_candidate_hash_key_check
 CHECK((email_hash IS NULL)=(hash_key_id IS NULL));
ALTER TABLE ats_candidate ADD CONSTRAINT ats_candidate_anonymised_check
 CHECK(anonymised_at IS NULL OR (email_sealed IS NULL AND phone_sealed IS NULL AND email_hash IS NULL
  AND notes IS NULL AND current_company IS NULL AND referrer_employee_id IS NULL));
ALTER TABLE job_requisition ADD COLUMN reapproval_requested_by uuid;


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
  'department_kind','location_kind','designation_kind','reapproval_requested_by'];
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
  NEW.reapproval_requested_by := NULL;
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
  NEW.reapproval_requested_by := OLD.reapproval_requested_by;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF (SELECT jsonb_object_agg(k,to_jsonb(NEW)->k) FROM unnest(details) k)
     IS DISTINCT FROM (SELECT jsonb_object_agg(k,to_jsonb(OLD)->k) FROM unnest(details) k) THEN
    RAISE EXCEPTION 'Change the details and the status in separate steps' USING ERRCODE='RC004';
   END IF;
   IF (OLD.status='draft' AND NEW.status IN ('pending_approval','cancelled'))
     OR (OLD.status='pending_approval' AND NEW.status='cancelled') THEN
    NULL; -- requester, hiring manager or HR (checked above)
   ELSIF OLD.status='pending_approval' AND NEW.status IN ('approved','rejected') THEN
    IF scope<>'entity' OR me=OLD.requested_by_employee OR me=OLD.hiring_manager_id
      OR me IS NOT DISTINCT FROM OLD.reapproval_requested_by THEN
     RAISE EXCEPTION 'Someone in HR other than the requester or hiring manager must decide this requisition' USING ERRCODE='RC005';
    END IF;
    IF NEW.status='approved' THEN
     NEW.approved_by_employee := me;
     NEW.approved_by_label := label;
     NEW.approved_at := now();
     NEW.reapproval_requested_by := NULL;
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
   -- A material change to an approved requisition needs a fresh approval by someone else.
   IF OLD.status IN ('approved','open','on_hold') AND (NEW.headcount>OLD.headcount
     OR (NEW.hiring_manager_id,NEW.title,NEW.department_id,NEW.location_id,NEW.employment_type)
      IS DISTINCT FROM (OLD.hiring_manager_id,OLD.title,OLD.department_id,OLD.location_id,OLD.employment_type)) THEN
    NEW.status := 'pending_approval';
    NEW.status_note := 'Re-approval needed after a change to an approved requisition';
    NEW.approved_by_employee := NULL;
    NEW.approved_by_label := NULL;
    NEW.approved_at := NULL;
    NEW.reapproval_requested_by := me;
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
  IF NEW.status IN ('sent','accepted') AND NEW.status<>OLD.status
    AND (SELECT r.status FROM job_requisition r WHERE r.id=OLD.requisition_id)<>'open' THEN
   RAISE EXCEPTION 'The requisition is not open' USING ERRCODE='RC004';
  END IF;
  IF NEW.status='accepted' AND OLD.status<>'accepted' AND OLD.proposed_joining_date<today THEN
   RAISE EXCEPTION 'The proposed joining date has passed; withdraw this offer and make a new one' USING ERRCODE='RC003';
  END IF;
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
    IF me=OLD.created_by_employee OR me=OLD.manager_id OR me=(SELECT r.hiring_manager_id FROM job_requisition r WHERE r.id=OLD.requisition_id) THEN
     RAISE EXCEPTION 'Another HR person (not the creator, the reporting manager or the hiring manager) must approve this offer' USING ERRCODE='RC005';
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

CREATE OR REPLACE FUNCTION guard_recruit_application() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.recruit_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 managed text[] := ARRAY['stage','previous_stage','stage_entered_at','stage_reason','rejection_reason',
  'rating_average','scorecard_count','version','updated_by_label','updated_at'];
 req record;
 cand record;
 hr boolean := scope='entity';
 hm boolean;
 o integer;
 n integer;
 offer_status text;
 hired integer;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This application belongs to another organization' USING ERRCODE='RC005';
 END IF;
 IF TG_OP='UPDATE' AND coalesce(current_setting('app.recruit_candidate_op',true),'')='anonymise:'||OLD.candidate_id::text THEN
  IF (to_jsonb(NEW)-ARRAY['candidate_name','candidate_company']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['candidate_name','candidate_company']) THEN
   RAISE EXCEPTION 'Anonymising changes only the copied candidate details' USING ERRCODE='RC004';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NOT hr OR me IS NULL THEN
   RAISE EXCEPTION 'Only HR adds candidates to requisitions' USING ERRCODE='RC005';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('recruit-req:'||NEW.requisition_id::text,0));
  SELECT r.status INTO req FROM job_requisition r
  WHERE r.tenant_id=NEW.tenant_id AND r.entity_id=NEW.entity_id AND r.id=NEW.requisition_id;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'This requisition is unavailable' USING ERRCODE='RC003';
  END IF;
  IF req.status<>'open' THEN
   RAISE EXCEPTION 'Candidates can be added only to an open requisition' USING ERRCODE='RC004';
  END IF;
  SELECT c.name, c.current_company, c.total_experience_months, c.source, c.consent_withdrawn_at, c.anonymised_at INTO cand FROM ats_candidate c
  WHERE c.tenant_id=NEW.tenant_id AND c.entity_id=NEW.entity_id AND c.id=NEW.candidate_id;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'This candidate is unavailable' USING ERRCODE='RC003';
  END IF;
  IF cand.consent_withdrawn_at IS NOT NULL OR cand.anonymised_at IS NOT NULL THEN
   RAISE EXCEPTION 'This candidate has withdrawn consent' USING ERRCODE='RC004';
  END IF;
  NEW.candidate_name := cand.name;
  NEW.candidate_company := cand.current_company;
  NEW.candidate_experience_months := cand.total_experience_months;
  NEW.source := cand.source;
  NEW.stage := 'applied';
  NEW.previous_stage := NULL;
  NEW.stage_entered_at := now();
  NEW.stage_reason := NULL;
  NEW.rejection_reason := NULL;
  NEW.rating_average := NULL;
  NEW.scorecard_count := 0;
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
  NEW.updated_by_label := label;
  NEW.updated_at := now();
  RETURN NEW;
 END IF;

 -- Same lock as requisition changes and hires, so headcount checks see settled rows.
 PERFORM pg_advisory_xact_lock(hashtextextended('recruit-req:'||OLD.requisition_id::text,0));
 IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) THEN
  RAISE EXCEPTION 'An application never moves to another candidate or requisition' USING ERRCODE='RC004';
 END IF;
 -- The rating is always derived from submitted scorecards.
 SELECT round(avg(s.overall),2), count(*) INTO NEW.rating_average, NEW.scorecard_count
 FROM recruit_scorecard s WHERE s.application_id=OLD.id;
 IF NEW.stage IS NOT DISTINCT FROM OLD.stage THEN
  IF NEW.version<>OLD.version
    OR (NEW.previous_stage, NEW.stage_reason, NEW.rejection_reason)
     IS DISTINCT FROM (OLD.previous_stage, OLD.stage_reason, OLD.rejection_reason) THEN
   RAISE EXCEPTION 'An application changes only by moving its stage' USING ERRCODE='RC004';
  END IF;
  NEW.stage_entered_at := OLD.stage_entered_at;
  NEW.updated_by_label := OLD.updated_by_label;
  NEW.updated_at := OLD.updated_at;
  RETURN NEW;
 END IF;
 IF NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'An application changes only through its own actions' USING ERRCODE='RC004';
 END IF;
 SELECT r.status, r.headcount, r.hiring_manager_id INTO req FROM job_requisition r WHERE r.id=OLD.requisition_id;
 hm := scope='team' AND me IS NOT NULL AND req.hiring_manager_id=me;
 IF me IS NULL OR NOT (hr OR hm) THEN
  RAISE EXCEPTION 'Only HR or the hiring manager can move this application' USING ERRCODE='RC005';
 END IF;
 NEW.stage_reason := nullif(btrim(coalesce(NEW.stage_reason,'')),'');
 o := recruit_stage_rank(OLD.stage);
 n := recruit_stage_rank(NEW.stage);
 offer_status := recruit_active_offer(OLD.id);
 IF OLD.stage='hired' THEN
  RAISE EXCEPTION 'A hired application is final' USING ERRCODE='RC004';
 ELSIF NEW.stage IN ('rejected','withdrawn') THEN
  IF OLD.stage IN ('rejected','withdrawn') THEN
   RAISE EXCEPTION 'This application is already closed' USING ERRCODE='RC004';
  END IF;
  IF NEW.stage='withdrawn' AND NOT hr THEN
   RAISE EXCEPTION 'Only HR records a withdrawal' USING ERRCODE='RC005';
  END IF;
  IF NEW.stage='rejected' AND NEW.rejection_reason IS NULL THEN
   RAISE EXCEPTION 'Choose a rejection reason' USING ERRCODE='RC003';
  END IF;
  IF NEW.stage='withdrawn' THEN
   NEW.rejection_reason := NULL;
  END IF;
  IF offer_status IS NOT NULL THEN
   RAISE EXCEPTION 'Withdraw the open offer first' USING ERRCODE='RC004';
  END IF;
 ELSIF OLD.stage IN ('rejected','withdrawn') THEN
  IF NOT hr THEN
   RAISE EXCEPTION 'Only HR reopens an application' USING ERRCODE='RC005';
  END IF;
  IF NEW.stage IS DISTINCT FROM OLD.previous_stage AND NOT (OLD.previous_stage='offer' AND NEW.stage='assessment') THEN
   RAISE EXCEPTION 'A closed application reopens only to its previous stage (%)', OLD.previous_stage USING ERRCODE='RC004';
  END IF;
  IF NEW.stage_reason IS NULL OR char_length(NEW.stage_reason)<3 THEN
   RAISE EXCEPTION 'Say why the application is reopened' USING ERRCODE='RC003';
  END IF;
  IF req.status<>'open' THEN
   RAISE EXCEPTION 'The requisition is not open' USING ERRCODE='RC004';
  END IF;
  IF NEW.stage='offer' AND (offer_status IS NULL OR offer_status='accepted') THEN
   RAISE EXCEPTION 'Create an offer to move to the offer stage' USING ERRCODE='RC004';
  END IF;
  NEW.rejection_reason := NULL;
 ELSIF n=o-1 AND n>=1 THEN
  IF NOT hr THEN
   RAISE EXCEPTION 'Only HR moves an application back a stage' USING ERRCODE='RC005';
  END IF;
  IF NEW.stage_reason IS NULL OR char_length(NEW.stage_reason)<3 THEN
   RAISE EXCEPTION 'Say why the application moves back' USING ERRCODE='RC003';
  END IF;
  IF offer_status IS NOT NULL THEN
   RAISE EXCEPTION 'Withdraw the open offer first' USING ERRCODE='RC004';
  END IF;
  NEW.rejection_reason := NULL;
 ELSIF n>o AND o>=1 THEN
  IF NEW.stage='offer' THEN
   IF NOT hr THEN
    RAISE EXCEPTION 'Only HR makes offers' USING ERRCODE='RC005';
   END IF;
   IF offer_status IS NULL OR offer_status='accepted' THEN
    RAISE EXCEPTION 'Create an offer to move to the offer stage' USING ERRCODE='RC004';
   END IF;
  ELSIF NEW.stage='hired' THEN
   IF NOT hr THEN
    RAISE EXCEPTION 'Only HR records a hire' USING ERRCODE='RC005';
   END IF;
   IF offer_status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'An application is hired only through an accepted offer' USING ERRCODE='RC004';
   END IF;
   SELECT count(*) INTO hired FROM recruit_application a WHERE a.requisition_id=OLD.requisition_id AND a.stage='hired';
   IF hired>=req.headcount THEN
    RAISE EXCEPTION 'This requisition has no headcount left' USING ERRCODE='RC004';
   END IF;
  ELSIF OLD.stage='offer' THEN
   RAISE EXCEPTION 'An application cannot move from % to %', OLD.stage, NEW.stage USING ERRCODE='RC004';
  END IF;
  IF NEW.stage<>'hired' AND req.status<>'open' THEN
   RAISE EXCEPTION 'The requisition is not open' USING ERRCODE='RC004';
  END IF;
  NEW.rejection_reason := NULL;
 ELSE
  RAISE EXCEPTION 'An application cannot move from % to %', OLD.stage, NEW.stage USING ERRCODE='RC004';
 END IF;
 NEW.previous_stage := OLD.stage;
 NEW.stage_entered_at := now();
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_recruit_interview() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.recruit_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 managed text[] := ARRAY['scheduled_at','duration_minutes','ends_at','mode','location_or_link','status','status_note',
  'version','updated_by_label','updated_at'];
 app record;
 member uuid;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This interview belongs to another organization' USING ERRCODE='RC005';
 END IF;
 IF TG_OP='UPDATE' AND coalesce(current_setting('app.recruit_candidate_op',true),'')='anonymise:'||OLD.candidate_id::text THEN
  IF (to_jsonb(NEW)-ARRAY['candidate_name']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['candidate_name']) THEN
   RAISE EXCEPTION 'Anonymising changes only the copied candidate details' USING ERRCODE='RC004';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' THEN
  SELECT a.requisition_id, a.candidate_id, a.candidate_name, a.stage, r.title, r.hiring_manager_id INTO app
  FROM recruit_application a JOIN job_requisition r ON r.id=a.requisition_id
  WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id AND a.id=NEW.application_id;
 ELSE
  SELECT a.requisition_id, a.candidate_id, a.candidate_name, a.stage, r.title, r.hiring_manager_id INTO app
  FROM recruit_application a JOIN job_requisition r ON r.id=a.requisition_id WHERE a.id=OLD.application_id;
 END IF;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'This application is unavailable' USING ERRCODE='RC003';
 END IF;
 IF me IS NULL OR NOT (scope='entity' OR (scope='team' AND app.hiring_manager_id=me)) THEN
  RAISE EXCEPTION 'Only HR or the hiring manager schedules interviews' USING ERRCODE='RC005';
 END IF;
 IF TG_OP='INSERT' THEN
  IF app.stage NOT IN ('screening','interview','assessment') THEN
   RAISE EXCEPTION 'Interviews are scheduled for applications in screening, interview or assessment' USING ERRCODE='RC004';
  END IF;
  IF EXISTS(SELECT 1 FROM ats_candidate c WHERE c.id=app.candidate_id
    AND (c.consent_withdrawn_at IS NOT NULL OR c.anonymised_at IS NOT NULL)) THEN
   RAISE EXCEPTION 'This candidate has withdrawn consent' USING ERRCODE='RC004';
  END IF;
  IF (SELECT r.status FROM job_requisition r WHERE r.id=app.requisition_id)<>'open' THEN
   RAISE EXCEPTION 'The requisition is not open' USING ERRCODE='RC004';
  END IF;
  IF NEW.scheduled_at IS NULL OR NEW.scheduled_at<=now() THEN
   RAISE EXCEPTION 'Schedule the interview in the future' USING ERRCODE='RC003';
  END IF;
  NEW.requisition_id := app.requisition_id;
  NEW.candidate_id := app.candidate_id;
  NEW.candidate_name := app.candidate_name;
  NEW.requisition_title := app.title;
  NEW.ends_at := NEW.scheduled_at+make_interval(mins=>NEW.duration_minutes);
  NEW.status := 'scheduled';
  NEW.status_note := NULL;
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
  PERFORM recruit_check_candidate_free(NEW.candidate_id,NEW.id,NEW.scheduled_at,NEW.ends_at);
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('recruit-interview:'||OLD.id::text,0));
  IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'An interview changes only through its own actions' USING ERRCODE='RC004';
  END IF;
  IF OLD.status<>'scheduled' THEN
   RAISE EXCEPTION 'This interview is final' USING ERRCODE='RC004';
  END IF;
  IF NEW.status<>OLD.status THEN
   IF (NEW.scheduled_at,NEW.duration_minutes,NEW.mode,NEW.location_or_link)
     IS DISTINCT FROM (OLD.scheduled_at,OLD.duration_minutes,OLD.mode,OLD.location_or_link) THEN
    RAISE EXCEPTION 'Reschedule and change the status in separate steps' USING ERRCODE='RC004';
   END IF;
   IF NEW.status NOT IN ('completed','cancelled','no_show') THEN
    RAISE EXCEPTION 'That interview step is not allowed' USING ERRCODE='RC004';
   END IF;
   IF NEW.status IN ('completed','no_show') AND OLD.scheduled_at>now() THEN
    RAISE EXCEPTION 'An interview is marked completed or no-show only after it starts' USING ERRCODE='RC003';
   END IF;
   IF NEW.status='cancelled' AND (NEW.status_note IS NULL OR char_length(btrim(NEW.status_note))<3) THEN
    RAISE EXCEPTION 'Say why the interview is cancelled' USING ERRCODE='RC003';
   END IF;
   NEW.ends_at := OLD.ends_at;
  ELSE
   NEW.status_note := OLD.status_note;
   IF NEW.scheduled_at<=now() THEN
    RAISE EXCEPTION 'Reschedule the interview to a future time' USING ERRCODE='RC003';
   END IF;
   NEW.ends_at := NEW.scheduled_at+make_interval(mins=>NEW.duration_minutes);
   IF (NEW.scheduled_at,NEW.ends_at) IS DISTINCT FROM (OLD.scheduled_at,OLD.ends_at) THEN
    PERFORM recruit_check_candidate_free(OLD.candidate_id,OLD.id,NEW.scheduled_at,NEW.ends_at);
    FOR member IN SELECT p.employee_id FROM recruit_interview_panel p WHERE p.interview_id=OLD.id ORDER BY p.employee_id LOOP
     PERFORM recruit_check_interviewer_free(member,OLD.id,NEW.scheduled_at,NEW.ends_at);
    END LOOP;
   END IF;
  END IF;
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_ats_candidate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 op text := coalesce(current_setting('app.recruit_candidate_op',true),'');
 today date;
 keep text[] := ARRAY['version','updated_by_label','updated_at'];
BEGIN
 -- Operations re-hash (recruit_rehash_candidate): only the hash and its key id change.
 IF TG_OP='UPDATE' AND op='rehash:'||OLD.id::text THEN
  IF (to_jsonb(NEW)-ARRAY['email_hash','hash_key_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['email_hash','hash_key_id'])
    OR OLD.email_hash IS NULL OR NEW.email_hash IS NULL OR NEW.hash_key_id IS NULL THEN
   RAISE EXCEPTION 'A re-hash changes only the email hash' USING ERRCODE='RC004';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid
   OR me IS NULL OR coalesce(current_setting('app.recruit_scope',true),'none')<>'entity' THEN
  RAISE EXCEPTION 'Only HR records candidates' USING ERRCODE='RC005';
 END IF;
 today := org_entity_today(NEW.tenant_id,NEW.entity_id);
 IF today IS NULL THEN
  RAISE EXCEPTION 'The organization''s current date is unavailable' USING ERRCODE='RC003';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.consent_given IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Record the candidate''s consent before saving their details' USING ERRCODE='RC003';
  END IF;
  IF NEW.referrer_employee_id IS NOT NULL
    AND recruit_employee_name(NEW.tenant_id,NEW.entity_id,NEW.referrer_employee_id) IS NULL THEN
   RAISE EXCEPTION 'The referrer must be a current employee' USING ERRCODE='RC003';
  END IF;
  NEW.retention_until := coalesce(NEW.retention_until,(today+interval '2 years')::date);
  IF NEW.retention_until<=today OR NEW.retention_until>(today+interval '5 years')::date THEN
   RAISE EXCEPTION 'Keep candidate details for up to five years from today' USING ERRCODE='RC003';
  END IF;
  NEW.consent_recorded_at := now();
  NEW.consent_withdrawn_at := NULL;
  NEW.consent_withdrawal_reason := NULL;
  NEW.anonymised_at := NULL;
  NEW.anonymised_reason := NULL;
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('recruit-candidate:'||OLD.id::text,0));
  IF OLD.anonymised_at IS NOT NULL THEN
   RAISE EXCEPTION 'This candidate has been anonymised' USING ERRCODE='RC004';
  END IF;
  IF NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'A candidate changes only through its own actions' USING ERRCODE='RC004';
  END IF;
  IF op='anonymise:'||OLD.id::text THEN
   IF (to_jsonb(NEW)-(keep||ARRAY['name','email_sealed','phone_sealed','email_hash','hash_key_id','current_company',
       'referrer_employee_id','notes','anonymised_at','anonymised_reason']))
     IS DISTINCT FROM (to_jsonb(OLD)-(keep||ARRAY['name','email_sealed','phone_sealed','email_hash','hash_key_id',
       'current_company','referrer_employee_id','notes','anonymised_at','anonymised_reason'])) THEN
    RAISE EXCEPTION 'Anonymising changes only personal details' USING ERRCODE='RC004';
   END IF;
   NEW.anonymised_at := now();
  ELSIF NEW.consent_withdrawal_reason IS DISTINCT FROM OLD.consent_withdrawal_reason THEN
   IF OLD.consent_withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'Consent is already withdrawn' USING ERRCODE='RC004';
   END IF;
   IF (to_jsonb(NEW)-(keep||ARRAY['consent_withdrawal_reason','consent_withdrawn_at']))
     IS DISTINCT FROM (to_jsonb(OLD)-(keep||ARRAY['consent_withdrawal_reason','consent_withdrawn_at'])) THEN
    RAISE EXCEPTION 'Withdrawing consent changes nothing else' USING ERRCODE='RC004';
   END IF;
   IF NEW.consent_withdrawal_reason IS NULL OR char_length(btrim(NEW.consent_withdrawal_reason))<10 THEN
    RAISE EXCEPTION 'Give a reason of at least 10 characters' USING ERRCODE='RC003';
   END IF;
   NEW.consent_withdrawn_at := now();
  ELSE
   IF (to_jsonb(NEW)-(keep||ARRAY['retention_until'])) IS DISTINCT FROM (to_jsonb(OLD)-(keep||ARRAY['retention_until'])) THEN
    RAISE EXCEPTION 'Only a candidate''s retention date can change' USING ERRCODE='RC004';
   END IF;
   IF OLD.consent_withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'Consent was withdrawn; retention cannot be extended' USING ERRCODE='RC004';
   END IF;
   IF NEW.retention_until<=OLD.retention_until OR NEW.retention_until>(today+interval '5 years')::date THEN
    RAISE EXCEPTION 'Extend retention to a later date, at most five years from today' USING ERRCODE='RC003';
   END IF;
  END IF;
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- The entity's today for the app (purge eligibility).
CREATE FUNCTION recruit_entity_today() RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.org_entity_today(nullif(current_setting('app.tenant_id',true),'')::uuid,
  nullif(current_setting('app.entity_id',true),'')::uuid);
$$;

-- Irreversible anonymisation, by HR in its own session. Values never reach audit or outbox.
CREATE FUNCTION recruit_anonymise_candidate(p_candidate uuid, p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 tenant uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
 entity uuid := nullif(current_setting('app.entity_id',true),'')::uuid;
 c record;
 v integer;
BEGIN
 IF tenant IS NULL OR entity IS NULL OR coalesce(current_setting('app.recruit_scope',true),'none')<>'entity'
   OR nullif(current_setting('app.employee_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Only HR anonymises candidates' USING ERRCODE='RC005';
 END IF;
 IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 10 AND 500 THEN
  RAISE EXCEPTION 'Give a reason of at least 10 characters' USING ERRCODE='RC003';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('recruit-candidate:'||p_candidate::text,0));
 SELECT x.id, x.anonymised_at, x.consent_withdrawn_at, x.retention_until, x.version INTO c FROM ats_candidate x
 WHERE x.id=p_candidate AND x.tenant_id=tenant AND x.entity_id=entity;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'This candidate is unavailable' USING ERRCODE='RC003';
 END IF;
 IF c.anonymised_at IS NOT NULL THEN
  RAISE EXCEPTION 'This candidate has already been anonymised' USING ERRCODE='RC004';
 END IF;
 IF c.consent_withdrawn_at IS NULL AND c.retention_until>=org_entity_today(tenant,entity) THEN
  RAISE EXCEPTION 'Anonymise only after consent is withdrawn or the retention date has passed' USING ERRCODE='RC004';
 END IF;
 IF EXISTS(SELECT 1 FROM recruit_application a WHERE a.candidate_id=p_candidate AND a.stage='hired') THEN
  RAISE EXCEPTION 'This candidate was hired; their record continues in Onboarding' USING ERRCODE='RC004';
 END IF;
 IF EXISTS(SELECT 1 FROM recruit_application a WHERE a.candidate_id=p_candidate AND a.stage NOT IN ('rejected','withdrawn')) THEN
  RAISE EXCEPTION 'Close the candidate''s open applications first' USING ERRCODE='RC004';
 END IF;
 PERFORM set_config('app.recruit_candidate_op','anonymise:'||p_candidate::text,true);
 UPDATE ats_candidate SET name='Anonymised candidate', email_sealed=NULL, phone_sealed=NULL, email_hash=NULL,
  hash_key_id=NULL, notes=NULL, current_company=NULL, referrer_employee_id=NULL, anonymised_reason=btrim(p_reason),
  version=version+1 WHERE id=p_candidate RETURNING version INTO v;
 UPDATE recruit_application SET candidate_name='Anonymised candidate', candidate_company=NULL WHERE candidate_id=p_candidate;
 UPDATE recruit_interview SET candidate_name='Anonymised candidate' WHERE candidate_id=p_candidate;
 PERFORM set_config('app.recruit_candidate_op','',true);
 RETURN v;
END $$;

-- Operations only (not granted to the app): compare-and-swap of one candidate's email hash.
CREATE FUNCTION recruit_rehash_candidate(p_candidate uuid, p_old text, p_new text, p_key integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE done boolean;
BEGIN
 PERFORM set_config('app.recruit_candidate_op','rehash:'||p_candidate::text,true);
 UPDATE ats_candidate SET email_hash=p_new, hash_key_id=p_key
 WHERE id=p_candidate AND email_hash=p_old AND anonymised_at IS NULL;
 done := FOUND;
 PERFORM set_config('app.recruit_candidate_op','',true);
 RETURN done;
END $$;

ALTER FUNCTION recruit_entity_today() OWNER TO anvione_recruit_keeper;
ALTER FUNCTION recruit_anonymise_candidate(uuid,text) OWNER TO anvione_recruit_writer;
ALTER FUNCTION recruit_rehash_candidate(uuid,text,text,integer) OWNER TO anvione_recruit_writer;
REVOKE ALL ON FUNCTION recruit_entity_today(), recruit_anonymise_candidate(uuid,text),
 recruit_rehash_candidate(uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recruit_entity_today(), recruit_anonymise_candidate(uuid,text) TO anvione_app;
GRANT EXECUTE ON FUNCTION org_entity_today(uuid,uuid) TO anvione_recruit_writer;
GRANT SELECT ON ats_candidate, recruit_application, recruit_interview TO anvione_recruit_writer;
GRANT UPDATE(name,email_sealed,phone_sealed,email_hash,hash_key_id,notes,current_company,referrer_employee_id,
 anonymised_reason,version) ON ats_candidate TO anvione_recruit_writer;
GRANT UPDATE(candidate_name,candidate_company) ON recruit_application TO anvione_recruit_writer;
GRANT UPDATE(candidate_name) ON recruit_interview TO anvione_recruit_writer;
CREATE POLICY recruit_writer_candidate ON ats_candidate FOR SELECT TO anvione_recruit_writer USING(true);
CREATE POLICY recruit_writer_candidate_update ON ats_candidate FOR UPDATE TO anvione_recruit_writer USING(true) WITH CHECK(true);
CREATE POLICY recruit_writer_interview ON recruit_interview FOR SELECT TO anvione_recruit_writer USING(true);
CREATE POLICY recruit_writer_interview_update ON recruit_interview FOR UPDATE TO anvione_recruit_writer USING(true) WITH CHECK(true);
GRANT INSERT(hash_key_id) ON ats_candidate TO anvione_app;
GRANT UPDATE(consent_withdrawal_reason) ON ats_candidate TO anvione_app;

ALTER TABLE job_requisition ENABLE ALWAYS TRIGGER job_requisition_guard;
ALTER TABLE job_requisition ENABLE ALWAYS TRIGGER job_requisition_no_delete;
ALTER TABLE ats_candidate ENABLE ALWAYS TRIGGER ats_candidate_guard;
ALTER TABLE ats_candidate ENABLE ALWAYS TRIGGER ats_candidate_no_delete;
ALTER TABLE recruit_application ENABLE ALWAYS TRIGGER recruit_application_guard;
ALTER TABLE recruit_application ENABLE ALWAYS TRIGGER recruit_application_history;
ALTER TABLE recruit_application ENABLE ALWAYS TRIGGER recruit_application_no_delete;
ALTER TABLE recruit_stage_history ENABLE ALWAYS TRIGGER recruit_stage_history_final;
ALTER TABLE recruit_stage_history ENABLE ALWAYS TRIGGER recruit_stage_history_no_delete;
ALTER TABLE recruit_interview ENABLE ALWAYS TRIGGER recruit_interview_guard;
ALTER TABLE recruit_interview ENABLE ALWAYS TRIGGER recruit_interview_no_delete;
ALTER TABLE recruit_interview_panel ENABLE ALWAYS TRIGGER recruit_interview_panel_guard;
ALTER TABLE recruit_interview_panel ENABLE ALWAYS TRIGGER recruit_interview_panel_final;
ALTER TABLE recruit_interview_panel ENABLE ALWAYS TRIGGER recruit_interview_panel_no_delete;
ALTER TABLE recruit_scorecard ENABLE ALWAYS TRIGGER recruit_scorecard_guard;
ALTER TABLE recruit_scorecard ENABLE ALWAYS TRIGGER recruit_scorecard_rating;
ALTER TABLE recruit_scorecard ENABLE ALWAYS TRIGGER recruit_scorecard_final;
ALTER TABLE recruit_scorecard ENABLE ALWAYS TRIGGER recruit_scorecard_no_delete;
ALTER TABLE recruit_offer ENABLE ALWAYS TRIGGER recruit_offer_guard;
ALTER TABLE recruit_offer ENABLE ALWAYS TRIGGER recruit_offer_no_delete;


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
 'employee.classified.v1','branding.rolled_back.v1',
 'project.created.v1','project.updated.v1','project.status_changed.v1',
 'project.member_added.v1','project.member_removed.v1',
 'project.task_created.v1','project.task_updated.v1','project.task_status_changed.v1',
 'time.logged.v1','time.withdrawn.v1','time.approved.v1','time.rejected.v1',
 'recruit.requisition_created.v1','recruit.requisition_updated.v1','recruit.requisition_status_changed.v1',
 'recruit.candidate_created.v1','recruit.candidate_retention_extended.v1',
 'recruit.candidate_consent_withdrawn.v1','recruit.candidate_anonymised.v1',
 'recruit.application_created.v1','recruit.application_stage_changed.v1',
 'recruit.interview_scheduled.v1','recruit.interview_rescheduled.v1','recruit.interview_status_changed.v1',
 'recruit.scorecard_submitted.v1','recruit.offer_created.v1','recruit.offer_status_changed.v1'
));
