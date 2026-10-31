-- PERF-01 performance basics (goals/OKRs and review cycles), backend only.
-- Goals (objectives) belong to an owner; the owner, the owner's direct manager and HR may see
-- and change them. Key results carry a start, a target and a current value; the current value
-- is always the latest append-only progress update and is recomputed by a narrow writer role,
-- as is a goal's progress (the average of its key results). HR opens review cycles; opening
-- generates one review per in-scope employee with a manager. The employee submits a self
-- entry, then the manager a manager entry (blind: the manager sees the self entry only after
-- submitting theirs; the employee sees the manager entry only once finalised), then HR
-- (never the employee or the reviewing manager) finalises with a rating and a reason.
-- Ratings are human inputs only; nothing is scored automatically. Nothing is deleted.
-- Guards run as a SELECT-only keeper and serialise on advisory locks. Errors: PF003 bad input
-- (400), PF004 conflict (409), PF005 forbidden (403).
CREATE ROLE anvione_perf_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE anvione_perf_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_perf_keeper, anvione_perf_writer;

CREATE TABLE perf_objective (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 owner_employee_id uuid NOT NULL,
 owner_name text NOT NULL,
 title text NOT NULL CHECK(char_length(title) BETWEEN 3 AND 160 AND title=btrim(title)),
 description text CHECK(description IS NULL OR char_length(description) BETWEEN 1 AND 2000),
 period_start date NOT NULL,
 period_end date NOT NULL,
 parent_objective_id uuid,
 status text NOT NULL CHECK(status IN ('draft','active','completed','cancelled')),
 status_note text CHECK(status_note IS NULL OR char_length(btrim(status_note)) BETWEEN 3 AND 500),
 progress numeric(5,2) NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 created_by_employee uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 FOREIGN KEY(tenant_id,entity_id,owner_employee_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,parent_objective_id) REFERENCES perf_objective(tenant_id,entity_id,id),
 CHECK(parent_objective_id IS DISTINCT FROM id),
 CHECK(period_end>=period_start AND period_end<=period_start+366),
 CHECK(status<>'cancelled' OR status_note IS NOT NULL),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX perf_objective_owner_idx ON perf_objective(tenant_id,entity_id,owner_employee_id,status);
CREATE INDEX perf_objective_entity_idx ON perf_objective(tenant_id,entity_id,status,created_at DESC);
CREATE INDEX perf_objective_parent_idx ON perf_objective(parent_objective_id);

CREATE TABLE perf_key_result (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 objective_id uuid NOT NULL,
 owner_employee_id uuid NOT NULL,
 title text NOT NULL CHECK(char_length(title) BETWEEN 3 AND 160 AND title=btrim(title)),
 unit text NOT NULL CHECK(unit IN ('number','percent','currency','hours')),
 start_value numeric(14,2) NOT NULL,
 target_value numeric(14,2) NOT NULL,
 current_value numeric(14,2) NOT NULL,
 progress numeric(5,2) GENERATED ALWAYS AS (greatest(0::numeric,least(100::numeric,
  coalesce(round((current_value-start_value)*100/nullif(target_value-start_value,0),2),0)))) STORED,
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,objective_id) REFERENCES perf_objective(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,owner_employee_id) REFERENCES employee(tenant_id,entity_id,id),
 CHECK(target_value<>start_value),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX perf_key_result_objective_idx ON perf_key_result(objective_id,created_at);

CREATE TABLE perf_kr_update (
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 key_result_id uuid NOT NULL,
 objective_id uuid NOT NULL,
 owner_employee_id uuid NOT NULL,
 value numeric(14,2) NOT NULL,
 previous_value numeric(14,2) NOT NULL,
 note text CHECK(note IS NULL OR char_length(note) BETWEEN 1 AND 500),
 by_employee uuid NOT NULL,
 by_label text NOT NULL,
 at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,entity_id,key_result_id) REFERENCES perf_key_result(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,objective_id) REFERENCES perf_objective(tenant_id,entity_id,id)
);
CREATE INDEX perf_kr_update_kr_idx ON perf_kr_update(key_result_id,seq DESC);

CREATE TABLE perf_cycle (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 3 AND 80 AND name=btrim(name)),
 period_start date NOT NULL,
 period_end date NOT NULL,
 self_due date NOT NULL,
 manager_due date NOT NULL,
 department_id uuid,
 department_kind text GENERATED ALWAYS AS ('department'::text) STORED,
 status text NOT NULL CHECK(status IN ('draft','active','closed','cancelled')),
 status_note text CHECK(status_note IS NULL OR char_length(btrim(status_note)) BETWEEN 3 AND 500),
 opened_at timestamptz,
 closed_at timestamptz,
 created_by_employee uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 FOREIGN KEY(tenant_id,entity_id,department_kind,department_id) REFERENCES org_unit(tenant_id,entity_id,kind,id),
 CHECK(period_end>=period_start AND period_end<=period_start+366),
 CHECK(self_due<=manager_due AND self_due>=period_start AND manager_due<=period_end+180),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE UNIQUE INDEX perf_cycle_name_key ON perf_cycle(tenant_id,entity_id,lower(name)) WHERE status<>'cancelled';
CREATE INDEX perf_cycle_entity_idx ON perf_cycle(tenant_id,entity_id,status,created_at DESC);

CREATE TABLE perf_review (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 cycle_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 employee_name text NOT NULL,
 manager_id uuid NOT NULL,
 manager_name text NOT NULL,
 status text NOT NULL CHECK(status IN ('self_pending','manager_pending','calibration','finalised')),
 self_submitted_at timestamptz,
 manager_submitted_at timestamptz,
 final_rating integer CHECK(final_rating IS NULL OR final_rating BETWEEN 1 AND 5),
 final_reason text CHECK(final_reason IS NULL OR char_length(btrim(final_reason)) BETWEEN 10 AND 500),
 finalised_by_employee uuid,
 finalised_by_label text,
 finalised_at timestamptz,
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,cycle_id) REFERENCES perf_cycle(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,manager_id) REFERENCES employee(tenant_id,entity_id,id),
 CHECK(manager_id<>employee_id),
 CHECK((status='finalised')=(final_rating IS NOT NULL AND final_reason IS NOT NULL AND finalised_at IS NOT NULL
  AND finalised_by_employee IS NOT NULL)),
 CHECK(finalised_by_employee IS NULL OR (finalised_by_employee<>employee_id AND finalised_by_employee<>manager_id)),
 CONSTRAINT perf_review_once_key UNIQUE(cycle_id,employee_id),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX perf_review_cycle_idx ON perf_review(cycle_id,status);
CREATE INDEX perf_review_employee_idx ON perf_review(tenant_id,entity_id,employee_id);
CREATE INDEX perf_review_manager_idx ON perf_review(tenant_id,entity_id,manager_id);

CREATE TABLE perf_review_entry (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 review_id uuid NOT NULL,
 cycle_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 manager_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('self','manager')),
 author_employee_id uuid NOT NULL,
 author_name text NOT NULL,
 ratings jsonb NOT NULL CHECK(jsonb_typeof(ratings)='object'),
 overall numeric(3,2) NOT NULL CHECK(overall BETWEEN 1 AND 5),
 comment text CHECK(comment IS NULL OR char_length(comment) BETWEEN 1 AND 2000),
 submitted_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,review_id) REFERENCES perf_review(tenant_id,entity_id,id),
 CHECK(author_employee_id=CASE kind WHEN 'self' THEN employee_id ELSE manager_id END),
 CONSTRAINT perf_review_entry_once_key UNIQUE(review_id,kind)
);

-- Helpers -----------------------------------------------------------------------------------
CREATE FUNCTION perf_in_entity(p_tenant uuid, p_entity uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT p_tenant=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND p_entity=nullif(current_setting('app.entity_id',true),'')::uuid;
$$;
-- Owner, the owner's current direct manager (team scope) or HR (entity scope).
CREATE FUNCTION perf_sees_owner(p_owner uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(CASE coalesce(current_setting('app.perf_scope',true),'none')
  WHEN 'entity' THEN true
  WHEN 'team' THEN p_owner=nullif(current_setting('app.employee_id',true),'')::uuid
   OR EXISTS(SELECT 1 FROM public.employee e WHERE e.id=p_owner
    AND e.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
    AND e.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
    AND e.manager_id=nullif(current_setting('app.employee_id',true),'')::uuid)
  WHEN 'self' THEN p_owner=nullif(current_setting('app.employee_id',true),'')::uuid
  ELSE false END,false);
$$;
CREATE FUNCTION perf_sees_review(p_employee uuid, p_manager uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(CASE coalesce(current_setting('app.perf_scope',true),'none')
  WHEN 'none' THEN false
  WHEN 'entity' THEN true
  ELSE p_employee=nullif(current_setting('app.employee_id',true),'')::uuid
   OR (current_setting('app.perf_scope',true)='team' AND p_manager=nullif(current_setting('app.employee_id',true),'')::uuid)
  END,false);
$$;
CREATE FUNCTION perf_sees_cycle(p_cycle uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(current_setting('app.perf_scope',true),'none')='entity'
  OR EXISTS(SELECT 1 FROM public.perf_review r WHERE r.cycle_id=p_cycle
   AND r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND r.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
   AND public.perf_sees_review(r.employee_id,r.manager_id));
$$;
-- Blind entries. On a review where you are the employee or the manager those rules apply even
-- to HR: the employee sees their self entry, and the manager entry once finalised; the manager
-- sees their own entry, and the self entry once they have submitted theirs. HR otherwise sees all.
CREATE FUNCTION perf_sees_entry(p_review uuid, p_kind text, p_employee uuid, p_manager uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.perf_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
BEGIN
 IF scope NOT IN ('self','team','entity') OR me IS NULL THEN
  RETURN false;
 END IF;
 IF p_employee=me THEN
  RETURN p_kind='self' OR EXISTS(SELECT 1 FROM public.perf_review r WHERE r.id=p_review AND r.status='finalised');
 END IF;
 IF p_manager=me THEN
  RETURN scope IN ('team','entity') AND (p_kind='manager'
   OR EXISTS(SELECT 1 FROM public.perf_review_entry x WHERE x.review_id=p_review AND x.kind='manager'));
 END IF;
 RETURN scope='entity';
END $$;
CREATE FUNCTION perf_employee_name(p_tenant uuid, p_entity uuid, p_employee uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT p.name FROM public.employee e JOIN public.person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
 WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.id=p_employee AND e.status IN ('active','notice');
$$;
-- Goals someone may align to: their own and their direct manager's draft or active goals
-- (id, title and owner name only), for a person the caller can see.
CREATE FUNCTION perf_alignable(p_owner uuid)
RETURNS TABLE(id uuid, title text, owner_employee_id uuid, owner_name text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT o.id, o.title, o.owner_employee_id, o.owner_name, o.status FROM public.perf_objective o
 WHERE o.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND o.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND public.perf_sees_owner(p_owner) AND o.status IN ('draft','active')
  AND (o.owner_employee_id=p_owner OR o.owner_employee_id=(SELECT e.manager_id FROM public.employee e WHERE e.id=p_owner
   AND e.tenant_id=o.tenant_id AND e.entity_id=o.entity_id))
 ORDER BY lower(o.title), o.id LIMIT 200;
$$;

-- Goals ---------------------------------------------------------------------------------------
CREATE FUNCTION guard_perf_objective() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.perf_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Employee');
 managed text[] := ARRAY['title','description','period_start','period_end','parent_objective_id','status','status_note',
  'progress','version','updated_by_label','updated_at'];
 details text[] := ARRAY['title','description','period_start','period_end','parent_objective_id'];
 owner record;
 par record;
 hop uuid;
 depth integer := 0;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This goal belongs to another organization' USING ERRCODE='PF005';
 END IF;
 IF TG_OP='UPDATE' AND NEW.progress IS NULL THEN
  -- Recompute request from the writer role (the app cannot write progress).
  IF (to_jsonb(NEW)-'progress') IS DISTINCT FROM (to_jsonb(OLD)-'progress') THEN
   RAISE EXCEPTION 'Goal progress is derived from its key results' USING ERRCODE='PF004';
  END IF;
  SELECT coalesce(round(avg(k.progress),2),0) INTO NEW.progress FROM perf_key_result k WHERE k.objective_id=NEW.id;
  RETURN NEW;
 END IF;
 IF me IS NULL OR scope NOT IN ('self','team','entity') OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Your current workspace cannot manage goals' USING ERRCODE='PF005';
 END IF;
 SELECT e.manager_id, e.status, p.name INTO owner FROM employee e JOIN person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
 WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=NEW.owner_employee_id;
 IF NOT perf_sees_owner(NEW.owner_employee_id) THEN
  RAISE EXCEPTION 'You can set goals for yourself, managers for their direct reports and HR for anyone' USING ERRCODE='PF005';
 END IF;
 IF TG_OP='INSERT' THEN
  IF owner.status IS NULL OR owner.status NOT IN ('active','notice') THEN
   RAISE EXCEPTION 'Goals belong to a current employee' USING ERRCODE='PF003';
  END IF;
  NEW.owner_name := owner.name;
  NEW.status := 'draft';
  NEW.status_note := NULL;
  NEW.progress := 0;
  NEW.created_by_employee := me;
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('perf-objective:'||OLD.id::text,0));
  IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'A goal changes only through its own actions and its owner never changes' USING ERRCODE='PF004';
  END IF;
  NEW.progress := OLD.progress;
  IF OLD.status IN ('completed','cancelled') THEN
   RAISE EXCEPTION 'A completed or cancelled goal is final' USING ERRCODE='PF004';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF (SELECT jsonb_object_agg(k,to_jsonb(NEW)->k) FROM unnest(details) k)
     IS DISTINCT FROM (SELECT jsonb_object_agg(k,to_jsonb(OLD)->k) FROM unnest(details) k) THEN
    RAISE EXCEPTION 'Change the details and the status in separate steps' USING ERRCODE='PF004';
   END IF;
   IF NOT ((OLD.status='draft' AND NEW.status IN ('active','cancelled'))
     OR (OLD.status='active' AND NEW.status IN ('completed','cancelled'))) THEN
    RAISE EXCEPTION 'A goal cannot move from % to %', OLD.status, NEW.status USING ERRCODE='PF004';
   END IF;
   IF NEW.status='active' AND NOT EXISTS(SELECT 1 FROM perf_key_result k WHERE k.objective_id=NEW.id) THEN
    RAISE EXCEPTION 'Add at least one key result before activating the goal' USING ERRCODE='PF003';
   END IF;
   IF NEW.status='cancelled' AND (NEW.status_note IS NULL OR char_length(btrim(NEW.status_note))<3) THEN
    RAISE EXCEPTION 'Say why the goal is cancelled' USING ERRCODE='PF003';
   END IF;
  ELSE
   NEW.status_note := OLD.status_note;
   IF (NEW.period_start,NEW.period_end) IS DISTINCT FROM (OLD.period_start,OLD.period_end) AND OLD.status<>'draft' THEN
    RAISE EXCEPTION 'The period changes only while the goal is a draft' USING ERRCODE='PF004';
   END IF;
  END IF;
 END IF;
 IF NEW.period_end<NEW.period_start OR NEW.period_end>NEW.period_start+366 THEN
  RAISE EXCEPTION 'The period ends on or after its start and lasts at most a year' USING ERRCODE='PF003';
 END IF;
 IF NEW.parent_objective_id IS NOT NULL
   AND (TG_OP='INSERT' OR NEW.parent_objective_id IS DISTINCT FROM OLD.parent_objective_id) THEN
  IF NEW.parent_objective_id=NEW.id THEN
   RAISE EXCEPTION 'A goal cannot align to itself' USING ERRCODE='PF003';
  END IF;
  SELECT o.owner_employee_id, o.status INTO par FROM perf_objective o
  WHERE o.tenant_id=NEW.tenant_id AND o.entity_id=NEW.entity_id AND o.id=NEW.parent_objective_id;
  IF NOT FOUND OR par.status NOT IN ('draft','active') THEN
   RAISE EXCEPTION 'Align to a draft or active goal' USING ERRCODE='PF003';
  END IF;
  IF NOT (scope='entity' OR par.owner_employee_id=NEW.owner_employee_id OR par.owner_employee_id=owner.manager_id) THEN
   RAISE EXCEPTION 'Align to the owner''s own goals or their manager''s' USING ERRCODE='PF005';
  END IF;
  hop := NEW.parent_objective_id;
  WHILE hop IS NOT NULL LOOP
   depth := depth+1;
   IF hop=NEW.id OR depth>20 THEN
    RAISE EXCEPTION 'This alignment would make a loop' USING ERRCODE='PF003';
   END IF;
   SELECT o.parent_objective_id INTO hop FROM perf_objective o WHERE o.id=hop;
  END LOOP;
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Key results -----------------------------------------------------------------------------------
CREATE FUNCTION guard_perf_key_result() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.perf_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Employee');
 managed text[] := ARRAY['title','unit','start_value','target_value','current_value','progress','version',
  'updated_by_label','updated_at'];
 obj record;
 latest numeric;
 n integer;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This key result belongs to another organization' USING ERRCODE='PF005';
 END IF;
 IF TG_OP='UPDATE' AND NEW.current_value IS NULL THEN
  -- Recompute request from the writer role: the current value is the latest progress update.
  IF (to_jsonb(NEW)-ARRAY['current_value','progress']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['current_value','progress']) THEN
   RAISE EXCEPTION 'The current value comes only from progress updates' USING ERRCODE='PF004';
  END IF;
  SELECT u.value INTO latest FROM perf_kr_update u WHERE u.key_result_id=NEW.id ORDER BY u.seq DESC LIMIT 1;
  NEW.current_value := coalesce(latest,OLD.start_value);
  NEW.version := OLD.version+1;
  NEW.updated_by_label := label;
  NEW.updated_at := now();
  RETURN NEW;
 END IF;
 IF me IS NULL OR scope NOT IN ('self','team','entity') OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Your current workspace cannot manage goals' USING ERRCODE='PF005';
 END IF;
 SELECT o.id, o.owner_employee_id, o.status INTO obj FROM perf_objective o
 WHERE o.tenant_id=NEW.tenant_id AND o.entity_id=NEW.entity_id
  AND o.id=CASE WHEN TG_OP='INSERT' THEN NEW.objective_id ELSE OLD.objective_id END;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'This goal is unavailable' USING ERRCODE='PF003';
 END IF;
 IF NOT perf_sees_owner(obj.owner_employee_id) THEN
  RAISE EXCEPTION 'Only the goal owner, their manager or HR changes its key results' USING ERRCODE='PF005';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('perf-objective:'||obj.id::text,0));
 IF TG_OP='INSERT' THEN
  IF obj.status NOT IN ('draft','active') THEN
   RAISE EXCEPTION 'Key results are added to draft or active goals' USING ERRCODE='PF004';
  END IF;
  SELECT count(*) INTO n FROM perf_key_result k WHERE k.objective_id=obj.id;
  IF n>=10 THEN
   RAISE EXCEPTION 'A goal has at most 10 key results' USING ERRCODE='PF004';
  END IF;
  NEW.owner_employee_id := obj.owner_employee_id;
  NEW.current_value := NEW.start_value;
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
 ELSE
  IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'A key result changes only through its own actions' USING ERRCODE='PF004';
  END IF;
  IF obj.status<>'draft' THEN
   RAISE EXCEPTION 'Key results are edited while the goal is a draft; record progress once it is active' USING ERRCODE='PF004';
  END IF;
  -- Drafts have no progress updates, so the current value stays at the start.
  NEW.current_value := NEW.start_value;
 END IF;
 IF NEW.target_value=NEW.start_value THEN
  RAISE EXCEPTION 'The target must differ from the starting value' USING ERRCODE='PF003';
 END IF;
 IF NEW.unit='percent' AND (NEW.start_value NOT BETWEEN 0 AND 100 OR NEW.target_value NOT BETWEEN 0 AND 100) THEN
  RAISE EXCEPTION 'Percentages run from 0 to 100' USING ERRCODE='PF003';
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

CREATE FUNCTION guard_perf_kr_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.perf_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Employee');
 kr record;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This key result belongs to another organization' USING ERRCODE='PF005';
 END IF;
 IF me IS NULL OR scope NOT IN ('self','team','entity') OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Your current workspace cannot record progress' USING ERRCODE='PF005';
 END IF;
 SELECT k.objective_id, k.owner_employee_id INTO kr FROM perf_key_result k
 WHERE k.tenant_id=NEW.tenant_id AND k.entity_id=NEW.entity_id AND k.id=NEW.key_result_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'This key result is unavailable' USING ERRCODE='PF003';
 END IF;
 IF NOT perf_sees_owner(kr.owner_employee_id) THEN
  RAISE EXCEPTION 'Only the goal owner, their manager or HR records progress' USING ERRCODE='PF005';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('perf-objective:'||kr.objective_id::text,0));
 IF (SELECT o.status FROM perf_objective o WHERE o.id=kr.objective_id)<>'active' THEN
  RAISE EXCEPTION 'Progress is recorded on active goals' USING ERRCODE='PF004';
 END IF;
 NEW.objective_id := kr.objective_id;
 NEW.owner_employee_id := kr.owner_employee_id;
 NEW.previous_value := (SELECT k.current_value FROM perf_key_result k WHERE k.id=NEW.key_result_id);
 NEW.by_employee := me;
 NEW.by_label := label;
 NEW.at := clock_timestamp();
 RETURN NEW;
END $$;

CREATE FUNCTION apply_perf_kr_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- The key result guard recomputes the current value from the latest update.
 UPDATE public.perf_key_result SET current_value=NULL WHERE id=NEW.key_result_id;
 RETURN NULL;
END $$;
CREATE FUNCTION refresh_perf_objective_progress() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- The goal guard recomputes progress as the average of its key results.
 UPDATE public.perf_objective SET progress=NULL WHERE id=NEW.objective_id;
 RETURN NULL;
END $$;

-- Review cycles ---------------------------------------------------------------------------------
CREATE FUNCTION guard_perf_cycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.perf_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 managed text[] := ARRAY['name','period_start','period_end','self_due','manager_due','department_id','department_kind',
  'status','status_note','opened_at','closed_at','version','updated_by_label','updated_at'];
 details text[] := ARRAY['name','period_start','period_end','self_due','manager_due','department_id'];
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This review cycle belongs to another organization' USING ERRCODE='PF005';
 END IF;
 IF me IS NULL OR scope<>'entity' OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Only HR runs review cycles' USING ERRCODE='PF005';
 END IF;
 IF TG_OP='INSERT' THEN
  NEW.status := 'draft';
  NEW.status_note := NULL;
  NEW.opened_at := NULL;
  NEW.closed_at := NULL;
  NEW.created_by_employee := me;
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('perf-cycle:'||OLD.id::text,0));
  IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'A review cycle changes only through its own actions' USING ERRCODE='PF004';
  END IF;
  NEW.opened_at := OLD.opened_at;
  NEW.closed_at := OLD.closed_at;
  IF OLD.status IN ('closed','cancelled') THEN
   RAISE EXCEPTION 'A closed or cancelled review cycle is final' USING ERRCODE='PF004';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF (SELECT jsonb_object_agg(k,to_jsonb(NEW)->k) FROM unnest(details) k)
     IS DISTINCT FROM (SELECT jsonb_object_agg(k,to_jsonb(OLD)->k) FROM unnest(details) k) THEN
    RAISE EXCEPTION 'Change the details and the status in separate steps' USING ERRCODE='PF004';
   END IF;
   IF OLD.status='draft' AND NEW.status='active' THEN
    NEW.opened_at := now();
   ELSIF OLD.status='draft' AND NEW.status='cancelled' THEN
    NULL;
   ELSIF OLD.status='active' AND NEW.status='closed' THEN
    IF EXISTS(SELECT 1 FROM perf_review r WHERE r.cycle_id=OLD.id AND r.status<>'finalised') THEN
     RAISE EXCEPTION 'Finalise every review before closing the cycle' USING ERRCODE='PF004';
    END IF;
    NEW.closed_at := now();
   ELSE
    RAISE EXCEPTION 'A review cycle cannot move from % to %', OLD.status, NEW.status USING ERRCODE='PF004';
   END IF;
  ELSE
   NEW.status_note := OLD.status_note;
   IF OLD.status<>'draft' THEN
    RAISE EXCEPTION 'A review cycle is edited only while it is a draft' USING ERRCODE='PF004';
   END IF;
  END IF;
 END IF;
 IF NEW.period_end<NEW.period_start OR NEW.period_end>NEW.period_start+366 THEN
  RAISE EXCEPTION 'The period ends on or after its start and lasts at most a year' USING ERRCODE='PF003';
 END IF;
 IF NEW.self_due>NEW.manager_due OR NEW.self_due<NEW.period_start OR NEW.manager_due>NEW.period_end+180 THEN
  RAISE EXCEPTION 'Self reviews are due within the cycle and before manager reviews' USING ERRCODE='PF003';
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Reviews ---------------------------------------------------------------------------------------
CREATE FUNCTION guard_perf_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.perf_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 derived text[] := ARRAY['self_submitted_at','manager_submitted_at','status','version','updated_by_label','updated_at'];
 final text[] := ARRAY['final_rating','final_reason','finalised_by_employee','finalised_by_label','finalised_at',
  'status','version','updated_by_label','updated_at'];
 cyc record;
 emp record;
 mgr text;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This review belongs to another organization' USING ERRCODE='PF005';
 END IF;
 IF TG_OP='INSERT' THEN
  IF me IS NULL OR scope<>'entity' OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
   RAISE EXCEPTION 'Only HR adds people to a review cycle' USING ERRCODE='PF005';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('perf-cycle:'||NEW.cycle_id::text,0));
  SELECT c.status, c.department_id INTO cyc FROM perf_cycle c
  WHERE c.tenant_id=NEW.tenant_id AND c.entity_id=NEW.entity_id AND c.id=NEW.cycle_id;
  IF NOT FOUND OR cyc.status<>'active' THEN
   RAISE EXCEPTION 'Reviews are added to an open review cycle' USING ERRCODE='PF004';
  END IF;
  SELECT e.status, e.manager_id, e.department_id, p.name INTO emp FROM employee e
  JOIN person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
  WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=NEW.employee_id;
  IF NOT FOUND OR emp.status NOT IN ('active','notice') THEN
   RAISE EXCEPTION 'Reviews are for current employees' USING ERRCODE='PF003';
  END IF;
  IF cyc.department_id IS NOT NULL AND emp.department_id IS DISTINCT FROM cyc.department_id THEN
   RAISE EXCEPTION 'This person is outside the cycle''s scope' USING ERRCODE='PF003';
  END IF;
  mgr := perf_employee_name(NEW.tenant_id,NEW.entity_id,emp.manager_id);
  IF emp.manager_id IS NULL OR mgr IS NULL THEN
   RAISE EXCEPTION 'This person has no current manager to review them' USING ERRCODE='PF003';
  END IF;
  NEW.employee_name := emp.name;
  NEW.manager_id := emp.manager_id;
  NEW.manager_name := mgr;
  NEW.status := 'self_pending';
  NEW.self_submitted_at := NULL;
  NEW.manager_submitted_at := NULL;
  NEW.final_rating := NULL;
  NEW.final_reason := NULL;
  NEW.finalised_by_employee := NULL;
  NEW.finalised_by_label := NULL;
  NEW.finalised_at := NULL;
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
  NEW.updated_by_label := label;
  NEW.updated_at := now();
  RETURN NEW;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('perf-review:'||OLD.id::text,0));
 IF OLD.status='finalised' THEN
  RAISE EXCEPTION 'A finalised review never changes' USING ERRCODE='PF004';
 END IF;
 IF (to_jsonb(NEW)-derived) IS NOT DISTINCT FROM (to_jsonb(OLD)-derived) THEN
  -- The state follows the submitted entries (refreshed by the writer role after each entry).
  NEW.self_submitted_at := (SELECT x.submitted_at FROM perf_review_entry x WHERE x.review_id=OLD.id AND x.kind='self');
  NEW.manager_submitted_at := (SELECT x.submitted_at FROM perf_review_entry x WHERE x.review_id=OLD.id AND x.kind='manager');
  NEW.status := CASE WHEN NEW.manager_submitted_at IS NOT NULL THEN 'calibration'
   WHEN NEW.self_submitted_at IS NOT NULL THEN 'manager_pending' ELSE 'self_pending' END;
  NEW.version := OLD.version+1;
  NEW.updated_by_label := coalesce(nullif(current_setting('app.actor_label',true),''),OLD.updated_by_label);
  NEW.updated_at := now();
  RETURN NEW;
 END IF;
 -- Otherwise this is HR finalising.
 IF (to_jsonb(NEW)-final) IS DISTINCT FROM (to_jsonb(OLD)-final) OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'A review changes only through its own actions' USING ERRCODE='PF004';
 END IF;
 IF me IS NULL OR scope<>'entity' OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Only HR finalises reviews' USING ERRCODE='PF005';
 END IF;
 IF me=OLD.employee_id THEN
  RAISE EXCEPTION 'You cannot finalise your own review' USING ERRCODE='PF005';
 END IF;
 IF me=OLD.manager_id THEN
  RAISE EXCEPTION 'Someone in HR other than the reviewing manager finalises this review' USING ERRCODE='PF005';
 END IF;
 IF OLD.status<>'calibration' THEN
  RAISE EXCEPTION 'A review is finalised after the self and manager reviews are in' USING ERRCODE='PF004';
 END IF;
 IF (SELECT c.status FROM perf_cycle c WHERE c.id=OLD.cycle_id)<>'active' THEN
  RAISE EXCEPTION 'This review cycle is not open' USING ERRCODE='PF004';
 END IF;
 IF NEW.final_rating IS NULL OR NEW.final_rating NOT BETWEEN 1 AND 5 THEN
  RAISE EXCEPTION 'Give a final rating from 1 to 5' USING ERRCODE='PF003';
 END IF;
 IF NEW.final_reason IS NULL OR char_length(btrim(NEW.final_reason)) NOT BETWEEN 10 AND 500 THEN
  RAISE EXCEPTION 'Explain the final rating in 10 to 500 characters' USING ERRCODE='PF003';
 END IF;
 NEW.status := 'finalised';
 NEW.finalised_by_employee := me;
 NEW.finalised_by_label := label;
 NEW.finalised_at := now();
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

CREATE FUNCTION guard_perf_review_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.perf_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 rv record;
 k text;
 v jsonb;
 total integer := 0;
 cnt integer := 0;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This review belongs to another organization' USING ERRCODE='PF005';
 END IF;
 IF me IS NULL OR scope NOT IN ('self','team','entity') OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Your current workspace cannot submit reviews' USING ERRCODE='PF005';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('perf-review:'||NEW.review_id::text,0));
 SELECT r.cycle_id, r.employee_id, r.employee_name, r.manager_id, r.manager_name, r.status, c.status AS cycle_status
 INTO rv FROM perf_review r JOIN perf_cycle c ON c.id=r.cycle_id
 WHERE r.tenant_id=NEW.tenant_id AND r.entity_id=NEW.entity_id AND r.id=NEW.review_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'This review is unavailable' USING ERRCODE='PF003';
 END IF;
 IF NEW.kind='self' THEN
  IF me<>rv.employee_id THEN
   RAISE EXCEPTION 'Only the person reviewed submits the self-review' USING ERRCODE='PF005';
  END IF;
  IF rv.status<>'self_pending' THEN
   RAISE EXCEPTION 'The self-review is already submitted' USING ERRCODE='PF004';
  END IF;
  NEW.author_name := rv.employee_name;
 ELSIF NEW.kind='manager' THEN
  IF me<>rv.manager_id OR scope NOT IN ('team','entity') THEN
   RAISE EXCEPTION 'Only the reviewing manager submits the manager review' USING ERRCODE='PF005';
  END IF;
  IF rv.status='self_pending' THEN
   RAISE EXCEPTION 'The manager review follows the self-review' USING ERRCODE='PF004';
  END IF;
  IF rv.status<>'manager_pending' THEN
   RAISE EXCEPTION 'The manager review is already submitted' USING ERRCODE='PF004';
  END IF;
  NEW.author_name := rv.manager_name;
 ELSE
  RAISE EXCEPTION 'An entry is a self or a manager review' USING ERRCODE='PF003';
 END IF;
 IF rv.cycle_status<>'active' THEN
  RAISE EXCEPTION 'This review cycle is not open' USING ERRCODE='PF004';
 END IF;
 IF NEW.ratings IS NULL OR jsonb_typeof(NEW.ratings)<>'object' THEN
  RAISE EXCEPTION 'Rate quality, delivery, collaboration, ownership and growth from 1 to 5' USING ERRCODE='PF003';
 END IF;
 FOR k, v IN SELECT * FROM jsonb_each(NEW.ratings) LOOP
  IF k NOT IN ('quality','delivery','collaboration','ownership','growth')
    OR jsonb_typeof(v)<>'number' OR v::text !~ '^[1-5]$' THEN
   RAISE EXCEPTION 'Rate quality, delivery, collaboration, ownership and growth from 1 to 5' USING ERRCODE='PF003';
  END IF;
  total := total+v::text::integer;
  cnt := cnt+1;
 END LOOP;
 IF cnt<>5 THEN
  RAISE EXCEPTION 'Rate quality, delivery, collaboration, ownership and growth from 1 to 5' USING ERRCODE='PF003';
 END IF;
 NEW.cycle_id := rv.cycle_id;
 NEW.employee_id := rv.employee_id;
 NEW.manager_id := rv.manager_id;
 NEW.author_employee_id := me;
 NEW.overall := round(total::numeric/cnt,2);
 NEW.submitted_at := now();
 RETURN NEW;
END $$;

CREATE FUNCTION refresh_perf_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- The review guard derives its status and submission times from the entries.
 UPDATE public.perf_review SET self_submitted_at=NULL WHERE id=NEW.review_id;
 RETURN NULL;
END $$;

CREATE FUNCTION reject_perf_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Performance records and their history are kept, never deleted' USING ERRCODE='23514';
END $$;
CREATE FUNCTION reject_perf_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Progress updates and submitted reviews are final' USING ERRCODE='PF004';
END $$;

CREATE TRIGGER perf_objective_guard BEFORE INSERT OR UPDATE ON perf_objective FOR EACH ROW EXECUTE FUNCTION guard_perf_objective();
CREATE TRIGGER perf_key_result_guard BEFORE INSERT OR UPDATE ON perf_key_result FOR EACH ROW EXECUTE FUNCTION guard_perf_key_result();
CREATE TRIGGER perf_key_result_progress AFTER INSERT OR UPDATE ON perf_key_result FOR EACH ROW EXECUTE FUNCTION refresh_perf_objective_progress();
CREATE TRIGGER perf_kr_update_guard BEFORE INSERT ON perf_kr_update FOR EACH ROW EXECUTE FUNCTION guard_perf_kr_update();
CREATE TRIGGER perf_kr_update_apply AFTER INSERT ON perf_kr_update FOR EACH ROW EXECUTE FUNCTION apply_perf_kr_update();
CREATE TRIGGER perf_kr_update_final BEFORE UPDATE ON perf_kr_update FOR EACH ROW EXECUTE FUNCTION reject_perf_rewrite();
CREATE TRIGGER perf_cycle_guard BEFORE INSERT OR UPDATE ON perf_cycle FOR EACH ROW EXECUTE FUNCTION guard_perf_cycle();
CREATE TRIGGER perf_review_guard BEFORE INSERT OR UPDATE ON perf_review FOR EACH ROW EXECUTE FUNCTION guard_perf_review();
CREATE TRIGGER perf_review_entry_guard BEFORE INSERT ON perf_review_entry FOR EACH ROW EXECUTE FUNCTION guard_perf_review_entry();
CREATE TRIGGER perf_review_entry_refresh AFTER INSERT ON perf_review_entry FOR EACH ROW EXECUTE FUNCTION refresh_perf_review();
CREATE TRIGGER perf_review_entry_final BEFORE UPDATE ON perf_review_entry FOR EACH ROW EXECUTE FUNCTION reject_perf_rewrite();
CREATE TRIGGER perf_objective_no_delete BEFORE DELETE ON perf_objective FOR EACH ROW EXECUTE FUNCTION reject_perf_delete();
CREATE TRIGGER perf_key_result_no_delete BEFORE DELETE ON perf_key_result FOR EACH ROW EXECUTE FUNCTION reject_perf_delete();
CREATE TRIGGER perf_kr_update_no_delete BEFORE DELETE ON perf_kr_update FOR EACH ROW EXECUTE FUNCTION reject_perf_delete();
CREATE TRIGGER perf_cycle_no_delete BEFORE DELETE ON perf_cycle FOR EACH ROW EXECUTE FUNCTION reject_perf_delete();
CREATE TRIGGER perf_review_no_delete BEFORE DELETE ON perf_review FOR EACH ROW EXECUTE FUNCTION reject_perf_delete();
CREATE TRIGGER perf_review_entry_no_delete BEFORE DELETE ON perf_review_entry FOR EACH ROW EXECUTE FUNCTION reject_perf_delete();
-- Guards, writers and delete blocks fire in replica sessions too.
ALTER TABLE perf_objective ENABLE ALWAYS TRIGGER perf_objective_guard;
ALTER TABLE perf_objective ENABLE ALWAYS TRIGGER perf_objective_no_delete;
ALTER TABLE perf_key_result ENABLE ALWAYS TRIGGER perf_key_result_guard;
ALTER TABLE perf_key_result ENABLE ALWAYS TRIGGER perf_key_result_progress;
ALTER TABLE perf_key_result ENABLE ALWAYS TRIGGER perf_key_result_no_delete;
ALTER TABLE perf_kr_update ENABLE ALWAYS TRIGGER perf_kr_update_guard;
ALTER TABLE perf_kr_update ENABLE ALWAYS TRIGGER perf_kr_update_apply;
ALTER TABLE perf_kr_update ENABLE ALWAYS TRIGGER perf_kr_update_final;
ALTER TABLE perf_kr_update ENABLE ALWAYS TRIGGER perf_kr_update_no_delete;
ALTER TABLE perf_cycle ENABLE ALWAYS TRIGGER perf_cycle_guard;
ALTER TABLE perf_cycle ENABLE ALWAYS TRIGGER perf_cycle_no_delete;
ALTER TABLE perf_review ENABLE ALWAYS TRIGGER perf_review_guard;
ALTER TABLE perf_review ENABLE ALWAYS TRIGGER perf_review_no_delete;
ALTER TABLE perf_review_entry ENABLE ALWAYS TRIGGER perf_review_entry_guard;
ALTER TABLE perf_review_entry ENABLE ALWAYS TRIGGER perf_review_entry_refresh;
ALTER TABLE perf_review_entry ENABLE ALWAYS TRIGGER perf_review_entry_final;
ALTER TABLE perf_review_entry ENABLE ALWAYS TRIGGER perf_review_entry_no_delete;

-- Ownership and grants -------------------------------------------------------------------------
ALTER FUNCTION perf_sees_owner(uuid) OWNER TO anvione_perf_keeper;
ALTER FUNCTION perf_sees_cycle(uuid) OWNER TO anvione_perf_keeper;
ALTER FUNCTION perf_sees_entry(uuid,text,uuid,uuid) OWNER TO anvione_perf_keeper;
ALTER FUNCTION perf_employee_name(uuid,uuid,uuid) OWNER TO anvione_perf_keeper;
ALTER FUNCTION perf_alignable(uuid) OWNER TO anvione_perf_keeper;
ALTER FUNCTION guard_perf_objective() OWNER TO anvione_perf_keeper;
ALTER FUNCTION guard_perf_key_result() OWNER TO anvione_perf_keeper;
ALTER FUNCTION guard_perf_kr_update() OWNER TO anvione_perf_keeper;
ALTER FUNCTION guard_perf_cycle() OWNER TO anvione_perf_keeper;
ALTER FUNCTION guard_perf_review() OWNER TO anvione_perf_keeper;
ALTER FUNCTION guard_perf_review_entry() OWNER TO anvione_perf_keeper;
ALTER FUNCTION apply_perf_kr_update() OWNER TO anvione_perf_writer;
ALTER FUNCTION refresh_perf_objective_progress() OWNER TO anvione_perf_writer;
ALTER FUNCTION refresh_perf_review() OWNER TO anvione_perf_writer;
REVOKE ALL ON FUNCTION perf_in_entity(uuid,uuid),perf_sees_owner(uuid),perf_sees_review(uuid,uuid),perf_sees_cycle(uuid),
 perf_sees_entry(uuid,text,uuid,uuid),perf_employee_name(uuid,uuid,uuid),perf_alignable(uuid),guard_perf_objective(),
 guard_perf_key_result(),guard_perf_kr_update(),guard_perf_cycle(),guard_perf_review(),guard_perf_review_entry(),
 apply_perf_kr_update(),refresh_perf_objective_progress(),refresh_perf_review(),reject_perf_delete(),reject_perf_rewrite()
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION perf_in_entity(uuid,uuid),perf_sees_owner(uuid),perf_sees_review(uuid,uuid),perf_sees_cycle(uuid),
 perf_sees_entry(uuid,text,uuid,uuid),perf_alignable(uuid) TO anvione_app;
GRANT EXECUTE ON FUNCTION perf_in_entity(uuid,uuid),perf_sees_owner(uuid),perf_sees_review(uuid,uuid),perf_sees_cycle(uuid),
 perf_sees_entry(uuid,text,uuid,uuid),perf_employee_name(uuid,uuid,uuid) TO anvione_perf_keeper;
GRANT SELECT ON perf_objective,perf_key_result,perf_kr_update,perf_cycle,perf_review,perf_review_entry,employee,person
 TO anvione_perf_keeper;
GRANT SELECT(id,objective_id), UPDATE(current_value) ON perf_key_result TO anvione_perf_writer;
GRANT SELECT(id), UPDATE(progress) ON perf_objective TO anvione_perf_writer;
GRANT SELECT(id), UPDATE(self_submitted_at) ON perf_review TO anvione_perf_writer;

ALTER TABLE perf_objective ENABLE ROW LEVEL SECURITY;
ALTER TABLE perf_objective FORCE ROW LEVEL SECURITY;
ALTER TABLE perf_key_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE perf_key_result FORCE ROW LEVEL SECURITY;
ALTER TABLE perf_kr_update ENABLE ROW LEVEL SECURITY;
ALTER TABLE perf_kr_update FORCE ROW LEVEL SECURITY;
ALTER TABLE perf_cycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE perf_cycle FORCE ROW LEVEL SECURITY;
ALTER TABLE perf_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE perf_review FORCE ROW LEVEL SECURITY;
ALTER TABLE perf_review_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE perf_review_entry FORCE ROW LEVEL SECURITY;

CREATE POLICY perf_keeper_emp ON employee FOR SELECT TO anvione_perf_keeper USING(true);
CREATE POLICY perf_keeper_person ON person FOR SELECT TO anvione_perf_keeper USING(true);
CREATE POLICY perf_keeper ON perf_objective FOR SELECT TO anvione_perf_keeper USING(true);
CREATE POLICY perf_keeper ON perf_key_result FOR SELECT TO anvione_perf_keeper USING(true);
CREATE POLICY perf_keeper ON perf_kr_update FOR SELECT TO anvione_perf_keeper USING(true);
CREATE POLICY perf_keeper ON perf_cycle FOR SELECT TO anvione_perf_keeper USING(true);
CREATE POLICY perf_keeper ON perf_review FOR SELECT TO anvione_perf_keeper USING(true);
CREATE POLICY perf_keeper ON perf_review_entry FOR SELECT TO anvione_perf_keeper USING(true);
CREATE POLICY perf_writer_read ON perf_key_result FOR SELECT TO anvione_perf_writer USING(true);
CREATE POLICY perf_writer_update ON perf_key_result FOR UPDATE TO anvione_perf_writer USING(true) WITH CHECK(true);
CREATE POLICY perf_writer_read ON perf_objective FOR SELECT TO anvione_perf_writer USING(true);
CREATE POLICY perf_writer_update ON perf_objective FOR UPDATE TO anvione_perf_writer USING(true) WITH CHECK(true);
CREATE POLICY perf_writer_read ON perf_review FOR SELECT TO anvione_perf_writer USING(true);
CREATE POLICY perf_writer_update ON perf_review FOR UPDATE TO anvione_perf_writer USING(true) WITH CHECK(true);

CREATE POLICY perf_objective_visible ON perf_objective FOR SELECT TO anvione_app
 USING(perf_in_entity(tenant_id,entity_id) AND perf_sees_owner(owner_employee_id));
CREATE POLICY perf_objective_insert ON perf_objective FOR INSERT TO anvione_app
 WITH CHECK(perf_in_entity(tenant_id,entity_id) AND perf_sees_owner(owner_employee_id));
CREATE POLICY perf_objective_update ON perf_objective FOR UPDATE TO anvione_app
 USING(perf_in_entity(tenant_id,entity_id) AND perf_sees_owner(owner_employee_id)) WITH CHECK(perf_in_entity(tenant_id,entity_id));
CREATE POLICY perf_key_result_visible ON perf_key_result FOR SELECT TO anvione_app
 USING(perf_in_entity(tenant_id,entity_id) AND perf_sees_owner(owner_employee_id));
CREATE POLICY perf_key_result_insert ON perf_key_result FOR INSERT TO anvione_app
 WITH CHECK(perf_in_entity(tenant_id,entity_id) AND perf_sees_owner(owner_employee_id));
CREATE POLICY perf_key_result_update ON perf_key_result FOR UPDATE TO anvione_app
 USING(perf_in_entity(tenant_id,entity_id) AND perf_sees_owner(owner_employee_id)) WITH CHECK(perf_in_entity(tenant_id,entity_id));
CREATE POLICY perf_kr_update_visible ON perf_kr_update FOR SELECT TO anvione_app
 USING(perf_in_entity(tenant_id,entity_id) AND perf_sees_owner(owner_employee_id));
CREATE POLICY perf_kr_update_insert ON perf_kr_update FOR INSERT TO anvione_app
 WITH CHECK(perf_in_entity(tenant_id,entity_id) AND perf_sees_owner(owner_employee_id)
  AND by_employee=nullif(current_setting('app.employee_id',true),'')::uuid);
CREATE POLICY perf_cycle_visible ON perf_cycle FOR SELECT TO anvione_app
 USING(perf_in_entity(tenant_id,entity_id) AND perf_sees_cycle(id));
CREATE POLICY perf_cycle_insert ON perf_cycle FOR INSERT TO anvione_app
 WITH CHECK(perf_in_entity(tenant_id,entity_id) AND current_setting('app.perf_scope',true)='entity');
CREATE POLICY perf_cycle_update ON perf_cycle FOR UPDATE TO anvione_app
 USING(perf_in_entity(tenant_id,entity_id) AND current_setting('app.perf_scope',true)='entity')
 WITH CHECK(perf_in_entity(tenant_id,entity_id));
CREATE POLICY perf_review_visible ON perf_review FOR SELECT TO anvione_app
 USING(perf_in_entity(tenant_id,entity_id) AND perf_sees_review(employee_id,manager_id));
CREATE POLICY perf_review_insert ON perf_review FOR INSERT TO anvione_app
 WITH CHECK(perf_in_entity(tenant_id,entity_id) AND current_setting('app.perf_scope',true)='entity');
CREATE POLICY perf_review_update ON perf_review FOR UPDATE TO anvione_app
 USING(perf_in_entity(tenant_id,entity_id) AND current_setting('app.perf_scope',true)='entity')
 WITH CHECK(perf_in_entity(tenant_id,entity_id));
CREATE POLICY perf_review_entry_visible ON perf_review_entry FOR SELECT TO anvione_app
 USING(perf_in_entity(tenant_id,entity_id) AND perf_sees_entry(review_id,kind,employee_id,manager_id));
CREATE POLICY perf_review_entry_insert ON perf_review_entry FOR INSERT TO anvione_app
 WITH CHECK(perf_in_entity(tenant_id,entity_id)
  AND author_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
  AND current_setting('app.perf_scope',true) IN ('self','team','entity'));

GRANT SELECT ON perf_objective,perf_key_result,perf_kr_update,perf_cycle,perf_review,perf_review_entry TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,owner_employee_id,title,description,period_start,period_end,parent_objective_id)
 ON perf_objective TO anvione_app;
GRANT UPDATE(title,description,period_start,period_end,parent_objective_id,status,status_note,version)
 ON perf_objective TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,objective_id,title,unit,start_value,target_value) ON perf_key_result TO anvione_app;
GRANT UPDATE(title,unit,start_value,target_value,version) ON perf_key_result TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,key_result_id,value,note) ON perf_kr_update TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,name,period_start,period_end,self_due,manager_due,department_id) ON perf_cycle TO anvione_app;
GRANT UPDATE(name,period_start,period_end,self_due,manager_due,department_id,status,status_note,version) ON perf_cycle TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,cycle_id,employee_id) ON perf_review TO anvione_app;
GRANT UPDATE(final_rating,final_reason,version) ON perf_review TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,review_id,kind,ratings,comment) ON perf_review_entry TO anvione_app;

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
 'performance.review_self_submitted.v1','performance.review_manager_submitted.v1','performance.review_finalised.v1'
));
