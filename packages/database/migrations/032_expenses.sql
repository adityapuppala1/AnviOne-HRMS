-- EXP-01 expenses: an employee claims an expense, a travel expense or a travel advance in
-- INR (integer paise); their manager or HR approves or rejects it, and HR records the payment.
-- Claims are never deleted, never edited after submission (cancel and resubmit instead),
-- and a closed claim never changes. Guards run as a keeper role so the rules hold whatever
-- statement reaches the tables. Settling an advance against a later claim is not modelled.
CREATE ROLE anvione_expense_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_expense_keeper;

CREATE TABLE expense_category (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^[A-Z][A-Z0-9_]{1,15}$'),
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 2 AND 60 AND name=btrim(name)),
 per_claim_limit_minor bigint CHECK(per_claim_limit_minor IS NULL OR per_claim_limit_minor BETWEEN 1 AND 1000000000),
 requires_receipt_over_minor bigint CHECK(requires_receipt_over_minor IS NULL OR requires_receipt_over_minor BETWEEN 0 AND 1000000000),
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 UNIQUE(tenant_id,entity_id,code),
 UNIQUE(tenant_id,entity_id,id)
);

-- Demo categories for existing entities, seeded the same way as leave types (015).
INSERT INTO expense_category(id,tenant_id,entity_id,code,name,per_claim_limit_minor,requires_receipt_over_minor,version,updated_by_label)
SELECT gen_random_uuid(),le.tenant_id,le.id,c.code,c.name,c.lim,c.receipt,1,'Setup'
FROM legal_entity le CROSS JOIN (VALUES
 ('TRAVEL','Travel',5000000::bigint,200000::bigint),
 ('MEALS','Meals',500000,50000),
 ('INTERNET','Internet',200000,0),
 ('OFFICE','Office supplies',1000000,100000),
 ('TRAINING','Training',10000000,0)
) AS c(code,name,lim,receipt);

CREATE TABLE expense_claim (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 manager_id uuid,
 kind text NOT NULL CHECK(kind IN ('expense','advance','travel')),
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 3 AND 120 AND title=btrim(title)),
 category_id uuid NOT NULL,
 category_code text NOT NULL,
 category_name text NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor<=1000000000),
 currency text NOT NULL CHECK(currency='INR'),
 expense_date date NOT NULL,
 trip_destination text CHECK(trip_destination IS NULL OR char_length(btrim(trip_destination)) BETWEEN 2 AND 120),
 description text CHECK(description IS NULL OR char_length(description) BETWEEN 1 AND 1000),
 receipt_reference text CHECK(receipt_reference IS NULL OR char_length(btrim(receipt_reference)) BETWEEN 2 AND 80),
 status text NOT NULL CHECK(status IN ('submitted','approved','rejected','paid','cancelled')),
 decision_note text CHECK(decision_note IS NULL OR char_length(btrim(decision_note)) BETWEEN 3 AND 500),
 decided_at timestamptz,
 decided_by_label text,
 decided_by_employee uuid,
 paid_on date,
 payment_reference text CHECK(payment_reference IS NULL OR char_length(btrim(payment_reference)) BETWEEN 2 AND 80),
 paid_at timestamptz,
 paid_by_label text,
 cancelled_at timestamptz,
 version integer NOT NULL CHECK(version>0),
 submitted_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,manager_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,category_id) REFERENCES expense_category(tenant_id,entity_id,id),
 CHECK((kind='expense')=(trip_destination IS NULL)),
 CHECK(status<>'rejected' OR decision_note IS NOT NULL),
 CHECK((status='paid')=(paid_on IS NOT NULL AND payment_reference IS NOT NULL)),
 CHECK((status IN ('approved','rejected','paid'))=(decided_at IS NOT NULL)),
 CHECK((status='cancelled')=(cancelled_at IS NOT NULL))
);
CREATE INDEX expense_claim_status_idx ON expense_claim(tenant_id,entity_id,status,created_at DESC);
CREATE INDEX expense_claim_employee_idx ON expense_claim(tenant_id,entity_id,employee_id,expense_date DESC);
CREATE INDEX expense_claim_manager_idx ON expense_claim(tenant_id,entity_id,manager_id,status);
CREATE INDEX expense_claim_category_idx ON expense_claim(tenant_id,entity_id,category_id);

CREATE FUNCTION guard_expense_category() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 managed text[] := ARRAY['name','per_claim_limit_minor','requires_receipt_over_minor','active','version','updated_at','updated_by_label'];
BEGIN
 IF coalesce(current_setting('app.expense_scope',true),'none')<>'entity'
   OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'Only HR manages expense categories' USING ERRCODE='EP005';
 END IF;
 IF TG_OP='INSERT' THEN
  NEW.version := 1;
  NEW.created_at := now();
 ELSE
  -- Same key as a claim submission, so a claim is checked against one settled category.
  PERFORM pg_advisory_xact_lock(hashtextextended('expense-category:'||OLD.id::text,0));
  IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'A category changes only through its own action and its code never changes' USING ERRCODE='EP004';
  END IF;
 END IF;
 NEW.updated_at := now();
 NEW.updated_by_label := label;
 RETURN NEW;
END $$;

CREATE FUNCTION guard_expense_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.expense_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Employee');
 today date := leave_entity_today();
 managed text[] := ARRAY['status','version','decision_note','decided_at','decided_by_label','decided_by_employee',
  'paid_on','payment_reference','paid_at','paid_by_label','cancelled_at'];
 cat record;
 manager uuid;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This expense claim belongs to another organization' USING ERRCODE='EP005';
 END IF;
 IF TG_OP='INSERT' THEN
  IF me IS NULL OR NEW.employee_id<>me OR scope NOT IN ('self','team')
    OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
   RAISE EXCEPTION 'You can only claim expenses for yourself' USING ERRCODE='EP005';
  END IF;
  SELECT e.manager_id INTO manager FROM employee e WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id
   AND e.id=NEW.employee_id AND e.status IN ('active','notice');
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Only current employees can claim expenses' USING ERRCODE='EP003';
  END IF;
  -- Lock first, then read the category, so a limit change cannot slip past this claim.
  PERFORM pg_advisory_xact_lock(hashtextextended('expense-category:'||NEW.category_id::text,0));
  SELECT c.code, c.name, c.per_claim_limit_minor AS lim, c.requires_receipt_over_minor AS receipt INTO cat
  FROM expense_category c WHERE c.tenant_id=NEW.tenant_id AND c.entity_id=NEW.entity_id AND c.id=NEW.category_id AND c.active;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'This expense category is unavailable' USING ERRCODE='EP003';
  END IF;
  IF NEW.amount_minor IS NULL OR NEW.amount_minor<=0 OR NEW.amount_minor>1000000000 THEN
   RAISE EXCEPTION 'The amount must be more than zero and at most INR 10000000.00' USING ERRCODE='EP003';
  END IF;
  IF cat.lim IS NOT NULL AND NEW.amount_minor>cat.lim THEN
   RAISE EXCEPTION 'The % category allows up to INR % per claim', cat.name, to_char(cat.lim/100.0,'FM9999999990.00')
    USING ERRCODE='EP003';
  END IF;
  IF cat.receipt IS NOT NULL AND NEW.amount_minor>cat.receipt AND NEW.receipt_reference IS NULL THEN
   RAISE EXCEPTION 'A receipt reference is required for % claims over INR %', cat.name, to_char(cat.receipt/100.0,'FM9999999990.00')
    USING ERRCODE='EP003';
  END IF;
  -- An advance is asked for before the trip, so its date may be up to 90 days ahead.
  IF NEW.kind='advance' AND (NEW.expense_date<today-90 OR NEW.expense_date>today+90) THEN
   RAISE EXCEPTION 'The trip date must be within 90 days before or after today' USING ERRCODE='EP003';
  END IF;
  IF NEW.kind<>'advance' AND (NEW.expense_date<today-90 OR NEW.expense_date>today) THEN
   RAISE EXCEPTION 'The expense date must be today or within the last 90 days' USING ERRCODE='EP003';
  END IF;
  IF (NEW.kind='expense') <> (NEW.trip_destination IS NULL) THEN
   RAISE EXCEPTION 'Travel claims and advances need a destination; plain expenses do not' USING ERRCODE='EP003';
  END IF;
  NEW.manager_id := manager;
  NEW.category_code := cat.code;
  NEW.category_name := cat.name;
  NEW.currency := 'INR';
  NEW.status := 'submitted';
  NEW.decision_note := NULL;
  NEW.decided_at := NULL;
  NEW.decided_by_label := NULL;
  NEW.decided_by_employee := NULL;
  NEW.paid_on := NULL;
  NEW.payment_reference := NULL;
  NEW.paid_at := NULL;
  NEW.paid_by_label := NULL;
  NEW.cancelled_at := NULL;
  NEW.version := 1;
  NEW.submitted_by_label := label;
  NEW.created_at := now();
  RETURN NEW;
 END IF;

 IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'An expense claim changes only through its own actions' USING ERRCODE='EP004';
 END IF;
 IF OLD.status IN ('rejected','paid','cancelled') THEN
  RAISE EXCEPTION 'This expense claim is final' USING ERRCODE='EP004';
 END IF;
 IF NOT ((OLD.status='submitted' AND NEW.status IN ('approved','rejected','cancelled'))
   OR (OLD.status='approved' AND NEW.status='paid')) THEN
  RAISE EXCEPTION 'That expense step is not allowed' USING ERRCODE='EP004';
 END IF;
 -- Each step sets only its own columns; everything else keeps its value.
 NEW.decided_at := OLD.decided_at;
 NEW.decided_by_label := OLD.decided_by_label;
 NEW.decided_by_employee := OLD.decided_by_employee;
 NEW.paid_at := NULL;
 NEW.paid_by_label := NULL;
 NEW.cancelled_at := NULL;
 IF NEW.status<>'paid' THEN
  NEW.paid_on := NULL;
  NEW.payment_reference := NULL;
 END IF;

 IF NEW.status='cancelled' THEN
  IF me IS NULL OR me<>OLD.employee_id OR scope NOT IN ('self','team') THEN
   RAISE EXCEPTION 'Only the claimant can cancel this claim' USING ERRCODE='EP005';
  END IF;
  NEW.decision_note := OLD.decision_note;
  NEW.cancelled_at := now();
  RETURN NEW;
 END IF;

 IF me IS NULL OR me=OLD.employee_id THEN
  RAISE EXCEPTION 'Someone else must decide or pay your own claim' USING ERRCODE='EP005';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM employee d WHERE d.tenant_id=OLD.tenant_id AND d.entity_id=OLD.entity_id
   AND d.id=me AND d.status IN ('active','notice')) THEN
  RAISE EXCEPTION 'Only current employees can decide expense claims' USING ERRCODE='EP005';
 END IF;

 IF NEW.status='paid' THEN
  IF scope<>'entity' THEN
   RAISE EXCEPTION 'Only HR records expense payments' USING ERRCODE='EP005';
  END IF;
  IF NEW.payment_reference IS NULL OR char_length(btrim(NEW.payment_reference))<2 OR NEW.paid_on IS NULL THEN
   RAISE EXCEPTION 'Give the payment date and a payment reference' USING ERRCODE='EP003';
  END IF;
  IF NEW.paid_on>today THEN
   RAISE EXCEPTION 'The payment date cannot be in the future' USING ERRCODE='EP003';
  END IF;
  -- An advance is paid before its trip, so it is bounded by the request date instead.
  IF OLD.kind<>'advance' AND NEW.paid_on<OLD.expense_date THEN
   RAISE EXCEPTION 'The payment date cannot be before the expense date' USING ERRCODE='EP003';
  END IF;
  IF OLD.kind='advance' AND NEW.paid_on<(OLD.created_at AT TIME ZONE 'UTC')::date-1 THEN
   RAISE EXCEPTION 'The payment date cannot be before the advance was requested' USING ERRCODE='EP003';
  END IF;
  NEW.decision_note := OLD.decision_note;
  NEW.paid_at := now();
  NEW.paid_by_label := label;
  RETURN NEW;
 END IF;

 -- Approve or reject: HR for anyone else, or the claimant's manager (at submission and still now).
 IF NOT (scope='entity'
   OR (scope='team' AND OLD.manager_id=me AND EXISTS(SELECT 1 FROM employee e WHERE e.tenant_id=OLD.tenant_id
     AND e.entity_id=OLD.entity_id AND e.id=OLD.employee_id AND e.manager_id=me))) THEN
  RAISE EXCEPTION 'Only the claimant''s manager or HR can decide this claim' USING ERRCODE='EP005';
 END IF;
 IF NEW.status='rejected' AND (NEW.decision_note IS NULL OR char_length(btrim(NEW.decision_note))<3) THEN
  RAISE EXCEPTION 'Say why the claim is rejected' USING ERRCODE='EP003';
 END IF;
 NEW.decided_at := now();
 NEW.decided_by_label := label;
 NEW.decided_by_employee := me;
 RETURN NEW;
END $$;

CREATE FUNCTION reject_expense_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Expense claims and categories are kept, never deleted' USING ERRCODE='23514';
END $$;

CREATE TRIGGER expense_category_guard BEFORE INSERT OR UPDATE ON expense_category
FOR EACH ROW EXECUTE FUNCTION guard_expense_category();
CREATE TRIGGER expense_claim_guard BEFORE INSERT OR UPDATE ON expense_claim
FOR EACH ROW EXECUTE FUNCTION guard_expense_claim();
CREATE TRIGGER expense_category_no_delete BEFORE DELETE ON expense_category
FOR EACH ROW EXECUTE FUNCTION reject_expense_delete();
CREATE TRIGGER expense_claim_no_delete BEFORE DELETE ON expense_claim
FOR EACH ROW EXECUTE FUNCTION reject_expense_delete();

ALTER FUNCTION guard_expense_category() OWNER TO anvione_expense_keeper;
ALTER FUNCTION guard_expense_claim() OWNER TO anvione_expense_keeper;
REVOKE ALL ON FUNCTION guard_expense_category(),guard_expense_claim(),reject_expense_delete() FROM PUBLIC;
GRANT SELECT ON employee,expense_category,expense_claim TO anvione_expense_keeper;
GRANT EXECUTE ON FUNCTION leave_entity_today() TO anvione_expense_keeper;

ALTER TABLE expense_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_category FORCE ROW LEVEL SECURITY;
ALTER TABLE expense_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_claim FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_keeper_emp ON employee FOR SELECT TO anvione_expense_keeper USING(true);
CREATE POLICY expense_category_keeper ON expense_category FOR SELECT TO anvione_expense_keeper USING(true);
CREATE POLICY expense_claim_keeper ON expense_claim FOR SELECT TO anvione_expense_keeper USING(true);

CREATE POLICY expense_category_visible ON expense_category FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.expense_scope',true) IN ('self','team','entity')
);
CREATE POLICY expense_category_insert ON expense_category FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.expense_scope',true)='entity'
);
CREATE POLICY expense_category_update ON expense_category FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.expense_scope',true)='entity'
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );

-- HR sees every claim; a manager sees their own and those routed to them; others only their own.
CREATE POLICY expense_claim_visible ON expense_claim FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  current_setting('app.expense_scope',true)='entity'
  OR (current_setting('app.expense_scope',true) IN ('self','team')
   AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
  OR (current_setting('app.expense_scope',true)='team'
   AND manager_id=nullif(current_setting('app.employee_id',true),'')::uuid)
 )
);
CREATE POLICY expense_claim_insert ON expense_claim FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
 AND current_setting('app.expense_scope',true) IN ('self','team')
);
CREATE POLICY expense_claim_update ON expense_claim FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND (
   current_setting('app.expense_scope',true)='entity'
   OR (current_setting('app.expense_scope',true) IN ('self','team')
    AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
   OR (current_setting('app.expense_scope',true)='team'
    AND manager_id=nullif(current_setting('app.employee_id',true),'')::uuid)
  )
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );

GRANT SELECT ON expense_category,expense_claim TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,code,name,per_claim_limit_minor,requires_receipt_over_minor,active)
 ON expense_category TO anvione_app;
GRANT UPDATE(name,per_claim_limit_minor,requires_receipt_over_minor,active,version) ON expense_category TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,employee_id,kind,title,category_id,amount_minor,expense_date,
 trip_destination,description,receipt_reference) ON expense_claim TO anvione_app;
GRANT UPDATE(status,version,decision_note,paid_on,payment_reference) ON expense_claim TO anvione_app;

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
 'calendar.holiday_created.v1','calendar.holiday_updated.v1','calendar.work_week_updated.v1',
 'document.uploaded.v1','document.verified.v1','document.rejected.v1','document.withdrawn.v1',
 'asset.registered.v1','asset.updated.v1','asset.issued.v1','asset.acknowledged.v1',
 'asset.returned.v1','asset.status_changed.v1',
 'policy.created.v1','policy.draft_updated.v1','policy.published.v1','policy.withdrawn.v1',
 'policy.acknowledged.v1',
 'exit.submitted.v1','exit.accepted.v1','exit.rejected.v1','exit.withdrawn.v1',
 'exit.clearance_updated.v1','exit.completed.v1',
 'expense.submitted.v1','expense.approved.v1','expense.rejected.v1','expense.cancelled.v1',
 'expense.paid.v1','expense.category_created.v1','expense.category_updated.v1'
));
