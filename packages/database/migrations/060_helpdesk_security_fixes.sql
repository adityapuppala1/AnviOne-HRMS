-- HLP-01 self security review fixes (forward-only; 059 is unchanged).
-- * Internal-note side channel: the case's last activity time (visible to the requester) was
--   refreshed by internal notes too, so a requester could tell when agents wrote notes about
--   them. Last activity and first response now come from public comments only.
-- * Someone other than the requester setting a satisfaction rating was answered as a conflict
--   (409); it is now refused as forbidden (HD005, 403).
-- * Cases raised before this fix keep their stored activity time until their next public comment.
CREATE OR REPLACE FUNCTION guard_hd_case() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.helpdesk_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Employee');
 managed text[] := ARRAY['status','assignee_employee_id','assignee_name','priority','confidential','satisfaction',
  'first_response_due','resolve_due','status_changed_at','resolved_at','resolved_by_employee','resolved_by_label',
  'closed_at','cancelled_at','reopen_count','version','updated_by_label','updated_at'];
 derived text[] := ARRAY['first_responded_at','last_activity_at'];
 cat record;
 req record;
 sla record;
 next_no integer;
 is_requester boolean;
 is_agent boolean;
 changed text[] := '{}';
 who text;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This case belongs to another organization' USING ERRCODE='HD005';
 END IF;
 IF TG_OP='UPDATE' AND NEW.last_activity_at IS NULL THEN
  -- Refresh request from the writer role (the app cannot write these columns).
  IF (to_jsonb(NEW)-derived) IS DISTINCT FROM (to_jsonb(OLD)-derived) THEN
   RAISE EXCEPTION 'Case activity is derived from its thread' USING ERRCODE='HD004';
  END IF;
  -- Internal notes never move the requester-visible activity time.
  SELECT min(x.at) FILTER (WHERE x.author_role='agent'), max(x.at)
  INTO NEW.first_responded_at, NEW.last_activity_at FROM hd_case_comment x WHERE x.case_id=OLD.id AND x.kind='comment';
  NEW.last_activity_at := greatest(coalesce(NEW.last_activity_at,OLD.created_at),OLD.status_changed_at);
  RETURN NEW;
 END IF;
 IF me IS NULL OR scope NOT IN ('self','agent','manage') OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Your current workspace cannot use the helpdesk' USING ERRCODE='HD005';
 END IF;
 IF TG_OP='INSERT' THEN
  SELECT e.status, p.name INTO req FROM employee e JOIN person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
  WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=me;
  IF NOT FOUND OR req.status NOT IN ('active','notice') THEN
   RAISE EXCEPTION 'Cases are raised by current employees' USING ERRCODE='HD003';
  END IF;
  SELECT c.active, c.confidential INTO cat FROM hd_category c
  WHERE c.tenant_id=NEW.tenant_id AND c.entity_id=NEW.entity_id AND c.id=NEW.category_id;
  IF NOT FOUND OR NOT cat.active THEN
   RAISE EXCEPTION 'Choose an active category' USING ERRCODE='HD003';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hd-case-code:'||NEW.tenant_id::text||':'||NEW.entity_id::text,0));
  SELECT coalesce(max(substr(c.code,5)::integer),0)+1 INTO next_no FROM hd_case c
  WHERE c.tenant_id=NEW.tenant_id AND c.entity_id=NEW.entity_id;
  IF next_no>999999 THEN
   RAISE EXCEPTION 'Case numbers are exhausted for this entity' USING ERRCODE='HD004';
  END IF;
  NEW.code := 'HLP-'||lpad(next_no::text,6,'0');
  NEW.requester_employee_id := me;
  NEW.requester_name := req.name;
  NEW.priority := coalesce(NEW.priority,'normal');
  NEW.confidential := coalesce(NEW.confidential,false) OR cat.confidential;
  NEW.status := 'open';
  NEW.assignee_employee_id := NULL;
  NEW.assignee_name := NULL;
  NEW.created_at := now();
  NEW.first_responded_at := NULL;
  NEW.last_activity_at := NEW.created_at;
  NEW.status_changed_at := NEW.created_at;
  NEW.resolved_at := NULL;
  NEW.resolved_by_employee := NULL;
  NEW.resolved_by_label := NULL;
  NEW.closed_at := NULL;
  NEW.cancelled_at := NULL;
  NEW.reopen_count := 0;
  NEW.satisfaction := NULL;
  NEW.version := 1;
  NEW.created_by_label := label;
  SELECT s.response_hours, s.resolve_hours INTO sla FROM hd_sla_target s
  WHERE s.tenant_id=NEW.tenant_id AND s.entity_id=NEW.entity_id AND s.priority=NEW.priority;
  NEW.first_response_due := NEW.created_at+make_interval(hours=>coalesce(sla.response_hours,
   CASE NEW.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 4 WHEN 'normal' THEN 8 ELSE 24 END));
  NEW.resolve_due := NEW.created_at+make_interval(hours=>coalesce(sla.resolve_hours,
   CASE NEW.priority WHEN 'urgent' THEN 8 WHEN 'high' THEN 24 WHEN 'normal' THEN 72 ELSE 120 END));
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('hd-case:'||OLD.id::text,0));
  IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'A case changes only through its own actions' USING ERRCODE='HD004';
  END IF;
  IF OLD.status IN ('closed','cancelled') THEN
   RAISE EXCEPTION 'A closed or cancelled case is final' USING ERRCODE='HD004';
  END IF;
  is_requester := me=OLD.requester_employee_id;
  is_agent := hd_agent_for(OLD.requester_employee_id)
   AND hd_sees_case(OLD.requester_employee_id,OLD.assignee_employee_id,OLD.confidential);
  IF NOT is_requester AND NOT is_agent THEN
   RAISE EXCEPTION 'This case is unavailable' USING ERRCODE='HD003';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN changed := changed||'status'::text; END IF;
  IF NEW.assignee_employee_id IS DISTINCT FROM OLD.assignee_employee_id THEN changed := changed||'assignee'::text; END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN changed := changed||'priority'::text; END IF;
  IF NEW.confidential IS DISTINCT FROM OLD.confidential THEN changed := changed||'confidential'::text; END IF;
  IF NEW.satisfaction IS DISTINCT FROM OLD.satisfaction THEN changed := changed||'satisfaction'::text; END IF;
  IF cardinality(changed)=0 OR (cardinality(changed)>1 AND changed<>ARRAY['status','satisfaction']) THEN
   RAISE EXCEPTION 'Change one thing about a case at a time' USING ERRCODE='HD004';
  END IF;
  -- Derived columns follow from the old row unless a step below sets them.
  NEW.assignee_name := OLD.assignee_name;
  NEW.first_response_due := OLD.first_response_due;
  NEW.resolve_due := OLD.resolve_due;
  NEW.status_changed_at := OLD.status_changed_at;
  NEW.resolved_at := OLD.resolved_at;
  NEW.resolved_by_employee := OLD.resolved_by_employee;
  NEW.resolved_by_label := OLD.resolved_by_label;
  NEW.closed_at := OLD.closed_at;
  NEW.cancelled_at := OLD.cancelled_at;
  NEW.reopen_count := OLD.reopen_count;
  IF 'satisfaction'=ANY(changed) AND NOT is_requester THEN
   RAISE EXCEPTION 'Only the requester rates a case' USING ERRCODE='HD005';
  END IF;
  IF 'satisfaction'=ANY(changed) AND NOT (is_requester AND OLD.status='resolved' AND NEW.status='closed'
    AND OLD.satisfaction IS NULL AND NEW.satisfaction BETWEEN 1 AND 5) THEN
   RAISE EXCEPTION 'The requester rates a case from 1 to 5 when closing it' USING ERRCODE='HD004';
  END IF;
  IF 'status'=ANY(changed) THEN
   NEW.status_changed_at := now();
   IF OLD.status IN ('open','in_progress','waiting_on_employee') AND NEW.status IN ('in_progress','waiting_on_employee') THEN
    IF NOT is_agent THEN
     RAISE EXCEPTION 'Only an HR agent other than the requester works a case' USING ERRCODE='HD005';
    END IF;
    IF NEW.status='in_progress' AND OLD.assignee_employee_id IS NULL THEN
     RAISE EXCEPTION 'Assign the case before starting it' USING ERRCODE='HD004';
    END IF;
   ELSIF OLD.status IN ('open','in_progress','waiting_on_employee') AND NEW.status='resolved' THEN
    IF NOT is_agent OR NOT (OLD.assignee_employee_id=me OR scope='manage') THEN
     RAISE EXCEPTION 'The assigned agent or an HR manager other than the requester resolves a case' USING ERRCODE='HD005';
    END IF;
    IF OLD.assignee_employee_id IS NULL THEN
     RAISE EXCEPTION 'Assign the case before resolving it' USING ERRCODE='HD004';
    END IF;
    NEW.resolved_at := now();
    NEW.resolved_by_employee := me;
    NEW.resolved_by_label := label;
   ELSIF OLD.status='resolved' AND NEW.status='in_progress' THEN
    IF NOT is_requester THEN
     RAISE EXCEPTION 'Only the requester reopens a case' USING ERRCODE='HD005';
    END IF;
    IF now()>OLD.resolved_at+interval '7 days' THEN
     RAISE EXCEPTION 'A case can be reopened within 7 days of being resolved' USING ERRCODE='HD004';
    END IF;
    NEW.resolved_at := NULL;
    NEW.resolved_by_employee := NULL;
    NEW.resolved_by_label := NULL;
    NEW.reopen_count := OLD.reopen_count+1;
   ELSIF OLD.status='resolved' AND NEW.status='closed' THEN
    IF NOT (is_requester OR (is_agent AND now()>OLD.resolved_at+interval '7 days')) THEN
     RAISE EXCEPTION 'The requester closes a resolved case; agents close it once the 7-day reopen window has passed' USING ERRCODE='HD005';
    END IF;
    NEW.closed_at := now();
   ELSIF OLD.status IN ('open','in_progress','waiting_on_employee') AND NEW.status='cancelled' THEN
    IF NOT (is_requester OR (is_agent AND scope='manage')) THEN
     RAISE EXCEPTION 'The requester or an HR manager cancels a case' USING ERRCODE='HD005';
    END IF;
    NEW.cancelled_at := now();
   ELSE
    RAISE EXCEPTION 'A case cannot move from % to %', OLD.status, NEW.status USING ERRCODE='HD004';
   END IF;
  ELSIF NOT is_agent THEN
   RAISE EXCEPTION 'Only an HR agent other than the requester works a case' USING ERRCODE='HD005';
  ELSIF OLD.status NOT IN ('open','in_progress','waiting_on_employee') THEN
   RAISE EXCEPTION 'A resolved case changes only by being reopened or closed' USING ERRCODE='HD004';
  ELSIF 'assignee'=ANY(changed) THEN
   IF NEW.assignee_employee_id IS NULL THEN
    RAISE EXCEPTION 'Assign the case to an HR agent' USING ERRCODE='HD003';
   END IF;
   IF scope<>'manage' AND (NEW.assignee_employee_id<>me OR OLD.assignee_employee_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Agents take unassigned cases for themselves; HR managers assign anyone' USING ERRCODE='HD005';
   END IF;
   IF NEW.assignee_employee_id=OLD.requester_employee_id THEN
    RAISE EXCEPTION 'Someone other than the requester works this case' USING ERRCODE='HD003';
   END IF;
   who := hd_agent_name(NEW.tenant_id,NEW.entity_id,NEW.assignee_employee_id);
   IF who IS NULL THEN
    RAISE EXCEPTION 'Assign the case to a current HR agent' USING ERRCODE='HD003';
   END IF;
   NEW.assignee_name := who;
  ELSIF 'priority'=ANY(changed) THEN
   SELECT s.response_hours, s.resolve_hours INTO sla FROM hd_sla_target s
   WHERE s.tenant_id=NEW.tenant_id AND s.entity_id=NEW.entity_id AND s.priority=NEW.priority;
   NEW.first_response_due := OLD.created_at+make_interval(hours=>coalesce(sla.response_hours,
    CASE NEW.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 4 WHEN 'normal' THEN 8 ELSE 24 END));
   NEW.resolve_due := OLD.created_at+make_interval(hours=>coalesce(sla.resolve_hours,
    CASE NEW.priority WHEN 'urgent' THEN 8 WHEN 'high' THEN 24 WHEN 'normal' THEN 72 ELSE 120 END));
  ELSIF 'confidential'=ANY(changed) THEN
   IF scope<>'manage' AND NOT NEW.confidential THEN
    RAISE EXCEPTION 'Only an HR manager clears the confidential flag' USING ERRCODE='HD005';
   END IF;
  END IF;
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

ALTER FUNCTION guard_hd_case() OWNER TO anvione_helpdesk_keeper;
REVOKE ALL ON FUNCTION guard_hd_case() FROM PUBLIC;

