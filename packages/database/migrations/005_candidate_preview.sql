CREATE ROLE anvione_candidate LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE anvione_candidate_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE TABLE candidate_case (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, entity_id uuid NOT NULL,
 name text NOT NULL, email text NOT NULL CHECK(email LIKE '%@anvi.example'), title text NOT NULL,
 department_id uuid NOT NULL, department_kind text GENERATED ALWAYS AS ('department'::text) STORED,
 location_id uuid NOT NULL, location_kind text GENERATED ALWAYS AS ('location'::text) STORED,
 manager_id uuid NOT NULL, joined_on date NOT NULL,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','invited','in_progress','submitted','changes_requested','approved','cancelled')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 draft jsonb NOT NULL DEFAULT '{"preferredName":"","introduction":"","acknowledged":false}', review_note text,
 invitation_hash text UNIQUE, invitation_generation integer NOT NULL DEFAULT 0,
 invitation_expires_at timestamptz, invitation_consumed_at timestamptz, invitation_sent_at timestamptz,
 otp_sent_at timestamptz, otp_window timestamptz NOT NULL DEFAULT now(), otp_count integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 FOREIGN KEY(tenant_id,entity_id,department_kind,department_id) REFERENCES org_unit(tenant_id,entity_id,kind,id),
 FOREIGN KEY(tenant_id,entity_id,location_kind,location_id) REFERENCES org_unit(tenant_id,entity_id,kind,id),
 FOREIGN KEY(tenant_id,entity_id,manager_id) REFERENCES employee(tenant_id,entity_id,id),
 CHECK(jsonb_typeof(draft)='object' AND octet_length(draft::text)<=8192)
);
CREATE INDEX candidate_recent ON candidate_case(tenant_id,entity_id,created_at DESC);
CREATE TABLE candidate_challenge (
 id uuid PRIMARY KEY, candidate_id uuid NOT NULL REFERENCES candidate_case(id), generation integer NOT NULL,
 code_hash text NOT NULL, attempts integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL
);
CREATE TABLE candidate_session (
 token_hash text PRIMARY KEY, candidate_id uuid NOT NULL REFERENCES candidate_case(id), generation integer NOT NULL,
 csrf_token text NOT NULL, expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE candidate_submission (
 candidate_id uuid NOT NULL REFERENCES candidate_case(id), version integer NOT NULL, payload jsonb NOT NULL,
 submitted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(candidate_id,version)
);
CREATE TABLE candidate_delivery_preview (
 candidate_id uuid NOT NULL REFERENCES candidate_case(id), kind text NOT NULL CHECK(kind IN ('invitation','code')),
 ciphertext text NOT NULL, expires_at timestamptz NOT NULL, PRIMARY KEY(candidate_id,kind)
);
ALTER TABLE candidate_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_case FORCE ROW LEVEL SECURITY;
CREATE POLICY candidate_hr ON candidate_case TO anvione_app USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.onboarding_scope',true)='write'
) WITH CHECK (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.onboarding_scope',true)='write'
);
CREATE POLICY candidate_self_read ON candidate_case FOR SELECT TO anvione_candidate USING(id=nullif(current_setting('candidate.id',true),'')::uuid AND state<>'cancelled');
CREATE POLICY candidate_self_write ON candidate_case FOR UPDATE TO anvione_candidate USING(
 id=nullif(current_setting('candidate.id',true),'')::uuid AND state IN ('invited','in_progress','changes_requested')
) WITH CHECK(id=nullif(current_setting('candidate.id',true),'')::uuid AND state IN ('in_progress','submitted'));
CREATE POLICY candidate_auth_case ON candidate_case TO anvione_candidate_auth USING(true) WITH CHECK(true);
GRANT USAGE ON SCHEMA public TO anvione_candidate, anvione_candidate_auth;
GRANT SELECT,INSERT,UPDATE ON candidate_case TO anvione_app;
GRANT SELECT ON candidate_case TO anvione_candidate;
GRANT UPDATE(draft,version,state) ON candidate_case TO anvione_candidate;
GRANT SELECT ON candidate_case TO anvione_candidate_auth;
GRANT UPDATE(invitation_consumed_at,otp_sent_at,otp_window,otp_count) ON candidate_case TO anvione_candidate_auth;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['candidate_challenge','candidate_session','candidate_submission','candidate_delivery_preview'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY hr_scope ON public.%I TO anvione_app USING (EXISTS(SELECT 1 FROM public.candidate_case c WHERE c.id=candidate_id)) WITH CHECK (EXISTS(SELECT 1 FROM public.candidate_case c WHERE c.id=candidate_id))',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON candidate_challenge,candidate_session,candidate_delivery_preview TO anvione_app;
GRANT SELECT ON candidate_submission TO anvione_app;
CREATE POLICY submission_self ON candidate_submission FOR INSERT TO anvione_candidate WITH CHECK(candidate_id=nullif(current_setting('candidate.id',true),'')::uuid);
GRANT INSERT ON candidate_submission TO anvione_candidate;
CREATE POLICY auth_challenge ON candidate_challenge TO anvione_candidate_auth USING(true) WITH CHECK(true);
CREATE POLICY auth_session ON candidate_session TO anvione_candidate_auth USING(true) WITH CHECK(true);
CREATE POLICY auth_delivery ON candidate_delivery_preview TO anvione_candidate_auth USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON candidate_challenge,candidate_session,candidate_delivery_preview TO anvione_candidate_auth;

CREATE FUNCTION candidate_begin(p_hash text,p_challenge uuid,p_code_hash text,p_cipher text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.candidate_case%ROWTYPE; BEGIN
 SELECT * INTO c FROM public.candidate_case WHERE invitation_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR c.state='cancelled' OR c.invitation_consumed_at IS NOT NULL OR c.invitation_expires_at<=now()
 OR c.otp_sent_at>now()-interval '60 seconds' OR (c.otp_window>now()-interval '1 hour' AND c.otp_count>=5) THEN RETURN false; END IF;
 UPDATE public.candidate_case SET otp_sent_at=now(),otp_count=CASE WHEN otp_window>now()-interval '1 hour' THEN otp_count+1 ELSE 1 END,
 otp_window=CASE WHEN otp_window>now()-interval '1 hour' THEN otp_window ELSE now() END WHERE id=c.id;
 DELETE FROM public.candidate_challenge WHERE candidate_id=c.id;
 INSERT INTO public.candidate_challenge VALUES(p_challenge,c.id,c.invitation_generation,p_code_hash,0,now()+interval '10 minutes');
 INSERT INTO public.candidate_delivery_preview VALUES(c.id,'code',p_cipher,now()+interval '10 minutes')
 ON CONFLICT(candidate_id,kind) DO UPDATE SET ciphertext=excluded.ciphertext,expires_at=excluded.expires_at;
 RETURN true;
END $$;
CREATE FUNCTION candidate_exchange(p_hash text,p_challenge uuid,p_code_hash text,p_session_hash text,p_csrf text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.candidate_case%ROWTYPE; o public.candidate_challenge%ROWTYPE; BEGIN
 SELECT * INTO c FROM public.candidate_case WHERE invitation_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR c.state='cancelled' OR c.invitation_consumed_at IS NOT NULL OR c.invitation_expires_at<=now() THEN RETURN false; END IF;
 SELECT * INTO o FROM public.candidate_challenge WHERE id=p_challenge AND candidate_id=c.id FOR UPDATE;
 IF NOT FOUND OR o.generation<>c.invitation_generation OR o.expires_at<=now() OR o.attempts>=5 THEN RETURN false; END IF;
 UPDATE public.candidate_challenge SET attempts=attempts+1 WHERE id=o.id;
 IF o.code_hash<>p_code_hash THEN RETURN false; END IF;
 UPDATE public.candidate_case SET invitation_consumed_at=now() WHERE id=c.id;
 DELETE FROM public.candidate_session WHERE candidate_id=c.id;
 INSERT INTO public.candidate_session(token_hash,candidate_id,generation,csrf_token,expires_at) VALUES(p_session_hash,c.id,c.invitation_generation,p_csrf,least(c.invitation_expires_at,now()+interval '1 hour'));
 DELETE FROM public.candidate_challenge WHERE candidate_id=c.id;
 DELETE FROM public.candidate_delivery_preview WHERE candidate_id=c.id;
 RETURN true;
END $$;
CREATE FUNCTION resolve_candidate_session(p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; BEGIN
 PERFORM c.id FROM public.candidate_case c JOIN public.candidate_session s ON s.candidate_id=c.id
 WHERE s.token_hash=p_hash FOR UPDATE OF c;
 UPDATE public.candidate_session s SET last_seen_at=now() FROM public.candidate_case c
 WHERE s.token_hash=p_hash AND s.candidate_id=c.id AND s.generation=c.invitation_generation
 AND c.state<>'cancelled' AND c.invitation_expires_at>now() AND s.expires_at>now() AND s.last_seen_at>now()-interval '15 minutes'
 RETURNING jsonb_build_object('id',c.id,'csrfToken',s.csrf_token) INTO result;
 RETURN result;
END $$;
ALTER FUNCTION candidate_begin(text,uuid,text,text) OWNER TO anvione_candidate_auth;
ALTER FUNCTION candidate_exchange(text,uuid,text,text,text) OWNER TO anvione_candidate_auth;
ALTER FUNCTION resolve_candidate_session(text) OWNER TO anvione_candidate_auth;
REVOKE ALL ON FUNCTION candidate_begin(text,uuid,text,text),candidate_exchange(text,uuid,text,text,text),resolve_candidate_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_begin(text,uuid,text,text),candidate_exchange(text,uuid,text,text,text),resolve_candidate_session(text) TO anvione_candidate;
CREATE FUNCTION end_candidate_session(p_hash text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ DELETE FROM public.candidate_session WHERE token_hash=p_hash; $$;
ALTER FUNCTION end_candidate_session(text) OWNER TO anvione_candidate_auth;
REVOKE ALL ON FUNCTION end_candidate_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION end_candidate_session(text) TO anvione_candidate;
CREATE POLICY candidate_audit ON audit_event FOR INSERT TO anvione_candidate WITH CHECK(
 role='candidate' AND actor_id=nullif(current_setting('candidate.id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM candidate_case c WHERE c.id=actor_id AND c.tenant_id=audit_event.tenant_id AND c.entity_id=audit_event.entity_id)
);
GRANT INSERT ON audit_event TO anvione_candidate;
CREATE POLICY candidate_event ON outbox_event FOR INSERT TO anvione_candidate WITH CHECK(
 event_type='candidate.submitted.v1' AND aggregate_id=nullif(current_setting('candidate.id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM candidate_case c WHERE c.id=aggregate_id AND c.tenant_id=outbox_event.tenant_id AND c.entity_id=outbox_event.entity_id)
);
GRANT INSERT ON outbox_event TO anvione_candidate;
ALTER TABLE outbox_event DROP CONSTRAINT outbox_event_event_type_check;
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_event_type_check CHECK(event_type IN ('branding.published.v1','organization.created.v1','organization.updated.v1','candidate.created.v1','candidate.invited.v1','candidate.revoked.v1','candidate.reviewed.v1','candidate.submitted.v1'));
