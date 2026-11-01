-- SHF-01 Shifts and rosters, backend only.
-- Templates (HR), shifts per person and date (HR for anyone, managers for their current direct
-- reports), entity-wide published roster weeks (HR), an append-only change history, swaps between
-- two people with an approver who is neither of them (four-eyes), open shifts that people claim and
-- the poster's side approves, and a configurable minimum rest. Conflicts (overlap, rest, approved
-- leave) are checked in the database under a per-person advisory lock. Planned hours are derived.
-- Visibility: self own (published weeks only), team own + current direct reports, manage entity.
-- Errors: SF003 bad input (400), SF004 conflict (409), SF005 forbidden (403).
CREATE ROLE anvione_shift_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE anvione_shift_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_shift_keeper, anvione_shift_writer;

-- Length of a shift in minutes from local start and end times; an end at or before the start
-- crosses midnight.
CREATE FUNCTION shf_span(p_start time, p_end time) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN p_end>p_start THEN (extract(epoch FROM p_end-p_start)/60)::integer
  ELSE 1440-(extract(epoch FROM p_start-p_end)/60)::integer END;
$$;

CREATE TABLE shf_setting (
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 min_rest_hours integer NOT NULL CHECK(min_rest_hours BETWEEN 0 AND 24),
 version integer NOT NULL CHECK(version>0),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,entity_id),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id)
);

CREATE TABLE shf_template (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^[A-Z0-9][A-Z0-9-]{1,11}$'),
 name text NOT NULL CHECK(char_length(name) BETWEEN 2 AND 60 AND name=btrim(name)),
 start_time time(0) NOT NULL CHECK(extract(second FROM start_time)=0),
 end_time time(0) NOT NULL CHECK(extract(second FROM end_time)=0),
 crosses_midnight boolean NOT NULL,
 break_minutes integer NOT NULL CHECK(break_minutes BETWEEN 0 AND 180),
 colour text NOT NULL CHECK(colour IN ('teal','indigo','amber','rose','slate','green','violet','sky')),
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 CHECK(crosses_midnight=(end_time<=start_time)),
 CHECK(shf_span(start_time,end_time) BETWEEN 15 AND 960),
 CHECK(break_minutes<shf_span(start_time,end_time)),
 CONSTRAINT shf_template_code_key UNIQUE(tenant_id,entity_id,code),
 UNIQUE(tenant_id,entity_id,id)
);

-- A published roster week (Monday start). Insert-only: publishing is final.
CREATE TABLE shf_week (
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 week_start date NOT NULL CHECK(extract(isodow FROM week_start)=1),
 published_at timestamptz NOT NULL DEFAULT now(),
 published_by_employee uuid NOT NULL,
 published_by_label text NOT NULL,
 CONSTRAINT shf_week_key PRIMARY KEY(tenant_id,entity_id,week_start),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 FOREIGN KEY(tenant_id,entity_id,published_by_employee) REFERENCES employee(tenant_id,entity_id,id)
);

CREATE TABLE shf_open_shift (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 template_id uuid NOT NULL,
 work_date date NOT NULL,
 start_at timestamp NOT NULL,
 end_at timestamp NOT NULL,
 break_minutes integer NOT NULL,
 audience text NOT NULL CHECK(audience IN ('entity','team')),
 manager_id uuid,
 status text NOT NULL CHECK(status IN ('open','filled','withdrawn')),
 assignment_id uuid,
 posted_by_employee uuid NOT NULL,
 posted_by_label text NOT NULL,
 filled_at timestamptz,
 withdrawn_at timestamptz,
 version integer NOT NULL CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,template_id) REFERENCES shf_template(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,manager_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,posted_by_employee) REFERENCES employee(tenant_id,entity_id,id),
 CHECK((audience='team')=(manager_id IS NOT NULL)),
 CHECK(audience<>'team' OR manager_id=posted_by_employee),
 CHECK(end_at>start_at),
 CHECK((status='filled')=(assignment_id IS NOT NULL AND filled_at IS NOT NULL)),
 CHECK((status='withdrawn')=(withdrawn_at IS NOT NULL)),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX shf_open_shift_idx ON shf_open_shift(tenant_id,entity_id,status,work_date);

CREATE TABLE shf_assignment (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 employee_name text NOT NULL,
 template_id uuid NOT NULL,
 work_date date NOT NULL,
 start_at timestamp NOT NULL,
 end_at timestamp NOT NULL,
 break_minutes integer NOT NULL CHECK(break_minutes>=0),
 status text NOT NULL CHECK(status IN ('active','cancelled')),
 source text NOT NULL CHECK(source IN ('assigned','swap','open_shift')),
 batch_id uuid,
 swap_id uuid,
 open_shift_id uuid,
 after_publish boolean NOT NULL DEFAULT false,
 change_reason text CHECK(char_length(change_reason) BETWEEN 3 AND 300 AND change_reason=btrim(change_reason)),
 assigned_by_employee uuid NOT NULL,
 assigned_by_label text NOT NULL,
 cancelled_at timestamptz,
 version integer NOT NULL CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,template_id) REFERENCES shf_template(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,open_shift_id) REFERENCES shf_open_shift(tenant_id,entity_id,id),
 CHECK(end_at>start_at AND start_at>=work_date AND start_at<work_date+1),
 CHECK((status='cancelled')=(cancelled_at IS NOT NULL)),
 CHECK((source='swap')=(swap_id IS NOT NULL)),
 CHECK(source<>'open_shift' OR open_shift_id IS NOT NULL),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX shf_assignment_person_idx ON shf_assignment(tenant_id,entity_id,employee_id,start_at) WHERE status='active';
CREATE INDEX shf_assignment_day_idx ON shf_assignment(tenant_id,entity_id,work_date,employee_id);
ALTER TABLE shf_open_shift ADD CONSTRAINT shf_open_shift_assignment_fk
 FOREIGN KEY(tenant_id,entity_id,assignment_id) REFERENCES shf_assignment(tenant_id,entity_id,id);
-- One filled shift per open shift.
CREATE UNIQUE INDEX shf_assignment_open_key ON shf_assignment(open_shift_id) WHERE open_shift_id IS NOT NULL;

-- Append-only change history, written only by the writer role from assignment changes.
CREATE TABLE shf_change (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 assignment_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 work_date date NOT NULL,
 kind text NOT NULL CHECK(kind IN ('assigned','claimed','cancelled','swapped_in','swapped_out')),
 after_publish boolean NOT NULL,
 reason text CHECK(char_length(reason) BETWEEN 3 AND 300),
 swap_id uuid,
 by_employee uuid NOT NULL,
 by_label text NOT NULL,
 at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,entity_id,assignment_id) REFERENCES shf_assignment(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 CHECK((kind IN ('swapped_in','swapped_out'))=(swap_id IS NOT NULL))
);
CREATE INDEX shf_change_assignment_idx ON shf_change(assignment_id,at);

CREATE TABLE shf_swap (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 work_date date NOT NULL,
 requester_id uuid NOT NULL,
 requester_name text NOT NULL,
 requester_assignment_id uuid NOT NULL,
 requester_template_id uuid NOT NULL,
 target_id uuid NOT NULL,
 target_name text NOT NULL,
 target_assignment_id uuid NOT NULL,
 target_template_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('proposed','accepted','declined','cancelled','approved','rejected')),
 responded_at timestamptz,
 decided_by_employee uuid,
 decided_by_label text,
 decided_at timestamptz,
 decision_reason text CHECK(char_length(decision_reason) BETWEEN 3 AND 300 AND decision_reason=btrim(decision_reason)),
 version integer NOT NULL CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,requester_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,target_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,requester_assignment_id) REFERENCES shf_assignment(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,target_assignment_id) REFERENCES shf_assignment(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,decided_by_employee) REFERENCES employee(tenant_id,entity_id,id),
 CHECK(requester_id<>target_id AND requester_assignment_id<>target_assignment_id),
 CHECK((status IN ('approved','rejected'))=(decided_at IS NOT NULL AND decided_by_employee IS NOT NULL)),
 CHECK(status<>'rejected' OR decision_reason IS NOT NULL),
 CHECK(status='rejected' OR decision_reason IS NULL),
 -- Four-eyes: the approver is neither person in the swap.
 CONSTRAINT shf_swap_four_eyes CHECK(decided_by_employee IS NULL
  OR (decided_by_employee<>requester_id AND decided_by_employee<>target_id)),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE UNIQUE INDEX shf_swap_open_requester_key ON shf_swap(requester_assignment_id) WHERE status IN ('proposed','accepted');
CREATE UNIQUE INDEX shf_swap_open_target_key ON shf_swap(target_assignment_id) WHERE status IN ('proposed','accepted');
CREATE INDEX shf_swap_people_idx ON shf_swap(tenant_id,entity_id,requester_id,target_id,created_at DESC);
ALTER TABLE shf_assignment ADD CONSTRAINT shf_assignment_swap_fk
 FOREIGN KEY(tenant_id,entity_id,swap_id) REFERENCES shf_swap(tenant_id,entity_id,id);

CREATE TABLE shf_claim (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 open_shift_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 employee_name text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','approved','rejected','withdrawn','not_selected')),
 decided_by_employee uuid,
 decided_by_label text,
 decided_at timestamptz,
 decision_reason text CHECK(char_length(decision_reason) BETWEEN 3 AND 300 AND decision_reason=btrim(decision_reason)),
 version integer NOT NULL CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,open_shift_id) REFERENCES shf_open_shift(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,decided_by_employee) REFERENCES employee(tenant_id,entity_id,id),
 CHECK((status IN ('approved','rejected'))=(decided_by_employee IS NOT NULL AND decided_at IS NOT NULL)),
 CHECK(status<>'rejected' OR decision_reason IS NOT NULL),
 CHECK(status='rejected' OR decision_reason IS NULL),
 -- Four-eyes: nobody approves their own claim.
 CONSTRAINT shf_claim_four_eyes CHECK(decided_by_employee IS NULL OR decided_by_employee<>employee_id),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE UNIQUE INDEX shf_claim_pending_key ON shf_claim(open_shift_id,employee_id) WHERE status='pending';
CREATE UNIQUE INDEX shf_claim_approved_key ON shf_claim(open_shift_id) WHERE status='approved';
CREATE INDEX shf_claim_employee_idx ON shf_claim(tenant_id,entity_id,employee_id,created_at DESC);

-- Helpers -----------------------------------------------------------------------------------
CREATE FUNCTION shf_in_entity(p_tenant uuid, p_entity uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(p_tenant=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND p_entity=nullif(current_setting('app.entity_id',true),'')::uuid,false);
$$;
CREATE FUNCTION shf_scope() RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN nullif(current_setting('app.employee_id',true),'') IS NULL
   OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN 'none'
  ELSE coalesce(nullif(current_setting('app.shift_scope',true),''),'none') END;
$$;
CREATE FUNCTION shf_me() RETURNS uuid
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT nullif(current_setting('app.employee_id',true),'')::uuid;
$$;
CREATE FUNCTION shf_label() RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
$$;
CREATE FUNCTION shf_week_of(p_day date) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT p_day-(extract(isodow FROM p_day)::integer-1);
$$;
-- Today in the caller's entity time zone.
CREATE FUNCTION shf_today() RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce((SELECT (now() AT TIME ZONE le.timezone)::date FROM public.legal_entity le
  WHERE le.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND le.id=nullif(current_setting('app.entity_id',true),'')::uuid),CURRENT_DATE);
$$;
-- Whether the week holding a date is published in the caller's entity.
CREATE FUNCTION shf_published(p_day date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.shf_week w
  WHERE w.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND w.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
   AND w.week_start=public.shf_week_of(p_day));
$$;
CREATE FUNCTION shf_min_rest_minutes() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce((SELECT s.min_rest_hours FROM public.shf_setting s
  WHERE s.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND s.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid),11)*60;
$$;
-- Whether an employee is currently a direct report of the caller (team scope only).
CREATE FUNCTION shf_is_report(p_employee uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.shf_scope()='team' AND EXISTS(SELECT 1 FROM public.employee e
  WHERE e.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND e.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
   AND e.id=p_employee AND e.manager_id=public.shf_me());
$$;
-- The caller's own manager (for team open shifts they may claim).
CREATE FUNCTION shf_my_manager() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT e.manager_id FROM public.employee e
 WHERE e.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND e.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid AND e.id=public.shf_me();
$$;
-- Who a shift or history row is visible to. Employees see their own only once the week is published.
CREATE FUNCTION shf_sees(p_tenant uuid, p_entity uuid, p_employee uuid, p_day date) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.shf_in_entity(p_tenant,p_entity) AND CASE public.shf_scope()
  WHEN 'manage' THEN true
  WHEN 'team' THEN public.shf_is_report(p_employee) OR (p_employee=public.shf_me() AND public.shf_published(p_day))
  WHEN 'self' THEN p_employee=public.shf_me() AND public.shf_published(p_day)
  ELSE false END;
$$;
-- Approved leave covering a date (derived flag; the caller can already see the shift row).
CREATE FUNCTION shf_on_leave(p_employee uuid, p_day date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.leave_request l
  WHERE l.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND l.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
   AND l.employee_id=p_employee AND l.state='approved' AND p_day BETWEEN l.start_date AND l.end_date);
$$;
-- A current employee of the caller's entity (active or on notice, joined by the date).
CREATE FUNCTION shf_person(p_employee uuid, p_day date)
RETURNS TABLE(name text, manager_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT p.name, e.manager_id FROM public.employee e
 JOIN public.person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
 WHERE e.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND e.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND e.id=p_employee AND e.status IN ('active','notice') AND e.joined_on<=p_day;
$$;
-- Conflict check for one person and one shift: approved leave on the date, overlap, or less than
-- the minimum rest between shifts. Returns the refusal message, or NULL. VOLATILE so that rows
-- inserted earlier by the same statement (a date range) are seen.
CREATE FUNCTION shf_conflict(p_employee uuid, p_day date, p_start timestamp, p_end timestamp, p_exclude uuid[])
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 rest integer := public.shf_min_rest_minutes();
 other record;
BEGIN
 IF EXISTS(SELECT 1 FROM public.leave_request l
   WHERE l.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
    AND l.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
    AND l.employee_id=p_employee AND l.state='approved' AND p_day BETWEEN l.start_date AND l.end_date) THEN
  RETURN format('This person is on approved leave on %s', p_day);
 END IF;
 SELECT a.start_at, a.end_at, a.work_date INTO other FROM public.shf_assignment a
 WHERE a.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND a.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND a.employee_id=p_employee AND a.status='active' AND NOT (a.id=ANY(coalesce(p_exclude,'{}')))
  AND a.start_at<p_end+make_interval(mins=>rest) AND a.end_at+make_interval(mins=>rest)>p_start
 ORDER BY a.start_at LIMIT 1;
 IF FOUND THEN
  IF other.start_at<p_end AND other.end_at>p_start THEN
   RETURN format('This overlaps another shift for this person on %s', other.work_date);
  END IF;
  RETURN format('This leaves less than %s hours of rest next to the shift on %s', rest/60, other.work_date);
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION shf_template_row(p_template uuid)
RETURNS TABLE(start_time time, end_time time, break_minutes integer, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT t.start_time, t.end_time, t.break_minutes, t.active FROM public.shf_template t
 WHERE t.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND t.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid AND t.id=p_template;
$$;
CREATE FUNCTION shf_lock_person(p_employee uuid) RETURNS void
LANGUAGE sql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT pg_advisory_xact_lock(hashtextextended('shf-person:'||p_employee::text,0));
$$;
-- Shared with publishing (exclusive): a shift write and a publish of its week never interleave.
CREATE FUNCTION shf_lock_week(p_day date, p_exclusive boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE k bigint := hashtextextended('shf-week:'||coalesce(current_setting('app.entity_id',true),'')||':'||public.shf_week_of(p_day)::text,0);
BEGIN
 IF p_exclusive THEN PERFORM pg_advisory_xact_lock(k); ELSE PERFORM pg_advisory_xact_lock_shared(k); END IF;
END $$;

CREATE FUNCTION shf_entity_check(p_tenant uuid, p_entity uuid) RETURNS void
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR p_entity IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This record belongs to another organization' USING ERRCODE='SF005';
 END IF;
END $$;

-- Settings and templates (shift.manage only) ---------------------------------------------------
CREATE FUNCTION guard_shf_setting() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.shf_entity_check(NEW.tenant_id,NEW.entity_id);
 IF public.shf_scope()<>'manage' THEN
  RAISE EXCEPTION 'Only HR changes shift settings' USING ERRCODE='SF005';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('shf-setting:'||NEW.entity_id::text,0));
 IF TG_OP='INSERT' THEN
  NEW.version := 1;
 ELSIF NEW.version<>OLD.version+1 OR (NEW.tenant_id,NEW.entity_id) IS DISTINCT FROM (OLD.tenant_id,OLD.entity_id) THEN
  RAISE EXCEPTION 'These settings changed. Reload them before trying again' USING ERRCODE='SF004';
 END IF;
 NEW.updated_by_label := public.shf_label();
 NEW.updated_at := now();
 RETURN NEW;
END $$;

CREATE FUNCTION guard_shf_template() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.shf_entity_check(NEW.tenant_id,NEW.entity_id);
 IF public.shf_scope()<>'manage' THEN
  RAISE EXCEPTION 'Only HR manages shift templates' USING ERRCODE='SF005';
 END IF;
 NEW.name := btrim(NEW.name);
 NEW.code := upper(btrim(NEW.code));
 NEW.crosses_midnight := NEW.end_time<=NEW.start_time;
 IF public.shf_span(NEW.start_time,NEW.end_time) NOT BETWEEN 15 AND 960 THEN
  RAISE EXCEPTION 'A shift lasts from 15 minutes to 16 hours' USING ERRCODE='SF003';
 END IF;
 IF NEW.break_minutes IS NULL OR NEW.break_minutes<0 OR NEW.break_minutes>180
   OR NEW.break_minutes>=public.shf_span(NEW.start_time,NEW.end_time) THEN
  RAISE EXCEPTION 'The unpaid break is 0 to 180 minutes and shorter than the shift' USING ERRCODE='SF003';
 END IF;
 IF TG_OP='INSERT' THEN
  NEW.version := 1;
  NEW.active := coalesce(NEW.active,true);
  NEW.created_by_label := public.shf_label();
  NEW.created_at := now();
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('shf-template:'||OLD.id::text,0));
  IF NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'This template changed. Reload it before trying again' USING ERRCODE='SF004';
  END IF;
  IF (NEW.id,NEW.tenant_id,NEW.entity_id,NEW.code,NEW.created_by_label,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.entity_id,OLD.code,OLD.created_by_label,OLD.created_at) THEN
   RAISE EXCEPTION 'A template code never changes' USING ERRCODE='SF004';
  END IF;
 END IF;
 NEW.updated_by_label := public.shf_label();
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Publishing a week (shift.manage only) ---------------------------------------------------------
CREATE FUNCTION guard_shf_week() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.shf_entity_check(NEW.tenant_id,NEW.entity_id);
 IF public.shf_scope()<>'manage' OR public.shf_me() IS NULL THEN
  RAISE EXCEPTION 'Only HR publishes a roster week' USING ERRCODE='SF005';
 END IF;
 IF NEW.week_start IS NULL OR extract(isodow FROM NEW.week_start)<>1 THEN
  RAISE EXCEPTION 'A roster week starts on a Monday' USING ERRCODE='SF003';
 END IF;
 IF NEW.week_start<public.shf_week_of(public.shf_today())-7 OR NEW.week_start>public.shf_today()+366 THEN
  RAISE EXCEPTION 'Publish a week from last week up to a year ahead' USING ERRCODE='SF003';
 END IF;
 PERFORM public.shf_lock_week(NEW.week_start,true);
 NEW.published_at := now();
 NEW.published_by_employee := public.shf_me();
 NEW.published_by_label := public.shf_label();
 RETURN NEW;
END $$;

-- Shifts (assignments) ------------------------------------------------------------------------
-- Inserts: HR for anyone, a manager for their current direct reports (source 'assigned'), or the
-- fill of an open shift from an approved claim (source 'open_shift', checked from the claim).
CREATE FUNCTION guard_shf_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := public.shf_me();
 scope text := public.shf_scope();
 today date := public.shf_today();
 who record;
 t record;
 o record;
 problem text;
BEGIN
 PERFORM public.shf_entity_check(NEW.tenant_id,NEW.entity_id);
 IF me IS NULL OR scope NOT IN ('self','team','manage') THEN
  RAISE EXCEPTION 'Your current workspace cannot plan shifts' USING ERRCODE='SF005';
 END IF;
 IF NEW.source='assigned' THEN
  IF scope NOT IN ('team','manage') THEN
   RAISE EXCEPTION 'Only HR and managers plan shifts' USING ERRCODE='SF005';
  END IF;
  IF NEW.work_date IS NULL OR NEW.work_date<today OR NEW.work_date>today+366 THEN
   RAISE EXCEPTION 'Choose dates from today up to a year ahead' USING ERRCODE='SF003';
  END IF;
  SELECT * INTO who FROM public.shf_person(NEW.employee_id,NEW.work_date);
  IF NOT FOUND OR (scope='team' AND who.manager_id IS DISTINCT FROM me) THEN
   RAISE EXCEPTION 'Choose a current employee you plan shifts for' USING ERRCODE='SF003';
  END IF;
  SELECT * INTO t FROM public.shf_template_row(NEW.template_id);
  IF NOT FOUND OR NOT t.active THEN
   RAISE EXCEPTION 'Choose an active shift template' USING ERRCODE='SF003';
  END IF;
  NEW.start_at := NEW.work_date+t.start_time;
  NEW.end_at := (NEW.work_date+t.start_time)+public.shf_span(t.start_time,t.end_time)*interval '1 minute';
  NEW.break_minutes := t.break_minutes;
  NEW.open_shift_id := NULL;
 ELSIF NEW.source='open_shift' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('shf-open:'||coalesce(NEW.open_shift_id::text,''),0));
  SELECT s.* INTO o FROM public.shf_open_shift s
  WHERE s.tenant_id=NEW.tenant_id AND s.entity_id=NEW.entity_id AND s.id=NEW.open_shift_id;
  IF NOT FOUND OR o.status<>'open' OR NOT EXISTS(SELECT 1 FROM public.shf_claim c
    WHERE c.open_shift_id=o.id AND c.employee_id=NEW.employee_id AND c.status='approved') THEN
   RAISE EXCEPTION 'Only an approved claim fills an open shift' USING ERRCODE='SF005';
  END IF;
  SELECT * INTO who FROM public.shf_person(NEW.employee_id,o.work_date);
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Choose a current employee you plan shifts for' USING ERRCODE='SF003';
  END IF;
  NEW.template_id := o.template_id;
  NEW.work_date := o.work_date;
  NEW.start_at := o.start_at;
  NEW.end_at := o.end_at;
  NEW.break_minutes := o.break_minutes;
 ELSE
  RAISE EXCEPTION 'Choose how the shift is planned' USING ERRCODE='SF003';
 END IF;
 PERFORM public.shf_lock_week(NEW.work_date,false);
 PERFORM public.shf_lock_person(NEW.employee_id);
 IF public.shf_published(NEW.work_date) THEN
  NEW.after_publish := true;
  IF NEW.source='assigned' THEN
   NEW.change_reason := nullif(btrim(NEW.change_reason),'');
   IF NEW.change_reason IS NULL OR char_length(NEW.change_reason) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'This week is published: give a reason of 3 to 300 characters' USING ERRCODE='SF003';
   END IF;
  ELSE
   NEW.change_reason := NULL;
  END IF;
 ELSE
  NEW.after_publish := false;
  NEW.change_reason := NULL;
 END IF;
 problem := public.shf_conflict(NEW.employee_id,NEW.work_date,NEW.start_at,NEW.end_at,ARRAY[NEW.id]);
 IF problem IS NOT NULL THEN
  RAISE EXCEPTION '%', problem USING ERRCODE='SF004';
 END IF;
 NEW.employee_name := who.name;
 NEW.status := 'active';
 NEW.swap_id := NULL;
 NEW.cancelled_at := NULL;
 NEW.assigned_by_employee := me;
 NEW.assigned_by_label := public.shf_label();
 NEW.version := 1;
 NEW.created_at := now();
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Updates: a cancellation by HR or the person's manager (status, reason), or a swap applied from
-- an approved swap (person columns; the app role has no grant on them). Checked from the facts.
CREATE FUNCTION guard_shf_assignment_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := public.shf_scope();
 s record;
 who record;
 problem text;
BEGIN
 PERFORM public.shf_entity_check(NEW.tenant_id,NEW.entity_id);
 IF NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'This shift changed. Reload it before trying again' USING ERRCODE='SF004';
 END IF;
 IF OLD.status<>'active' THEN
  RAISE EXCEPTION 'A cancelled shift cannot be changed' USING ERRCODE='SF004';
 END IF;
 IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
  -- Swap path.
  IF (to_jsonb(NEW)-ARRAY['employee_id','employee_name','source','swap_id','after_publish','change_reason','version','updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['employee_id','employee_name','source','swap_id','after_publish','change_reason','version','updated_at']) THEN
   RAISE EXCEPTION 'A shift changes only through its own actions' USING ERRCODE='SF004';
  END IF;
  SELECT x.* INTO s FROM public.shf_swap x WHERE x.tenant_id=NEW.tenant_id AND x.entity_id=NEW.entity_id AND x.id=NEW.swap_id;
  IF NOT FOUND OR s.status<>'approved'
    OR NOT ((OLD.id=s.requester_assignment_id AND OLD.employee_id=s.requester_id AND NEW.employee_id=s.target_id)
     OR (OLD.id=s.target_assignment_id AND OLD.employee_id=s.target_id AND NEW.employee_id=s.requester_id)) THEN
   RAISE EXCEPTION 'Only an approved swap moves a shift to someone else' USING ERRCODE='SF005';
  END IF;
  SELECT * INTO who FROM public.shf_person(NEW.employee_id,OLD.work_date);
  IF NOT FOUND THEN
   RAISE EXCEPTION 'One of these people is no longer a current employee' USING ERRCODE='SF004';
  END IF;
  PERFORM public.shf_lock_person(NEW.employee_id);
  problem := public.shf_conflict(NEW.employee_id,OLD.work_date,OLD.start_at,OLD.end_at,
   ARRAY[s.requester_assignment_id,s.target_assignment_id]);
  IF problem IS NOT NULL THEN
   RAISE EXCEPTION '%', problem USING ERRCODE='SF004';
  END IF;
  NEW.employee_name := who.name;
  NEW.source := 'swap';
  NEW.change_reason := NULL;
  NEW.after_publish := OLD.after_publish OR public.shf_published(OLD.work_date);
  NEW.updated_at := now();
  RETURN NEW;
 END IF;
 -- Cancellation path.
 IF scope<>'manage' AND NOT (scope='team' AND public.shf_is_report(OLD.employee_id)) THEN
  RAISE EXCEPTION 'Only HR or the person''s manager cancels a shift' USING ERRCODE='SF005';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','change_reason','version','after_publish','cancelled_at','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','change_reason','version','after_publish','cancelled_at','updated_at'])
   OR NEW.status<>'cancelled' THEN
  RAISE EXCEPTION 'A shift can only be cancelled' USING ERRCODE='SF004';
 END IF;
 IF OLD.work_date<public.shf_today() THEN
  RAISE EXCEPTION 'A past shift cannot be cancelled' USING ERRCODE='SF004';
 END IF;
 PERFORM public.shf_lock_week(OLD.work_date,false);
 IF public.shf_published(OLD.work_date) THEN
  NEW.change_reason := nullif(btrim(NEW.change_reason),'');
  IF NEW.change_reason IS NULL OR char_length(NEW.change_reason) NOT BETWEEN 3 AND 300 THEN
   RAISE EXCEPTION 'This week is published: give a reason of 3 to 300 characters' USING ERRCODE='SF003';
  END IF;
  NEW.after_publish := true;
 ELSE
  NEW.change_reason := NULL;
  NEW.after_publish := OLD.after_publish;
 END IF;
 NEW.cancelled_at := now();
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Writer-owned: the append-only history row for every shift change.
CREATE FUNCTION record_shf_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := public.shf_me();
 label text := public.shf_label();
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.shf_change(id,tenant_id,entity_id,assignment_id,employee_id,work_date,kind,after_publish,reason,by_employee,by_label)
  VALUES (gen_random_uuid(),NEW.tenant_id,NEW.entity_id,NEW.id,NEW.employee_id,NEW.work_date,
   CASE NEW.source WHEN 'open_shift' THEN 'claimed' ELSE 'assigned' END,NEW.after_publish,NEW.change_reason,me,label);
 ELSIF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
  INSERT INTO public.shf_change(id,tenant_id,entity_id,assignment_id,employee_id,work_date,kind,after_publish,swap_id,by_employee,by_label)
  VALUES (gen_random_uuid(),NEW.tenant_id,NEW.entity_id,NEW.id,OLD.employee_id,NEW.work_date,'swapped_out',NEW.after_publish,NEW.swap_id,me,label),
   (gen_random_uuid(),NEW.tenant_id,NEW.entity_id,NEW.id,NEW.employee_id,NEW.work_date,'swapped_in',NEW.after_publish,NEW.swap_id,me,label);
 ELSIF NEW.status='cancelled' AND OLD.status='active' THEN
  INSERT INTO public.shf_change(id,tenant_id,entity_id,assignment_id,employee_id,work_date,kind,after_publish,reason,by_employee,by_label)
  VALUES (gen_random_uuid(),NEW.tenant_id,NEW.entity_id,NEW.id,NEW.employee_id,NEW.work_date,'cancelled',NEW.after_publish,NEW.change_reason,me,label);
 END IF;
 RETURN NULL;
END $$;

-- Swaps -------------------------------------------------------------------------------------------
CREATE FUNCTION guard_shf_swap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := public.shf_me();
 scope text := public.shf_scope();
 mine record;
 theirs record;
 who record;
 n integer;
 problem text;
BEGIN
 PERFORM public.shf_entity_check(NEW.tenant_id,NEW.entity_id);
 IF me IS NULL OR scope NOT IN ('self','team','manage') THEN
  RAISE EXCEPTION 'Your current workspace cannot swap shifts' USING ERRCODE='SF005';
 END IF;
 SELECT a.* INTO mine FROM public.shf_assignment a
 WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id AND a.id=NEW.requester_assignment_id;
 -- One answer whether the shift is missing, someone else's, cancelled, past or unpublished.
 IF NOT FOUND OR mine.employee_id<>me OR mine.status<>'active' OR mine.work_date<public.shf_today()
   OR NOT public.shf_published(mine.work_date) THEN
  RAISE EXCEPTION 'Choose one of your own upcoming published shifts' USING ERRCODE='SF003';
 END IF;
 SELECT * INTO who FROM public.shf_person(NEW.target_id,mine.work_date);
 IF NEW.target_id IS NULL OR NEW.target_id=me OR NOT FOUND THEN
  RAISE EXCEPTION 'This colleague has no published shift that day' USING ERRCODE='SF003';
 END IF;
 SELECT count(*)::integer INTO n FROM public.shf_assignment a
 WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id AND a.employee_id=NEW.target_id
  AND a.work_date=mine.work_date AND a.status='active';
 IF n=0 THEN
  RAISE EXCEPTION 'This colleague has no published shift that day' USING ERRCODE='SF003';
 ELSIF n>1 THEN
  RAISE EXCEPTION 'This colleague has more than one shift that day; ask your manager' USING ERRCODE='SF004';
 END IF;
 SELECT a.* INTO theirs FROM public.shf_assignment a
 WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id AND a.employee_id=NEW.target_id
  AND a.work_date=mine.work_date AND a.status='active';
 PERFORM pg_advisory_xact_lock(hashtextextended('shf-swap-shift:'||least(mine.id,theirs.id)::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('shf-swap-shift:'||greatest(mine.id,theirs.id)::text,0));
 IF EXISTS(SELECT 1 FROM public.shf_swap x WHERE x.status IN ('proposed','accepted')
   AND (x.requester_assignment_id IN (mine.id,theirs.id) OR x.target_assignment_id IN (mine.id,theirs.id))) THEN
  RAISE EXCEPTION 'One of these shifts is already in an open swap' USING ERRCODE='SF004';
 END IF;
 problem := coalesce(public.shf_conflict(NEW.target_id,mine.work_date,mine.start_at,mine.end_at,ARRAY[mine.id,theirs.id]),
  public.shf_conflict(me,theirs.work_date,theirs.start_at,theirs.end_at,ARRAY[mine.id,theirs.id]));
 IF problem IS NOT NULL THEN
  RAISE EXCEPTION '%', problem USING ERRCODE='SF004';
 END IF;
 NEW.work_date := mine.work_date;
 NEW.requester_id := me;
 NEW.requester_name := (SELECT p.name FROM public.shf_person(me,mine.work_date) p);
 NEW.requester_template_id := mine.template_id;
 NEW.target_assignment_id := theirs.id;
 NEW.target_name := who.name;
 NEW.target_template_id := theirs.template_id;
 IF NEW.requester_name IS NULL THEN
  RAISE EXCEPTION 'Your current workspace cannot swap shifts' USING ERRCODE='SF005';
 END IF;
 NEW.status := 'proposed';
 NEW.responded_at := NULL;
 NEW.decided_by_employee := NULL;
 NEW.decided_by_label := NULL;
 NEW.decided_at := NULL;
 NEW.decision_reason := NULL;
 NEW.version := 1;
 NEW.created_at := now();
 NEW.updated_at := now();
 RETURN NEW;
END $$;

CREATE FUNCTION guard_shf_swap_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := public.shf_me();
 scope text := public.shf_scope();
BEGIN
 PERFORM public.shf_entity_check(NEW.tenant_id,NEW.entity_id);
 IF me IS NULL OR scope NOT IN ('self','team','manage') THEN
  RAISE EXCEPTION 'Your current workspace cannot swap shifts' USING ERRCODE='SF005';
 END IF;
 IF NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'This swap changed. Reload it before trying again' USING ERRCODE='SF004';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','decision_reason','version','responded_at','decided_by_employee','decided_by_label','decided_at','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','decision_reason','version','responded_at','decided_by_employee','decided_by_label','decided_at','updated_at']) THEN
  RAISE EXCEPTION 'A swap changes only through its own actions' USING ERRCODE='SF004';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('shf-swap:'||OLD.id::text,0));
 IF OLD.status IN ('proposed','accepted') AND NEW.status<>'cancelled' AND OLD.work_date<public.shf_today() THEN
  RAISE EXCEPTION 'This swap''s date has passed' USING ERRCODE='SF004';
 END IF;
 IF OLD.status='proposed' AND NEW.status IN ('accepted','declined') THEN
  IF me<>OLD.target_id THEN
   RAISE EXCEPTION 'Only the colleague asked answers this swap' USING ERRCODE='SF005';
  END IF;
  NEW.decision_reason := NULL;
  NEW.responded_at := now();
 ELSIF OLD.status IN ('proposed','accepted') AND NEW.status='cancelled' THEN
  IF me<>OLD.requester_id THEN
   RAISE EXCEPTION 'Only the person who proposed a swap cancels it' USING ERRCODE='SF005';
  END IF;
  NEW.decision_reason := NULL;
 ELSIF OLD.status='accepted' AND NEW.status IN ('approved','rejected') THEN
  IF me IN (OLD.requester_id,OLD.target_id) THEN
   RAISE EXCEPTION 'Someone other than the two people in a swap decides it' USING ERRCODE='SF005';
  END IF;
  IF NOT (scope='manage' OR (scope='team' AND public.shf_is_report(OLD.requester_id) AND public.shf_is_report(OLD.target_id))) THEN
   RAISE EXCEPTION 'Only HR, or a manager of both people, decides this swap' USING ERRCODE='SF005';
  END IF;
  IF NEW.status='rejected' THEN
   NEW.decision_reason := nullif(btrim(NEW.decision_reason),'');
   IF NEW.decision_reason IS NULL OR char_length(NEW.decision_reason) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'Give a reason of 3 to 300 characters' USING ERRCODE='SF003';
   END IF;
  ELSE
   NEW.decision_reason := NULL;
  END IF;
  NEW.decided_by_employee := me;
  NEW.decided_by_label := public.shf_label();
  NEW.decided_at := now();
 ELSE
  RAISE EXCEPTION 'A swap cannot move from % to %', OLD.status, NEW.status USING ERRCODE='SF004';
 END IF;
 IF NEW.status NOT IN ('approved','rejected') THEN
  NEW.decided_by_employee := NULL;
  NEW.decided_by_label := NULL;
  NEW.decided_at := NULL;
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Writer-owned: on approval both shifts change hands in the same transaction.
CREATE FUNCTION apply_shf_swap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n integer;
BEGIN
 IF NEW.status<>'approved' OR OLD.status='approved' THEN
  RETURN NULL;
 END IF;
 PERFORM public.shf_lock_week(NEW.work_date,false);
 PERFORM public.shf_lock_person(least(NEW.requester_id,NEW.target_id));
 PERFORM public.shf_lock_person(greatest(NEW.requester_id,NEW.target_id));
 SELECT count(*)::integer INTO n FROM public.shf_assignment a
 WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id AND a.status='active'
  AND ((a.id=NEW.requester_assignment_id AND a.employee_id=NEW.requester_id)
   OR (a.id=NEW.target_assignment_id AND a.employee_id=NEW.target_id));
 IF n<>2 THEN
  RAISE EXCEPTION 'One of these shifts changed since the swap was proposed' USING ERRCODE='SF004';
 END IF;
 UPDATE public.shf_assignment SET employee_id=NEW.target_id, swap_id=NEW.id, version=version+1
 WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND id=NEW.requester_assignment_id;
 UPDATE public.shf_assignment SET employee_id=NEW.requester_id, swap_id=NEW.id, version=version+1
 WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND id=NEW.target_assignment_id;
 RETURN NULL;
END $$;

-- Open shifts and claims ------------------------------------------------------------------------
CREATE FUNCTION guard_shf_open_shift() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := public.shf_me();
 scope text := public.shf_scope();
 today date := public.shf_today();
 t record;
BEGIN
 PERFORM public.shf_entity_check(NEW.tenant_id,NEW.entity_id);
 IF me IS NULL OR scope NOT IN ('team','manage') THEN
  RAISE EXCEPTION 'Only HR and managers post open shifts' USING ERRCODE='SF005';
 END IF;
 IF NEW.work_date IS NULL OR NEW.work_date<today OR NEW.work_date>today+366 THEN
  RAISE EXCEPTION 'Choose a date from today up to a year ahead' USING ERRCODE='SF003';
 END IF;
 SELECT * INTO t FROM public.shf_template_row(NEW.template_id);
 IF NOT FOUND OR NOT t.active THEN
  RAISE EXCEPTION 'Choose an active shift template' USING ERRCODE='SF003';
 END IF;
 NEW.start_at := NEW.work_date+t.start_time;
 NEW.end_at := (NEW.work_date+t.start_time)+public.shf_span(t.start_time,t.end_time)*interval '1 minute';
 NEW.break_minutes := t.break_minutes;
 NEW.audience := CASE scope WHEN 'manage' THEN 'entity' ELSE 'team' END;
 NEW.manager_id := CASE scope WHEN 'manage' THEN NULL ELSE me END;
 NEW.status := 'open';
 NEW.assignment_id := NULL;
 NEW.filled_at := NULL;
 NEW.withdrawn_at := NULL;
 NEW.posted_by_employee := me;
 NEW.posted_by_label := public.shf_label();
 NEW.version := 1;
 NEW.created_at := now();
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Updates: withdrawn by the poster or HR, or filled from its approved claim's shift.
CREATE FUNCTION guard_shf_open_shift_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope text := public.shf_scope();
BEGIN
 PERFORM public.shf_entity_check(NEW.tenant_id,NEW.entity_id);
 IF NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'This open shift changed. Reload it before trying again' USING ERRCODE='SF004';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','assignment_id','filled_at','withdrawn_at','version','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','assignment_id','filled_at','withdrawn_at','version','updated_at']) THEN
  RAISE EXCEPTION 'An open shift changes only through its own actions' USING ERRCODE='SF004';
 END IF;
 IF OLD.status<>'open' THEN
  RAISE EXCEPTION 'This open shift is already %', OLD.status USING ERRCODE='SF004';
 END IF;
 IF NEW.status='filled' THEN
  IF NOT EXISTS(SELECT 1 FROM public.shf_assignment a WHERE a.id=NEW.assignment_id AND a.open_shift_id=OLD.id
    AND a.tenant_id=OLD.tenant_id AND a.entity_id=OLD.entity_id) THEN
   RAISE EXCEPTION 'Only an approved claim fills an open shift' USING ERRCODE='SF005';
  END IF;
  NEW.filled_at := now();
  NEW.withdrawn_at := NULL;
 ELSIF NEW.status='withdrawn' THEN
  IF scope<>'manage' AND NOT (scope='team' AND OLD.manager_id=public.shf_me()) THEN
   RAISE EXCEPTION 'Only the poster or HR withdraws an open shift' USING ERRCODE='SF005';
  END IF;
  NEW.assignment_id := NULL;
  NEW.filled_at := NULL;
  NEW.withdrawn_at := now();
 ELSE
  RAISE EXCEPTION 'An open shift cannot move from % to %', OLD.status, NEW.status USING ERRCODE='SF004';
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Writer-owned: a withdrawn open shift closes its pending claims.
CREATE FUNCTION apply_shf_open_withdrawn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.status='withdrawn' AND OLD.status='open' THEN
  UPDATE public.shf_claim SET status='not_selected', version=version+1
  WHERE open_shift_id=NEW.id AND status='pending';
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION guard_shf_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := public.shf_me();
 scope text := public.shf_scope();
 o record;
 who record;
 problem text;
BEGIN
 PERFORM public.shf_entity_check(NEW.tenant_id,NEW.entity_id);
 IF me IS NULL OR scope NOT IN ('self','team','manage') THEN
  RAISE EXCEPTION 'Your current workspace cannot claim shifts' USING ERRCODE='SF005';
 END IF;
 IF NEW.employee_id IS DISTINCT FROM me THEN
  RAISE EXCEPTION 'You can claim only for yourself' USING ERRCODE='SF005';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('shf-open:'||coalesce(NEW.open_shift_id::text,''),0));
 SELECT s.* INTO o FROM public.shf_open_shift s
 WHERE s.tenant_id=NEW.tenant_id AND s.entity_id=NEW.entity_id AND s.id=NEW.open_shift_id;
 SELECT * INTO who FROM public.shf_person(me,coalesce(o.work_date,public.shf_today()));
 -- One answer whether it is missing, closed, past or not open to the caller.
 IF o.id IS NULL OR o.status<>'open' OR o.work_date<public.shf_today() OR who.name IS NULL
   OR (o.audience='team' AND who.manager_id IS DISTINCT FROM o.manager_id) THEN
  RAISE EXCEPTION 'This open shift is unavailable' USING ERRCODE='SF003';
 END IF;
 PERFORM public.shf_lock_person(me);
 IF EXISTS(SELECT 1 FROM public.shf_claim c WHERE c.open_shift_id=o.id AND c.employee_id=me AND c.status='pending') THEN
  RAISE EXCEPTION 'You already claimed this open shift' USING ERRCODE='SF004';
 END IF;
 problem := public.shf_conflict(me,o.work_date,o.start_at,o.end_at,'{}');
 IF problem IS NOT NULL THEN
  RAISE EXCEPTION '%', replace(problem,'This person is','You are') USING ERRCODE='SF004';
 END IF;
 NEW.employee_name := who.name;
 NEW.status := 'pending';
 NEW.decided_by_employee := NULL;
 NEW.decided_by_label := NULL;
 NEW.decided_at := NULL;
 NEW.decision_reason := NULL;
 NEW.version := 1;
 NEW.created_at := now();
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Updates: withdrawn by the claimant; approved or rejected by HR or the posting manager (never the
-- claimant); not selected once the open shift is filled or withdrawn.
CREATE FUNCTION guard_shf_claim_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := public.shf_me();
 scope text := public.shf_scope();
 o record;
BEGIN
 PERFORM public.shf_entity_check(NEW.tenant_id,NEW.entity_id);
 IF NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'This claim changed. Reload it before trying again' USING ERRCODE='SF004';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','decision_reason','version','decided_by_employee','decided_by_label','decided_at','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','decision_reason','version','decided_by_employee','decided_by_label','decided_at','updated_at']) THEN
  RAISE EXCEPTION 'A claim changes only through its own actions' USING ERRCODE='SF004';
 END IF;
 IF OLD.status<>'pending' THEN
  RAISE EXCEPTION 'This claim is already %', replace(OLD.status,'_',' ') USING ERRCODE='SF004';
 END IF;
 SELECT s.* INTO o FROM public.shf_open_shift s WHERE s.id=OLD.open_shift_id;
 IF NEW.status='not_selected' THEN
  IF o.status='open' THEN
   RAISE EXCEPTION 'This open shift is still open' USING ERRCODE='SF004';
  END IF;
  NEW.decision_reason := NULL;
  NEW.decided_by_employee := NULL;
  NEW.decided_by_label := NULL;
  NEW.decided_at := NULL;
  NEW.updated_at := now();
  RETURN NEW;
 END IF;
 IF me IS NULL OR scope NOT IN ('self','team','manage') THEN
  RAISE EXCEPTION 'Your current workspace cannot change claims' USING ERRCODE='SF005';
 END IF;
 IF NEW.status='withdrawn' THEN
  IF me<>OLD.employee_id THEN
   RAISE EXCEPTION 'Only the claimant withdraws a claim' USING ERRCODE='SF005';
  END IF;
  NEW.decision_reason := NULL;
  NEW.decided_by_employee := NULL;
  NEW.decided_by_label := NULL;
  NEW.decided_at := NULL;
 ELSIF NEW.status IN ('approved','rejected') THEN
  IF me=OLD.employee_id THEN
   RAISE EXCEPTION 'Someone else decides your own claim' USING ERRCODE='SF005';
  END IF;
  IF NOT (scope='manage' OR (scope='team' AND o.audience='team' AND o.manager_id=me AND public.shf_is_report(OLD.employee_id))) THEN
   RAISE EXCEPTION 'Only HR or the manager who posted this open shift decides claims' USING ERRCODE='SF005';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('shf-open:'||OLD.open_shift_id::text,0));
  SELECT s.* INTO o FROM public.shf_open_shift s WHERE s.id=OLD.open_shift_id;
  IF o.status<>'open' THEN
   RAISE EXCEPTION 'This open shift is already %', o.status USING ERRCODE='SF004';
  END IF;
  IF NEW.status='rejected' THEN
   NEW.decision_reason := nullif(btrim(NEW.decision_reason),'');
   IF NEW.decision_reason IS NULL OR char_length(NEW.decision_reason) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'Give a reason of 3 to 300 characters' USING ERRCODE='SF003';
   END IF;
  ELSE
   NEW.decision_reason := NULL;
  END IF;
  NEW.decided_by_employee := me;
  NEW.decided_by_label := public.shf_label();
  NEW.decided_at := now();
 ELSE
  RAISE EXCEPTION 'A claim cannot move from % to %', OLD.status, NEW.status USING ERRCODE='SF004';
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Writer-owned: an approved claim creates the shift, fills the open shift and closes the others.
CREATE FUNCTION apply_shf_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE shift_id uuid := gen_random_uuid();
BEGIN
 IF NEW.status<>'approved' OR OLD.status='approved' THEN
  RETURN NULL;
 END IF;
 INSERT INTO public.shf_assignment(id,tenant_id,entity_id,employee_id,template_id,work_date,start_at,end_at,break_minutes,source,open_shift_id)
 SELECT shift_id,s.tenant_id,s.entity_id,NEW.employee_id,s.template_id,s.work_date,s.start_at,s.end_at,s.break_minutes,'open_shift',s.id
 FROM public.shf_open_shift s WHERE s.id=NEW.open_shift_id;
 UPDATE public.shf_open_shift SET status='filled', assignment_id=shift_id, version=version+1 WHERE id=NEW.open_shift_id;
 UPDATE public.shf_claim SET status='not_selected', version=version+1
 WHERE open_shift_id=NEW.open_shift_id AND status='pending' AND id<>NEW.id;
 RETURN NULL;
END $$;

CREATE FUNCTION reject_shf_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Shift records are kept, never deleted' USING ERRCODE='23514';
END $$;
CREATE FUNCTION reject_shf_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'This record is final' USING ERRCODE='SF004';
END $$;
CREATE FUNCTION guard_shf_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF current_user<>'anvione_shift_writer' THEN
  RAISE EXCEPTION 'Shift history is written only from shift changes' USING ERRCODE='SF005';
 END IF;
 NEW.at := clock_timestamp();
 RETURN NEW;
END $$;

CREATE TRIGGER shf_setting_guard BEFORE INSERT OR UPDATE ON shf_setting FOR EACH ROW EXECUTE FUNCTION guard_shf_setting();
CREATE TRIGGER shf_template_guard BEFORE INSERT OR UPDATE ON shf_template FOR EACH ROW EXECUTE FUNCTION guard_shf_template();
CREATE TRIGGER shf_week_guard BEFORE INSERT ON shf_week FOR EACH ROW EXECUTE FUNCTION guard_shf_week();
CREATE TRIGGER shf_week_final BEFORE UPDATE ON shf_week FOR EACH ROW EXECUTE FUNCTION reject_shf_rewrite();
CREATE TRIGGER shf_assignment_guard BEFORE INSERT ON shf_assignment FOR EACH ROW EXECUTE FUNCTION guard_shf_assignment();
CREATE TRIGGER shf_assignment_guard_update BEFORE UPDATE ON shf_assignment FOR EACH ROW EXECUTE FUNCTION guard_shf_assignment_update();
CREATE TRIGGER shf_assignment_history AFTER INSERT OR UPDATE ON shf_assignment FOR EACH ROW EXECUTE FUNCTION record_shf_change();
CREATE TRIGGER shf_change_guard BEFORE INSERT ON shf_change FOR EACH ROW EXECUTE FUNCTION guard_shf_change();
CREATE TRIGGER shf_change_final BEFORE UPDATE ON shf_change FOR EACH ROW EXECUTE FUNCTION reject_shf_rewrite();
CREATE TRIGGER shf_swap_guard BEFORE INSERT ON shf_swap FOR EACH ROW EXECUTE FUNCTION guard_shf_swap();
CREATE TRIGGER shf_swap_guard_update BEFORE UPDATE ON shf_swap FOR EACH ROW EXECUTE FUNCTION guard_shf_swap_update();
CREATE TRIGGER shf_swap_apply AFTER UPDATE ON shf_swap FOR EACH ROW EXECUTE FUNCTION apply_shf_swap();
CREATE TRIGGER shf_open_shift_guard BEFORE INSERT ON shf_open_shift FOR EACH ROW EXECUTE FUNCTION guard_shf_open_shift();
CREATE TRIGGER shf_open_shift_guard_update BEFORE UPDATE ON shf_open_shift FOR EACH ROW EXECUTE FUNCTION guard_shf_open_shift_update();
CREATE TRIGGER shf_open_shift_withdrawn AFTER UPDATE ON shf_open_shift FOR EACH ROW EXECUTE FUNCTION apply_shf_open_withdrawn();
CREATE TRIGGER shf_claim_guard BEFORE INSERT ON shf_claim FOR EACH ROW EXECUTE FUNCTION guard_shf_claim();
CREATE TRIGGER shf_claim_guard_update BEFORE UPDATE ON shf_claim FOR EACH ROW EXECUTE FUNCTION guard_shf_claim_update();
CREATE TRIGGER shf_claim_apply AFTER UPDATE ON shf_claim FOR EACH ROW EXECUTE FUNCTION apply_shf_claim();
CREATE TRIGGER shf_setting_no_delete BEFORE DELETE ON shf_setting FOR EACH ROW EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_template_no_delete BEFORE DELETE ON shf_template FOR EACH ROW EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_week_no_delete BEFORE DELETE ON shf_week FOR EACH ROW EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_assignment_no_delete BEFORE DELETE ON shf_assignment FOR EACH ROW EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_change_no_delete BEFORE DELETE ON shf_change FOR EACH ROW EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_swap_no_delete BEFORE DELETE ON shf_swap FOR EACH ROW EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_open_shift_no_delete BEFORE DELETE ON shf_open_shift FOR EACH ROW EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_claim_no_delete BEFORE DELETE ON shf_claim FOR EACH ROW EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_setting_no_truncate BEFORE TRUNCATE ON shf_setting FOR EACH STATEMENT EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_template_no_truncate BEFORE TRUNCATE ON shf_template FOR EACH STATEMENT EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_week_no_truncate BEFORE TRUNCATE ON shf_week FOR EACH STATEMENT EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_assignment_no_truncate BEFORE TRUNCATE ON shf_assignment FOR EACH STATEMENT EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_change_no_truncate BEFORE TRUNCATE ON shf_change FOR EACH STATEMENT EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_swap_no_truncate BEFORE TRUNCATE ON shf_swap FOR EACH STATEMENT EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_open_shift_no_truncate BEFORE TRUNCATE ON shf_open_shift FOR EACH STATEMENT EXECUTE FUNCTION reject_shf_delete();
CREATE TRIGGER shf_claim_no_truncate BEFORE TRUNCATE ON shf_claim FOR EACH STATEMENT EXECUTE FUNCTION reject_shf_delete();
-- Guards, writers and delete blocks fire in replica sessions too.
DO $$
DECLARE r record;
BEGIN
 FOR r IN SELECT c.relname AS t, g.tgname AS name FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE NOT g.tgisinternal AND n.nspname='public' AND c.relname LIKE 'shf\_%' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I', r.t, r.name);
 END LOOP;
END $$;

-- Ownership and grants -------------------------------------------------------------------------
-- keeper: reads people, leave, legal entities and shift tables for the guards and helpers; writes
-- nothing. writer: history rows, swap application, open-shift fills and closing claims.
ALTER FUNCTION shf_today() OWNER TO anvione_shift_keeper;
ALTER FUNCTION shf_published(date) OWNER TO anvione_shift_keeper;
ALTER FUNCTION shf_min_rest_minutes() OWNER TO anvione_shift_keeper;
ALTER FUNCTION shf_is_report(uuid) OWNER TO anvione_shift_keeper;
ALTER FUNCTION shf_my_manager() OWNER TO anvione_shift_keeper;
ALTER FUNCTION shf_on_leave(uuid,date) OWNER TO anvione_shift_keeper;
ALTER FUNCTION shf_person(uuid,date) OWNER TO anvione_shift_keeper;
ALTER FUNCTION shf_conflict(uuid,date,timestamp,timestamp,uuid[]) OWNER TO anvione_shift_keeper;
ALTER FUNCTION shf_template_row(uuid) OWNER TO anvione_shift_keeper;
ALTER FUNCTION guard_shf_assignment() OWNER TO anvione_shift_keeper;
ALTER FUNCTION guard_shf_assignment_update() OWNER TO anvione_shift_keeper;
ALTER FUNCTION guard_shf_swap() OWNER TO anvione_shift_keeper;
ALTER FUNCTION guard_shf_swap_update() OWNER TO anvione_shift_keeper;
ALTER FUNCTION guard_shf_open_shift() OWNER TO anvione_shift_keeper;
ALTER FUNCTION guard_shf_open_shift_update() OWNER TO anvione_shift_keeper;
ALTER FUNCTION guard_shf_claim() OWNER TO anvione_shift_keeper;
ALTER FUNCTION guard_shf_claim_update() OWNER TO anvione_shift_keeper;
ALTER FUNCTION record_shf_change() OWNER TO anvione_shift_writer;
ALTER FUNCTION apply_shf_swap() OWNER TO anvione_shift_writer;
ALTER FUNCTION apply_shf_open_withdrawn() OWNER TO anvione_shift_writer;
ALTER FUNCTION apply_shf_claim() OWNER TO anvione_shift_writer;
REVOKE ALL ON FUNCTION shf_span(time,time),shf_in_entity(uuid,uuid),shf_scope(),shf_me(),shf_label(),shf_week_of(date),
 shf_today(),shf_published(date),shf_min_rest_minutes(),shf_is_report(uuid),shf_my_manager(),
 shf_sees(uuid,uuid,uuid,date),shf_on_leave(uuid,date),shf_person(uuid,date),
 shf_conflict(uuid,date,timestamp,timestamp,uuid[]),shf_template_row(uuid),shf_lock_person(uuid),
 shf_lock_week(date,boolean),shf_entity_check(uuid,uuid),guard_shf_setting(),guard_shf_template(),guard_shf_week(),
 guard_shf_assignment(),guard_shf_assignment_update(),record_shf_change(),guard_shf_swap(),guard_shf_swap_update(),
 apply_shf_swap(),guard_shf_open_shift(),guard_shf_open_shift_update(),apply_shf_open_withdrawn(),guard_shf_claim(),
 guard_shf_claim_update(),apply_shf_claim(),reject_shf_delete(),reject_shf_rewrite(),guard_shf_change() FROM PUBLIC;
-- The app reads through the visibility helpers and derived flags; guards call the rest as owners.
GRANT EXECUTE ON FUNCTION shf_span(time,time),shf_in_entity(uuid,uuid),shf_scope(),shf_me(),shf_label(),shf_week_of(date),
 shf_today(),shf_published(date),shf_is_report(uuid),shf_my_manager(),shf_sees(uuid,uuid,uuid,date),
 shf_on_leave(uuid,date),shf_lock_person(uuid),shf_lock_week(date,boolean),shf_entity_check(uuid,uuid)
 TO anvione_app;
GRANT EXECUTE ON FUNCTION shf_span(time,time),shf_in_entity(uuid,uuid),shf_scope(),shf_me(),shf_label(),shf_week_of(date),
 shf_today(),shf_published(date),shf_min_rest_minutes(),shf_is_report(uuid),shf_my_manager(),
 shf_sees(uuid,uuid,uuid,date),shf_on_leave(uuid,date),shf_person(uuid,date),
 shf_conflict(uuid,date,timestamp,timestamp,uuid[]),shf_template_row(uuid),shf_lock_person(uuid),
 shf_lock_week(date,boolean),shf_entity_check(uuid,uuid)
 TO anvione_shift_keeper, anvione_shift_writer;

GRANT SELECT ON employee,person,legal_entity,leave_request,shf_setting,shf_template,shf_week,shf_assignment,
 shf_swap,shf_open_shift,shf_claim TO anvione_shift_keeper;
GRANT SELECT ON shf_assignment,shf_swap,shf_open_shift,shf_claim TO anvione_shift_writer;
GRANT INSERT(id,tenant_id,entity_id,assignment_id,employee_id,work_date,kind,after_publish,reason,swap_id,by_employee,by_label)
 ON shf_change TO anvione_shift_writer;
GRANT INSERT(id,tenant_id,entity_id,employee_id,template_id,work_date,start_at,end_at,break_minutes,source,open_shift_id)
 ON shf_assignment TO anvione_shift_writer;
GRANT UPDATE(employee_id,swap_id,version) ON shf_assignment TO anvione_shift_writer;
GRANT UPDATE(status,assignment_id,version) ON shf_open_shift TO anvione_shift_writer;
GRANT UPDATE(status,version) ON shf_claim TO anvione_shift_writer;

ALTER TABLE shf_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE shf_setting FORCE ROW LEVEL SECURITY;
ALTER TABLE shf_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE shf_template FORCE ROW LEVEL SECURITY;
ALTER TABLE shf_week ENABLE ROW LEVEL SECURITY;
ALTER TABLE shf_week FORCE ROW LEVEL SECURITY;
ALTER TABLE shf_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE shf_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE shf_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE shf_change FORCE ROW LEVEL SECURITY;
ALTER TABLE shf_swap ENABLE ROW LEVEL SECURITY;
ALTER TABLE shf_swap FORCE ROW LEVEL SECURITY;
ALTER TABLE shf_open_shift ENABLE ROW LEVEL SECURITY;
ALTER TABLE shf_open_shift FORCE ROW LEVEL SECURITY;
ALTER TABLE shf_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE shf_claim FORCE ROW LEVEL SECURITY;

CREATE POLICY shf_keeper_emp ON employee FOR SELECT TO anvione_shift_keeper USING(true);
CREATE POLICY shf_keeper_person ON person FOR SELECT TO anvione_shift_keeper USING(true);
CREATE POLICY shf_keeper_leave ON leave_request FOR SELECT TO anvione_shift_keeper USING(true);
CREATE POLICY shf_keeper ON shf_setting FOR SELECT TO anvione_shift_keeper USING(true);
CREATE POLICY shf_keeper ON shf_template FOR SELECT TO anvione_shift_keeper USING(true);
CREATE POLICY shf_keeper ON shf_week FOR SELECT TO anvione_shift_keeper USING(true);
CREATE POLICY shf_keeper ON shf_assignment FOR SELECT TO anvione_shift_keeper USING(true);
CREATE POLICY shf_keeper ON shf_swap FOR SELECT TO anvione_shift_keeper USING(true);
CREATE POLICY shf_keeper ON shf_open_shift FOR SELECT TO anvione_shift_keeper USING(true);
CREATE POLICY shf_keeper ON shf_claim FOR SELECT TO anvione_shift_keeper USING(true);
CREATE POLICY shf_writer_read ON shf_assignment FOR SELECT TO anvione_shift_writer USING(true);
CREATE POLICY shf_writer_insert ON shf_assignment FOR INSERT TO anvione_shift_writer WITH CHECK(source='open_shift');
CREATE POLICY shf_writer_update ON shf_assignment FOR UPDATE TO anvione_shift_writer USING(true) WITH CHECK(source='swap');
CREATE POLICY shf_writer_insert ON shf_change FOR INSERT TO anvione_shift_writer WITH CHECK(true);
CREATE POLICY shf_writer_read ON shf_swap FOR SELECT TO anvione_shift_writer USING(true);
CREATE POLICY shf_writer_read ON shf_open_shift FOR SELECT TO anvione_shift_writer USING(true);
CREATE POLICY shf_writer_update ON shf_open_shift FOR UPDATE TO anvione_shift_writer USING(true) WITH CHECK(status='filled');
CREATE POLICY shf_writer_read ON shf_claim FOR SELECT TO anvione_shift_writer USING(true);
CREATE POLICY shf_writer_update ON shf_claim FOR UPDATE TO anvione_shift_writer USING(true) WITH CHECK(status='not_selected');

-- Settings, templates and published weeks: readable by anyone with a shift scope in the entity.
CREATE POLICY shf_setting_visible ON shf_setting FOR SELECT TO anvione_app
 USING(shf_in_entity(tenant_id,entity_id) AND shf_scope() IN ('self','team','manage'));
CREATE POLICY shf_setting_insert ON shf_setting FOR INSERT TO anvione_app
 WITH CHECK(shf_in_entity(tenant_id,entity_id) AND shf_scope()='manage');
CREATE POLICY shf_setting_update ON shf_setting FOR UPDATE TO anvione_app
 USING(shf_in_entity(tenant_id,entity_id) AND shf_scope()='manage') WITH CHECK(shf_in_entity(tenant_id,entity_id));
CREATE POLICY shf_template_visible ON shf_template FOR SELECT TO anvione_app
 USING(shf_in_entity(tenant_id,entity_id) AND shf_scope() IN ('self','team','manage'));
CREATE POLICY shf_template_insert ON shf_template FOR INSERT TO anvione_app
 WITH CHECK(shf_in_entity(tenant_id,entity_id) AND shf_scope()='manage');
CREATE POLICY shf_template_update ON shf_template FOR UPDATE TO anvione_app
 USING(shf_in_entity(tenant_id,entity_id) AND shf_scope()='manage') WITH CHECK(shf_in_entity(tenant_id,entity_id));
CREATE POLICY shf_week_visible ON shf_week FOR SELECT TO anvione_app
 USING(shf_in_entity(tenant_id,entity_id) AND shf_scope() IN ('self','team','manage'));
CREATE POLICY shf_week_insert ON shf_week FOR INSERT TO anvione_app
 WITH CHECK(shf_in_entity(tenant_id,entity_id) AND shf_scope()='manage');
-- Shifts and history.
CREATE POLICY shf_assignment_visible ON shf_assignment FOR SELECT TO anvione_app
 USING(shf_sees(tenant_id,entity_id,employee_id,work_date));
CREATE POLICY shf_assignment_insert ON shf_assignment FOR INSERT TO anvione_app
 WITH CHECK(shf_in_entity(tenant_id,entity_id) AND source='assigned'
  AND (shf_scope()='manage' OR (shf_scope()='team' AND shf_is_report(employee_id))));
CREATE POLICY shf_assignment_update ON shf_assignment FOR UPDATE TO anvione_app
 USING(shf_in_entity(tenant_id,entity_id) AND (shf_scope()='manage' OR (shf_scope()='team' AND shf_is_report(employee_id))))
 WITH CHECK(shf_in_entity(tenant_id,entity_id));
CREATE POLICY shf_change_visible ON shf_change FOR SELECT TO anvione_app
 USING(shf_sees(tenant_id,entity_id,employee_id,work_date));
-- Swaps: the two people, and approvers who may decide them.
CREATE POLICY shf_swap_visible ON shf_swap FOR SELECT TO anvione_app
 USING(shf_in_entity(tenant_id,entity_id) AND shf_scope() IN ('self','team','manage')
  AND (requester_id=shf_me() OR target_id=shf_me() OR shf_scope()='manage'
   OR (shf_is_report(requester_id) AND shf_is_report(target_id))));
CREATE POLICY shf_swap_insert ON shf_swap FOR INSERT TO anvione_app
 WITH CHECK(shf_in_entity(tenant_id,entity_id) AND shf_scope() IN ('self','team','manage') AND requester_id=shf_me());
CREATE POLICY shf_swap_update ON shf_swap FOR UPDATE TO anvione_app
 USING(shf_in_entity(tenant_id,entity_id) AND shf_scope() IN ('self','team','manage')
  AND (requester_id=shf_me() OR target_id=shf_me() OR shf_scope()='manage'
   OR (shf_is_report(requester_id) AND shf_is_report(target_id))))
 WITH CHECK(shf_in_entity(tenant_id,entity_id));
-- Open shifts: HR all; the posting manager; open ones the caller may claim; ones they claimed.
CREATE POLICY shf_open_shift_visible ON shf_open_shift FOR SELECT TO anvione_app
 USING(shf_in_entity(tenant_id,entity_id) AND shf_scope() IN ('self','team','manage')
  AND (shf_scope()='manage' OR manager_id=shf_me()
   OR (status='open' AND (audience='entity' OR manager_id=shf_my_manager()))
   OR EXISTS(SELECT 1 FROM shf_claim c WHERE c.open_shift_id=shf_open_shift.id AND c.employee_id=shf_me())));
CREATE POLICY shf_open_shift_insert ON shf_open_shift FOR INSERT TO anvione_app
 WITH CHECK(shf_in_entity(tenant_id,entity_id) AND shf_scope() IN ('team','manage'));
CREATE POLICY shf_open_shift_update ON shf_open_shift FOR UPDATE TO anvione_app
 USING(shf_in_entity(tenant_id,entity_id) AND (shf_scope()='manage' OR (shf_scope()='team' AND manager_id=shf_me())))
 WITH CHECK(shf_in_entity(tenant_id,entity_id));
-- Claims: the claimant, HR, and the manager who posted the open shift.
CREATE FUNCTION shf_open_poster(p_open uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT s.manager_id FROM public.shf_open_shift s
 WHERE s.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND s.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid AND s.id=p_open;
$$;
ALTER FUNCTION shf_open_poster(uuid) OWNER TO anvione_shift_keeper;
REVOKE ALL ON FUNCTION shf_open_poster(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shf_open_poster(uuid) TO anvione_app;
CREATE POLICY shf_claim_visible ON shf_claim FOR SELECT TO anvione_app
 USING(shf_in_entity(tenant_id,entity_id) AND shf_scope() IN ('self','team','manage')
  AND (employee_id=shf_me() OR shf_scope()='manage' OR (shf_scope()='team' AND shf_open_poster(open_shift_id)=shf_me())));
CREATE POLICY shf_claim_insert ON shf_claim FOR INSERT TO anvione_app
 WITH CHECK(shf_in_entity(tenant_id,entity_id) AND shf_scope() IN ('self','team','manage') AND employee_id=shf_me());
CREATE POLICY shf_claim_update ON shf_claim FOR UPDATE TO anvione_app
 USING(shf_in_entity(tenant_id,entity_id) AND shf_scope() IN ('self','team','manage')
  AND (employee_id=shf_me() OR shf_scope()='manage' OR (shf_scope()='team' AND shf_open_poster(open_shift_id)=shf_me())))
 WITH CHECK(shf_in_entity(tenant_id,entity_id));

GRANT SELECT ON shf_setting,shf_template,shf_week,shf_assignment,shf_change,shf_swap,shf_open_shift,shf_claim TO anvione_app;
GRANT INSERT(tenant_id,entity_id,min_rest_hours) ON shf_setting TO anvione_app;
GRANT UPDATE(min_rest_hours,version) ON shf_setting TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,code,name,start_time,end_time,break_minutes,colour,active) ON shf_template TO anvione_app;
GRANT UPDATE(name,start_time,end_time,break_minutes,colour,active,version) ON shf_template TO anvione_app;
GRANT INSERT(tenant_id,entity_id,week_start) ON shf_week TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,employee_id,template_id,work_date,source,batch_id,change_reason) ON shf_assignment TO anvione_app;
GRANT UPDATE(status,change_reason,version) ON shf_assignment TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,requester_assignment_id,target_id) ON shf_swap TO anvione_app;
GRANT UPDATE(status,decision_reason,version) ON shf_swap TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,template_id,work_date) ON shf_open_shift TO anvione_app;
GRANT UPDATE(status,version) ON shf_open_shift TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,open_shift_id,employee_id) ON shf_claim TO anvione_app;
GRANT UPDATE(status,decision_reason,version) ON shf_claim TO anvione_app;

-- Outbox event types: rebuilt from the constraint as it stands when this runs (so types added by
-- any migration applied before this one are kept), plus the shift events.
DO $$
DECLARE
 def text;
 types text[];
BEGIN
 SELECT pg_get_constraintdef(c.oid) INTO def FROM pg_constraint c
 WHERE c.conrelid='public.outbox_event'::regclass AND c.conname='outbox_event_event_type_check';
 SELECT coalesce(array_agg(DISTINCT m[1]),'{}') INTO types FROM regexp_matches(coalesce(def,''),'''([a-z0-9_.]+)''','g') AS m;
 IF cardinality(types)<100 THEN
  RAISE EXCEPTION 'Could not read the existing outbox event types';
 END IF;
 types := types||ARRAY['shift.settings_updated.v1','shift.template_created.v1','shift.template_updated.v1',
  'shift.assigned.v1','shift.cancelled.v1','shift.week_published.v1','shift.swap_proposed.v1',
  'shift.swap_accepted.v1','shift.swap_declined.v1','shift.swap_cancelled.v1','shift.swap_approved.v1',
  'shift.swap_rejected.v1','shift.open_posted.v1','shift.open_withdrawn.v1','shift.open_claimed.v1',
  'shift.claim_withdrawn.v1','shift.claim_approved.v1','shift.claim_rejected.v1'];
 ALTER TABLE public.outbox_event DROP CONSTRAINT outbox_event_event_type_check;
 EXECUTE format('ALTER TABLE public.outbox_event ADD CONSTRAINT outbox_event_event_type_check CHECK(event_type IN (%s))',
  (SELECT string_agg(quote_literal(x),',' ORDER BY x) FROM (SELECT DISTINCT unnest(types) AS x) u));
END $$;
