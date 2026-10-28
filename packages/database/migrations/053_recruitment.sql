-- REC-01 recruitment (applicant tracking), backend only.
-- Requisitions are raised by a hiring manager (or HR), approved by HR who is neither the
-- requester nor the hiring manager, then opened by HR. HR records candidates (with consent;
-- email and phone are sealed by the API and only an HMAC of the normalised email is stored
-- for duplicate detection), adds them to open requisitions and moves applications through a
-- fixed stage matrix; the hiring manager may advance and reject applications on their own
-- requisitions. Interviews have a panel of 1..6 current employees; a person (interviewer or
-- candidate) cannot be in two overlapping scheduled interviews. Panel members submit one
-- immutable scorecard each; scorecards are blind until you have submitted your own for that
-- application. Offers are HR-only with four-eyes approval; "sent" is a recorded status only
-- (no email is dispatched). Accepting an offer marks the application hired (within headcount)
-- and creates a draft pre-boarding candidate_case in the same transaction (done by the API).
-- No salary or CTC is stored. Nothing is deleted. Guards run as a SELECT-only keeper and
-- serialise on advisory locks; stage history and scorecard averages are written by a narrow
-- writer role from triggers. Errors: RC003 bad input (400), RC004 conflict (409), RC005 (403).
CREATE ROLE anvione_recruit_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE anvione_recruit_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_recruit_keeper, anvione_recruit_writer;

CREATE TABLE job_requisition (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^REQ-[0-9]{6}$'),
 title text NOT NULL CHECK(char_length(title) BETWEEN 3 AND 120 AND title=btrim(title)),
 department_id uuid NOT NULL,
 department_kind text GENERATED ALWAYS AS ('department'::text) STORED,
 location_id uuid NOT NULL,
 location_kind text GENERATED ALWAYS AS ('location'::text) STORED,
 designation_id uuid,
 designation_kind text GENERATED ALWAYS AS ('designation'::text) STORED,
 headcount integer NOT NULL CHECK(headcount BETWEEN 1 AND 50),
 employment_type text NOT NULL CHECK(employment_type IN ('full_time','part_time','contract','intern')),
 hiring_manager_id uuid NOT NULL,
 hiring_manager_name text NOT NULL,
 description text CHECK(description IS NULL OR char_length(description) BETWEEN 1 AND 2000),
 target_start date,
 status text NOT NULL CHECK(status IN ('draft','pending_approval','approved','open','on_hold','closed','rejected','cancelled')),
 status_note text CHECK(status_note IS NULL OR char_length(btrim(status_note)) BETWEEN 3 AND 500),
 requested_by_employee uuid NOT NULL,
 approved_by_employee uuid,
 approved_by_label text,
 approved_at timestamptz,
 closed_at timestamptz,
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 FOREIGN KEY(tenant_id,entity_id,department_kind,department_id) REFERENCES org_unit(tenant_id,entity_id,kind,id),
 FOREIGN KEY(tenant_id,entity_id,location_kind,location_id) REFERENCES org_unit(tenant_id,entity_id,kind,id),
 FOREIGN KEY(tenant_id,entity_id,designation_kind,designation_id) REFERENCES org_unit(tenant_id,entity_id,kind,id),
 FOREIGN KEY(tenant_id,entity_id,hiring_manager_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,requested_by_employee) REFERENCES employee(tenant_id,entity_id,id),
 CHECK(status NOT IN ('closed','rejected') OR status_note IS NOT NULL),
 UNIQUE(tenant_id,entity_id,code),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX job_requisition_status_idx ON job_requisition(tenant_id,entity_id,status,created_at DESC);
CREATE INDEX job_requisition_manager_idx ON job_requisition(tenant_id,entity_id,hiring_manager_id);
CREATE INDEX job_requisition_requester_idx ON job_requisition(tenant_id,entity_id,requested_by_employee);

CREATE TABLE ats_candidate (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120 AND name=btrim(name)),
 -- Sealed by the API (AES-256-GCM, base64url); never plaintext, so never an '@'.
 email_sealed text NOT NULL CHECK(char_length(email_sealed)>=40 AND email_sealed ~ '^[A-Za-z0-9_-]+$'),
 phone_sealed text CHECK(phone_sealed IS NULL OR (char_length(phone_sealed)>=40 AND phone_sealed ~ '^[A-Za-z0-9_-]+$')),
 email_hash text NOT NULL CHECK(email_hash ~ '^[0-9a-f]{64}$'),
 current_company text CHECK(current_company IS NULL OR char_length(current_company) BETWEEN 1 AND 120),
 total_experience_months integer NOT NULL CHECK(total_experience_months BETWEEN 0 AND 720),
 source text NOT NULL CHECK(source IN ('portal','referral','agency','campaign','direct','other')),
 referrer_employee_id uuid,
 consent_given boolean NOT NULL CHECK(consent_given),
 consent_recorded_at timestamptz NOT NULL,
 retention_until date NOT NULL,
 notes text CHECK(notes IS NULL OR char_length(notes) BETWEEN 1 AND 1000),
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 FOREIGN KEY(tenant_id,entity_id,referrer_employee_id) REFERENCES employee(tenant_id,entity_id,id),
 CHECK(source<>'referral' OR referrer_employee_id IS NOT NULL),
 CONSTRAINT ats_candidate_email_hash_key UNIQUE(tenant_id,entity_id,email_hash),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX ats_candidate_name_idx ON ats_candidate(tenant_id,entity_id,name);
CREATE INDEX ats_candidate_retention_idx ON ats_candidate(tenant_id,entity_id,retention_until);

CREATE TABLE recruit_application (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 candidate_id uuid NOT NULL,
 requisition_id uuid NOT NULL,
 -- Non-contact snapshot so hiring managers never need the candidate table.
 candidate_name text NOT NULL,
 candidate_company text,
 candidate_experience_months integer NOT NULL,
 source text NOT NULL,
 stage text NOT NULL CHECK(stage IN ('applied','screening','interview','assessment','offer','hired','rejected','withdrawn')),
 previous_stage text,
 stage_entered_at timestamptz NOT NULL DEFAULT now(),
 stage_reason text CHECK(stage_reason IS NULL OR char_length(stage_reason) BETWEEN 1 AND 500),
 rejection_reason text CHECK(rejection_reason IN ('not_a_fit','salary','experience','withdrew','no_show','position_filled','failed_assessment','other')),
 rating_average numeric(3,2),
 scorecard_count integer NOT NULL DEFAULT 0,
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,candidate_id) REFERENCES ats_candidate(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,requisition_id) REFERENCES job_requisition(tenant_id,entity_id,id),
 CHECK((stage='rejected')=(rejection_reason IS NOT NULL)),
 CONSTRAINT recruit_application_pair_key UNIQUE(candidate_id,requisition_id),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX recruit_application_req_idx ON recruit_application(requisition_id,stage);
CREATE INDEX recruit_application_entity_idx ON recruit_application(tenant_id,entity_id,stage,created_at DESC);

CREATE TABLE recruit_stage_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 application_id uuid NOT NULL,
 from_stage text,
 to_stage text NOT NULL,
 reason text,
 rejection_reason text,
 by_label text NOT NULL,
 at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,entity_id,application_id) REFERENCES recruit_application(tenant_id,entity_id,id)
);
CREATE INDEX recruit_stage_history_app_idx ON recruit_stage_history(application_id,at);

CREATE TABLE recruit_interview (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 application_id uuid NOT NULL,
 requisition_id uuid NOT NULL,
 candidate_id uuid NOT NULL,
 candidate_name text NOT NULL,
 requisition_title text NOT NULL,
 round_name text NOT NULL CHECK(char_length(round_name) BETWEEN 3 AND 60 AND round_name=btrim(round_name)),
 scheduled_at timestamptz NOT NULL,
 duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 15 AND 240 AND duration_minutes%15=0),
 ends_at timestamptz NOT NULL,
 mode text NOT NULL CHECK(mode IN ('video','phone','onsite')),
 location_or_link text CHECK(location_or_link IS NULL OR char_length(location_or_link) BETWEEN 1 AND 200),
 status text NOT NULL CHECK(status IN ('scheduled','completed','cancelled','no_show')),
 status_note text CHECK(status_note IS NULL OR char_length(btrim(status_note)) BETWEEN 3 AND 500),
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,application_id) REFERENCES recruit_application(tenant_id,entity_id,id),
 CHECK(ends_at>scheduled_at),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX recruit_interview_app_idx ON recruit_interview(application_id,scheduled_at);
CREATE INDEX recruit_interview_candidate_idx ON recruit_interview(candidate_id,scheduled_at) WHERE status='scheduled';

CREATE TABLE recruit_interview_panel (
 interview_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 employee_name text NOT NULL,
 added_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(interview_id,employee_id),
 FOREIGN KEY(tenant_id,entity_id,interview_id) REFERENCES recruit_interview(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id)
);
CREATE INDEX recruit_interview_panel_employee_idx ON recruit_interview_panel(tenant_id,entity_id,employee_id);

CREATE TABLE recruit_scorecard (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 interview_id uuid NOT NULL,
 application_id uuid NOT NULL,
 interviewer_employee_id uuid NOT NULL,
 interviewer_name text NOT NULL,
 ratings jsonb NOT NULL CHECK(jsonb_typeof(ratings)='object'),
 overall numeric(3,2) NOT NULL CHECK(overall BETWEEN 1 AND 5),
 recommendation text NOT NULL CHECK(recommendation IN ('strong_yes','yes','no','strong_no')),
 comment text CHECK(comment IS NULL OR char_length(comment) BETWEEN 1 AND 1000),
 submitted_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,interview_id) REFERENCES recruit_interview(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,application_id) REFERENCES recruit_application(tenant_id,entity_id,id),
 FOREIGN KEY(interview_id,interviewer_employee_id) REFERENCES recruit_interview_panel(interview_id,employee_id),
 CONSTRAINT recruit_scorecard_once_key UNIQUE(interview_id,interviewer_employee_id)
);
CREATE INDEX recruit_scorecard_app_idx ON recruit_scorecard(application_id,interviewer_employee_id);

CREATE TABLE recruit_offer (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 application_id uuid NOT NULL,
 requisition_id uuid NOT NULL,
 candidate_id uuid NOT NULL,
 title text NOT NULL,
 department_id uuid NOT NULL,
 department_kind text GENERATED ALWAYS AS ('department'::text) STORED,
 location_id uuid NOT NULL,
 location_kind text GENERATED ALWAYS AS ('location'::text) STORED,
 designation_id uuid,
 designation_kind text GENERATED ALWAYS AS ('designation'::text) STORED,
 manager_id uuid NOT NULL,
 manager_name text NOT NULL,
 proposed_joining_date date NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','pending_approval','approved','sent','accepted','declined','expired','withdrawn')),
 status_note text CHECK(status_note IS NULL OR char_length(btrim(status_note)) BETWEEN 3 AND 500),
 created_by_employee uuid NOT NULL,
 approved_by_employee uuid,
 approved_by_label text,
 approved_at timestamptz,
 sent_at timestamptz,
 responded_on date,
 candidate_case_id uuid UNIQUE,
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,application_id) REFERENCES recruit_application(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,department_kind,department_id) REFERENCES org_unit(tenant_id,entity_id,kind,id),
 FOREIGN KEY(tenant_id,entity_id,location_kind,location_id) REFERENCES org_unit(tenant_id,entity_id,kind,id),
 FOREIGN KEY(tenant_id,entity_id,designation_kind,designation_id) REFERENCES org_unit(tenant_id,entity_id,kind,id),
 FOREIGN KEY(tenant_id,entity_id,manager_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,candidate_case_id) REFERENCES candidate_case(tenant_id,entity_id,id),
 CHECK((status='accepted')=(candidate_case_id IS NOT NULL)),
 CHECK(status NOT IN ('accepted','declined','expired') OR responded_on IS NOT NULL),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE UNIQUE INDEX recruit_offer_active_key ON recruit_offer(application_id)
 WHERE status IN ('draft','pending_approval','approved','sent','accepted');
CREATE INDEX recruit_offer_entity_idx ON recruit_offer(tenant_id,entity_id,status,created_at DESC);

-- Helpers -----------------------------------------------------------------------------------
CREATE FUNCTION recruit_in_entity(p_tenant uuid, p_entity uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT p_tenant=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND p_entity=nullif(current_setting('app.entity_id',true),'')::uuid;
$$;
CREATE FUNCTION recruit_manages_req(p_req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.job_requisition r WHERE r.id=p_req
  AND r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND r.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND (coalesce(current_setting('app.recruit_scope',true),'none')='entity'
   OR (current_setting('app.recruit_scope',true)='team'
    AND r.hiring_manager_id=nullif(current_setting('app.employee_id',true),'')::uuid)));
$$;
CREATE FUNCTION recruit_sees_req(p_req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.recruit_manages_req(p_req) OR EXISTS(SELECT 1 FROM public.job_requisition r WHERE r.id=p_req
  AND r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND r.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.recruit_scope',true)='team'
  AND r.requested_by_employee=nullif(current_setting('app.employee_id',true),'')::uuid);
$$;
CREATE FUNCTION recruit_sees_application(p_app uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.recruit_application a WHERE a.id=p_app AND public.recruit_manages_req(a.requisition_id));
$$;
CREATE FUNCTION recruit_on_panel(p_interview uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(current_setting('app.recruit_scope',true),'none') IN ('self','team','entity')
  AND EXISTS(SELECT 1 FROM public.recruit_interview_panel p WHERE p.interview_id=p_interview
   AND p.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND p.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
   AND p.employee_id=nullif(current_setting('app.employee_id',true),'')::uuid);
$$;
CREATE FUNCTION recruit_sees_interview(p_interview uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.recruit_interview i WHERE i.id=p_interview
  AND (public.recruit_manages_req(i.requisition_id) OR public.recruit_on_panel(i.id)));
$$;
-- Blind scorecards: HR and the hiring manager see all; an interviewer sees their own, and the
-- others for an application only once they have submitted their own for it.
CREATE FUNCTION recruit_sees_scorecard(p_app uuid, p_interviewer uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.recruit_sees_application(p_app)
  OR (coalesce(current_setting('app.recruit_scope',true),'none') IN ('self','team','entity')
   AND (p_interviewer=nullif(current_setting('app.employee_id',true),'')::uuid
    OR EXISTS(SELECT 1 FROM public.recruit_scorecard s WHERE s.application_id=p_app
     AND s.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
     AND s.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
     AND s.interviewer_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)));
$$;
CREATE FUNCTION recruit_stage_rank(p_stage text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE p_stage WHEN 'applied' THEN 1 WHEN 'screening' THEN 2 WHEN 'interview' THEN 3
  WHEN 'assessment' THEN 4 WHEN 'offer' THEN 5 WHEN 'hired' THEN 6 ELSE 0 END;
$$;
-- A department, location or designation that is active, not merged and in effect today.
CREATE FUNCTION recruit_unit_in_effect(p_tenant uuid, p_entity uuid, p_kind text, p_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE today date := public.org_entity_today(p_tenant,p_entity);
BEGIN
 RETURN EXISTS(SELECT 1 FROM public.org_unit u WHERE u.tenant_id=p_tenant AND u.entity_id=p_entity
  AND u.id=p_id AND u.kind=p_kind AND u.active AND u.merged_into_id IS NULL
  AND u.effective_from<=today AND (u.effective_to IS NULL OR u.effective_to>=today));
END $$;
CREATE FUNCTION recruit_employee_name(p_tenant uuid, p_entity uuid, p_employee uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT p.name FROM public.employee e JOIN public.person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
 WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.id=p_employee AND e.status IN ('active','notice');
$$;

-- Requisitions -------------------------------------------------------------------------------
CREATE FUNCTION guard_job_requisition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.recruit_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Manager');
 today date := org_entity_today(NEW.tenant_id,NEW.entity_id);
 managed text[] := ARRAY['title','department_id','location_id','designation_id','headcount','employment_type',
  'hiring_manager_id','hiring_manager_name','description','target_start','status','status_note',
  'approved_by_employee','approved_by_label','approved_at','closed_at','version','updated_by_label','updated_at'];
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

-- Candidates (HR only) -----------------------------------------------------------------------
CREATE FUNCTION guard_ats_candidate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 today date := org_entity_today(NEW.tenant_id,NEW.entity_id);
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid
   OR me IS NULL OR coalesce(current_setting('app.recruit_scope',true),'none')<>'entity' THEN
  RAISE EXCEPTION 'Only HR records candidates' USING ERRCODE='RC005';
 END IF;
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
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('recruit-candidate:'||OLD.id::text,0));
  IF (to_jsonb(NEW)-ARRAY['retention_until','version','updated_by_label','updated_at'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['retention_until','version','updated_by_label','updated_at'])
    OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'Only a candidate''s retention date can change' USING ERRCODE='RC004';
  END IF;
  IF NEW.retention_until<=OLD.retention_until OR NEW.retention_until>(today+interval '5 years')::date THEN
   RAISE EXCEPTION 'Extend retention to a later date, at most five years from today' USING ERRCODE='RC003';
  END IF;
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Applications ------------------------------------------------------------------------------
CREATE FUNCTION recruit_active_offer(p_app uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT o.status FROM public.recruit_offer o WHERE o.application_id=p_app
  AND o.status IN ('draft','pending_approval','approved','sent','accepted') LIMIT 1;
$$;

CREATE FUNCTION guard_recruit_application() RETURNS trigger
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
  SELECT c.name, c.current_company, c.total_experience_months, c.source INTO cand FROM ats_candidate c
  WHERE c.tenant_id=NEW.tenant_id AND c.entity_id=NEW.entity_id AND c.id=NEW.candidate_id;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'This candidate is unavailable' USING ERRCODE='RC003';
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
  IF NEW.stage IS DISTINCT FROM OLD.previous_stage THEN
   RAISE EXCEPTION 'A closed application reopens only to its previous stage (%)', OLD.previous_stage USING ERRCODE='RC004';
  END IF;
  IF NEW.stage_reason IS NULL OR char_length(NEW.stage_reason)<3 THEN
   RAISE EXCEPTION 'Say why the application is reopened' USING ERRCODE='RC003';
  END IF;
  IF req.status<>'open' THEN
   RAISE EXCEPTION 'The requisition is not open' USING ERRCODE='RC004';
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

-- Written by the writer role only; the app reads it.
CREATE FUNCTION record_recruit_stage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.stage IS NOT DISTINCT FROM OLD.stage THEN
  RETURN NULL;
 END IF;
 INSERT INTO public.recruit_stage_history(tenant_id,entity_id,application_id,from_stage,to_stage,reason,rejection_reason,by_label)
 VALUES (NEW.tenant_id,NEW.entity_id,NEW.id,CASE WHEN TG_OP='UPDATE' THEN OLD.stage END,NEW.stage,
  CASE WHEN TG_OP='UPDATE' THEN NEW.stage_reason END,NEW.rejection_reason,NEW.updated_by_label);
 RETURN NULL;
END $$;

-- Interviews ---------------------------------------------------------------------------------
CREATE FUNCTION recruit_check_candidate_free(p_candidate uuid, p_interview uuid, p_from timestamptz, p_to timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('recruit-candidate-time:'||p_candidate::text,0));
 IF EXISTS(SELECT 1 FROM recruit_interview i WHERE i.candidate_id=p_candidate AND i.id<>p_interview
   AND i.status='scheduled' AND tstzrange(i.scheduled_at,i.ends_at)&&tstzrange(p_from,p_to)) THEN
  RAISE EXCEPTION 'The candidate already has an interview at that time' USING ERRCODE='RC004';
 END IF;
END $$;
CREATE FUNCTION recruit_check_interviewer_free(p_employee uuid, p_interview uuid, p_from timestamptz, p_to timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('recruit-interviewer:'||p_employee::text,0));
 IF EXISTS(SELECT 1 FROM recruit_interview_panel p JOIN recruit_interview i ON i.id=p.interview_id
   WHERE p.employee_id=p_employee AND i.id<>p_interview AND i.status='scheduled'
    AND tstzrange(i.scheduled_at,i.ends_at)&&tstzrange(p_from,p_to)) THEN
  RAISE EXCEPTION 'An interviewer is already booked at that time' USING ERRCODE='RC004';
 END IF;
END $$;

CREATE FUNCTION guard_recruit_interview() RETURNS trigger
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

CREATE FUNCTION guard_recruit_interview_panel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.recruit_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 iv record;
 who text;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This interview belongs to another organization' USING ERRCODE='RC005';
 END IF;
 SELECT i.status, i.scheduled_at, i.ends_at, r.hiring_manager_id INTO iv
 FROM recruit_interview i JOIN job_requisition r ON r.id=i.requisition_id
 WHERE i.tenant_id=NEW.tenant_id AND i.entity_id=NEW.entity_id AND i.id=NEW.interview_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'This interview is unavailable' USING ERRCODE='RC003';
 END IF;
 IF me IS NULL OR NOT (scope='entity' OR (scope='team' AND iv.hiring_manager_id=me)) THEN
  RAISE EXCEPTION 'Only HR or the hiring manager sets an interview panel' USING ERRCODE='RC005';
 END IF;
 IF iv.status<>'scheduled' THEN
  RAISE EXCEPTION 'This interview is final' USING ERRCODE='RC004';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('recruit-interview:'||NEW.interview_id::text,0));
 IF (SELECT count(*) FROM recruit_interview_panel p WHERE p.interview_id=NEW.interview_id)>=6 THEN
  RAISE EXCEPTION 'An interview panel has at most six people' USING ERRCODE='RC003';
 END IF;
 who := recruit_employee_name(NEW.tenant_id,NEW.entity_id,NEW.employee_id);
 IF who IS NULL THEN
  RAISE EXCEPTION 'Interviewers must be current employees' USING ERRCODE='RC003';
 END IF;
 PERFORM recruit_check_interviewer_free(NEW.employee_id,NEW.interview_id,iv.scheduled_at,iv.ends_at);
 NEW.employee_name := who;
 NEW.added_at := now();
 RETURN NEW;
END $$;

-- Scorecards -------------------------------------------------------------------------------
CREATE FUNCTION guard_recruit_scorecard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.recruit_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 iv record;
 k text;
 v jsonb;
 total integer := 0;
 cnt integer := 0;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This interview belongs to another organization' USING ERRCODE='RC005';
 END IF;
 IF me IS NULL OR scope='none' OR NEW.interviewer_employee_id IS DISTINCT FROM me THEN
  RAISE EXCEPTION 'You can only submit your own scorecard' USING ERRCODE='RC005';
 END IF;
 SELECT i.application_id, i.status, i.scheduled_at, p.employee_name INTO iv
 FROM recruit_interview i JOIN recruit_interview_panel p ON p.interview_id=i.id AND p.employee_id=me
 WHERE i.tenant_id=NEW.tenant_id AND i.entity_id=NEW.entity_id AND i.id=NEW.interview_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Only the interview panel submits scorecards' USING ERRCODE='RC005';
 END IF;
 IF NOT (iv.status='completed' OR (iv.status='scheduled' AND iv.scheduled_at<=now())) THEN
  RAISE EXCEPTION 'Scorecards are submitted once the interview has started and was not cancelled' USING ERRCODE='RC004';
 END IF;
 IF NEW.ratings IS NULL OR jsonb_typeof(NEW.ratings)<>'object' THEN
  RAISE EXCEPTION 'Rate at least one competency' USING ERRCODE='RC003';
 END IF;
 FOR k, v IN SELECT * FROM jsonb_each(NEW.ratings) LOOP
  IF k NOT IN ('skills','communication','problem_solving','culture_fit','ownership')
    OR jsonb_typeof(v)<>'number' OR v::text !~ '^[1-5]$' THEN
   RAISE EXCEPTION 'Rate skills, communication, problem solving, culture fit or ownership from 1 to 5' USING ERRCODE='RC003';
  END IF;
  total := total+v::text::integer;
  cnt := cnt+1;
 END LOOP;
 IF cnt=0 THEN
  RAISE EXCEPTION 'Rate at least one competency' USING ERRCODE='RC003';
 END IF;
 NEW.application_id := iv.application_id;
 NEW.interviewer_name := iv.employee_name;
 NEW.overall := round(total::numeric/cnt,2);
 NEW.submitted_at := now();
 RETURN NEW;
END $$;

CREATE FUNCTION refresh_recruit_rating() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- The application guard recomputes the average and count from the scorecards.
 UPDATE public.recruit_application SET rating_average=NULL WHERE id=NEW.application_id;
 RETURN NULL;
END $$;

-- Offers (HR only, four-eyes) -----------------------------------------------------------------
CREATE FUNCTION guard_recruit_offer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.recruit_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 today date := org_entity_today(NEW.tenant_id,NEW.entity_id);
 managed text[] := ARRAY['status','status_note','approved_by_employee','approved_by_label','approved_at','sent_at',
  'responded_on','candidate_case_id','version','updated_by_label','updated_at'];
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

CREATE FUNCTION reject_recruit_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Recruitment records and their history are kept, never deleted' USING ERRCODE='23514';
END $$;
CREATE FUNCTION reject_recruit_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Stage history, panels and submitted scorecards are final' USING ERRCODE='RC004';
END $$;

CREATE TRIGGER job_requisition_guard BEFORE INSERT OR UPDATE ON job_requisition FOR EACH ROW EXECUTE FUNCTION guard_job_requisition();
CREATE TRIGGER ats_candidate_guard BEFORE INSERT OR UPDATE ON ats_candidate FOR EACH ROW EXECUTE FUNCTION guard_ats_candidate();
CREATE TRIGGER recruit_application_guard BEFORE INSERT OR UPDATE ON recruit_application FOR EACH ROW EXECUTE FUNCTION guard_recruit_application();
CREATE TRIGGER recruit_application_history AFTER INSERT OR UPDATE ON recruit_application FOR EACH ROW EXECUTE FUNCTION record_recruit_stage();
CREATE TRIGGER recruit_interview_guard BEFORE INSERT OR UPDATE ON recruit_interview FOR EACH ROW EXECUTE FUNCTION guard_recruit_interview();
CREATE TRIGGER recruit_interview_panel_guard BEFORE INSERT ON recruit_interview_panel FOR EACH ROW EXECUTE FUNCTION guard_recruit_interview_panel();
CREATE TRIGGER recruit_scorecard_guard BEFORE INSERT ON recruit_scorecard FOR EACH ROW EXECUTE FUNCTION guard_recruit_scorecard();
CREATE TRIGGER recruit_scorecard_rating AFTER INSERT ON recruit_scorecard FOR EACH ROW EXECUTE FUNCTION refresh_recruit_rating();
CREATE TRIGGER recruit_offer_guard BEFORE INSERT OR UPDATE ON recruit_offer FOR EACH ROW EXECUTE FUNCTION guard_recruit_offer();
CREATE TRIGGER recruit_stage_history_final BEFORE UPDATE ON recruit_stage_history FOR EACH ROW EXECUTE FUNCTION reject_recruit_rewrite();
CREATE TRIGGER recruit_interview_panel_final BEFORE UPDATE ON recruit_interview_panel FOR EACH ROW EXECUTE FUNCTION reject_recruit_rewrite();
CREATE TRIGGER recruit_scorecard_final BEFORE UPDATE ON recruit_scorecard FOR EACH ROW EXECUTE FUNCTION reject_recruit_rewrite();
CREATE TRIGGER job_requisition_no_delete BEFORE DELETE ON job_requisition FOR EACH ROW EXECUTE FUNCTION reject_recruit_delete();
CREATE TRIGGER ats_candidate_no_delete BEFORE DELETE ON ats_candidate FOR EACH ROW EXECUTE FUNCTION reject_recruit_delete();
CREATE TRIGGER recruit_application_no_delete BEFORE DELETE ON recruit_application FOR EACH ROW EXECUTE FUNCTION reject_recruit_delete();
CREATE TRIGGER recruit_stage_history_no_delete BEFORE DELETE ON recruit_stage_history FOR EACH ROW EXECUTE FUNCTION reject_recruit_delete();
CREATE TRIGGER recruit_interview_no_delete BEFORE DELETE ON recruit_interview FOR EACH ROW EXECUTE FUNCTION reject_recruit_delete();
CREATE TRIGGER recruit_interview_panel_no_delete BEFORE DELETE ON recruit_interview_panel FOR EACH ROW EXECUTE FUNCTION reject_recruit_delete();
CREATE TRIGGER recruit_scorecard_no_delete BEFORE DELETE ON recruit_scorecard FOR EACH ROW EXECUTE FUNCTION reject_recruit_delete();
CREATE TRIGGER recruit_offer_no_delete BEFORE DELETE ON recruit_offer FOR EACH ROW EXECUTE FUNCTION reject_recruit_delete();

-- Ownership and grants -------------------------------------------------------------------------
ALTER FUNCTION recruit_manages_req(uuid) OWNER TO anvione_recruit_keeper;
ALTER FUNCTION recruit_sees_req(uuid) OWNER TO anvione_recruit_keeper;
ALTER FUNCTION recruit_sees_application(uuid) OWNER TO anvione_recruit_keeper;
ALTER FUNCTION recruit_on_panel(uuid) OWNER TO anvione_recruit_keeper;
ALTER FUNCTION recruit_sees_interview(uuid) OWNER TO anvione_recruit_keeper;
ALTER FUNCTION recruit_sees_scorecard(uuid,uuid) OWNER TO anvione_recruit_keeper;
ALTER FUNCTION recruit_unit_in_effect(uuid,uuid,text,uuid) OWNER TO anvione_recruit_keeper;
ALTER FUNCTION recruit_employee_name(uuid,uuid,uuid) OWNER TO anvione_recruit_keeper;
ALTER FUNCTION recruit_active_offer(uuid) OWNER TO anvione_recruit_keeper;
ALTER FUNCTION recruit_check_candidate_free(uuid,uuid,timestamptz,timestamptz) OWNER TO anvione_recruit_keeper;
ALTER FUNCTION recruit_check_interviewer_free(uuid,uuid,timestamptz,timestamptz) OWNER TO anvione_recruit_keeper;
ALTER FUNCTION guard_job_requisition() OWNER TO anvione_recruit_keeper;
ALTER FUNCTION guard_ats_candidate() OWNER TO anvione_recruit_keeper;
ALTER FUNCTION guard_recruit_application() OWNER TO anvione_recruit_keeper;
ALTER FUNCTION guard_recruit_interview() OWNER TO anvione_recruit_keeper;
ALTER FUNCTION guard_recruit_interview_panel() OWNER TO anvione_recruit_keeper;
ALTER FUNCTION guard_recruit_scorecard() OWNER TO anvione_recruit_keeper;
ALTER FUNCTION guard_recruit_offer() OWNER TO anvione_recruit_keeper;
ALTER FUNCTION record_recruit_stage() OWNER TO anvione_recruit_writer;
ALTER FUNCTION refresh_recruit_rating() OWNER TO anvione_recruit_writer;
REVOKE ALL ON FUNCTION recruit_in_entity(uuid,uuid),recruit_manages_req(uuid),recruit_sees_req(uuid),
 recruit_sees_application(uuid),recruit_on_panel(uuid),recruit_sees_interview(uuid),recruit_sees_scorecard(uuid,uuid),
 recruit_stage_rank(text),recruit_unit_in_effect(uuid,uuid,text,uuid),recruit_employee_name(uuid,uuid,uuid),
 recruit_active_offer(uuid),recruit_check_candidate_free(uuid,uuid,timestamptz,timestamptz),
 recruit_check_interviewer_free(uuid,uuid,timestamptz,timestamptz),guard_job_requisition(),guard_ats_candidate(),
 guard_recruit_application(),guard_recruit_interview(),guard_recruit_interview_panel(),guard_recruit_scorecard(),
 guard_recruit_offer(),record_recruit_stage(),refresh_recruit_rating(),reject_recruit_delete(),reject_recruit_rewrite()
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recruit_in_entity(uuid,uuid),recruit_manages_req(uuid),recruit_sees_req(uuid),
 recruit_sees_application(uuid),recruit_on_panel(uuid),recruit_sees_interview(uuid),recruit_sees_scorecard(uuid,uuid)
 TO anvione_app;
GRANT EXECUTE ON FUNCTION recruit_in_entity(uuid,uuid),recruit_manages_req(uuid),recruit_sees_req(uuid),
 recruit_sees_application(uuid),recruit_on_panel(uuid),recruit_sees_interview(uuid),recruit_sees_scorecard(uuid,uuid),
 recruit_stage_rank(text),recruit_unit_in_effect(uuid,uuid,text,uuid),recruit_employee_name(uuid,uuid,uuid),
 recruit_active_offer(uuid),recruit_check_candidate_free(uuid,uuid,timestamptz,timestamptz),
 recruit_check_interviewer_free(uuid,uuid,timestamptz,timestamptz),org_entity_today(uuid,uuid)
 TO anvione_recruit_keeper;
GRANT SELECT ON job_requisition,ats_candidate,recruit_application,recruit_stage_history,recruit_interview,
 recruit_interview_panel,recruit_scorecard,recruit_offer,employee,person,org_unit TO anvione_recruit_keeper;
GRANT SELECT(tenant_id,entity_id,employee_id,active,roles) ON identity_binding TO anvione_recruit_keeper;
GRANT SELECT(id,tenant_id,entity_id) ON candidate_case TO anvione_recruit_keeper;
GRANT SELECT,INSERT ON recruit_stage_history TO anvione_recruit_writer;
GRANT SELECT(id), UPDATE(rating_average) ON recruit_application TO anvione_recruit_writer;

ALTER TABLE job_requisition ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_requisition FORCE ROW LEVEL SECURITY;
ALTER TABLE ats_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE ats_candidate FORCE ROW LEVEL SECURITY;
ALTER TABLE recruit_application ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruit_application FORCE ROW LEVEL SECURITY;
ALTER TABLE recruit_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruit_stage_history FORCE ROW LEVEL SECURITY;
ALTER TABLE recruit_interview ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruit_interview FORCE ROW LEVEL SECURITY;
ALTER TABLE recruit_interview_panel ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruit_interview_panel FORCE ROW LEVEL SECURITY;
ALTER TABLE recruit_scorecard ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruit_scorecard FORCE ROW LEVEL SECURITY;
ALTER TABLE recruit_offer ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruit_offer FORCE ROW LEVEL SECURITY;

CREATE POLICY recruit_keeper_emp ON employee FOR SELECT TO anvione_recruit_keeper USING(true);
CREATE POLICY recruit_keeper_person ON person FOR SELECT TO anvione_recruit_keeper USING(true);
CREATE POLICY recruit_keeper_org ON org_unit FOR SELECT TO anvione_recruit_keeper USING(true);
CREATE POLICY recruit_keeper_binding ON identity_binding FOR SELECT TO anvione_recruit_keeper USING(true);
CREATE POLICY recruit_keeper_case ON candidate_case FOR SELECT TO anvione_recruit_keeper USING(true);
CREATE POLICY recruit_keeper ON job_requisition FOR SELECT TO anvione_recruit_keeper USING(true);
CREATE POLICY recruit_keeper ON ats_candidate FOR SELECT TO anvione_recruit_keeper USING(true);
CREATE POLICY recruit_keeper ON recruit_application FOR SELECT TO anvione_recruit_keeper USING(true);
CREATE POLICY recruit_keeper ON recruit_stage_history FOR SELECT TO anvione_recruit_keeper USING(true);
CREATE POLICY recruit_keeper ON recruit_interview FOR SELECT TO anvione_recruit_keeper USING(true);
CREATE POLICY recruit_keeper ON recruit_interview_panel FOR SELECT TO anvione_recruit_keeper USING(true);
CREATE POLICY recruit_keeper ON recruit_scorecard FOR SELECT TO anvione_recruit_keeper USING(true);
CREATE POLICY recruit_keeper ON recruit_offer FOR SELECT TO anvione_recruit_keeper USING(true);
CREATE POLICY recruit_writer_read ON recruit_stage_history FOR SELECT TO anvione_recruit_writer USING(true);
CREATE POLICY recruit_writer_add ON recruit_stage_history FOR INSERT TO anvione_recruit_writer WITH CHECK(true);
CREATE POLICY recruit_writer_rating ON recruit_application FOR SELECT TO anvione_recruit_writer USING(true);
CREATE POLICY recruit_writer_rating_update ON recruit_application FOR UPDATE TO anvione_recruit_writer USING(true) WITH CHECK(true);

CREATE POLICY job_requisition_visible ON job_requisition FOR SELECT TO anvione_app
 USING(recruit_in_entity(tenant_id,entity_id) AND recruit_sees_req(id));
CREATE POLICY job_requisition_insert ON job_requisition FOR INSERT TO anvione_app
 WITH CHECK(recruit_in_entity(tenant_id,entity_id) AND current_setting('app.recruit_scope',true) IN ('team','entity'));
CREATE POLICY job_requisition_update ON job_requisition FOR UPDATE TO anvione_app
 USING(recruit_in_entity(tenant_id,entity_id) AND recruit_sees_req(id)) WITH CHECK(recruit_in_entity(tenant_id,entity_id));
CREATE POLICY ats_candidate_hr ON ats_candidate TO anvione_app
 USING(recruit_in_entity(tenant_id,entity_id) AND current_setting('app.recruit_scope',true)='entity')
 WITH CHECK(recruit_in_entity(tenant_id,entity_id) AND current_setting('app.recruit_scope',true)='entity');
CREATE POLICY recruit_application_visible ON recruit_application FOR SELECT TO anvione_app
 USING(recruit_in_entity(tenant_id,entity_id) AND recruit_manages_req(requisition_id));
CREATE POLICY recruit_application_insert ON recruit_application FOR INSERT TO anvione_app
 WITH CHECK(recruit_in_entity(tenant_id,entity_id) AND current_setting('app.recruit_scope',true)='entity');
CREATE POLICY recruit_application_update ON recruit_application FOR UPDATE TO anvione_app
 USING(recruit_in_entity(tenant_id,entity_id) AND recruit_manages_req(requisition_id)) WITH CHECK(recruit_in_entity(tenant_id,entity_id));
CREATE POLICY recruit_stage_history_visible ON recruit_stage_history FOR SELECT TO anvione_app
 USING(recruit_in_entity(tenant_id,entity_id) AND recruit_sees_application(application_id));
CREATE POLICY recruit_interview_visible ON recruit_interview FOR SELECT TO anvione_app
 USING(recruit_in_entity(tenant_id,entity_id) AND (recruit_manages_req(requisition_id) OR recruit_on_panel(id)));
CREATE POLICY recruit_interview_insert ON recruit_interview FOR INSERT TO anvione_app
 WITH CHECK(recruit_in_entity(tenant_id,entity_id) AND current_setting('app.recruit_scope',true) IN ('team','entity'));
CREATE POLICY recruit_interview_update ON recruit_interview FOR UPDATE TO anvione_app
 USING(recruit_in_entity(tenant_id,entity_id) AND recruit_manages_req(requisition_id)) WITH CHECK(recruit_in_entity(tenant_id,entity_id));
CREATE POLICY recruit_interview_panel_visible ON recruit_interview_panel FOR SELECT TO anvione_app
 USING(recruit_in_entity(tenant_id,entity_id) AND recruit_sees_interview(interview_id));
CREATE POLICY recruit_interview_panel_insert ON recruit_interview_panel FOR INSERT TO anvione_app
 WITH CHECK(recruit_in_entity(tenant_id,entity_id) AND current_setting('app.recruit_scope',true) IN ('team','entity'));
CREATE POLICY recruit_scorecard_visible ON recruit_scorecard FOR SELECT TO anvione_app
 USING(recruit_in_entity(tenant_id,entity_id) AND recruit_sees_scorecard(application_id,interviewer_employee_id));
CREATE POLICY recruit_scorecard_insert ON recruit_scorecard FOR INSERT TO anvione_app
 WITH CHECK(recruit_in_entity(tenant_id,entity_id)
  AND interviewer_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
  AND current_setting('app.recruit_scope',true) IN ('self','team','entity'));
CREATE POLICY recruit_offer_hr ON recruit_offer TO anvione_app
 USING(recruit_in_entity(tenant_id,entity_id) AND current_setting('app.recruit_scope',true)='entity')
 WITH CHECK(recruit_in_entity(tenant_id,entity_id) AND current_setting('app.recruit_scope',true)='entity');

GRANT SELECT ON job_requisition,ats_candidate,recruit_application,recruit_stage_history,recruit_interview,
 recruit_interview_panel,recruit_scorecard,recruit_offer TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,title,department_id,location_id,designation_id,headcount,employment_type,
 hiring_manager_id,description,target_start) ON job_requisition TO anvione_app;
GRANT UPDATE(title,department_id,location_id,designation_id,headcount,employment_type,hiring_manager_id,description,
 target_start,status,status_note,version) ON job_requisition TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,name,email_sealed,phone_sealed,email_hash,current_company,total_experience_months,
 source,referrer_employee_id,consent_given,retention_until,notes) ON ats_candidate TO anvione_app;
GRANT UPDATE(retention_until,version) ON ats_candidate TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,candidate_id,requisition_id) ON recruit_application TO anvione_app;
GRANT UPDATE(stage,stage_reason,rejection_reason,version) ON recruit_application TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,application_id,round_name,scheduled_at,duration_minutes,mode,location_or_link)
 ON recruit_interview TO anvione_app;
GRANT UPDATE(scheduled_at,duration_minutes,mode,location_or_link,status,status_note,version) ON recruit_interview TO anvione_app;
GRANT INSERT(interview_id,employee_id,tenant_id,entity_id) ON recruit_interview_panel TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,interview_id,interviewer_employee_id,ratings,recommendation,comment)
 ON recruit_scorecard TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,application_id,department_id,location_id,designation_id,manager_id,proposed_joining_date)
 ON recruit_offer TO anvione_app;
GRANT UPDATE(status,status_note,responded_on,candidate_case_id,version) ON recruit_offer TO anvione_app;

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
 'recruit.application_created.v1','recruit.application_stage_changed.v1',
 'recruit.interview_scheduled.v1','recruit.interview_rescheduled.v1','recruit.interview_status_changed.v1',
 'recruit.scorecard_submitted.v1','recruit.offer_created.v1','recruit.offer_status_changed.v1'
));
