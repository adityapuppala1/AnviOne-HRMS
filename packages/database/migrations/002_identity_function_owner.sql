-- Keep authentication lookups independent of a superuser migration account.
-- This NOLOGIN role is not granted to runtime; only fixed functions execute as it.
CREATE ROLE anvione_identity_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_identity_reader;
GRANT SELECT ON identity_binding, employee, app_session, legal_entity TO anvione_identity_reader;
CREATE POLICY employee_identity_lookup ON employee TO anvione_identity_reader USING (true);
ALTER FUNCTION resolve_session(text) OWNER TO anvione_identity_reader;
ALTER FUNCTION resolve_identity(text,text) OWNER TO anvione_identity_reader;
