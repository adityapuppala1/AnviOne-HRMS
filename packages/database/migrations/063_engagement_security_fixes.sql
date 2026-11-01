-- ENG-01 self security review fixes (forward-only; 062 is unchanged).
-- * Pre-joiners: employees whose joining date is still ahead (they cannot sign in yet) were
--   offered as recipients, could be recognised and were snapshotted as survey-eligible, which
--   inflated the eligible count. Colleagues, recipients and eligibility now require
--   joined_on <= today, matching sign-in (001 resolve_identity).
-- * Daily cap counter: the cap counts hidden posts too, but RLS hides them from the giver, so the
--   "given today" figure could read 9 while the guard refused the next post. eng_given_today()
--   returns the caller's own count, including hidden posts (a number only).
-- Errors: EG003 bad input (400), EG004 conflict (409), EG005 forbidden (403).
CREATE OR REPLACE FUNCTION eng_colleagues(p_q text) RETURNS TABLE(employee_id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT e.id, p.name FROM public.employee e JOIN public.person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
 WHERE public.eng_scope() IN ('self','manage')
  AND e.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND e.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND e.status IN ('active','notice') AND e.joined_on<=CURRENT_DATE
  AND e.id<>nullif(current_setting('app.employee_id',true),'')::uuid
  AND (coalesce(p_q,'')='' OR p.name ILIKE '%'||replace(replace(replace(left(p_q,80),'\','\\'),'%','\%'),'_','\_')||'%')
 ORDER BY lower(p.name), e.id LIMIT 20;
$$;

CREATE FUNCTION eng_given_today() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT count(*)::integer FROM public.eng_kudos k
 WHERE public.eng_scope() IN ('self','manage')
  AND k.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND k.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND k.giver_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
  AND k.given_on=(now() AT TIME ZONE 'UTC')::date;
$$;

-- Runs before eng_kudos_guard (triggers fire in name order): the recipient must have joined.
CREATE FUNCTION guard_eng_kudos_joined() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.recipient_employee_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.employee e
   WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=NEW.recipient_employee_id
    AND e.joined_on>CURRENT_DATE) THEN
  RAISE EXCEPTION 'Choose a current colleague in your organization' USING ERRCODE='EG003';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER eng_kudos_a_joined BEFORE INSERT ON eng_kudos FOR EACH ROW EXECUTE FUNCTION guard_eng_kudos_joined();
ALTER TABLE eng_kudos ENABLE ALWAYS TRIGGER eng_kudos_a_joined;

CREATE OR REPLACE FUNCTION snapshot_eng_survey_eligible() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF OLD.status='draft' AND NEW.status='published' THEN
  INSERT INTO public.eng_survey_eligible(tenant_id,entity_id,survey_id,employee_id)
  SELECT e.tenant_id, e.entity_id, NEW.id, e.id FROM public.employee e
  WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.status IN ('active','notice')
   AND e.joined_on<=CURRENT_DATE;
 END IF;
 RETURN NULL;
END $$;

ALTER FUNCTION eng_given_today() OWNER TO anvione_engage_keeper;
ALTER FUNCTION guard_eng_kudos_joined() OWNER TO anvione_engage_keeper;
REVOKE ALL ON FUNCTION eng_given_today(), guard_eng_kudos_joined() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eng_given_today() TO anvione_app;
