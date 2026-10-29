-- ENG-01 independent security review fixes (forward-only; 062 and 063 are unchanged).
-- * Late answers after the close time: eng_submit_response checked the window with now(), the
--   transaction START time, so a request that began just before closes_at could commit after it,
--   while eng_survey_results already released a naturally closed survey. HR could read results,
--   then read them again with one more answer (a before/after difference). The window is now
--   checked with clock_timestamp() while holding the survey row lock, and results of a survey
--   that closed by time (not by HR's close step, which waits for that lock) are released only
--   2 minutes after closes_at, so no in-flight answer can land after a release.
-- * Moderation conflict of interest: an HR user could hide or restore a post they gave or
--   received. Moderation now needs another HR colleague (EG005).
-- With this migration (API, engage.store.ts): a survey response no longer writes an audit row, because the
-- audit trail named who answered which survey and when, readable by anyone with audit.read.
-- Errors: EG003 bad input (400), EG004 conflict (409), EG005 forbidden (403).

CREATE OR REPLACE FUNCTION eng_submit_response(p_survey uuid, p_answers jsonb) RETURNS void
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
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.eng_survey_eligible g WHERE g.survey_id=p_survey AND g.employee_id=me) THEN
  RAISE EXCEPTION 'This survey is unavailable' USING ERRCODE='EG003';
 END IF;
 -- Wall-clock time under the row lock, not the transaction start time.
 IF s.status<>'published' OR clock_timestamp()<s.opens_at OR clock_timestamp()>=s.closes_at THEN
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
 INSERT INTO public.eng_survey_answer(id,tenant_id,entity_id,survey_id,question_id,rating,choice,text_value)
 SELECT gen_random_uuid(),t,e,p_survey,x.q,x.r,x.c,x.v
 FROM unnest(q_ids,ratings,choices,texts) AS x(q,r,c,v) ORDER BY random();
 UPDATE public.eng_survey SET response_count=response_count+1 WHERE id=p_survey;
END $$;

CREATE OR REPLACE FUNCTION eng_survey_results(p_survey uuid) RETURNS jsonb
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
 -- Closed by HR (the close step waits for in-flight answers), or 2 minutes past its close time.
 closed := s.status='closed' OR (s.status='published' AND clock_timestamp()>=s.closes_at+interval '2 minutes');
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

-- Runs before eng_kudos_moderation_guard (name order): HR never moderates a post they gave or received.
CREATE FUNCTION guard_eng_kudos_moderation_conflict() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
BEGIN
 IF me IS NULL OR EXISTS(SELECT 1 FROM public.eng_kudos k WHERE k.tenant_id=NEW.tenant_id AND k.entity_id=NEW.entity_id
   AND k.id=NEW.kudos_id AND me IN (k.giver_employee_id,k.recipient_employee_id)) THEN
  RAISE EXCEPTION 'Recognition you gave or received is moderated by another HR colleague' USING ERRCODE='EG005';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER eng_kudos_moderation_a_conflict BEFORE INSERT ON eng_kudos_moderation
 FOR EACH ROW EXECUTE FUNCTION guard_eng_kudos_moderation_conflict();
ALTER TABLE eng_kudos_moderation ENABLE ALWAYS TRIGGER eng_kudos_moderation_a_conflict;
ALTER FUNCTION guard_eng_kudos_moderation_conflict() OWNER TO anvione_engage_keeper;
REVOKE ALL ON FUNCTION guard_eng_kudos_moderation_conflict() FROM PUBLIC;
