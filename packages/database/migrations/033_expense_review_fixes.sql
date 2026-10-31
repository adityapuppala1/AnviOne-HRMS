-- EXP-01 review fixes. A manager sees and decides only claims of their CURRENT reports
-- (manager_id on the claim stays as history); payments are bounded by the entity's local
-- request and approval dates.
CREATE FUNCTION expense_is_my_report(p_tenant uuid, p_entity uuid, p_employee uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.employee e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity
  AND e.id=p_employee AND e.manager_id=nullif(current_setting('app.employee_id',true),'')::uuid);
$$;
ALTER FUNCTION expense_is_my_report(uuid,uuid,uuid) OWNER TO anvione_expense_keeper;
REVOKE ALL ON FUNCTION expense_is_my_report(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expense_is_my_report(uuid,uuid,uuid) TO anvione_app;
GRANT SELECT(tenant_id,id,timezone) ON legal_entity TO anvione_expense_keeper;

DROP POLICY expense_claim_visible ON expense_claim;
DROP POLICY expense_claim_update ON expense_claim;
CREATE POLICY expense_claim_visible ON expense_claim FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  current_setting('app.expense_scope',true)='entity'
  OR (current_setting('app.expense_scope',true) IN ('self','team')
   AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
  OR (current_setting('app.expense_scope',true)='team' AND expense_is_my_report(tenant_id,entity_id,employee_id))
 )
);
CREATE POLICY expense_claim_update ON expense_claim FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND (
   current_setting('app.expense_scope',true)='entity'
   OR (current_setting('app.expense_scope',true) IN ('self','team')
    AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
   OR (current_setting('app.expense_scope',true)='team' AND expense_is_my_report(tenant_id,entity_id,employee_id))
  )
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );

CREATE OR REPLACE FUNCTION guard_expense_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.expense_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Employee');
 today date := leave_entity_today();
 managed text[] := ARRAY['status','version','decision_note','decided_at','decided_by_label','decided_by_employee',
  'paid_on','payment_reference','paid_at','paid_by_label','cancelled_at'];
 cat record;
 tz text;
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
  SELECT le.timezone INTO tz FROM legal_entity le WHERE le.tenant_id=OLD.tenant_id AND le.id=OLD.entity_id;
  -- An advance is paid before its trip, so it is bounded by the request date instead.
  IF OLD.kind<>'advance' AND NEW.paid_on<OLD.expense_date THEN
   RAISE EXCEPTION 'The payment date cannot be before the expense date' USING ERRCODE='EP003';
  END IF;
  IF OLD.kind='advance' AND NEW.paid_on<(OLD.created_at AT TIME ZONE tz)::date THEN
   RAISE EXCEPTION 'The payment date cannot be before the advance was requested' USING ERRCODE='EP003';
  END IF;
  IF NEW.paid_on<(OLD.decided_at AT TIME ZONE tz)::date THEN
   RAISE EXCEPTION 'The payment date cannot be before the claim was approved' USING ERRCODE='EP003';
  END IF;
  NEW.decision_note := OLD.decision_note;
  NEW.paid_at := now();
  NEW.paid_by_label := label;
  RETURN NEW;
 END IF;

 -- Approve or reject: HR for anyone else, or the claimant's current manager.
 IF NOT (scope='entity'
   OR (scope='team' AND EXISTS(SELECT 1 FROM employee e WHERE e.tenant_id=OLD.tenant_id
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
