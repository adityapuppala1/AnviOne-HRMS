-- Expand the foundation into people, employment and organization records.
-- employee remains the employment table so existing identifiers and references survive.
ALTER TABLE legal_entity ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Kolkata';
CREATE FUNCTION validate_entity_timezone() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Unknown legal entity timezone' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER legal_entity_timezone_guard BEFORE INSERT OR UPDATE OF timezone ON legal_entity
FOR EACH ROW EXECUTE FUNCTION validate_entity_timezone();

CREATE TABLE person (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  initials text NOT NULL CHECK (char_length(initials) BETWEEN 1 AND 8),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
INSERT INTO person(id,tenant_id,name,initials)
SELECT id,tenant_id,name,initials FROM employee;

CREATE TABLE org_unit (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('department','location')),
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_-]{1,19}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60 AND name = btrim(name)),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES legal_entity(tenant_id, id),
  UNIQUE (tenant_id, entity_id, kind, id),
  UNIQUE (tenant_id, entity_id, kind, code)
);
CREATE UNIQUE INDEX org_unit_name_key ON org_unit(tenant_id,entity_id,kind,lower(name));
INSERT INTO org_unit(id,tenant_id,entity_id,kind,code,name)
SELECT gen_random_uuid(),tenant_id,entity_id,kind,
  CASE kind WHEN 'department' THEN 'DEP-' ELSE 'LOC-' END ||
    lpad((row_number() OVER (PARTITION BY tenant_id,entity_id,kind ORDER BY name))::text,6,'0'),name
FROM (
  SELECT DISTINCT tenant_id,entity_id,'department'::text AS kind,department AS name FROM employee
  UNION
  SELECT DISTINCT tenant_id,entity_id,'location'::text AS kind,location AS name FROM employee
) masters;

ALTER TABLE employee ADD COLUMN person_id uuid;
ALTER TABLE employee ADD COLUMN department_id uuid;
ALTER TABLE employee ADD COLUMN location_id uuid;
ALTER TABLE employee ADD COLUMN department_kind text GENERATED ALWAYS AS ('department'::text) STORED;
ALTER TABLE employee ADD COLUMN location_kind text GENERATED ALWAYS AS ('location'::text) STORED;
UPDATE employee SET person_id = id;
UPDATE employee e SET department_id = o.id FROM org_unit o
WHERE o.tenant_id=e.tenant_id AND o.entity_id=e.entity_id AND o.kind='department' AND o.name=e.department;
UPDATE employee e SET location_id = o.id FROM org_unit o
WHERE o.tenant_id=e.tenant_id AND o.entity_id=e.entity_id AND o.kind='location' AND o.name=e.location;
ALTER TABLE employee ALTER COLUMN person_id SET NOT NULL;
ALTER TABLE employee ALTER COLUMN department_id SET NOT NULL;
ALTER TABLE employee ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE employee ADD CONSTRAINT employee_person_fk FOREIGN KEY (tenant_id,person_id) REFERENCES person(tenant_id,id);
ALTER TABLE employee ADD CONSTRAINT employee_department_fk FOREIGN KEY (tenant_id,entity_id,department_kind,department_id) REFERENCES org_unit(tenant_id,entity_id,kind,id);
ALTER TABLE employee ADD CONSTRAINT employee_location_fk FOREIGN KEY (tenant_id,entity_id,location_kind,location_id) REFERENCES org_unit(tenant_id,entity_id,kind,id);
CREATE INDEX employee_person_idx ON employee(tenant_id,person_id);

-- Fixed authentication functions retain the restricted NOLOGIN reader owner.
-- A person's corporate name is canonical; employment dates use entity business time.
CREATE OR REPLACE FUNCTION resolve_session(p_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT jsonb_build_object('actorId', i.id, 'employeeId', i.employee_id,
    'tenantId', i.tenant_id, 'entityId', i.entity_id, 'role', s.role, 'roles', i.roles,
    'name', p.name, 'csrfToken', s.csrf_token, 'entityName', le.name)
  FROM public.app_session s JOIN public.identity_binding i ON i.id = s.actor_id
  JOIN public.employee e ON e.id = i.employee_id AND e.tenant_id=i.tenant_id AND e.entity_id=i.entity_id
  JOIN public.person p ON p.id=e.person_id AND p.tenant_id=e.tenant_id
  JOIN public.legal_entity le ON le.id = i.entity_id AND le.tenant_id=i.tenant_id
  WHERE s.token_hash = p_hash AND i.active AND e.status IN ('active','notice')
    AND e.joined_on <= (now() AT TIME ZONE le.timezone)::date AND s.role = ANY(i.roles)
    AND s.expires_at > now()
    AND s.last_seen_at > now() - CASE WHEN s.role IN ('employee','manager') THEN interval '30 minutes' ELSE interval '15 minutes' END;
$$;
CREATE OR REPLACE FUNCTION resolve_identity(p_issuer text, p_subject text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT jsonb_build_object('actorId', i.id, 'employeeId', i.employee_id,
    'tenantId', i.tenant_id, 'entityId', i.entity_id, 'roles', i.roles, 'name', p.name)
  FROM public.identity_binding i
  JOIN public.employee e ON e.id = i.employee_id AND e.tenant_id=i.tenant_id AND e.entity_id=i.entity_id
  JOIN public.person p ON p.id=e.person_id AND p.tenant_id=e.tenant_id
  JOIN public.legal_entity le ON le.id=i.entity_id AND le.tenant_id=i.tenant_id
  WHERE i.issuer = p_issuer AND i.subject = p_subject AND i.active
    AND e.status IN ('active','notice') AND e.joined_on <= (now() AT TIME ZONE le.timezone)::date;
$$;
ALTER FUNCTION resolve_session(text) OWNER TO anvione_identity_reader;
ALTER FUNCTION resolve_identity(text,text) OWNER TO anvione_identity_reader;

ALTER TABLE employee DROP COLUMN name;
ALTER TABLE employee DROP COLUMN initials;
ALTER TABLE employee DROP COLUMN department;
ALTER TABLE employee DROP COLUMN location;
CREATE INDEX employee_directory_idx ON employee(tenant_id,entity_id,id);
CREATE INDEX person_name_idx ON person(tenant_id,name,id);

ALTER TABLE person ENABLE ROW LEVEL SECURITY;
ALTER TABLE person FORCE ROW LEVEL SECURITY;
CREATE POLICY person_directory_read ON person FOR SELECT TO anvione_app USING (
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND EXISTS (SELECT 1 FROM employee e WHERE e.tenant_id=person.tenant_id AND e.person_id=person.id)
);
CREATE POLICY person_identity_lookup ON person FOR SELECT TO anvione_identity_reader USING (true);
GRANT SELECT ON person TO anvione_app, anvione_identity_reader;

ALTER TABLE org_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_unit FORCE ROW LEVEL SECURITY;
-- Master labels are work metadata. Directory joins need the current entity's labels;
-- the organization HTTP resource separately requires organization.read.
CREATE POLICY org_unit_read ON org_unit FOR SELECT TO anvione_app USING (
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
);
CREATE POLICY org_unit_insert ON org_unit FOR INSERT TO anvione_app WITH CHECK (
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.hr_scope',true)='write'
);
CREATE POLICY org_unit_update ON org_unit FOR UPDATE TO anvione_app USING (
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.hr_scope',true)='write'
) WITH CHECK (
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND current_setting('app.hr_scope',true)='write'
);
GRANT SELECT ON org_unit TO anvione_app;
GRANT INSERT (id,tenant_id,entity_id,kind,code,name) ON org_unit TO anvione_app;
GRANT UPDATE (name,active,version) ON org_unit TO anvione_app;
CREATE FUNCTION guard_org_unit_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (NEW.id,NEW.tenant_id,NEW.entity_id,NEW.kind,NEW.code,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.entity_id,OLD.kind,OLD.code,OLD.created_at)
      OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Organization identity is immutable and updates must increment version' USING ERRCODE='23514';
  END IF;
  NEW.updated_at=now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER org_unit_update_guard BEFORE UPDATE ON org_unit
FOR EACH ROW EXECUTE FUNCTION guard_org_unit_update();

CREATE FUNCTION guard_employment_assignments() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    PERFORM id FROM public.org_unit WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
      AND id=NEW.department_id AND kind='department' AND active FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'New department assignments require an active department in this entity' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='INSERT' OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    PERFORM id FROM public.org_unit WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
      AND id=NEW.location_id AND kind='location' AND active FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'New location assignments require an active location in this entity' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER employee_assignment_guard BEFORE INSERT OR UPDATE OF department_id,location_id ON employee
FOR EACH ROW EXECUTE FUNCTION guard_employment_assignments();

CREATE VIEW employee_directory WITH (security_invoker=true) AS
SELECT e.id,e.tenant_id,e.entity_id,e.person_id,e.code,p.name,e.title,
  d.name AS department,l.name AS location,e.email,e.joined_on,e.status,e.manager_id,p.initials,
  e.department_id,e.location_id
FROM employee e JOIN person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
JOIN org_unit d ON d.tenant_id=e.tenant_id AND d.entity_id=e.entity_id AND d.kind='department' AND d.id=e.department_id
JOIN org_unit l ON l.tenant_id=e.tenant_id AND l.entity_id=e.entity_id AND l.kind='location' AND l.id=e.location_id;
GRANT SELECT ON employee_directory TO anvione_app;

-- Issued codes contain no name/email and deliberately do not cascade with employment.
-- They remain reserved even after a future approved employment-erasure process.
CREATE TABLE employee_code_allocation (
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  code text NOT NULL,
  allocation_sequence bigint,
  issued_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,code),
  UNIQUE (tenant_id,employee_id),
  UNIQUE (tenant_id,allocation_sequence),
  UNIQUE (tenant_id,entity_id,employee_id,code),
  FOREIGN KEY (tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
  CHECK (allocation_sequence IS NULL OR allocation_sequence > 0)
);
INSERT INTO employee_code_allocation(tenant_id,entity_id,employee_id,code,allocation_sequence)
SELECT tenant_id,entity_id,id,code,
  CASE WHEN code ~ '^ANV-[0-9]+$' THEN substring(code FROM 5)::bigint ELSE NULL END
FROM employee;
ALTER TABLE employee ADD CONSTRAINT employee_issued_code_fk
  FOREIGN KEY (tenant_id,entity_id,id,code)
  REFERENCES employee_code_allocation(tenant_id,entity_id,employee_id,code);
CREATE SEQUENCE employee_code_sequence AS bigint MINVALUE 1 NO CYCLE;
SELECT setval('employee_code_sequence',coalesce(max(allocation_sequence),1),max(allocation_sequence) IS NOT NULL)
FROM employee_code_allocation;
CREATE FUNCTION reject_code_allocation_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Issued employee codes are immutable and cannot be recycled' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER employee_code_allocation_immutable BEFORE UPDATE OR DELETE ON employee_code_allocation
FOR EACH ROW EXECUTE FUNCTION reject_code_allocation_mutation();
CREATE FUNCTION guard_employment_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF (NEW.id,NEW.tenant_id,NEW.entity_id,NEW.person_id,NEW.code)
      IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.entity_id,OLD.person_id,OLD.code) THEN
    RAISE EXCEPTION 'Employment identity and issued code are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER employment_identity_immutable BEFORE UPDATE ON employee
FOR EACH ROW EXECUTE FUNCTION guard_employment_identity();

CREATE ROLE anvione_lifecycle_allocator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_lifecycle_allocator;
GRANT USAGE ON SEQUENCE employee_code_sequence TO anvione_lifecycle_allocator;
GRANT SELECT,INSERT ON employee_code_allocation TO anvione_lifecycle_allocator;
ALTER TABLE employee_code_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_code_allocation FORCE ROW LEVEL SECURITY;
CREATE POLICY employee_code_allocator ON employee_code_allocation TO anvione_lifecycle_allocator USING (true) WITH CHECK (true);
CREATE FUNCTION issue_employee_code(p_tenant uuid,p_entity uuid,p_employee uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  existing_code text;
  existing_entity uuid;
  issued_sequence bigint;
  issued_code text;
BEGIN
  -- One global allocation lock also coordinates synthetic seed/high-water setup.
  -- nextval remains nontransactional: rolled-back attempts consume a gap, never reuse.
  PERFORM pg_advisory_xact_lock(804211);
  SELECT code,entity_id INTO existing_code,existing_entity FROM public.employee_code_allocation
    WHERE tenant_id=p_tenant AND employee_id=p_employee;
  IF FOUND THEN
    IF existing_entity <> p_entity THEN
      RAISE EXCEPTION 'Employment allocation belongs to another entity' USING ERRCODE='23514';
    END IF;
    RETURN existing_code;
  END IF;
  issued_sequence=nextval('public.employee_code_sequence');
  issued_code='ANV-' || lpad(issued_sequence::text,greatest(6,length(issued_sequence::text)),'0');
  INSERT INTO public.employee_code_allocation(tenant_id,entity_id,employee_id,code,allocation_sequence)
    VALUES(p_tenant,p_entity,p_employee,issued_code,issued_sequence);
  RETURN issued_code;
END;
$$;
ALTER FUNCTION issue_employee_code(uuid,uuid,uuid) OWNER TO anvione_lifecycle_allocator;
REVOKE ALL ON FUNCTION issue_employee_code(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_entity_timezone(),guard_org_unit_update(),guard_employment_assignments(),reject_code_allocation_mutation(),guard_employment_identity() FROM PUBLIC;

ALTER TABLE audit_event ADD COLUMN reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 300);
ALTER TABLE audit_event ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(details)='object' AND octet_length(details::text)<=8192);
ALTER TABLE outbox_event ADD COLUMN aggregate_id uuid;
UPDATE outbox_event SET aggregate_id=entity_id;
ALTER TABLE outbox_event ALTER COLUMN aggregate_id SET NOT NULL;
ALTER TABLE outbox_event DROP CONSTRAINT outbox_event_event_type_check;
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_event_type_check CHECK (
  event_type IN ('branding.published.v1','organization.created.v1','organization.updated.v1')
);
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN SELECT conname FROM pg_constraint
    WHERE conrelid='public.outbox_event'::regclass AND contype='u'
  LOOP
    EXECUTE format('ALTER TABLE public.outbox_event DROP CONSTRAINT %I',constraint_name);
  END LOOP;
END;
$$;
ALTER TABLE outbox_event ADD CONSTRAINT outbox_aggregate_version_key
  UNIQUE(tenant_id,entity_id,event_type,aggregate_id,aggregate_version);
