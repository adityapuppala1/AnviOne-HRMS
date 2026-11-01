-- ENG-01 Recognition and engagement (pulse surveys), backend only.
-- Recognition: any current employee thanks a colleague in their entity (never themselves) for an
-- admin-managed company value with a short message; at most 10 given per person per UTC day;
-- one reaction per person per post from a fixed set of codes; HR hides or restores a post with a
-- reason, kept in an append-only moderation history. No cash value, points or redemption.
-- Pulse surveys: HR drafts, publishes and closes surveys of up to 12 questions. ANONYMITY:
-- participation (survey, employee) and answers (survey, question, value) live in separate tables;
-- the answer table has no employee, link or time column and random ids. Both are written in one
-- transaction by eng_submit_response, owned by a writer role that cannot read answers; results
-- come only from eng_survey_results, owned by a keeper role that cannot read participation. The
-- app role has no privilege on answers. Results are released only once the survey has closed and
-- at least 5 people answered; free text is then returned in random order.
-- Errors: EG003 bad input (400), EG004 conflict (409), EG005 forbidden (403).
CREATE ROLE anvione_engage_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE anvione_engage_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_engage_keeper, anvione_engage_writer;

CREATE TABLE eng_value (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 2 AND 40 AND name=btrim(name)),
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
CREATE UNIQUE INDEX eng_value_name_key ON eng_value(tenant_id,entity_id,lower(name));

CREATE TABLE eng_kudos (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 giver_employee_id uuid NOT NULL,
 giver_name text NOT NULL,
 recipient_employee_id uuid NOT NULL,
 recipient_name text NOT NULL,
 value_id uuid NOT NULL,
 message text NOT NULL CHECK(char_length(message) BETWEEN 1 AND 280 AND message=btrim(message)),
 given_on date NOT NULL,
 hidden boolean NOT NULL DEFAULT false,
 hidden_at timestamptz,
 version integer NOT NULL CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 FOREIGN KEY(tenant_id,entity_id,giver_employee_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,recipient_employee_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,value_id) REFERENCES eng_value(tenant_id,entity_id,id),
 -- Recognition is for a colleague, never for oneself.
 CONSTRAINT eng_kudos_not_self CHECK(giver_employee_id<>recipient_employee_id),
 CHECK(hidden=(hidden_at IS NOT NULL)),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX eng_kudos_feed_idx ON eng_kudos(tenant_id,entity_id,created_at DESC,id);
CREATE INDEX eng_kudos_giver_idx ON eng_kudos(giver_employee_id,given_on);
CREATE INDEX eng_kudos_recipient_idx ON eng_kudos(recipient_employee_id,created_at DESC);

CREATE TABLE eng_kudos_moderation (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 kudos_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('hide','restore')),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 3 AND 500 AND reason=btrim(reason)),
 by_employee uuid NOT NULL,
 by_label text NOT NULL,
 at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,entity_id,kudos_id) REFERENCES eng_kudos(tenant_id,entity_id,id)
);
CREATE INDEX eng_kudos_moderation_kudos_idx ON eng_kudos_moderation(kudos_id,at);

CREATE TABLE eng_reaction (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 kudos_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 code text NOT NULL CHECK(code IN ('thanks','applause','inspiring','helpful','celebrate')),
 at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,kudos_id) REFERENCES eng_kudos(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 CONSTRAINT eng_reaction_once_key UNIQUE(kudos_id,employee_id)
);

CREATE TABLE eng_survey (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 title text NOT NULL CHECK(char_length(title) BETWEEN 3 AND 120 AND title=btrim(title)),
 opens_at timestamptz NOT NULL,
 closes_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','published','closed')),
 published_at timestamptz,
 closed_at timestamptz,
 response_count integer NOT NULL DEFAULT 0 CHECK(response_count>=0),
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 CHECK(closes_at>opens_at AND closes_at<=opens_at+interval '92 days'),
 CHECK((status<>'draft')=(published_at IS NOT NULL)),
 CHECK((status='closed')=(closed_at IS NOT NULL)),
 CHECK(status<>'draft' OR response_count=0),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX eng_survey_entity_idx ON eng_survey(tenant_id,entity_id,status,created_at DESC);

CREATE TABLE eng_survey_question (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 survey_id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 1 AND 12),
 kind text NOT NULL CHECK(kind IN ('rating','choice','text')),
 prompt text NOT NULL CHECK(char_length(prompt) BETWEEN 3 AND 200 AND prompt=btrim(prompt)),
 options text[] NOT NULL DEFAULT '{}',
 FOREIGN KEY(tenant_id,entity_id,survey_id) REFERENCES eng_survey(tenant_id,entity_id,id),
 CHECK((kind='choice' AND cardinality(options) BETWEEN 2 AND 8) OR (kind<>'choice' AND cardinality(options)=0)),
 CONSTRAINT eng_survey_question_position_key UNIQUE(survey_id,position),
 UNIQUE(tenant_id,entity_id,survey_id,id)
);

-- Who could answer: current employees of the entity when the survey was published.
CREATE TABLE eng_survey_eligible (
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 survey_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 PRIMARY KEY(survey_id,employee_id),
 FOREIGN KEY(tenant_id,entity_id,survey_id) REFERENCES eng_survey(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id)
);

-- Who answered. No time, no link to any answer.
CREATE TABLE eng_survey_participation (
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 survey_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 CONSTRAINT eng_survey_participation_pkey PRIMARY KEY(survey_id,employee_id),
 FOREIGN KEY(survey_id,employee_id) REFERENCES eng_survey_eligible(survey_id,employee_id),
 FOREIGN KEY(tenant_id,entity_id,survey_id) REFERENCES eng_survey(tenant_id,entity_id,id)
);

-- What was answered. Deliberately no employee, participation link, time, date or sequence.
CREATE TABLE eng_survey_answer (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 survey_id uuid NOT NULL,
 question_id uuid NOT NULL,
 rating smallint CHECK(rating BETWEEN 1 AND 5),
 choice smallint CHECK(choice BETWEEN 0 AND 7),
 text_value text CHECK(char_length(text_value) BETWEEN 1 AND 500 AND text_value=btrim(text_value)),
 FOREIGN KEY(tenant_id,entity_id,survey_id,question_id) REFERENCES eng_survey_question(tenant_id,entity_id,survey_id,id),
 CHECK(num_nonnulls(rating,choice,text_value)=1)
);
CREATE INDEX eng_survey_answer_question_idx ON eng_survey_answer(question_id);

-- Seed: default company values for every existing entity.
INSERT INTO eng_value(id,tenant_id,entity_id,name,sort,version,created_by_label,updated_by_label)
SELECT gen_random_uuid(), e.tenant_id, e.id, v.name, v.sort, 1, 'System', 'System'
FROM legal_entity e CROSS JOIN (VALUES ('Customer first',10),('Ownership',20),('Teamwork',30),
 ('Integrity',40),('Learning',50),('Excellence',60)) AS v(name,sort);

-- Helpers -----------------------------------------------------------------------------------
CREATE FUNCTION eng_in_entity(p_tenant uuid, p_entity uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(p_tenant=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND p_entity=nullif(current_setting('app.entity_id',true),'')::uuid,false);
$$;
CREATE FUNCTION eng_scope() RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN nullif(current_setting('app.employee_id',true),'') IS NULL THEN 'none'
  ELSE coalesce(nullif(current_setting('app.engage_scope',true),''),'none') END;
$$;
-- Colleagues to recognise: current employees of the entity other than the caller (id and name).
CREATE FUNCTION eng_colleagues(p_q text) RETURNS TABLE(employee_id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT e.id, p.name FROM public.employee e JOIN public.person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
 WHERE public.eng_scope() IN ('self','manage')
  AND e.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND e.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND e.status IN ('active','notice')
  AND e.id<>nullif(current_setting('app.employee_id',true),'')::uuid
  AND (coalesce(p_q,'')='' OR p.name ILIKE '%'||replace(replace(replace(left(p_q,80),'\','\\'),'%','\%'),'_','\_')||'%')
 ORDER BY lower(p.name), e.id LIMIT 20;
$$;

-- Values (engage.manage only) ----------------------------------------------------------------
CREATE FUNCTION guard_eng_value() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This record belongs to another organization' USING ERRCODE='EG005';
 END IF;
 IF eng_scope()<>'manage' OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Only HR manages company values' USING ERRCODE='EG005';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'This value changed. Reload it before trying again' USING ERRCODE='EG004';
  END IF;
  NEW.created_by_label := OLD.created_by_label;
  NEW.created_at := OLD.created_at;
 ELSE
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Recognition posts ---------------------------------------------------------------------------
CREATE FUNCTION guard_eng_kudos() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 today date := (now() AT TIME ZONE 'UTC')::date;
 giver record;
 recipient record;
 given integer;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This record belongs to another organization' USING ERRCODE='EG005';
 END IF;
 IF me IS NULL OR public.eng_scope() NOT IN ('self','manage') OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Your current workspace cannot give recognition' USING ERRCODE='EG005';
 END IF;
 SELECT e.status, p.name INTO giver FROM public.employee e JOIN public.person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
 WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=me;
 IF NOT FOUND OR giver.status NOT IN ('active','notice') THEN
  RAISE EXCEPTION 'Recognition is given by current employees' USING ERRCODE='EG003';
 END IF;
 IF NEW.recipient_employee_id IS NOT DISTINCT FROM me THEN
  RAISE EXCEPTION 'Recognise a colleague, not yourself' USING ERRCODE='EG003';
 END IF;
 SELECT e.status, p.name INTO recipient FROM public.employee e JOIN public.person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
 WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=NEW.recipient_employee_id;
 IF NOT FOUND OR recipient.status NOT IN ('active','notice') THEN
  RAISE EXCEPTION 'Choose a current colleague in your organization' USING ERRCODE='EG003';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.eng_value v WHERE v.tenant_id=NEW.tenant_id AND v.entity_id=NEW.entity_id
   AND v.id=NEW.value_id AND v.active) THEN
  RAISE EXCEPTION 'Choose an active company value' USING ERRCODE='EG003';
 END IF;
 IF NEW.message IS NULL OR char_length(btrim(NEW.message)) NOT BETWEEN 1 AND 280 THEN
  RAISE EXCEPTION 'Write a message of up to 280 characters' USING ERRCODE='EG003';
 END IF;
 -- The daily cap is counted under a per-giver, per-day lock so parallel requests cannot pass it.
 PERFORM pg_advisory_xact_lock(hashtextextended('eng-kudos-day:'||me::text||':'||today::text,0));
 SELECT count(*) INTO given FROM public.eng_kudos k WHERE k.giver_employee_id=me AND k.given_on=today;
 IF given>=10 THEN
  RAISE EXCEPTION 'You can give up to 10 recognitions a day. Try again tomorrow' USING ERRCODE='EG004';
 END IF;
 NEW.message := btrim(NEW.message);
 NEW.giver_employee_id := me;
 NEW.giver_name := giver.name;
 NEW.recipient_name := recipient.name;
 NEW.given_on := today;
 NEW.hidden := false;
 NEW.hidden_at := NULL;
 NEW.version := 1;
 NEW.created_at := now();
 RETURN NEW;
END $$;

-- Posts change only through moderation, applied by the writer role.
CREATE FUNCTION guard_eng_kudos_update() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF current_user<>'anvione_engage_writer'
   OR (to_jsonb(NEW)-ARRAY['hidden','hidden_at','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['hidden','hidden_at','version'])
   OR NEW.version<>OLD.version+1 OR NEW.hidden=OLD.hidden THEN
  RAISE EXCEPTION 'Recognition posts are final; HR can only hide or restore them' USING ERRCODE='EG004';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION guard_eng_kudos_moderation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 k record;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This record belongs to another organization' USING ERRCODE='EG005';
 END IF;
 IF public.eng_scope()<>'manage' OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Only HR moderates recognition' USING ERRCODE='EG005';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eng-kudos:'||NEW.kudos_id::text,0));
 SELECT x.hidden INTO k FROM public.eng_kudos x WHERE x.tenant_id=NEW.tenant_id AND x.entity_id=NEW.entity_id AND x.id=NEW.kudos_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'This recognition is unavailable' USING ERRCODE='EG003';
 END IF;
 IF NEW.action='hide' AND k.hidden THEN
  RAISE EXCEPTION 'This recognition is already hidden' USING ERRCODE='EG004';
 ELSIF NEW.action='restore' AND NOT k.hidden THEN
  RAISE EXCEPTION 'This recognition is not hidden' USING ERRCODE='EG004';
 ELSIF NEW.action IS NULL OR NEW.action NOT IN ('hide','restore') THEN
  RAISE EXCEPTION 'Hide or restore a recognition' USING ERRCODE='EG003';
 END IF;
 IF NEW.reason IS NULL OR char_length(btrim(NEW.reason)) NOT BETWEEN 3 AND 500 THEN
  RAISE EXCEPTION 'Give a reason of 3 to 500 characters' USING ERRCODE='EG003';
 END IF;
 NEW.reason := btrim(NEW.reason);
 NEW.by_employee := me;
 NEW.by_label := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 NEW.at := clock_timestamp();
 RETURN NEW;
END $$;

CREATE FUNCTION apply_eng_kudos_moderation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 UPDATE public.eng_kudos SET hidden=(NEW.action='hide'),
  hidden_at=CASE WHEN NEW.action='hide' THEN NEW.at END, version=version+1
 WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND id=NEW.kudos_id;
 RETURN NULL;
END $$;

CREATE FUNCTION guard_eng_reaction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This record belongs to another organization' USING ERRCODE='EG005';
 END IF;
 IF me IS NULL OR public.eng_scope() NOT IN ('self','manage') OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Your current workspace cannot react to recognition' USING ERRCODE='EG005';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eng-kudos:'||NEW.kudos_id::text,0));
 -- One answer whether the post is missing, in another entity or hidden.
 IF NOT EXISTS(SELECT 1 FROM public.eng_kudos k WHERE k.tenant_id=NEW.tenant_id AND k.entity_id=NEW.entity_id
   AND k.id=NEW.kudos_id AND NOT k.hidden) THEN
  RAISE EXCEPTION 'This recognition is unavailable' USING ERRCODE='EG003';
 END IF;
 IF NEW.code IS NULL OR NEW.code NOT IN ('thanks','applause','inspiring','helpful','celebrate') THEN
  RAISE EXCEPTION 'Choose a reaction from the list' USING ERRCODE='EG003';
 END IF;
 NEW.employee_id := me;
 NEW.at := now();
 RETURN NEW;
END $$;

-- Surveys -------------------------------------------------------------------------------------
-- Runs as the caller (not SECURITY DEFINER) so it can tell the writer role's counter update apart.
CREATE FUNCTION guard_eng_survey() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 questions integer;
BEGIN
 IF current_user='anvione_engage_writer' THEN
  -- Answering a survey only counts the response.
  IF TG_OP<>'UPDATE' OR (to_jsonb(NEW)-'response_count') IS DISTINCT FROM (to_jsonb(OLD)-'response_count')
    OR NEW.response_count<>OLD.response_count+1 THEN
   RAISE EXCEPTION 'A survey changes only through its own actions' USING ERRCODE='EG004';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This record belongs to another organization' USING ERRCODE='EG005';
 END IF;
 IF eng_scope()<>'manage' OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Only HR runs surveys' USING ERRCODE='EG005';
 END IF;
 IF TG_OP='INSERT' THEN
  NEW.status := 'draft';
  NEW.published_at := NULL;
  NEW.closed_at := NULL;
  NEW.response_count := 0;
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('eng-survey:'||OLD.id::text,0));
  IF NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'This survey changed. Reload it before trying again' USING ERRCODE='EG004';
  END IF;
  IF (NEW.id,NEW.response_count,NEW.created_by_label,NEW.created_at,NEW.published_at,NEW.closed_at)
    IS DISTINCT FROM (OLD.id,OLD.response_count,OLD.created_by_label,OLD.created_at,OLD.published_at,OLD.closed_at) THEN
   RAISE EXCEPTION 'A survey changes only through its own actions' USING ERRCODE='EG004';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF (NEW.title,NEW.opens_at,NEW.closes_at) IS DISTINCT FROM (OLD.title,OLD.opens_at,OLD.closes_at) THEN
    RAISE EXCEPTION 'Change the survey and its status in separate steps' USING ERRCODE='EG004';
   END IF;
   IF OLD.status='draft' AND NEW.status='published' THEN
    IF OLD.closes_at<=now() THEN
     RAISE EXCEPTION 'Set a close time in the future before publishing' USING ERRCODE='EG003';
    END IF;
    SELECT count(*) INTO questions FROM eng_survey_question q WHERE q.survey_id=OLD.id;
    IF questions=0 THEN
     RAISE EXCEPTION 'Add at least one question before publishing' USING ERRCODE='EG003';
    END IF;
    NEW.published_at := now();
   ELSIF OLD.status='published' AND NEW.status='closed' THEN
    NEW.closed_at := now();
   ELSE
    RAISE EXCEPTION 'A survey cannot move from % to %', OLD.status, NEW.status USING ERRCODE='EG004';
   END IF;
  ELSIF OLD.status<>'draft' THEN
   RAISE EXCEPTION 'A published survey cannot be edited' USING ERRCODE='EG004';
  END IF;
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Questions are added and replaced only while their survey is a draft (runs as the app).
CREATE FUNCTION guard_eng_survey_question() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 r record;
 s record;
 opt text;
 n integer;
BEGIN
 IF TG_OP='DELETE' THEN r := OLD; ELSE r := NEW; END IF;
 IF r.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR r.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This record belongs to another organization' USING ERRCODE='EG005';
 END IF;
 IF eng_scope()<>'manage' OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Only HR runs surveys' USING ERRCODE='EG005';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eng-survey:'||r.survey_id::text,0));
 SELECT x.status INTO s FROM eng_survey x WHERE x.tenant_id=r.tenant_id AND x.entity_id=r.entity_id AND x.id=r.survey_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'This survey is unavailable' USING ERRCODE='EG003';
 END IF;
 IF s.status<>'draft' THEN
  RAISE EXCEPTION 'Questions are fixed once a survey is published' USING ERRCODE='EG004';
 END IF;
 IF TG_OP='DELETE' THEN
  RETURN OLD;
 END IF;
 SELECT count(*) INTO n FROM eng_survey_question q WHERE q.survey_id=NEW.survey_id;
 IF n>=12 THEN
  RAISE EXCEPTION 'A survey has at most 12 questions' USING ERRCODE='EG003';
 END IF;
 IF NEW.kind='choice' THEN
  IF NEW.options IS NULL OR cardinality(NEW.options) NOT BETWEEN 2 AND 8 THEN
   RAISE EXCEPTION 'A choice question has 2 to 8 options' USING ERRCODE='EG003';
  END IF;
  FOREACH opt IN ARRAY NEW.options LOOP
   IF opt IS NULL OR char_length(btrim(opt)) NOT BETWEEN 1 AND 80 OR opt<>btrim(opt) THEN
    RAISE EXCEPTION 'Options are 1 to 80 characters' USING ERRCODE='EG003';
   END IF;
  END LOOP;
  IF (SELECT count(DISTINCT lower(o)) FROM unnest(NEW.options) o)<>cardinality(NEW.options) THEN
   RAISE EXCEPTION 'Options must be different from each other' USING ERRCODE='EG003';
  END IF;
 ELSE
  NEW.options := '{}';
 END IF;
 RETURN NEW;
END $$;

-- Writer-owned: snapshot eligibility when a survey is published.
CREATE FUNCTION snapshot_eng_survey_eligible() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF OLD.status='draft' AND NEW.status='published' THEN
  INSERT INTO public.eng_survey_eligible(tenant_id,entity_id,survey_id,employee_id)
  SELECT e.tenant_id, e.entity_id, NEW.id, e.id FROM public.employee e
  WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.status IN ('active','notice');
 END IF;
 RETURN NULL;
END $$;

-- Writer-only inserts into eligibility, participation and answers.
CREATE FUNCTION guard_eng_writer_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF current_user<>'anvione_engage_writer' THEN
  RAISE EXCEPTION 'Survey answers are recorded only through eng_submit_response' USING ERRCODE='EG005';
 END IF;
 RETURN NEW;
END $$;

-- Answer a survey once: participation and answers in one transaction, never linked.
CREATE FUNCTION eng_submit_response(p_survey uuid, p_answers jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 t uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
 e uuid := nullif(current_setting('app.entity_id',true),'')::uuid;
 s record;
 q record;
 a jsonb;
 v jsonb;
 n integer;
 matched integer := 0;
 q_ids uuid[] := '{}';
 ratings smallint[] := '{}';
 choices smallint[] := '{}';
 texts text[] := '{}';
 txt text;
BEGIN
 IF me IS NULL OR t IS NULL OR e IS NULL OR public.eng_scope() NOT IN ('self','manage')
   OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Your current workspace cannot answer surveys' USING ERRCODE='EG005';
 END IF;
 SELECT x.id, x.status, x.opens_at, x.closes_at INTO s FROM public.eng_survey x
 WHERE x.tenant_id=t AND x.entity_id=e AND x.id=p_survey FOR UPDATE;
 -- One answer whether the survey is missing, a draft, in another entity or not for the caller.
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.eng_survey_eligible g WHERE g.survey_id=p_survey AND g.employee_id=me) THEN
  RAISE EXCEPTION 'This survey is unavailable' USING ERRCODE='EG003';
 END IF;
 IF s.status<>'published' OR now()<s.opens_at OR now()>=s.closes_at THEN
  RAISE EXCEPTION 'This survey is not open for answers' USING ERRCODE='EG004';
 END IF;
 IF p_answers IS NULL OR jsonb_typeof(p_answers)<>'array' OR jsonb_array_length(p_answers)>12 THEN
  RAISE EXCEPTION 'Answer the survey questions' USING ERRCODE='EG003';
 END IF;
 BEGIN
  INSERT INTO public.eng_survey_participation(tenant_id,entity_id,survey_id,employee_id) VALUES (t,e,p_survey,me);
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'You have already answered this survey' USING ERRCODE='EG004';
 END;
 FOR q IN SELECT x.id, x.kind, cardinality(x.options) AS opts FROM public.eng_survey_question x
   WHERE x.survey_id=p_survey ORDER BY x.position LOOP
  SELECT count(*) INTO n FROM jsonb_array_elements(p_answers) y WHERE y->>'questionId'=q.id::text;
  IF n>1 THEN
   RAISE EXCEPTION 'Answer each question once' USING ERRCODE='EG003';
  END IF;
  a := (SELECT y FROM jsonb_array_elements(p_answers) y WHERE y->>'questionId'=q.id::text);
  matched := matched+n;
  IF q.kind='rating' THEN
   v := a->'rating';
   IF v IS NULL OR jsonb_typeof(v)<>'number' OR v::text !~ '^[1-5]$' THEN
    RAISE EXCEPTION 'Rate every rating question from 1 to 5' USING ERRCODE='EG003';
   END IF;
   q_ids := q_ids||q.id; ratings := ratings||(v::text)::smallint; choices := choices||NULL::smallint; texts := texts||NULL::text;
  ELSIF q.kind='choice' THEN
   v := a->'choice';
   IF v IS NULL OR jsonb_typeof(v)<>'number' OR v::text !~ '^[0-7]$' OR (v::text)::integer>=q.opts THEN
    RAISE EXCEPTION 'Choose one option for every choice question' USING ERRCODE='EG003';
   END IF;
   q_ids := q_ids||q.id; ratings := ratings||NULL::smallint; choices := choices||(v::text)::smallint; texts := texts||NULL::text;
  ELSE
   v := a->'text';
   IF v IS NOT NULL AND jsonb_typeof(v) NOT IN ('string','null') THEN
    RAISE EXCEPTION 'Text answers are up to 500 characters' USING ERRCODE='EG003';
   END IF;
   txt := btrim(a->>'text');
   IF txt IS NOT NULL AND txt<>'' THEN
    IF char_length(txt)>500 THEN
     RAISE EXCEPTION 'Text answers are up to 500 characters' USING ERRCODE='EG003';
    END IF;
    q_ids := q_ids||q.id; ratings := ratings||NULL::smallint; choices := choices||NULL::smallint; texts := texts||txt;
   END IF;
  END IF;
 END LOOP;
 IF matched<>jsonb_array_length(p_answers) THEN
  RAISE EXCEPTION 'Answer only this survey''s questions' USING ERRCODE='EG003';
 END IF;
 -- Random ids and random insertion order; no employee, time or link column exists.
 INSERT INTO public.eng_survey_answer(id,tenant_id,entity_id,survey_id,question_id,rating,choice,text_value)
 SELECT gen_random_uuid(),t,e,p_survey,x.q,x.r,x.c,x.v
 FROM unnest(q_ids,ratings,choices,texts) AS x(q,r,c,v) ORDER BY random();
 UPDATE public.eng_survey SET response_count=response_count+1 WHERE id=p_survey;
END $$;

-- Aggregates only, released after the survey closed and only with at least 5 answers.
CREATE FUNCTION eng_survey_results(p_survey uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 t uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
 e uuid := nullif(current_setting('app.entity_id',true),'')::uuid;
 s record;
 eligible integer;
 closed boolean;
 items jsonb := '[]';
 q record;
BEGIN
 IF public.eng_scope()<>'manage' OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Only HR reads survey results' USING ERRCODE='EG005';
 END IF;
 SELECT x.id, x.status, x.closes_at, x.response_count INTO s FROM public.eng_survey x
 WHERE x.tenant_id=t AND x.entity_id=e AND x.id=p_survey;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'This survey is unavailable' USING ERRCODE='EG003';
 END IF;
 SELECT count(*) INTO eligible FROM public.eng_survey_eligible g WHERE g.survey_id=p_survey;
 closed := s.status='closed' OR (s.status='published' AND now()>=s.closes_at);
 IF NOT closed OR s.response_count<5 THEN
  RETURN jsonb_build_object('responses',s.response_count,'eligible',eligible,'threshold',5,'released',false,
   'withheld',CASE WHEN s.status='draft' THEN 'draft' WHEN NOT closed THEN 'open' ELSE 'too_few_responses' END,
   'questions','[]'::jsonb);
 END IF;
 FOR q IN SELECT x.id, x.position, x.kind, x.prompt, x.options FROM public.eng_survey_question x
   WHERE x.survey_id=p_survey ORDER BY x.position LOOP
  IF q.kind='rating' THEN
   items := items||jsonb_build_array(jsonb_build_object('questionId',q.id,'position',q.position,'kind',q.kind,
    'prompt',q.prompt,'answered',(SELECT count(*) FROM public.eng_survey_answer a WHERE a.question_id=q.id),
    'average',(SELECT round(avg(a.rating)::numeric,2) FROM public.eng_survey_answer a WHERE a.question_id=q.id),
    'counts',(SELECT jsonb_agg((SELECT count(*) FROM public.eng_survey_answer a WHERE a.question_id=q.id AND a.rating=g) ORDER BY g)
      FROM generate_series(1,5) g)));
  ELSIF q.kind='choice' THEN
   items := items||jsonb_build_array(jsonb_build_object('questionId',q.id,'position',q.position,'kind',q.kind,
    'prompt',q.prompt,'options',to_jsonb(q.options),
    'answered',(SELECT count(*) FROM public.eng_survey_answer a WHERE a.question_id=q.id),
    'counts',(SELECT jsonb_agg((SELECT count(*) FROM public.eng_survey_answer a WHERE a.question_id=q.id AND a.choice=g-1) ORDER BY g)
      FROM generate_series(1,cardinality(q.options)) g)));
  ELSE
   items := items||jsonb_build_array(jsonb_build_object('questionId',q.id,'position',q.position,'kind',q.kind,
    'prompt',q.prompt,'answered',(SELECT count(*) FROM public.eng_survey_answer a WHERE a.question_id=q.id),
    'texts',coalesce((SELECT jsonb_agg(a.text_value ORDER BY random()) FROM public.eng_survey_answer a WHERE a.question_id=q.id),'[]'::jsonb)));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('responses',s.response_count,'eligible',eligible,'threshold',5,'released',true,
  'withheld',NULL,'questions',items);
END $$;

CREATE FUNCTION reject_eng_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Recognition and survey records are kept, never deleted' USING ERRCODE='23514';
END $$;
CREATE FUNCTION reject_eng_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Moderation history, reactions, questions, eligibility, participation and answers are final' USING ERRCODE='EG004';
END $$;

CREATE TRIGGER eng_value_guard BEFORE INSERT OR UPDATE ON eng_value FOR EACH ROW EXECUTE FUNCTION guard_eng_value();
CREATE TRIGGER eng_kudos_guard BEFORE INSERT ON eng_kudos FOR EACH ROW EXECUTE FUNCTION guard_eng_kudos();
CREATE TRIGGER eng_kudos_guard_update BEFORE UPDATE ON eng_kudos FOR EACH ROW EXECUTE FUNCTION guard_eng_kudos_update();
CREATE TRIGGER eng_kudos_moderation_guard BEFORE INSERT ON eng_kudos_moderation FOR EACH ROW EXECUTE FUNCTION guard_eng_kudos_moderation();
CREATE TRIGGER eng_kudos_moderation_apply AFTER INSERT ON eng_kudos_moderation FOR EACH ROW EXECUTE FUNCTION apply_eng_kudos_moderation();
CREATE TRIGGER eng_reaction_guard BEFORE INSERT ON eng_reaction FOR EACH ROW EXECUTE FUNCTION guard_eng_reaction();
CREATE TRIGGER eng_survey_guard BEFORE INSERT OR UPDATE ON eng_survey FOR EACH ROW EXECUTE FUNCTION guard_eng_survey();
CREATE TRIGGER eng_survey_eligible_snapshot AFTER UPDATE ON eng_survey FOR EACH ROW EXECUTE FUNCTION snapshot_eng_survey_eligible();
CREATE TRIGGER eng_survey_question_guard BEFORE INSERT OR DELETE ON eng_survey_question FOR EACH ROW EXECUTE FUNCTION guard_eng_survey_question();
CREATE TRIGGER eng_survey_eligible_guard BEFORE INSERT ON eng_survey_eligible FOR EACH ROW EXECUTE FUNCTION guard_eng_writer_insert();
CREATE TRIGGER eng_survey_participation_guard BEFORE INSERT ON eng_survey_participation FOR EACH ROW EXECUTE FUNCTION guard_eng_writer_insert();
CREATE TRIGGER eng_survey_answer_guard BEFORE INSERT ON eng_survey_answer FOR EACH ROW EXECUTE FUNCTION guard_eng_writer_insert();
CREATE TRIGGER eng_kudos_moderation_final BEFORE UPDATE ON eng_kudos_moderation FOR EACH ROW EXECUTE FUNCTION reject_eng_rewrite();
CREATE TRIGGER eng_reaction_final BEFORE UPDATE ON eng_reaction FOR EACH ROW EXECUTE FUNCTION reject_eng_rewrite();
CREATE TRIGGER eng_survey_question_final BEFORE UPDATE ON eng_survey_question FOR EACH ROW EXECUTE FUNCTION reject_eng_rewrite();
CREATE TRIGGER eng_survey_eligible_final BEFORE UPDATE ON eng_survey_eligible FOR EACH ROW EXECUTE FUNCTION reject_eng_rewrite();
CREATE TRIGGER eng_survey_participation_final BEFORE UPDATE ON eng_survey_participation FOR EACH ROW EXECUTE FUNCTION reject_eng_rewrite();
CREATE TRIGGER eng_survey_answer_final BEFORE UPDATE ON eng_survey_answer FOR EACH ROW EXECUTE FUNCTION reject_eng_rewrite();
CREATE TRIGGER eng_value_no_delete BEFORE DELETE ON eng_value FOR EACH ROW EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_kudos_no_delete BEFORE DELETE ON eng_kudos FOR EACH ROW EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_kudos_moderation_no_delete BEFORE DELETE ON eng_kudos_moderation FOR EACH ROW EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_survey_no_delete BEFORE DELETE ON eng_survey FOR EACH ROW EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_survey_eligible_no_delete BEFORE DELETE ON eng_survey_eligible FOR EACH ROW EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_survey_participation_no_delete BEFORE DELETE ON eng_survey_participation FOR EACH ROW EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_survey_answer_no_delete BEFORE DELETE ON eng_survey_answer FOR EACH ROW EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_value_no_truncate BEFORE TRUNCATE ON eng_value FOR EACH STATEMENT EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_kudos_no_truncate BEFORE TRUNCATE ON eng_kudos FOR EACH STATEMENT EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_kudos_moderation_no_truncate BEFORE TRUNCATE ON eng_kudos_moderation FOR EACH STATEMENT EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_reaction_no_truncate BEFORE TRUNCATE ON eng_reaction FOR EACH STATEMENT EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_survey_no_truncate BEFORE TRUNCATE ON eng_survey FOR EACH STATEMENT EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_survey_question_no_truncate BEFORE TRUNCATE ON eng_survey_question FOR EACH STATEMENT EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_survey_eligible_no_truncate BEFORE TRUNCATE ON eng_survey_eligible FOR EACH STATEMENT EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_survey_participation_no_truncate BEFORE TRUNCATE ON eng_survey_participation FOR EACH STATEMENT EXECUTE FUNCTION reject_eng_delete();
CREATE TRIGGER eng_survey_answer_no_truncate BEFORE TRUNCATE ON eng_survey_answer FOR EACH STATEMENT EXECUTE FUNCTION reject_eng_delete();
-- Guards, writers and delete blocks fire in replica sessions too.
DO $$
DECLARE r record;
BEGIN
 FOR r IN SELECT c.relname AS t, g.tgname AS name FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE NOT g.tgisinternal AND n.nspname='public' AND c.relname LIKE 'eng\_%' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I', r.t, r.name);
 END LOOP;
END $$;

-- Ownership and grants -------------------------------------------------------------------------
-- keeper: reads posts, values, people, surveys, questions, eligibility and ANSWERS; never participation.
-- writer: writes participation, answers, eligibility, the response counter and the hidden flag;
-- never reads answers or participation.
ALTER FUNCTION eng_colleagues(text) OWNER TO anvione_engage_keeper;
ALTER FUNCTION guard_eng_kudos() OWNER TO anvione_engage_keeper;
ALTER FUNCTION guard_eng_kudos_moderation() OWNER TO anvione_engage_keeper;
ALTER FUNCTION guard_eng_reaction() OWNER TO anvione_engage_keeper;
ALTER FUNCTION eng_survey_results(uuid) OWNER TO anvione_engage_keeper;
ALTER FUNCTION apply_eng_kudos_moderation() OWNER TO anvione_engage_writer;
ALTER FUNCTION snapshot_eng_survey_eligible() OWNER TO anvione_engage_writer;
ALTER FUNCTION eng_submit_response(uuid,jsonb) OWNER TO anvione_engage_writer;
REVOKE ALL ON FUNCTION eng_in_entity(uuid,uuid),eng_scope(),eng_colleagues(text),guard_eng_value(),guard_eng_kudos(),
 guard_eng_kudos_update(),guard_eng_kudos_moderation(),apply_eng_kudos_moderation(),guard_eng_reaction(),
 guard_eng_survey(),guard_eng_survey_question(),snapshot_eng_survey_eligible(),guard_eng_writer_insert(),
 eng_submit_response(uuid,jsonb),eng_survey_results(uuid),reject_eng_delete(),reject_eng_rewrite() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eng_in_entity(uuid,uuid),eng_scope(),eng_colleagues(text),eng_submit_response(uuid,jsonb),
 eng_survey_results(uuid) TO anvione_app;
GRANT EXECUTE ON FUNCTION eng_in_entity(uuid,uuid),eng_scope() TO anvione_engage_keeper, anvione_engage_writer;

GRANT SELECT ON eng_value,eng_kudos,eng_survey,eng_survey_question,eng_survey_eligible,eng_survey_answer,employee,person
 TO anvione_engage_keeper;
GRANT SELECT ON eng_survey,eng_survey_question,eng_survey_eligible,eng_kudos,employee TO anvione_engage_writer;
GRANT UPDATE(response_count) ON eng_survey TO anvione_engage_writer;
GRANT UPDATE(hidden,hidden_at,version) ON eng_kudos TO anvione_engage_writer;
GRANT INSERT ON eng_survey_eligible,eng_survey_participation,eng_survey_answer TO anvione_engage_writer;

ALTER TABLE eng_value ENABLE ROW LEVEL SECURITY;
ALTER TABLE eng_value FORCE ROW LEVEL SECURITY;
ALTER TABLE eng_kudos ENABLE ROW LEVEL SECURITY;
ALTER TABLE eng_kudos FORCE ROW LEVEL SECURITY;
ALTER TABLE eng_kudos_moderation ENABLE ROW LEVEL SECURITY;
ALTER TABLE eng_kudos_moderation FORCE ROW LEVEL SECURITY;
ALTER TABLE eng_reaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE eng_reaction FORCE ROW LEVEL SECURITY;
ALTER TABLE eng_survey ENABLE ROW LEVEL SECURITY;
ALTER TABLE eng_survey FORCE ROW LEVEL SECURITY;
ALTER TABLE eng_survey_question ENABLE ROW LEVEL SECURITY;
ALTER TABLE eng_survey_question FORCE ROW LEVEL SECURITY;
ALTER TABLE eng_survey_eligible ENABLE ROW LEVEL SECURITY;
ALTER TABLE eng_survey_eligible FORCE ROW LEVEL SECURITY;
ALTER TABLE eng_survey_participation ENABLE ROW LEVEL SECURITY;
ALTER TABLE eng_survey_participation FORCE ROW LEVEL SECURITY;
ALTER TABLE eng_survey_answer ENABLE ROW LEVEL SECURITY;
ALTER TABLE eng_survey_answer FORCE ROW LEVEL SECURITY;

CREATE POLICY eng_keeper_emp ON employee FOR SELECT TO anvione_engage_keeper USING(true);
CREATE POLICY eng_keeper_person ON person FOR SELECT TO anvione_engage_keeper USING(true);
CREATE POLICY eng_keeper ON eng_value FOR SELECT TO anvione_engage_keeper USING(true);
CREATE POLICY eng_keeper ON eng_kudos FOR SELECT TO anvione_engage_keeper USING(true);
CREATE POLICY eng_keeper ON eng_survey FOR SELECT TO anvione_engage_keeper USING(true);
CREATE POLICY eng_keeper ON eng_survey_question FOR SELECT TO anvione_engage_keeper USING(true);
CREATE POLICY eng_keeper ON eng_survey_eligible FOR SELECT TO anvione_engage_keeper USING(true);
CREATE POLICY eng_keeper ON eng_survey_answer FOR SELECT TO anvione_engage_keeper USING(true);
CREATE POLICY eng_writer_emp ON employee FOR SELECT TO anvione_engage_writer USING(true);
CREATE POLICY eng_writer_read ON eng_survey FOR SELECT TO anvione_engage_writer USING(true);
CREATE POLICY eng_writer_update ON eng_survey FOR UPDATE TO anvione_engage_writer USING(true) WITH CHECK(true);
CREATE POLICY eng_writer_read ON eng_survey_question FOR SELECT TO anvione_engage_writer USING(true);
CREATE POLICY eng_writer_read ON eng_survey_eligible FOR SELECT TO anvione_engage_writer USING(true);
CREATE POLICY eng_writer_insert ON eng_survey_eligible FOR INSERT TO anvione_engage_writer WITH CHECK(true);
CREATE POLICY eng_writer_insert ON eng_survey_participation FOR INSERT TO anvione_engage_writer WITH CHECK(true);
CREATE POLICY eng_writer_insert ON eng_survey_answer FOR INSERT TO anvione_engage_writer WITH CHECK(true);
CREATE POLICY eng_writer_read ON eng_kudos FOR SELECT TO anvione_engage_writer USING(true);
CREATE POLICY eng_writer_update ON eng_kudos FOR UPDATE TO anvione_engage_writer USING(true) WITH CHECK(true);

CREATE POLICY eng_value_visible ON eng_value FOR SELECT TO anvione_app
 USING(eng_in_entity(tenant_id,entity_id) AND eng_scope() IN ('self','manage'));
CREATE POLICY eng_value_insert ON eng_value FOR INSERT TO anvione_app
 WITH CHECK(eng_in_entity(tenant_id,entity_id) AND eng_scope()='manage');
CREATE POLICY eng_value_update ON eng_value FOR UPDATE TO anvione_app
 USING(eng_in_entity(tenant_id,entity_id) AND eng_scope()='manage') WITH CHECK(eng_in_entity(tenant_id,entity_id));
-- The feed is the entity's; hidden posts only for HR.
CREATE POLICY eng_kudos_visible ON eng_kudos FOR SELECT TO anvione_app
 USING(eng_in_entity(tenant_id,entity_id) AND eng_scope() IN ('self','manage') AND (NOT hidden OR eng_scope()='manage'));
CREATE POLICY eng_kudos_insert ON eng_kudos FOR INSERT TO anvione_app
 WITH CHECK(eng_in_entity(tenant_id,entity_id) AND eng_scope() IN ('self','manage')
  AND giver_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid);
CREATE POLICY eng_kudos_moderation_visible ON eng_kudos_moderation FOR SELECT TO anvione_app
 USING(eng_in_entity(tenant_id,entity_id) AND eng_scope()='manage');
CREATE POLICY eng_kudos_moderation_insert ON eng_kudos_moderation FOR INSERT TO anvione_app
 WITH CHECK(eng_in_entity(tenant_id,entity_id) AND eng_scope()='manage'
  AND by_employee=nullif(current_setting('app.employee_id',true),'')::uuid);
CREATE POLICY eng_reaction_visible ON eng_reaction FOR SELECT TO anvione_app
 USING(eng_in_entity(tenant_id,entity_id) AND EXISTS(SELECT 1 FROM eng_kudos k WHERE k.id=eng_reaction.kudos_id));
CREATE POLICY eng_reaction_insert ON eng_reaction FOR INSERT TO anvione_app
 WITH CHECK(eng_in_entity(tenant_id,entity_id) AND eng_scope() IN ('self','manage')
  AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid);
CREATE POLICY eng_reaction_delete ON eng_reaction FOR DELETE TO anvione_app
 USING(eng_in_entity(tenant_id,entity_id) AND eng_scope() IN ('self','manage')
  AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid);
-- HR sees every survey; others only published or closed surveys they were eligible for.
CREATE POLICY eng_survey_visible ON eng_survey FOR SELECT TO anvione_app
 USING(eng_in_entity(tenant_id,entity_id) AND (eng_scope()='manage' OR (eng_scope()='self' AND status<>'draft'
  AND EXISTS(SELECT 1 FROM eng_survey_eligible g WHERE g.survey_id=eng_survey.id))));
CREATE POLICY eng_survey_insert ON eng_survey FOR INSERT TO anvione_app
 WITH CHECK(eng_in_entity(tenant_id,entity_id) AND eng_scope()='manage');
CREATE POLICY eng_survey_update ON eng_survey FOR UPDATE TO anvione_app
 USING(eng_in_entity(tenant_id,entity_id) AND eng_scope()='manage') WITH CHECK(eng_in_entity(tenant_id,entity_id));
CREATE POLICY eng_survey_question_visible ON eng_survey_question FOR SELECT TO anvione_app
 USING(eng_in_entity(tenant_id,entity_id) AND EXISTS(SELECT 1 FROM eng_survey s WHERE s.id=eng_survey_question.survey_id));
CREATE POLICY eng_survey_question_insert ON eng_survey_question FOR INSERT TO anvione_app
 WITH CHECK(eng_in_entity(tenant_id,entity_id) AND eng_scope()='manage');
CREATE POLICY eng_survey_question_delete ON eng_survey_question FOR DELETE TO anvione_app
 USING(eng_in_entity(tenant_id,entity_id) AND eng_scope()='manage');
CREATE POLICY eng_survey_eligible_visible ON eng_survey_eligible FOR SELECT TO anvione_app
 USING(eng_in_entity(tenant_id,entity_id) AND (eng_scope()='manage'
  OR (eng_scope()='self' AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)));
-- Participation: only one's own row, for "you have answered". HR sees counts only.
CREATE POLICY eng_survey_participation_visible ON eng_survey_participation FOR SELECT TO anvione_app
 USING(eng_in_entity(tenant_id,entity_id) AND eng_scope() IN ('self','manage')
  AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid);
-- eng_survey_answer: no policy and no privilege for the app role, ever.

GRANT SELECT ON eng_value,eng_kudos,eng_kudos_moderation,eng_reaction,eng_survey,eng_survey_question,
 eng_survey_eligible,eng_survey_participation TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,name,active,sort) ON eng_value TO anvione_app;
GRANT UPDATE(name,active,sort,version) ON eng_value TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,recipient_employee_id,value_id,message) ON eng_kudos TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,kudos_id,action,reason) ON eng_kudos_moderation TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,kudos_id,code) ON eng_reaction TO anvione_app;
GRANT DELETE ON eng_reaction TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,title,opens_at,closes_at) ON eng_survey TO anvione_app;
GRANT UPDATE(title,opens_at,closes_at,status,version) ON eng_survey TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,survey_id,position,kind,prompt,options) ON eng_survey_question TO anvione_app;
GRANT DELETE ON eng_survey_question TO anvione_app;

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
 'helpdesk.article_status_changed.v1','helpdesk.internal_note_added.v1',
 'engage.value_created.v1','engage.value_updated.v1','engage.kudos_given.v1','engage.kudos_hidden.v1',
 'engage.kudos_restored.v1','engage.reaction_added.v1','engage.reaction_removed.v1',
 'engage.survey_created.v1','engage.survey_updated.v1','engage.survey_published.v1','engage.survey_closed.v1',
 'engage.survey_responded.v1'
));
