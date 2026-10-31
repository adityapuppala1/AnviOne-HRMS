-- F0.10 leave: entitlement types, versioned requests and an append-only ledger.
-- The keeper owns the guards so balance, overlap and approver checks see every
-- relevant row regardless of the caller's directory scope.
CREATE ROLE anvione_leave_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_leave_keeper;

CREATE TABLE leave_type (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^[A-Z]{2,6}$'),
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 2 AND 40),
 annual_days numeric(4,1) CHECK(annual_days IS NULL OR annual_days BETWEEN 0.5 AND 60),
 paid boolean NOT NULL,
 active boolean NOT NULL DEFAULT true,
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 UNIQUE(tenant_id,entity_id,code),
 UNIQUE(tenant_id,entity_id,id)
);
INSERT INTO leave_type(id,tenant_id,entity_id,code,name,annual_days,paid)
SELECT gen_random_uuid(),le.tenant_id,le.id,t.code,t.name,t.days,t.paid
FROM legal_entity le CROSS JOIN (VALUES
 ('CL','Casual leave',12.0,true),
 ('SL','Sick leave',12.0,true),
 ('EL','Earned leave',15.0,true),
 ('LOP','Leave without pay',NULL::numeric,false)
) AS t(code,name,days,paid);

CREATE TABLE leave_request (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 leave_type_id uuid NOT NULL,
 start_date date NOT NULL,
 end_date date NOT NULL,
 days numeric(4,1) NOT NULL CHECK(days>0),
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 3 AND 300),
 state text NOT NULL CHECK(state IN ('pending','approved','rejected','cancelled')),
 approver text NOT NULL CHECK(approver IN ('manager','hr')),
 manager_id uuid,
 version integer NOT NULL CHECK(version>0),
 requested_by_actor uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 decided_by_employee uuid,
 decided_by_label text,
 decision_note text CHECK(decision_note IS NULL OR char_length(btrim(decision_note)) BETWEEN 3 AND 300),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,manager_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,leave_type_id) REFERENCES leave_type(tenant_id,entity_id,id),
 CHECK(end_date>=start_date AND end_date-start_date<=31),
 CHECK(date_part('year',start_date)=date_part('year',end_date)),
 CHECK((approver='manager')=(manager_id IS NOT NULL)),
 CHECK((state='pending')=(decided_at IS NULL)),
 CHECK(state<>'rejected' OR decision_note IS NOT NULL)
);
CREATE INDEX leave_request_employee_idx ON leave_request(tenant_id,entity_id,employee_id,start_date);
CREATE INDEX leave_request_queue_idx ON leave_request(tenant_id,entity_id,state,manager_id);

CREATE TABLE leave_ledger (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 leave_type_id uuid NOT NULL,
 leave_year integer NOT NULL CHECK(leave_year BETWEEN 2000 AND 2200),
 kind text NOT NULL CHECK(kind IN ('debit','reversal')),
 days numeric(4,1) NOT NULL CHECK(days>0),
 request_id uuid NOT NULL REFERENCES leave_request(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,leave_type_id) REFERENCES leave_type(tenant_id,entity_id,id),
 UNIQUE(request_id,kind)
);
CREATE INDEX leave_ledger_balance_idx ON leave_ledger(tenant_id,entity_id,employee_id,leave_type_id,leave_year);

CREATE FUNCTION leave_working_days(p_start date,p_end date) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT count(*)::numeric FROM generate_series(p_start,p_end,interval '1 day') d
 WHERE extract(isodow FROM d) < 6;
$$;

CREATE FUNCTION guard_leave_request() RETURNS trigger
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
  NEW.days := leave_working_days(NEW.start_date,NEW.end_date);
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
    OR (OLD.approver='hr' AND scope='entity')) THEN
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

CREATE FUNCTION record_leave_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF OLD.state='pending' AND NEW.state='approved' THEN
  INSERT INTO leave_ledger(id,tenant_id,entity_id,employee_id,leave_type_id,leave_year,kind,days,request_id)
  VALUES(gen_random_uuid(),NEW.tenant_id,NEW.entity_id,NEW.employee_id,NEW.leave_type_id,
   date_part('year',NEW.start_date),'debit',NEW.days,NEW.id);
 ELSIF OLD.state='approved' AND NEW.state='cancelled' THEN
  INSERT INTO leave_ledger(id,tenant_id,entity_id,employee_id,leave_type_id,leave_year,kind,days,request_id)
  VALUES(gen_random_uuid(),NEW.tenant_id,NEW.entity_id,NEW.employee_id,NEW.leave_type_id,
   date_part('year',NEW.start_date),'reversal',NEW.days,NEW.id);
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION reject_leave_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Leave history is append-only' USING ERRCODE='23514';
END $$;

CREATE TRIGGER leave_request_guard BEFORE INSERT OR UPDATE ON leave_request
FOR EACH ROW EXECUTE FUNCTION guard_leave_request();
CREATE TRIGGER leave_request_ledger AFTER UPDATE OF state ON leave_request
FOR EACH ROW EXECUTE FUNCTION record_leave_ledger();
CREATE TRIGGER leave_ledger_immutable BEFORE UPDATE OR DELETE ON leave_ledger
FOR EACH ROW EXECUTE FUNCTION reject_leave_ledger_mutation();
CREATE TRIGGER leave_request_no_delete BEFORE DELETE ON leave_request
FOR EACH ROW EXECUTE FUNCTION reject_leave_ledger_mutation();

ALTER FUNCTION guard_leave_request() OWNER TO anvione_leave_keeper;
ALTER FUNCTION record_leave_ledger() OWNER TO anvione_leave_keeper;
REVOKE ALL ON FUNCTION guard_leave_request(),record_leave_ledger(),reject_leave_ledger_mutation() FROM PUBLIC;
GRANT SELECT ON legal_entity,employee,leave_type,leave_request,leave_ledger TO anvione_leave_keeper;
GRANT INSERT ON leave_ledger TO anvione_leave_keeper;

-- Business date for the caller's legal entity; exposes no other entity data.
CREATE FUNCTION leave_entity_today() RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT (now() AT TIME ZONE le.timezone)::date FROM public.legal_entity le
 WHERE le.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND le.id=nullif(current_setting('app.entity_id',true),'')::uuid;
$$;
ALTER FUNCTION leave_entity_today() OWNER TO anvione_leave_keeper;
REVOKE ALL ON FUNCTION leave_entity_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION leave_entity_today() TO anvione_app;

ALTER TABLE leave_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_type FORCE ROW LEVEL SECURITY;
ALTER TABLE leave_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_request FORCE ROW LEVEL SECURITY;
ALTER TABLE leave_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY employee_leave_keeper ON employee FOR SELECT TO anvione_leave_keeper USING(true);
CREATE POLICY leave_type_keeper ON leave_type FOR SELECT TO anvione_leave_keeper USING(true);
CREATE POLICY leave_request_keeper ON leave_request FOR SELECT TO anvione_leave_keeper USING(true);
CREATE POLICY leave_ledger_keeper ON leave_ledger TO anvione_leave_keeper USING(true) WITH CHECK(true);

CREATE POLICY leave_type_read ON leave_type FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
);
CREATE POLICY leave_request_visible ON leave_request FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  (current_setting('app.leave_scope',true) IN ('self','team')
   AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
  OR (current_setting('app.leave_scope',true)='team'
   AND manager_id=nullif(current_setting('app.employee_id',true),'')::uuid)
  OR current_setting('app.leave_scope',true)='entity'
 )
);
CREATE POLICY leave_request_submit ON leave_request FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
 AND current_setting('app.leave_scope',true) IN ('self','team')
);
CREATE POLICY leave_request_transition ON leave_request FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND (
   (current_setting('app.leave_scope',true) IN ('self','team')
    AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
   OR (current_setting('app.leave_scope',true)='team'
    AND manager_id=nullif(current_setting('app.employee_id',true),'')::uuid)
   OR current_setting('app.leave_scope',true)='entity'
  )
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );
CREATE POLICY leave_ledger_visible ON leave_ledger FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM leave_request r WHERE r.id=leave_ledger.request_id)
);

GRANT SELECT ON leave_type,leave_request,leave_ledger TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,employee_id,leave_type_id,start_date,end_date,reason,
 days,state,approver,version,requested_by_actor) ON leave_request TO anvione_app;
GRANT UPDATE(state,version,decision_note) ON leave_request TO anvione_app;

ALTER TABLE outbox_event DROP CONSTRAINT outbox_event_event_type_check;
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_event_type_check CHECK(event_type IN (
 'branding.published.v1','organization.created.v1','organization.updated.v1',
 'candidate.created.v1','candidate.invited.v1','candidate.revoked.v1','candidate.reviewed.v1',
 'candidate.submitted.v1','candidate.checklist_started.v1','candidate.task_created.v1','candidate.task_updated.v1',
 'candidate.local_review_proposed.v1','candidate.local_review_decided.v1','candidate.local_review_withdrawn.v1',
 'candidate.task_assigned.v1','candidate.assigned_task_updated.v1',
 'leave.requested.v1','leave.approved.v1','leave.rejected.v1','leave.cancelled.v1'
));
