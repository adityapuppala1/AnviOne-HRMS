-- Operations may bind a preapproved employment, but cannot create employment,
-- grant privileged roles, replace an identity or read the underlying tables.
CREATE ROLE anvione_identity_operator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE anvione_identity_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

CREATE TABLE identity_operation_principal (
  id uuid PRIMARY KEY,
  db_principal name NOT NULL UNIQUE
);
INSERT INTO identity_operation_principal(id, db_principal)
VALUES ('40000000-0000-4000-8000-000000000004', 'anvione_identity_operator');

CREATE TABLE identity_binding_attestation (
  binding_id uuid PRIMARY KEY REFERENCES identity_binding(id),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  verified_official_email text NOT NULL CHECK (length(verified_official_email) BETWEEN 3 AND 254),
  hr_approval_reference text NOT NULL CHECK (length(hr_approval_reference) BETWEEN 3 AND 200),
  identity_verification_reference text NOT NULL CHECK (length(identity_verification_reference) BETWEEN 3 AND 200),
  operator_identifier text NOT NULL CHECK (length(operator_identifier) BETWEEN 3 AND 120),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
  db_principal name NOT NULL REFERENCES identity_operation_principal(db_principal),
  request_id uuid NOT NULL UNIQUE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, entity_id, employee_id) REFERENCES employee(tenant_id, entity_id, id)
);
-- The attestation is append-only through this interface. Inactive bindings are
-- retained; this slice has no reassignment/revocation command.
CREATE UNIQUE INDEX identity_binding_one_active_employment
  ON identity_binding(tenant_id, entity_id, employee_id) WHERE active;

ALTER TABLE identity_operation_principal ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_operation_principal FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_operation_principal_read ON identity_operation_principal
  FOR SELECT TO anvione_identity_writer USING (true);
ALTER TABLE identity_binding_attestation ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_binding_attestation FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_attestation_read ON identity_binding_attestation
  FOR SELECT TO anvione_identity_writer USING (true);
CREATE POLICY identity_attestation_insert ON identity_binding_attestation
  FOR INSERT TO anvione_identity_writer WITH CHECK (true);
CREATE POLICY employee_identity_provisioning ON employee
  FOR SELECT TO anvione_identity_writer USING (true);
CREATE POLICY employee_identity_provisioning_lock ON employee
  FOR UPDATE TO anvione_identity_writer USING (true) WITH CHECK (false);
CREATE POLICY identity_operation_audit ON audit_event
  FOR INSERT TO anvione_identity_writer WITH CHECK (true);

REVOKE ALL ON identity_operation_principal, identity_binding_attestation FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anvione_identity_writer, anvione_identity_operator;
GRANT SELECT ON employee, legal_entity, identity_binding,
  identity_operation_principal, identity_binding_attestation TO anvione_identity_writer;
-- PostgreSQL requires an UPDATE column privilege for SELECT ... FOR UPDATE.
-- This NOLOGIN role is not granted to runtime or the operator. Its sole callable
-- function never updates employee rows, and locks them to serialize binding.
GRANT UPDATE (id) ON employee, identity_binding TO anvione_identity_writer;
GRANT INSERT ON identity_binding, identity_binding_attestation, audit_event TO anvione_identity_writer;

CREATE FUNCTION bind_identity(
  p_tenant_id uuid,
  p_entity_id uuid,
  p_employee_id uuid,
  p_issuer text,
  p_subject text,
  p_verified_official_email text,
  p_hr_approval_reference text,
  p_identity_verification_reference text,
  p_operator_identifier text,
  p_reason text,
  p_request_id uuid,
  p_apply boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  employment public.employee%ROWTYPE;
  existing public.identity_binding%ROWTYPE;
  attestation public.identity_binding_attestation%ROWTYPE;
  operator_id uuid;
  business_date date;
  binding_id uuid;
BEGIN
  SELECT id INTO operator_id FROM public.identity_operation_principal
    WHERE db_principal = session_user;
  IF operator_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'A dedicated identity operations connection is required.';
  END IF;

  IF p_tenant_id IS NULL OR p_entity_id IS NULL OR p_employee_id IS NULL
    OR p_request_id IS NULL OR p_apply IS NULL
    OR p_issuer IS NULL OR length(p_issuer) NOT BETWEEN 9 AND 500
    OR p_issuer !~ '^https://[^/?#@[:space:]]+(/[^?#[:space:]]*)?$'
    OR p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 255
    OR p_subject ~ '[[:cntrl:]]'
    OR p_verified_official_email IS NULL OR length(p_verified_official_email) NOT BETWEEN 3 AND 254
    OR p_verified_official_email ~ '[[:space:][:cntrl:]]'
    OR p_hr_approval_reference IS NULL OR length(p_hr_approval_reference) NOT BETWEEN 3 AND 200
    OR p_identity_verification_reference IS NULL OR length(p_identity_verification_reference) NOT BETWEEN 3 AND 200
    OR p_operator_identifier IS NULL OR length(p_operator_identifier) NOT BETWEEN 3 AND 120
    OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 3 AND 300
    OR p_hr_approval_reference <> btrim(p_hr_approval_reference)
    OR p_identity_verification_reference <> btrim(p_identity_verification_reference)
    OR p_operator_identifier <> btrim(p_operator_identifier)
    OR p_reason <> btrim(p_reason)
    OR concat(p_hr_approval_reference, p_identity_verification_reference, p_operator_identifier, p_reason) ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Binding input or approval evidence is invalid.';
  END IF;

  SELECT e.* INTO employment
    FROM public.employee e
    WHERE e.id = p_employee_id AND e.tenant_id = p_tenant_id AND e.entity_id = p_entity_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'The approved employment is unavailable.';
  END IF;
  SELECT (now() AT TIME ZONE le.timezone)::date INTO business_date
    FROM public.legal_entity le
    WHERE le.id = p_entity_id AND le.tenant_id = p_tenant_id;
  IF employment.status NOT IN ('active', 'notice')
    OR employment.joined_on > business_date
    OR employment.email <> p_verified_official_email
    OR EXISTS (
      SELECT 1 FROM public.employee e WHERE e.tenant_id = p_tenant_id AND e.entity_id = p_entity_id
        AND e.id <> employment.id AND e.status IN ('active', 'notice')
        AND lower(e.email) = lower(p_verified_official_email)
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Employment eligibility or verified official email does not match.';
  END IF;

  SELECT * INTO existing FROM public.identity_binding
    WHERE issuer = p_issuer AND subject = p_subject FOR UPDATE;
  IF FOUND THEN
    SELECT a.* INTO attestation FROM public.identity_binding_attestation a WHERE a.binding_id = existing.id;
    IF existing.tenant_id <> p_tenant_id OR existing.entity_id <> p_entity_id
      OR existing.employee_id <> p_employee_id OR NOT existing.active
      OR existing.roles <> ARRAY['employee']::text[]
      OR attestation.binding_id IS NULL
      OR attestation.verified_official_email <> p_verified_official_email
      OR attestation.hr_approval_reference <> p_hr_approval_reference
      OR attestation.identity_verification_reference <> p_identity_verification_reference
      OR attestation.operator_identifier <> p_operator_identifier
      OR attestation.reason <> p_reason
      OR attestation.db_principal <> session_user
      OR EXISTS (SELECT 1 FROM public.identity_binding WHERE employee_id = p_employee_id AND id <> existing.id)
    THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Identity or employment is already bound; reassignment is not supported.';
    END IF;
    RETURN jsonb_build_object('status', 'unchanged', 'bindingId', existing.id,
      'employmentId', employment.id, 'employeeCode', employment.code, 'role', 'employee');
  END IF;
  IF EXISTS (SELECT 1 FROM public.identity_binding WHERE employee_id = p_employee_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Identity or employment is already bound; reassignment is not supported.';
  END IF;
  IF NOT p_apply THEN
    RETURN jsonb_build_object('status', 'ready', 'bindingId', NULL,
      'employmentId', employment.id, 'employeeCode', employment.code, 'role', 'employee');
  END IF;

  binding_id := gen_random_uuid();
  INSERT INTO public.identity_binding(id, tenant_id, entity_id, employee_id, issuer, subject, active, roles)
    VALUES (binding_id, p_tenant_id, p_entity_id, p_employee_id, p_issuer, p_subject, true, ARRAY['employee']);
  INSERT INTO public.identity_binding_attestation(binding_id, tenant_id, entity_id, employee_id,
    verified_official_email, hr_approval_reference, identity_verification_reference,
    operator_identifier, reason, db_principal, request_id)
    VALUES (binding_id, p_tenant_id, p_entity_id, p_employee_id, p_verified_official_email,
      p_hr_approval_reference, p_identity_verification_reference, p_operator_identifier,
      p_reason, session_user, p_request_id);
  INSERT INTO public.audit_event(id, tenant_id, entity_id, actor_id, actor_label, role, action,
    target, request_id, reason, details)
    VALUES (gen_random_uuid(), p_tenant_id, p_entity_id, operator_id, session_user, 'identity_operations',
      'identity.bound', binding_id::text, p_request_id, p_reason,
      jsonb_build_object('employmentId', employment.id, 'role', 'employee',
        'operatorIdentifier', p_operator_identifier,
        'hrApprovalReference', p_hr_approval_reference,
        'identityVerificationReference', p_identity_verification_reference));
  RETURN jsonb_build_object('status', 'created', 'bindingId', binding_id,
    'employmentId', employment.id, 'employeeCode', employment.code, 'role', 'employee');
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Identity or employment is already bound, or the request identifier was already used.';
END;
$$;
REVOKE ALL ON FUNCTION bind_identity(uuid, uuid, uuid, text, text, text, text, text, text, text, uuid, boolean) FROM PUBLIC;
ALTER FUNCTION bind_identity(uuid, uuid, uuid, text, text, text, text, text, text, text, uuid, boolean) OWNER TO anvione_identity_writer;
GRANT EXECUTE ON FUNCTION bind_identity(uuid, uuid, uuid, text, text, text, text, text, text, text, uuid, boolean) TO anvione_identity_operator;
