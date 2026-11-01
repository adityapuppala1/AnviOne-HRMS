-- F0.12 calendar: an entity work week and entity- or location-scoped holidays.
-- HR writes through the existing organization scope; every workspace reads.
CREATE ROLE anvione_calendar_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_calendar_keeper;

CREATE TABLE work_week (
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 days smallint[] NOT NULL CHECK(
  cardinality(days) BETWEEN 1 AND 7 AND days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,entity_id),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id)
);
INSERT INTO work_week(tenant_id,entity_id,days)
SELECT tenant_id,id,ARRAY[1,2,3,4,5]::smallint[] FROM legal_entity;

-- New legal entities start with a Monday–Friday week and the default leave types,
-- matching the backfill above and in migration 015. Entities are created only by
-- privileged operators, so this trigger runs with their rights.
CREATE FUNCTION initialize_entity_calendar() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 INSERT INTO work_week(tenant_id,entity_id,days) VALUES(NEW.tenant_id,NEW.id,ARRAY[1,2,3,4,5]::smallint[])
 ON CONFLICT DO NOTHING;
 INSERT INTO leave_type(id,tenant_id,entity_id,code,name,annual_days,paid)
 SELECT gen_random_uuid(),NEW.tenant_id,NEW.id,t.code,t.name,t.days,t.paid
 FROM (VALUES ('CL','Casual leave',12.0,true),('SL','Sick leave',12.0,true),
  ('EL','Earned leave',15.0,true),('LOP','Leave without pay',NULL::numeric,false)) AS t(code,name,days,paid)
 ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;
CREATE TRIGGER legal_entity_calendar AFTER INSERT ON legal_entity
FOR EACH ROW EXECUTE FUNCTION initialize_entity_calendar();
REVOKE ALL ON FUNCTION initialize_entity_calendar() FROM PUBLIC;

CREATE TABLE holiday (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 location_id uuid,
 location_kind text GENERATED ALWAYS AS ('location'::text) STORED,
 holiday_date date NOT NULL,
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 2 AND 60 AND name=btrim(name)),
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 FOREIGN KEY(tenant_id,entity_id,location_kind,location_id)
  REFERENCES org_unit(tenant_id,entity_id,kind,id)
);
CREATE UNIQUE INDEX holiday_active_key ON holiday(tenant_id,entity_id,holiday_date,
 coalesce(location_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE active;
CREATE INDEX holiday_year_idx ON holiday(tenant_id,entity_id,holiday_date);

CREATE FUNCTION guard_holiday() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.location_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM org_unit o
    WHERE o.tenant_id=NEW.tenant_id AND o.entity_id=NEW.entity_id AND o.kind='location'
     AND o.id=NEW.location_id AND o.active) THEN
   RAISE EXCEPTION 'Choose an active work location' USING ERRCODE='CL003';
  END IF;
  NEW.active := true;
  NEW.version := 1;
  NEW.updated_at := now();
  RETURN NEW;
 END IF;
 -- Generated columns are still empty in NEW during BEFORE triggers.
 IF (to_jsonb(NEW)-ARRAY['name','active','version','updated_at','location_kind'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','active','version','updated_at','location_kind'])
   OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'A holiday keeps its date and location; add a new one instead' USING ERRCODE='CL004';
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

CREATE FUNCTION guard_work_week() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.entity_id<>OLD.entity_id OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'The work week changes one version at a time' USING ERRCODE='CL004';
 END IF;
 NEW.days := ARRAY(SELECT DISTINCT d FROM unnest(NEW.days) d ORDER BY d);
 NEW.updated_at := now();
 RETURN NEW;
END $$;

CREATE FUNCTION reject_calendar_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Deactivate a holiday instead of deleting it' USING ERRCODE='23514';
END $$;

CREATE TRIGGER holiday_guard BEFORE INSERT OR UPDATE ON holiday
FOR EACH ROW EXECUTE FUNCTION guard_holiday();
CREATE TRIGGER holiday_no_delete BEFORE DELETE ON holiday
FOR EACH ROW EXECUTE FUNCTION reject_calendar_delete();
CREATE TRIGGER work_week_guard BEFORE UPDATE ON work_week
FOR EACH ROW EXECUTE FUNCTION guard_work_week();
CREATE TRIGGER work_week_no_delete BEFORE DELETE ON work_week
FOR EACH ROW EXECUTE FUNCTION reject_calendar_delete();

-- Business days for one employee: their entity's work week minus active holidays
-- that apply entity-wide or to their work location.
CREATE FUNCTION calendar_business_days(p_tenant uuid,p_entity uuid,p_employee uuid,p_start date,p_end date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT count(*)::numeric FROM generate_series(p_start,p_end,interval '1 day') d
 WHERE extract(isodow FROM d)::smallint = ANY(coalesce(
   (SELECT w.days FROM public.work_week w WHERE w.tenant_id=p_tenant AND w.entity_id=p_entity),
   ARRAY[1,2,3,4,5]::smallint[]))
  AND NOT EXISTS(
   SELECT 1 FROM public.holiday h
   WHERE h.tenant_id=p_tenant AND h.entity_id=p_entity AND h.active AND h.holiday_date=d::date
    AND (h.location_id IS NULL OR h.location_id=(
     SELECT e.location_id FROM public.employee e
     WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.id=p_employee)));
$$;
ALTER FUNCTION calendar_business_days(uuid,uuid,uuid,date,date) OWNER TO anvione_calendar_keeper;
REVOKE ALL ON FUNCTION calendar_business_days(uuid,uuid,uuid,date,date),guard_holiday(),
 guard_work_week(),reject_calendar_delete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendar_business_days(uuid,uuid,uuid,date,date) TO anvione_leave_keeper;
GRANT SELECT ON holiday,work_week,employee TO anvione_calendar_keeper;

ALTER TABLE work_week ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_week FORCE ROW LEVEL SECURITY;
ALTER TABLE holiday ENABLE ROW LEVEL SECURITY;
ALTER TABLE holiday FORCE ROW LEVEL SECURITY;
CREATE POLICY employee_calendar_keeper ON employee FOR SELECT TO anvione_calendar_keeper USING(true);
CREATE POLICY holiday_calendar_keeper ON holiday FOR SELECT TO anvione_calendar_keeper USING(true);
CREATE POLICY work_week_calendar_keeper ON work_week FOR SELECT TO anvione_calendar_keeper USING(true);
CREATE POLICY holiday_read ON holiday FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
);
CREATE POLICY holiday_insert ON holiday FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.hr_scope',true)='write'
);
CREATE POLICY holiday_update ON holiday FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.hr_scope',true)='write'
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.hr_scope',true)='write'
 );
CREATE POLICY work_week_read ON work_week FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
);
CREATE POLICY work_week_update ON work_week FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.hr_scope',true)='write'
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.hr_scope',true)='write'
 );
GRANT SELECT ON holiday,work_week TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,location_id,holiday_date,name) ON holiday TO anvione_app;
GRANT UPDATE(name,active,version) ON holiday TO anvione_app;
GRANT UPDATE(days,version) ON work_week TO anvione_app;

ALTER TABLE outbox_event DROP CONSTRAINT outbox_event_event_type_check;
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_event_type_check CHECK(event_type IN (
 'branding.published.v1','organization.created.v1','organization.updated.v1',
 'candidate.created.v1','candidate.invited.v1','candidate.revoked.v1','candidate.reviewed.v1',
 'candidate.submitted.v1','candidate.checklist_started.v1','candidate.task_created.v1','candidate.task_updated.v1',
 'candidate.local_review_proposed.v1','candidate.local_review_decided.v1','candidate.local_review_withdrawn.v1',
 'candidate.task_assigned.v1','candidate.assigned_task_updated.v1',
 'leave.requested.v1','leave.approved.v1','leave.rejected.v1','leave.cancelled.v1',
 'attendance.checked_in.v1','attendance.checked_out.v1',
 'attendance.correction_requested.v1','attendance.correction_approved.v1',
 'attendance.correction_rejected.v1','attendance.correction_cancelled.v1',
 'calendar.holiday_created.v1','calendar.holiday_updated.v1','calendar.work_week_updated.v1'
));

-- Leave now counts business days from the calendar instead of Monday–Friday.
CREATE OR REPLACE FUNCTION guard_leave_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 scope text := coalesce(current_setting('app.leave_scope',true),'none');
 today date;
 kind record;
 used numeric;
 reserved numeric;
 manager uuid;
BEGIN
 SELECT (now() AT TIME ZONE le.timezone)::date INTO today
 FROM legal_entity le WHERE le.tenant_id=NEW.tenant_id AND le.id=NEW.entity_id;
 IF today IS NULL THEN
  RAISE EXCEPTION 'Your workspace calendar is unavailable' USING ERRCODE='LV006';
 END IF;

 IF TG_OP='INSERT' THEN
  IF me IS NULL OR NEW.employee_id<>me OR scope NOT IN ('self','team')
    OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
    OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
   RAISE EXCEPTION 'Leave can only be requested for yourself' USING ERRCODE='LV006';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('leave:'||NEW.employee_id::text,0));
  SELECT e.manager_id INTO manager FROM employee e
  WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=NEW.employee_id
   AND e.status IN ('active','notice');
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Only current employees can request leave' USING ERRCODE='LV006';
  END IF;
  IF nullif(current_setting('app.actor_id',true),'') IS NULL THEN
   RAISE EXCEPTION 'Sign in again before requesting leave' USING ERRCODE='LV006';
  END IF;
  IF NEW.end_date < NEW.start_date OR NEW.end_date-NEW.start_date > 31
    OR date_part('year',NEW.start_date)<>date_part('year',NEW.end_date) THEN
   RAISE EXCEPTION 'Choose up to 31 days within one calendar year' USING ERRCODE='LV003';
  END IF;
  IF NEW.start_date < today-7 OR NEW.start_date > today+365 THEN
   RAISE EXCEPTION 'Leave must start within the last 7 days or the next year' USING ERRCODE='LV003';
  END IF;
  NEW.days := calendar_business_days(NEW.tenant_id,NEW.entity_id,NEW.employee_id,NEW.start_date,NEW.end_date);
  IF NEW.days=0 THEN
   RAISE EXCEPTION 'Choose dates that include a working day' USING ERRCODE='LV003';
  END IF;
  SELECT * INTO kind FROM leave_type t
  WHERE t.tenant_id=NEW.tenant_id AND t.entity_id=NEW.entity_id AND t.id=NEW.leave_type_id AND t.active;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'This leave type is unavailable' USING ERRCODE='LV003';
  END IF;
  IF EXISTS(
   SELECT 1 FROM leave_request r
   WHERE r.tenant_id=NEW.tenant_id AND r.employee_id=NEW.employee_id
    AND r.state IN ('pending','approved')
    AND daterange(r.start_date,r.end_date,'[]') && daterange(NEW.start_date,NEW.end_date,'[]')
  ) THEN
   RAISE EXCEPTION 'These dates overlap another leave request' USING ERRCODE='LV001';
  END IF;
  IF kind.annual_days IS NOT NULL THEN
   SELECT coalesce(sum(CASE WHEN l.kind='debit' THEN l.days ELSE -l.days END),0) INTO used
   FROM leave_ledger l
   WHERE l.tenant_id=NEW.tenant_id AND l.employee_id=NEW.employee_id
    AND l.leave_type_id=NEW.leave_type_id AND l.leave_year=date_part('year',NEW.start_date);
   SELECT coalesce(sum(r.days),0) INTO reserved FROM leave_request r
   WHERE r.tenant_id=NEW.tenant_id AND r.employee_id=NEW.employee_id
    AND r.leave_type_id=NEW.leave_type_id AND r.state='pending'
    AND date_part('year',r.start_date)=date_part('year',NEW.start_date);
   IF kind.annual_days-used-reserved < NEW.days THEN
    RAISE EXCEPTION 'Not enough leave balance for these dates' USING ERRCODE='LV002';
   END IF;
  END IF;
  NEW.manager_id := manager;
  NEW.approver := CASE WHEN manager IS NULL THEN 'hr' ELSE 'manager' END;
  NEW.state := 'pending';
  NEW.version := 1;
  NEW.requested_by_actor := nullif(current_setting('app.actor_id',true),'')::uuid;
  NEW.created_at := now();
  NEW.decided_at := NULL;
  NEW.decided_by_employee := NULL;
  NEW.decided_by_label := NULL;
  NEW.decision_note := NULL;
  RETURN NEW;
 END IF;

 -- UPDATE: only the workflow columns may change, one version at a time.
 IF (to_jsonb(NEW)-ARRAY['state','version','decided_at','decided_by_employee','decided_by_label','decision_note'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','decided_at','decided_by_employee','decided_by_label','decision_note'])
   OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'Leave requests change only through their workflow' USING ERRCODE='LV004';
 END IF;
 IF OLD.state IN ('rejected','cancelled') OR NEW.state=OLD.state THEN
  RAISE EXCEPTION 'This leave request is already final' USING ERRCODE='LV004';
 END IF;
 IF NEW.state IN ('approved','rejected') THEN
  IF OLD.state<>'pending' THEN
   RAISE EXCEPTION 'Only pending requests can be decided' USING ERRCODE='LV004';
  END IF;
  IF me IS NULL OR me=OLD.employee_id THEN
   RAISE EXCEPTION 'You cannot decide your own leave' USING ERRCODE='LV005';
  END IF;
  -- The decider must still be employed, and a manager must still manage the requester.
  IF NOT EXISTS(SELECT 1 FROM employee d WHERE d.tenant_id=OLD.tenant_id
    AND d.entity_id=OLD.entity_id AND d.id=me AND d.status IN ('active','notice')) THEN
   RAISE EXCEPTION 'Only current employees can decide leave' USING ERRCODE='LV006';
  END IF;
  IF NOT ((OLD.approver='manager' AND scope='team' AND OLD.manager_id=me
      AND EXISTS(SELECT 1 FROM employee e WHERE e.tenant_id=OLD.tenant_id
        AND e.entity_id=OLD.entity_id AND e.id=OLD.employee_id AND e.manager_id=me))
    OR (OLD.approver='hr' AND scope='entity')
    -- A request whose manager no longer manages the requester falls to HR.
    OR (OLD.approver='manager' AND scope='entity' AND NOT EXISTS(
      SELECT 1 FROM employee e WHERE e.tenant_id=OLD.tenant_id
        AND e.entity_id=OLD.entity_id AND e.id=OLD.employee_id AND e.manager_id=OLD.manager_id))) THEN
   RAISE EXCEPTION 'This request is routed to another approver' USING ERRCODE='LV006';
  END IF;
  IF NEW.state='rejected' AND NEW.decision_note IS NULL THEN
   RAISE EXCEPTION 'Explain why the request is declined' USING ERRCODE='LV003';
  END IF;
 ELSIF NEW.state='cancelled' THEN
  IF me IS NULL OR me<>OLD.employee_id OR scope NOT IN ('self','team') THEN
   RAISE EXCEPTION 'Only the requester can cancel leave' USING ERRCODE='LV006';
  END IF;
  IF NOT (OLD.state='pending' OR (OLD.state='approved' AND OLD.start_date>today)) THEN
   RAISE EXCEPTION 'Leave that has started cannot be cancelled here' USING ERRCODE='LV007';
  END IF;
 ELSE
  RAISE EXCEPTION 'Unsupported leave transition' USING ERRCODE='LV004';
 END IF;
 NEW.decided_at := now();
 NEW.decided_by_employee := me;
 NEW.decided_by_label := nullif(current_setting('app.actor_label',true),'');
 RETURN NEW;
END $$;
