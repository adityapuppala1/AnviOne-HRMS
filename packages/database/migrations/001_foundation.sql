CREATE ROLE anvione_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE anvione_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE TABLE tenant (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE legal_entity (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenant(id), name text NOT NULL,
  UNIQUE (tenant_id, id)
);
CREATE TABLE employee (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, entity_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, title text NOT NULL,
  department text NOT NULL, location text NOT NULL, email text NOT NULL,
  joined_on date NOT NULL, status text NOT NULL CHECK (status IN ('active', 'notice', 'inactive')),
  manager_id uuid, initials text NOT NULL,
  UNIQUE (tenant_id, code), UNIQUE (tenant_id, entity_id, id),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES legal_entity(tenant_id, id),
  FOREIGN KEY (tenant_id, entity_id, manager_id) REFERENCES employee(tenant_id, entity_id, id),
  CHECK (id IS DISTINCT FROM manager_id)
);
CREATE INDEX employee_directory_idx ON employee(tenant_id, entity_id, name, id);
CREATE TABLE identity_binding (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, entity_id uuid NOT NULL, employee_id uuid NOT NULL,
  issuer text NOT NULL, subject text NOT NULL, active boolean NOT NULL DEFAULT false,
  roles text[] NOT NULL CHECK (roles <@ ARRAY['employee','manager','hr_admin','platform_admin','auditor']),
  UNIQUE (issuer, subject),
  FOREIGN KEY (tenant_id, entity_id, employee_id) REFERENCES employee(tenant_id, entity_id, id)
);
CREATE TABLE app_session (
  token_hash text PRIMARY KEY, actor_id uuid NOT NULL REFERENCES identity_binding(id),
  role text NOT NULL, csrf_token text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_session_expiry_idx ON app_session(expires_at);
CREATE TABLE oidc_attempt (
  token_hash text PRIMARY KEY, verifier text NOT NULL, state text NOT NULL, nonce text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE branding (
  tenant_id uuid NOT NULL, entity_id uuid NOT NULL, platform_name text NOT NULL,
  employee_name text NOT NULL, organization_name text NOT NULL,
  theme text NOT NULL CHECK (theme IN ('ocean','iris','forest')), version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, entity_id),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES legal_entity(tenant_id, id)
);
CREATE TABLE audit_event (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, entity_id uuid NOT NULL,
  actor_id uuid NOT NULL, actor_label text NOT NULL, role text NOT NULL,
  action text NOT NULL, target text NOT NULL, request_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES legal_entity(tenant_id, id)
);
CREATE INDEX audit_recent_idx ON audit_event(tenant_id, entity_id, occurred_at DESC);
CREATE TABLE outbox_event (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, entity_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type = 'branding.published.v1'),
  aggregate_version integer NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  FOREIGN KEY (tenant_id, entity_id) REFERENCES legal_entity(tenant_id, id),
  UNIQUE (tenant_id, entity_id, event_type, aggregate_version)
);
CREATE TABLE event_receipt (event_id uuid PRIMARY KEY REFERENCES outbox_event(id), processed_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE employee ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee FORCE ROW LEVEL SECURITY;
CREATE POLICY employee_scope ON employee USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND entity_id = nullif(current_setting('app.entity_id', true), '')::uuid
  AND (
    current_setting('app.directory_scope', true) = 'entity'
    OR id = nullif(current_setting('app.employee_id', true), '')::uuid
    OR (current_setting('app.directory_scope', true) = 'team'
      AND manager_id = nullif(current_setting('app.employee_id', true), '')::uuid)
  )
);
ALTER TABLE branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE branding FORCE ROW LEVEL SECURITY;
CREATE POLICY branding_scope ON branding USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND
  entity_id = nullif(current_setting('app.entity_id', true), '')::uuid
);
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_scope ON audit_event USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND
  entity_id = nullif(current_setting('app.entity_id', true), '')::uuid
);
ALTER TABLE outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_event FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_app ON outbox_event TO anvione_app USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND
  entity_id = nullif(current_setting('app.entity_id', true), '')::uuid
);
CREATE POLICY outbox_worker ON outbox_event TO anvione_worker USING (true);

-- Authentication functions expose only identity/session records through fixed queries.
-- Runtime cannot read arbitrary identity bindings or bypass employee RLS.
CREATE FUNCTION resolve_session(p_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('actorId', i.id, 'employeeId', i.employee_id,
    'tenantId', i.tenant_id, 'entityId', i.entity_id, 'role', s.role, 'roles', i.roles,
    'name', e.name, 'csrfToken', s.csrf_token, 'entityName', le.name)
  FROM public.app_session s JOIN public.identity_binding i ON i.id = s.actor_id
  JOIN public.employee e ON e.id = i.employee_id
  JOIN public.legal_entity le ON le.id = i.entity_id
  WHERE s.token_hash = p_hash AND i.active AND e.status IN ('active','notice')
    AND e.joined_on <= CURRENT_DATE AND s.role = ANY(i.roles)
    AND s.expires_at > now()
    AND s.last_seen_at > now() - CASE WHEN s.role IN ('employee','manager') THEN interval '30 minutes' ELSE interval '15 minutes' END;
$$;
CREATE FUNCTION resolve_identity(p_issuer text, p_subject text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('actorId', i.id, 'employeeId', i.employee_id,
    'tenantId', i.tenant_id, 'entityId', i.entity_id, 'roles', i.roles, 'name', e.name)
  FROM public.identity_binding i JOIN public.employee e ON e.id = i.employee_id
  WHERE i.issuer = p_issuer AND i.subject = p_subject AND i.active
    AND e.status IN ('active','notice') AND e.joined_on <= CURRENT_DATE;
$$;
REVOKE ALL ON FUNCTION resolve_session(text), resolve_identity(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_session(text), resolve_identity(text,text) TO anvione_app;
GRANT USAGE ON SCHEMA public TO anvione_app, anvione_worker;
GRANT SELECT ON employee, branding, audit_event TO anvione_app;
GRANT UPDATE ON branding TO anvione_app;
GRANT INSERT ON audit_event, outbox_event TO anvione_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_session, oidc_attempt TO anvione_app;
GRANT SELECT, UPDATE ON outbox_event TO anvione_worker;
GRANT SELECT, INSERT ON event_receipt TO anvione_worker;
