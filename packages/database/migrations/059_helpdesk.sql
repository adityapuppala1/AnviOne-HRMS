-- HLP-01 HR helpdesk (employee cases), backend only.
-- Employees raise cases for themselves in an admin-managed category; HR agents work them through
-- open, in_progress, waiting_on_employee and resolved; the requester reopens (within 7 days of
-- resolution), closes (optionally rating 1 to 5) or cancels. Due times for the first response
-- and for resolution come from per-priority service targets and are computed here; breach is
-- derived when read. Targets are wall-clock hours (no business hours, no pause).
-- Comments and internal notes are append-only; internal notes are never visible to the
-- requester. A confidential case is visible only to its requester, its assigned agent and
-- helpdesk.manage. The requester never works their own case (four-eyes), even when they are HR.
-- Status, assignment, priority and confidentiality changes are written to an append-only history
-- by a narrow writer role. Knowledge articles are suggested by plain keyword matching (no AI).
-- Guards run as a SELECT-only keeper and serialise on per-case advisory locks.
-- Errors: HD003 bad input (400), HD004 conflict (409), HD005 forbidden (403).
CREATE ROLE anvione_helpdesk_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE anvione_helpdesk_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_helpdesk_keeper, anvione_helpdesk_writer;

CREATE TABLE hd_category (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 2 AND 60 AND name=btrim(name)),
 confidential boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true,
 sort integer NOT NULL DEFAULT 100 CHECK(sort BETWEEN 0 AND 1000),
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE UNIQUE INDEX hd_category_name_key ON hd_category(tenant_id,entity_id,lower(name));

CREATE TABLE hd_sla_target (
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 priority text NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
 response_hours integer NOT NULL CHECK(response_hours BETWEEN 1 AND 720),
 resolve_hours integer NOT NULL CHECK(resolve_hours BETWEEN 1 AND 2160),
 version integer NOT NULL CHECK(version>0),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,entity_id,priority),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 CHECK(resolve_hours>=response_hours)
);

CREATE TABLE hd_article (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 category_id uuid,
 title text NOT NULL CHECK(char_length(title) BETWEEN 3 AND 160 AND title=btrim(title)),
 body text NOT NULL CHECK(char_length(body) BETWEEN 10 AND 8000),
 keywords text[] NOT NULL DEFAULT '{}' CHECK(cardinality(keywords)<=20),
 status text NOT NULL CHECK(status IN ('draft','published','archived')),
 published_at timestamptz,
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,category_id) REFERENCES hd_category(tenant_id,entity_id,id),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX hd_article_entity_idx ON hd_article(tenant_id,entity_id,status,category_id);

CREATE TABLE hd_case (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^HLP-[0-9]{6}$'),
 requester_employee_id uuid NOT NULL,
 requester_name text NOT NULL,
 category_id uuid NOT NULL,
 subject text NOT NULL CHECK(char_length(subject) BETWEEN 3 AND 160 AND subject=btrim(subject)),
 description text NOT NULL CHECK(char_length(btrim(description)) BETWEEN 10 AND 4000),
 priority text NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
 confidential boolean NOT NULL DEFAULT false,
 status text NOT NULL CHECK(status IN ('open','in_progress','waiting_on_employee','resolved','closed','cancelled')),
 assignee_employee_id uuid,
 assignee_name text,
 first_response_due timestamptz NOT NULL,
 resolve_due timestamptz NOT NULL,
 first_responded_at timestamptz,
 last_activity_at timestamptz NOT NULL DEFAULT now(),
 status_changed_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 resolved_by_employee uuid,
 resolved_by_label text,
 closed_at timestamptz,
 cancelled_at timestamptz,
 reopen_count integer NOT NULL DEFAULT 0 CHECK(reopen_count>=0),
 satisfaction integer CHECK(satisfaction IS NULL OR satisfaction BETWEEN 1 AND 5),
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 FOREIGN KEY(tenant_id,entity_id,requester_employee_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,assignee_employee_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,category_id) REFERENCES hd_category(tenant_id,entity_id,id),
 -- Four-eyes: the requester never works or resolves their own case.
 CHECK(assignee_employee_id IS DISTINCT FROM requester_employee_id),
 CHECK(resolved_by_employee IS DISTINCT FROM requester_employee_id),
 CHECK(resolve_due>=first_response_due),
 CHECK((status IN ('resolved','closed'))=(resolved_at IS NOT NULL)),
 CHECK((status='closed')=(closed_at IS NOT NULL)),
 CHECK((status='cancelled')=(cancelled_at IS NOT NULL)),
 CHECK(satisfaction IS NULL OR status='closed'),
 CHECK(status IN ('open','cancelled','waiting_on_employee') OR assignee_employee_id IS NOT NULL),
 CONSTRAINT hd_case_code_key UNIQUE(tenant_id,entity_id,code),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX hd_case_requester_idx ON hd_case(tenant_id,entity_id,requester_employee_id,status);
CREATE INDEX hd_case_assignee_idx ON hd_case(tenant_id,entity_id,assignee_employee_id,status);
CREATE INDEX hd_case_queue_idx ON hd_case(tenant_id,entity_id,status,created_at DESC);

CREATE TABLE hd_case_comment (
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 case_id uuid NOT NULL,
 requester_employee_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('comment','internal')),
 body text NOT NULL CHECK(char_length(btrim(body)) BETWEEN 1 AND 4000),
 author_employee_id uuid NOT NULL,
 author_role text NOT NULL CHECK(author_role IN ('requester','agent')),
 author_label text NOT NULL,
 at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,entity_id,case_id) REFERENCES hd_case(tenant_id,entity_id,id),
 -- Internal notes are written by agents only, never by the requester.
 CHECK(kind='comment' OR (author_role='agent' AND author_employee_id<>requester_employee_id)),
 CHECK((author_role='requester')=(author_employee_id=requester_employee_id))
);
CREATE INDEX hd_case_comment_case_idx ON hd_case_comment(case_id,seq);

CREATE TABLE hd_case_history (
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 case_id uuid NOT NULL,
 from_status text,
 to_status text NOT NULL,
 assignee_employee_id uuid,
 assignee_name text,
 assignee_changed boolean NOT NULL,
 priority text NOT NULL,
 priority_changed boolean NOT NULL,
 confidential boolean NOT NULL,
 confidential_changed boolean NOT NULL,
 by_employee uuid NOT NULL,
 by_label text NOT NULL,
 at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,entity_id,case_id) REFERENCES hd_case(tenant_id,entity_id,id)
);
CREATE INDEX hd_case_history_case_idx ON hd_case_history(case_id,seq);

CREATE TABLE hd_case_article (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 case_id uuid NOT NULL,
 article_id uuid NOT NULL,
 by_employee uuid NOT NULL,
 by_label text NOT NULL,
 at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,case_id) REFERENCES hd_case(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,article_id) REFERENCES hd_article(tenant_id,entity_id,id),
 CONSTRAINT hd_case_article_once_key UNIQUE(case_id,article_id)
);

-- Seed: default categories and service targets for every existing entity.
INSERT INTO hd_category(id,tenant_id,entity_id,name,confidential,sort,version,created_by_label,updated_by_label)
SELECT gen_random_uuid(), e.tenant_id, e.id, c.name, c.confidential, c.sort, 1, 'System', 'System'
FROM legal_entity e CROSS JOIN (VALUES ('Payroll query',false,10),('Leave',false,20),('Policy',false,30),
 ('IT and assets',false,40),('Benefits',false,50),('Grievance or harassment',true,60),('Other',false,90))
 AS c(name,confidential,sort);
INSERT INTO hd_sla_target(tenant_id,entity_id,priority,response_hours,resolve_hours,version,updated_by_label)
SELECT e.tenant_id, e.id, s.priority, s.response_hours, s.resolve_hours, 1, 'System'
FROM legal_entity e CROSS JOIN (VALUES ('urgent',1,8),('high',4,24),('normal',8,72),('low',24,120))
 AS s(priority,response_hours,resolve_hours);

-- Helpers -----------------------------------------------------------------------------------
CREATE FUNCTION hd_in_entity(p_tenant uuid, p_entity uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(p_tenant=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND p_entity=nullif(current_setting('app.entity_id',true),'')::uuid,false);
$$;
-- The requester always sees their own case. Agents see the entity's cases; a confidential case
-- only when it is assigned to them, or with helpdesk.manage. Nobody else sees anything.
CREATE FUNCTION hd_sees_case(p_requester uuid, p_assignee uuid, p_confidential boolean) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(CASE
  WHEN coalesce(current_setting('app.helpdesk_scope',true),'none') NOT IN ('self','agent','manage') THEN false
  WHEN p_requester=nullif(current_setting('app.employee_id',true),'')::uuid THEN true
  WHEN current_setting('app.helpdesk_scope',true)='manage' THEN true
  WHEN current_setting('app.helpdesk_scope',true)='agent' THEN
   NOT p_confidential OR p_assignee=nullif(current_setting('app.employee_id',true),'')::uuid
  ELSE false END,false);
$$;
-- Acting as an agent on a case: an agent scope and never the requester.
CREATE FUNCTION hd_agent_for(p_requester uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(current_setting('app.helpdesk_scope',true) IN ('agent','manage')
  AND p_requester IS DISTINCT FROM nullif(current_setting('app.employee_id',true),'')::uuid
  AND nullif(current_setting('app.employee_id',true),'') IS NOT NULL,false);
$$;
-- A current employee in the entity whose active sign-in carries the HR admin role.
CREATE FUNCTION hd_agent_name(p_tenant uuid, p_entity uuid, p_employee uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT p.name FROM public.employee e JOIN public.person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
 WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.id=p_employee AND e.status IN ('active','notice')
  AND EXISTS(SELECT 1 FROM public.identity_binding b WHERE b.tenant_id=e.tenant_id AND b.entity_id=e.entity_id
   AND b.employee_id=e.id AND b.active AND b.roles && ARRAY['hr_admin']);
$$;
-- People a case may be assigned to (agents and managers only; id and name only).
CREATE FUNCTION hd_agents() RETURNS TABLE(employee_id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT e.id, p.name FROM public.employee e JOIN public.person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
 WHERE coalesce(current_setting('app.helpdesk_scope',true),'none') IN ('agent','manage')
  AND e.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND e.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND e.status IN ('active','notice')
  AND EXISTS(SELECT 1 FROM public.identity_binding b WHERE b.tenant_id=e.tenant_id AND b.entity_id=e.entity_id
   AND b.employee_id=e.id AND b.active AND b.roles && ARRAY['hr_admin'])
 ORDER BY lower(p.name), e.id LIMIT 200;
$$;

-- Admin lists: categories, service targets and articles (helpdesk.manage only) ----------------
CREATE FUNCTION guard_hd_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 kw text;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This record belongs to another organization' USING ERRCODE='HD005';
 END IF;
 IF coalesce(current_setting('app.helpdesk_scope',true),'none')<>'manage'
   OR nullif(current_setting('app.employee_id',true),'') IS NULL
   OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Only HR manages the helpdesk' USING ERRCODE='HD005';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'This record changed. Reload it before trying again' USING ERRCODE='HD004';
  END IF;
 ELSE
  NEW.version := 1;
 END IF;
 IF TG_TABLE_NAME='hd_category' THEN
  IF TG_OP='INSERT' THEN
   NEW.created_by_label := label;
   NEW.created_at := now();
  END IF;
 ELSIF TG_TABLE_NAME='hd_article' THEN
  NEW.keywords := ARRAY(SELECT DISTINCT lower(btrim(k)) FROM unnest(coalesce(NEW.keywords,'{}'::text[])) k
   WHERE btrim(k)<>'' ORDER BY 1);
  FOREACH kw IN ARRAY NEW.keywords LOOP
   IF char_length(kw) NOT BETWEEN 2 AND 40 THEN
    RAISE EXCEPTION 'Keywords are 2 to 40 characters' USING ERRCODE='HD003';
   END IF;
  END LOOP;
  IF TG_OP='INSERT' THEN
   NEW.status := 'draft';
   NEW.published_at := NULL;
   NEW.created_by_label := label;
   NEW.created_at := now();
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
   IF (NEW.title,NEW.body,NEW.keywords,NEW.category_id) IS DISTINCT FROM (OLD.title,OLD.body,OLD.keywords,OLD.category_id) THEN
    RAISE EXCEPTION 'Change the article and its status in separate steps' USING ERRCODE='HD004';
   END IF;
   IF NOT ((OLD.status IN ('draft','archived') AND NEW.status='published') OR (OLD.status='published' AND NEW.status='archived')) THEN
    RAISE EXCEPTION 'An article cannot move from % to %', OLD.status, NEW.status USING ERRCODE='HD004';
   END IF;
   NEW.published_at := CASE WHEN NEW.status='published' THEN now() ELSE OLD.published_at END;
  ELSE
   NEW.published_at := OLD.published_at;
  END IF;
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Cases -------------------------------------------------------------------------------------
CREATE FUNCTION guard_hd_case() RETURNS trigger
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
  SELECT min(x.at) FILTER (WHERE x.kind='comment' AND x.author_role='agent'), max(x.at)
  INTO NEW.first_responded_at, NEW.last_activity_at FROM hd_case_comment x WHERE x.case_id=OLD.id;
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

-- Thread: comments (both sides) and internal notes (agents only) ------------------------------
CREATE FUNCTION guard_hd_case_comment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.helpdesk_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Employee');
 cs record;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This case belongs to another organization' USING ERRCODE='HD005';
 END IF;
 IF me IS NULL OR scope NOT IN ('self','agent','manage') OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Your current workspace cannot use the helpdesk' USING ERRCODE='HD005';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('hd-case:'||NEW.case_id::text,0));
 SELECT c.requester_employee_id, c.assignee_employee_id, c.confidential, c.status INTO cs FROM hd_case c
 WHERE c.tenant_id=NEW.tenant_id AND c.entity_id=NEW.entity_id AND c.id=NEW.case_id;
 -- One answer whether the case is missing or hidden from the caller.
 IF NOT FOUND OR NOT hd_sees_case(cs.requester_employee_id,cs.assignee_employee_id,cs.confidential) THEN
  RAISE EXCEPTION 'This case is unavailable' USING ERRCODE='HD003';
 END IF;
 IF me=cs.requester_employee_id THEN
  IF NEW.kind IS DISTINCT FROM 'comment' THEN
   RAISE EXCEPTION 'Only HR agents add internal notes' USING ERRCODE='HD005';
  END IF;
  NEW.author_role := 'requester';
 ELSIF hd_agent_for(cs.requester_employee_id) THEN
  NEW.author_role := 'agent';
 ELSE
  RAISE EXCEPTION 'This case is unavailable' USING ERRCODE='HD003';
 END IF;
 IF cs.status IN ('closed','cancelled') THEN
  RAISE EXCEPTION 'A closed or cancelled case takes no more comments' USING ERRCODE='HD004';
 END IF;
 IF NEW.kind NOT IN ('comment','internal') OR NEW.body IS NULL OR char_length(btrim(NEW.body)) NOT BETWEEN 1 AND 4000 THEN
  RAISE EXCEPTION 'Write a comment of up to 4000 characters' USING ERRCODE='HD003';
 END IF;
 NEW.requester_employee_id := cs.requester_employee_id;
 NEW.author_employee_id := me;
 NEW.author_label := label;
 NEW.at := clock_timestamp();
 RETURN NEW;
END $$;

CREATE FUNCTION guard_hd_case_article() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 cs record;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This case belongs to another organization' USING ERRCODE='HD005';
 END IF;
 IF me IS NULL OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Your current workspace cannot use the helpdesk' USING ERRCODE='HD005';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('hd-case:'||NEW.case_id::text,0));
 SELECT c.requester_employee_id, c.assignee_employee_id, c.confidential, c.status INTO cs FROM hd_case c
 WHERE c.tenant_id=NEW.tenant_id AND c.entity_id=NEW.entity_id AND c.id=NEW.case_id;
 IF NOT FOUND OR NOT hd_sees_case(cs.requester_employee_id,cs.assignee_employee_id,cs.confidential) THEN
  RAISE EXCEPTION 'This case is unavailable' USING ERRCODE='HD003';
 END IF;
 IF NOT hd_agent_for(cs.requester_employee_id) THEN
  RAISE EXCEPTION 'Only an HR agent other than the requester links articles' USING ERRCODE='HD005';
 END IF;
 IF cs.status IN ('closed','cancelled') THEN
  RAISE EXCEPTION 'A closed or cancelled case is final' USING ERRCODE='HD004';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM hd_article a WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id
   AND a.id=NEW.article_id AND a.status='published') THEN
  RAISE EXCEPTION 'Link a published article' USING ERRCODE='HD003';
 END IF;
 NEW.by_employee := me;
 NEW.by_label := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 NEW.at := now();
 RETURN NEW;
END $$;

-- Writer-owned derivations --------------------------------------------------------------------
CREATE FUNCTION refresh_hd_case_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- The case guard recomputes the first response and last activity from the thread.
 UPDATE public.hd_case SET last_activity_at=NULL WHERE id=NEW.case_id;
 RETURN NULL;
END $$;
CREATE FUNCTION record_hd_case_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.status,NEW.assignee_employee_id,NEW.priority,NEW.confidential)
   IS NOT DISTINCT FROM (OLD.status,OLD.assignee_employee_id,OLD.priority,OLD.confidential) THEN
  RETURN NULL;
 END IF;
 INSERT INTO public.hd_case_history(tenant_id,entity_id,case_id,from_status,to_status,assignee_employee_id,assignee_name,
  assignee_changed,priority,priority_changed,confidential,confidential_changed,by_employee,by_label)
 VALUES (NEW.tenant_id,NEW.entity_id,NEW.id,CASE WHEN TG_OP='UPDATE' THEN OLD.status END,NEW.status,
  NEW.assignee_employee_id,NEW.assignee_name,
  TG_OP='UPDATE' AND NEW.assignee_employee_id IS DISTINCT FROM OLD.assignee_employee_id,NEW.priority,
  TG_OP='UPDATE' AND NEW.priority IS DISTINCT FROM OLD.priority,NEW.confidential,
  TG_OP='UPDATE' AND NEW.confidential IS DISTINCT FROM OLD.confidential,
  nullif(current_setting('app.employee_id',true),'')::uuid,
  coalesce(nullif(current_setting('app.actor_label',true),''),'Employee'));
 RETURN NULL;
END $$;

CREATE FUNCTION reject_hd_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Helpdesk records and their history are kept, never deleted' USING ERRCODE='23514';
END $$;
CREATE FUNCTION reject_hd_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Comments, notes, links and case history are final' USING ERRCODE='HD004';
END $$;

CREATE TRIGGER hd_category_guard BEFORE INSERT OR UPDATE ON hd_category FOR EACH ROW EXECUTE FUNCTION guard_hd_admin();
CREATE TRIGGER hd_sla_target_guard BEFORE INSERT OR UPDATE ON hd_sla_target FOR EACH ROW EXECUTE FUNCTION guard_hd_admin();
CREATE TRIGGER hd_article_guard BEFORE INSERT OR UPDATE ON hd_article FOR EACH ROW EXECUTE FUNCTION guard_hd_admin();
CREATE TRIGGER hd_case_guard BEFORE INSERT OR UPDATE ON hd_case FOR EACH ROW EXECUTE FUNCTION guard_hd_case();
CREATE TRIGGER hd_case_history_record AFTER INSERT OR UPDATE ON hd_case FOR EACH ROW EXECUTE FUNCTION record_hd_case_history();
CREATE TRIGGER hd_case_comment_guard BEFORE INSERT ON hd_case_comment FOR EACH ROW EXECUTE FUNCTION guard_hd_case_comment();
CREATE TRIGGER hd_case_comment_activity AFTER INSERT ON hd_case_comment FOR EACH ROW EXECUTE FUNCTION refresh_hd_case_activity();
CREATE TRIGGER hd_case_comment_final BEFORE UPDATE ON hd_case_comment FOR EACH ROW EXECUTE FUNCTION reject_hd_rewrite();
CREATE TRIGGER hd_case_history_final BEFORE UPDATE ON hd_case_history FOR EACH ROW EXECUTE FUNCTION reject_hd_rewrite();
CREATE TRIGGER hd_case_article_guard BEFORE INSERT ON hd_case_article FOR EACH ROW EXECUTE FUNCTION guard_hd_case_article();
CREATE TRIGGER hd_case_article_final BEFORE UPDATE ON hd_case_article FOR EACH ROW EXECUTE FUNCTION reject_hd_rewrite();
CREATE TRIGGER hd_category_no_delete BEFORE DELETE ON hd_category FOR EACH ROW EXECUTE FUNCTION reject_hd_delete();
CREATE TRIGGER hd_sla_target_no_delete BEFORE DELETE ON hd_sla_target FOR EACH ROW EXECUTE FUNCTION reject_hd_delete();
CREATE TRIGGER hd_article_no_delete BEFORE DELETE ON hd_article FOR EACH ROW EXECUTE FUNCTION reject_hd_delete();
CREATE TRIGGER hd_case_no_delete BEFORE DELETE ON hd_case FOR EACH ROW EXECUTE FUNCTION reject_hd_delete();
CREATE TRIGGER hd_case_comment_no_delete BEFORE DELETE ON hd_case_comment FOR EACH ROW EXECUTE FUNCTION reject_hd_delete();
CREATE TRIGGER hd_case_history_no_delete BEFORE DELETE ON hd_case_history FOR EACH ROW EXECUTE FUNCTION reject_hd_delete();
CREATE TRIGGER hd_case_article_no_delete BEFORE DELETE ON hd_case_article FOR EACH ROW EXECUTE FUNCTION reject_hd_delete();
CREATE TRIGGER hd_category_no_truncate BEFORE TRUNCATE ON hd_category FOR EACH STATEMENT EXECUTE FUNCTION reject_hd_delete();
CREATE TRIGGER hd_sla_target_no_truncate BEFORE TRUNCATE ON hd_sla_target FOR EACH STATEMENT EXECUTE FUNCTION reject_hd_delete();
CREATE TRIGGER hd_article_no_truncate BEFORE TRUNCATE ON hd_article FOR EACH STATEMENT EXECUTE FUNCTION reject_hd_delete();
CREATE TRIGGER hd_case_no_truncate BEFORE TRUNCATE ON hd_case FOR EACH STATEMENT EXECUTE FUNCTION reject_hd_delete();
CREATE TRIGGER hd_case_comment_no_truncate BEFORE TRUNCATE ON hd_case_comment FOR EACH STATEMENT EXECUTE FUNCTION reject_hd_delete();
CREATE TRIGGER hd_case_history_no_truncate BEFORE TRUNCATE ON hd_case_history FOR EACH STATEMENT EXECUTE FUNCTION reject_hd_delete();
CREATE TRIGGER hd_case_article_no_truncate BEFORE TRUNCATE ON hd_case_article FOR EACH STATEMENT EXECUTE FUNCTION reject_hd_delete();
-- Guards, writers and delete blocks fire in replica sessions too.
ALTER TABLE hd_category ENABLE ALWAYS TRIGGER hd_category_guard;
ALTER TABLE hd_sla_target ENABLE ALWAYS TRIGGER hd_sla_target_guard;
ALTER TABLE hd_article ENABLE ALWAYS TRIGGER hd_article_guard;
ALTER TABLE hd_case ENABLE ALWAYS TRIGGER hd_case_guard;
ALTER TABLE hd_case ENABLE ALWAYS TRIGGER hd_case_history_record;
ALTER TABLE hd_case_comment ENABLE ALWAYS TRIGGER hd_case_comment_guard;
ALTER TABLE hd_case_comment ENABLE ALWAYS TRIGGER hd_case_comment_activity;
ALTER TABLE hd_case_comment ENABLE ALWAYS TRIGGER hd_case_comment_final;
ALTER TABLE hd_case_history ENABLE ALWAYS TRIGGER hd_case_history_final;
ALTER TABLE hd_case_article ENABLE ALWAYS TRIGGER hd_case_article_guard;
ALTER TABLE hd_case_article ENABLE ALWAYS TRIGGER hd_case_article_final;
ALTER TABLE hd_category ENABLE ALWAYS TRIGGER hd_category_no_delete;
ALTER TABLE hd_sla_target ENABLE ALWAYS TRIGGER hd_sla_target_no_delete;
ALTER TABLE hd_article ENABLE ALWAYS TRIGGER hd_article_no_delete;
ALTER TABLE hd_case ENABLE ALWAYS TRIGGER hd_case_no_delete;
ALTER TABLE hd_case_comment ENABLE ALWAYS TRIGGER hd_case_comment_no_delete;
ALTER TABLE hd_case_history ENABLE ALWAYS TRIGGER hd_case_history_no_delete;
ALTER TABLE hd_case_article ENABLE ALWAYS TRIGGER hd_case_article_no_delete;
ALTER TABLE hd_category ENABLE ALWAYS TRIGGER hd_category_no_truncate;
ALTER TABLE hd_sla_target ENABLE ALWAYS TRIGGER hd_sla_target_no_truncate;
ALTER TABLE hd_article ENABLE ALWAYS TRIGGER hd_article_no_truncate;
ALTER TABLE hd_case ENABLE ALWAYS TRIGGER hd_case_no_truncate;
ALTER TABLE hd_case_comment ENABLE ALWAYS TRIGGER hd_case_comment_no_truncate;
ALTER TABLE hd_case_history ENABLE ALWAYS TRIGGER hd_case_history_no_truncate;
ALTER TABLE hd_case_article ENABLE ALWAYS TRIGGER hd_case_article_no_truncate;

-- Ownership and grants -------------------------------------------------------------------------
ALTER FUNCTION hd_agent_name(uuid,uuid,uuid) OWNER TO anvione_helpdesk_keeper;
ALTER FUNCTION hd_agents() OWNER TO anvione_helpdesk_keeper;
ALTER FUNCTION guard_hd_admin() OWNER TO anvione_helpdesk_keeper;
ALTER FUNCTION guard_hd_case() OWNER TO anvione_helpdesk_keeper;
ALTER FUNCTION guard_hd_case_comment() OWNER TO anvione_helpdesk_keeper;
ALTER FUNCTION guard_hd_case_article() OWNER TO anvione_helpdesk_keeper;
ALTER FUNCTION refresh_hd_case_activity() OWNER TO anvione_helpdesk_writer;
ALTER FUNCTION record_hd_case_history() OWNER TO anvione_helpdesk_writer;
REVOKE ALL ON FUNCTION hd_in_entity(uuid,uuid),hd_sees_case(uuid,uuid,boolean),hd_agent_for(uuid),
 hd_agent_name(uuid,uuid,uuid),hd_agents(),guard_hd_admin(),guard_hd_case(),guard_hd_case_comment(),
 guard_hd_case_article(),refresh_hd_case_activity(),record_hd_case_history(),reject_hd_delete(),reject_hd_rewrite()
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hd_in_entity(uuid,uuid),hd_sees_case(uuid,uuid,boolean),hd_agent_for(uuid),hd_agents()
 TO anvione_app;
GRANT EXECUTE ON FUNCTION hd_in_entity(uuid,uuid),hd_sees_case(uuid,uuid,boolean),hd_agent_for(uuid),
 hd_agent_name(uuid,uuid,uuid) TO anvione_helpdesk_keeper;
GRANT SELECT ON hd_category,hd_sla_target,hd_article,hd_case,hd_case_comment,employee,person TO anvione_helpdesk_keeper;
GRANT SELECT(tenant_id,entity_id,employee_id,active,roles) ON identity_binding TO anvione_helpdesk_keeper;
GRANT SELECT(id), UPDATE(last_activity_at) ON hd_case TO anvione_helpdesk_writer;
GRANT INSERT(tenant_id,entity_id,case_id,from_status,to_status,assignee_employee_id,assignee_name,assignee_changed,
 priority,priority_changed,confidential,confidential_changed,by_employee,by_label) ON hd_case_history TO anvione_helpdesk_writer;

ALTER TABLE hd_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE hd_category FORCE ROW LEVEL SECURITY;
ALTER TABLE hd_sla_target ENABLE ROW LEVEL SECURITY;
ALTER TABLE hd_sla_target FORCE ROW LEVEL SECURITY;
ALTER TABLE hd_article ENABLE ROW LEVEL SECURITY;
ALTER TABLE hd_article FORCE ROW LEVEL SECURITY;
ALTER TABLE hd_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE hd_case FORCE ROW LEVEL SECURITY;
ALTER TABLE hd_case_comment ENABLE ROW LEVEL SECURITY;
ALTER TABLE hd_case_comment FORCE ROW LEVEL SECURITY;
ALTER TABLE hd_case_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE hd_case_history FORCE ROW LEVEL SECURITY;
ALTER TABLE hd_case_article ENABLE ROW LEVEL SECURITY;
ALTER TABLE hd_case_article FORCE ROW LEVEL SECURITY;

CREATE POLICY hd_keeper_emp ON employee FOR SELECT TO anvione_helpdesk_keeper USING(true);
CREATE POLICY hd_keeper_person ON person FOR SELECT TO anvione_helpdesk_keeper USING(true);
CREATE POLICY hd_keeper_binding ON identity_binding FOR SELECT TO anvione_helpdesk_keeper USING(true);
CREATE POLICY hd_keeper ON hd_category FOR SELECT TO anvione_helpdesk_keeper USING(true);
CREATE POLICY hd_keeper ON hd_sla_target FOR SELECT TO anvione_helpdesk_keeper USING(true);
CREATE POLICY hd_keeper ON hd_article FOR SELECT TO anvione_helpdesk_keeper USING(true);
CREATE POLICY hd_keeper ON hd_case FOR SELECT TO anvione_helpdesk_keeper USING(true);
CREATE POLICY hd_keeper ON hd_case_comment FOR SELECT TO anvione_helpdesk_keeper USING(true);
CREATE POLICY hd_writer_read ON hd_case FOR SELECT TO anvione_helpdesk_writer USING(true);
CREATE POLICY hd_writer_update ON hd_case FOR UPDATE TO anvione_helpdesk_writer USING(true) WITH CHECK(true);
CREATE POLICY hd_writer_insert ON hd_case_history FOR INSERT TO anvione_helpdesk_writer WITH CHECK(true);

CREATE POLICY hd_category_visible ON hd_category FOR SELECT TO anvione_app
 USING(hd_in_entity(tenant_id,entity_id) AND coalesce(current_setting('app.helpdesk_scope',true),'none') IN ('self','agent','manage'));
CREATE POLICY hd_category_insert ON hd_category FOR INSERT TO anvione_app
 WITH CHECK(hd_in_entity(tenant_id,entity_id) AND current_setting('app.helpdesk_scope',true)='manage');
CREATE POLICY hd_category_update ON hd_category FOR UPDATE TO anvione_app
 USING(hd_in_entity(tenant_id,entity_id) AND current_setting('app.helpdesk_scope',true)='manage')
 WITH CHECK(hd_in_entity(tenant_id,entity_id));
CREATE POLICY hd_sla_target_visible ON hd_sla_target FOR SELECT TO anvione_app
 USING(hd_in_entity(tenant_id,entity_id) AND coalesce(current_setting('app.helpdesk_scope',true),'none') IN ('self','agent','manage'));
CREATE POLICY hd_sla_target_insert ON hd_sla_target FOR INSERT TO anvione_app
 WITH CHECK(hd_in_entity(tenant_id,entity_id) AND current_setting('app.helpdesk_scope',true)='manage');
CREATE POLICY hd_sla_target_update ON hd_sla_target FOR UPDATE TO anvione_app
 USING(hd_in_entity(tenant_id,entity_id) AND current_setting('app.helpdesk_scope',true)='manage')
 WITH CHECK(hd_in_entity(tenant_id,entity_id));
-- Published articles are for everyone with helpdesk access; drafts and archived ones for HR.
CREATE POLICY hd_article_visible ON hd_article FOR SELECT TO anvione_app
 USING(hd_in_entity(tenant_id,entity_id) AND (current_setting('app.helpdesk_scope',true)='manage'
  OR (status='published' AND coalesce(current_setting('app.helpdesk_scope',true),'none') IN ('self','agent'))));
CREATE POLICY hd_article_insert ON hd_article FOR INSERT TO anvione_app
 WITH CHECK(hd_in_entity(tenant_id,entity_id) AND current_setting('app.helpdesk_scope',true)='manage');
CREATE POLICY hd_article_update ON hd_article FOR UPDATE TO anvione_app
 USING(hd_in_entity(tenant_id,entity_id) AND current_setting('app.helpdesk_scope',true)='manage')
 WITH CHECK(hd_in_entity(tenant_id,entity_id));
CREATE POLICY hd_case_visible ON hd_case FOR SELECT TO anvione_app
 USING(hd_in_entity(tenant_id,entity_id) AND hd_sees_case(requester_employee_id,assignee_employee_id,confidential));
CREATE POLICY hd_case_insert ON hd_case FOR INSERT TO anvione_app
 WITH CHECK(hd_in_entity(tenant_id,entity_id)
  AND requester_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
  AND current_setting('app.helpdesk_scope',true) IN ('self','agent','manage'));
CREATE POLICY hd_case_update ON hd_case FOR UPDATE TO anvione_app
 USING(hd_in_entity(tenant_id,entity_id) AND hd_sees_case(requester_employee_id,assignee_employee_id,confidential))
 WITH CHECK(hd_in_entity(tenant_id,entity_id));
-- A comment is visible with its case; an internal note never to the requester.
CREATE POLICY hd_case_comment_visible ON hd_case_comment FOR SELECT TO anvione_app
 USING(hd_in_entity(tenant_id,entity_id) AND EXISTS(SELECT 1 FROM hd_case c WHERE c.id=hd_case_comment.case_id)
  AND (kind='comment' OR hd_agent_for(requester_employee_id)));
CREATE POLICY hd_case_comment_insert ON hd_case_comment FOR INSERT TO anvione_app
 WITH CHECK(hd_in_entity(tenant_id,entity_id)
  AND author_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
  AND (kind='comment' OR hd_agent_for(requester_employee_id)));
CREATE POLICY hd_case_history_visible ON hd_case_history FOR SELECT TO anvione_app
 USING(hd_in_entity(tenant_id,entity_id) AND EXISTS(SELECT 1 FROM hd_case c WHERE c.id=hd_case_history.case_id));
CREATE POLICY hd_case_article_visible ON hd_case_article FOR SELECT TO anvione_app
 USING(hd_in_entity(tenant_id,entity_id) AND EXISTS(SELECT 1 FROM hd_case c WHERE c.id=hd_case_article.case_id));
CREATE POLICY hd_case_article_insert ON hd_case_article FOR INSERT TO anvione_app
 WITH CHECK(hd_in_entity(tenant_id,entity_id) AND current_setting('app.helpdesk_scope',true) IN ('agent','manage')
  AND by_employee=nullif(current_setting('app.employee_id',true),'')::uuid);

GRANT SELECT ON hd_category,hd_sla_target,hd_article,hd_case,hd_case_comment,hd_case_history,hd_case_article TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,name,confidential,active,sort) ON hd_category TO anvione_app;
GRANT UPDATE(name,confidential,active,sort,version) ON hd_category TO anvione_app;
GRANT INSERT(tenant_id,entity_id,priority,response_hours,resolve_hours) ON hd_sla_target TO anvione_app;
GRANT UPDATE(response_hours,resolve_hours,version) ON hd_sla_target TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,category_id,title,body,keywords) ON hd_article TO anvione_app;
GRANT UPDATE(category_id,title,body,keywords,status,version) ON hd_article TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,category_id,subject,description,priority,confidential) ON hd_case TO anvione_app;
GRANT UPDATE(status,assignee_employee_id,priority,confidential,satisfaction,version) ON hd_case TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,case_id,kind,body) ON hd_case_comment TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,case_id,article_id) ON hd_case_article TO anvione_app;

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
 'recruit.scorecard_submitted.v1','recruit.offer_created.v1','recruit.offer_status_changed.v1',
 'performance.objective_created.v1','performance.objective_updated.v1','performance.objective_status_changed.v1',
 'performance.key_result_added.v1','performance.key_result_updated.v1','performance.progress_recorded.v1',
 'performance.cycle_created.v1','performance.cycle_updated.v1','performance.cycle_status_changed.v1',
 'performance.review_self_submitted.v1','performance.review_manager_submitted.v1','performance.review_finalised.v1',
 'helpdesk.case_created.v1','helpdesk.case_status_changed.v1','helpdesk.case_assigned.v1',
 'helpdesk.case_priority_changed.v1','helpdesk.case_confidentiality_changed.v1','helpdesk.comment_added.v1',
 'helpdesk.article_linked.v1','helpdesk.category_created.v1','helpdesk.category_updated.v1',
 'helpdesk.sla_updated.v1','helpdesk.article_created.v1','helpdesk.article_updated.v1',
 'helpdesk.article_status_changed.v1'
));
