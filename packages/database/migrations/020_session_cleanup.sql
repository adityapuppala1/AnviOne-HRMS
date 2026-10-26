-- OPS-02 session cleanup. The worker may only purge sessions that the sign-in
-- path would already refuse (expired, or idle past the role's limit) and expired
-- sign-in attempts. It gets no direct access to either table.
CREATE ROLE anvione_session_janitor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_session_janitor;
GRANT SELECT, DELETE ON app_session, oidc_attempt TO anvione_session_janitor;

CREATE FUNCTION purge_stale_sessions(OUT sessions integer, OUT attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 DELETE FROM public.app_session s
 WHERE s.expires_at <= now()
  OR s.last_seen_at <= now() - CASE WHEN s.role IN ('employee','manager')
   THEN interval '30 minutes' ELSE interval '15 minutes' END;
 GET DIAGNOSTICS sessions = ROW_COUNT;
 DELETE FROM public.oidc_attempt a WHERE a.expires_at <= now();
 GET DIAGNOSTICS attempts = ROW_COUNT;
END $$;
ALTER FUNCTION purge_stale_sessions() OWNER TO anvione_session_janitor;
REVOKE ALL ON FUNCTION purge_stale_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_stale_sessions() TO anvione_worker;
