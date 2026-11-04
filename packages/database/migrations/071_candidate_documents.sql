-- Migration 071: Candidate intake documents and review workflow

CREATE TABLE candidate_document (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidate_case(id),
  category text NOT NULL CHECK(category IN ('government_id', 'proof_of_address', 'education_certificate', 'previous_employment')),
  title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 2 AND 80 AND title = btrim(title)),
  file_name text NOT NULL CHECK(char_length(file_name) BETWEEN 1 AND 120),
  content_type text NOT NULL CHECK(content_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 5242880),
  sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'verified', 'rejected', 'withdrawn')),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  review_note text CHECK(review_note IS NULL OR char_length(btrim(review_note)) BETWEEN 10 AND 300),
  reviewed_by uuid,
  reviewer_label text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((status = 'pending') = (reviewed_at IS NULL)),
  CHECK(status <> 'rejected' OR review_note IS NOT NULL)
);

CREATE UNIQUE INDEX candidate_document_active_category 
  ON candidate_document(candidate_id, category) 
  WHERE status IN ('pending', 'verified');

CREATE INDEX candidate_document_case_created_idx 
  ON candidate_document(candidate_id, created_at DESC, id);

CREATE TABLE candidate_document_content (
  document_id uuid PRIMARY KEY REFERENCES candidate_document(id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL REFERENCES candidate_case(id),
  bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 5242880)
);

CREATE INDEX candidate_document_content_case_idx 
  ON candidate_document_content(candidate_id);

CREATE FUNCTION guard_candidate_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  c_state text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT state INTO c_state FROM public.candidate_case WHERE id = NEW.candidate_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Candidate case not found' USING ERRCODE = '23514';
    END IF;
    IF c_state = 'cancelled' THEN
      RAISE EXCEPTION 'Cancelled intake cannot accept documents' USING ERRCODE = '23514';
    END IF;
    IF c_state = 'approved' THEN
      RAISE EXCEPTION 'Approved intake cannot accept documents' USING ERRCODE = '23514';
    END IF;

    IF current_user = 'anvione_candidate' THEN
      IF NEW.candidate_id IS DISTINCT FROM nullif(current_setting('candidate.id', true), '')::uuid THEN
        RAISE EXCEPTION 'Candidate can only upload their own documents' USING ERRCODE = '23514';
      END IF;
      IF NEW.status <> 'pending' OR NEW.version <> 1 OR NEW.reviewed_by IS NOT NULL OR NEW.reviewer_label IS NOT NULL OR NEW.review_note IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
        RAISE EXCEPTION 'New candidate documents must start in pending review status' USING ERRCODE = '23514';
      END IF;
      IF c_state = 'submitted' AND NOT EXISTS(
        SELECT 1 FROM public.candidate_document WHERE candidate_id = NEW.candidate_id AND category = NEW.category AND status = 'rejected'
      ) THEN
        RAISE EXCEPTION 'Once submitted, candidates can only re-upload rejected document categories' USING ERRCODE = '23514';
      END IF;
    END IF;

    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'verified' THEN
      RAISE EXCEPTION 'Verified documents are immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'Only pending documents can be reviewed' USING ERRCODE = '23514';
    END IF;
    IF current_user = 'anvione_candidate' THEN
      RAISE EXCEPTION 'Candidates cannot modify document reviews' USING ERRCODE = '23514';
    END IF;

    IF (to_jsonb(NEW) - ARRAY['status', 'version', 'reviewed_by', 'reviewer_label', 'review_note', 'reviewed_at', 'updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'version', 'reviewed_by', 'reviewer_label', 'review_note', 'reviewed_at', 'updated_at'])
       OR NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Document metadata is immutable during review' USING ERRCODE = '23514';
    END IF;

    IF NEW.status NOT IN ('verified', 'rejected') THEN
      RAISE EXCEPTION 'Document review status must be verified or rejected' USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'rejected' AND (NEW.review_note IS NULL OR char_length(btrim(NEW.review_note)) < 10) THEN
      RAISE EXCEPTION 'A rejection reason of at least 10 characters is required' USING ERRCODE = '23514';
    END IF;

    NEW.reviewed_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Candidate documents cannot be deleted' USING ERRCODE = '23514';
  END IF;
END $$;

CREATE TRIGGER candidate_document_guard
  BEFORE INSERT OR UPDATE OR DELETE ON candidate_document
  FOR EACH ROW EXECUTE FUNCTION guard_candidate_document();

CREATE FUNCTION guard_candidate_document_content() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS(
      SELECT 1 FROM public.candidate_document d
      WHERE d.id = NEW.document_id AND d.candidate_id = NEW.candidate_id AND d.status = 'pending'
    ) THEN
      RAISE EXCEPTION 'Content can only be added to a pending candidate document' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Candidate document content is strictly immutable' USING ERRCODE = '23514';
  END IF;
END $$;

CREATE TRIGGER candidate_document_content_guard
  BEFORE INSERT OR UPDATE OR DELETE ON candidate_document_content
  FOR EACH ROW EXECUTE FUNCTION guard_candidate_document_content();

ALTER TABLE candidate_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_document FORCE ROW LEVEL SECURITY;

ALTER TABLE candidate_document_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_document_content FORCE ROW LEVEL SECURITY;

CREATE POLICY candidate_doc_hr ON candidate_document TO anvione_app
  USING (EXISTS(SELECT 1 FROM candidate_case c WHERE c.id = candidate_id))
  WITH CHECK (EXISTS(SELECT 1 FROM candidate_case c WHERE c.id = candidate_id));

CREATE POLICY candidate_doc_self_read ON candidate_document FOR SELECT TO anvione_candidate
  USING (candidate_id = nullif(current_setting('candidate.id', true), '')::uuid);

CREATE POLICY candidate_doc_self_insert ON candidate_document FOR INSERT TO anvione_candidate
  WITH CHECK (candidate_id = nullif(current_setting('candidate.id', true), '')::uuid);

CREATE POLICY candidate_content_hr ON candidate_document_content TO anvione_app
  USING (EXISTS(SELECT 1 FROM candidate_case c WHERE c.id = candidate_id))
  WITH CHECK (EXISTS(SELECT 1 FROM candidate_case c WHERE c.id = candidate_id));

CREATE POLICY candidate_content_self_read ON candidate_document_content FOR SELECT TO anvione_candidate
  USING (candidate_id = nullif(current_setting('candidate.id', true), '')::uuid);

CREATE POLICY candidate_content_self_insert ON candidate_document_content FOR INSERT TO anvione_candidate
  WITH CHECK (candidate_id = nullif(current_setting('candidate.id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON candidate_document TO anvione_app;
GRANT SELECT, INSERT, UPDATE ON candidate_document_content TO anvione_app;
GRANT SELECT, INSERT ON candidate_document TO anvione_candidate;
GRANT INSERT, SELECT ON candidate_document_content TO anvione_candidate;

DROP POLICY candidate_event ON outbox_event;
CREATE POLICY candidate_event ON outbox_event FOR INSERT TO anvione_candidate WITH CHECK(
  event_type IN ('candidate.submitted.v1', 'candidate.task_updated.v1', 'candidate.document_uploaded.v1')
  AND aggregate_id = nullif(current_setting('candidate.id', true), '')::uuid
  AND EXISTS(SELECT 1 FROM candidate_case c WHERE c.id = aggregate_id AND c.tenant_id = outbox_event.tenant_id AND c.entity_id = outbox_event.entity_id)
);

DO $$
DECLARE
  def text;
  types text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO def FROM pg_constraint c
  WHERE c.conrelid = 'public.outbox_event'::regclass AND c.conname = 'outbox_event_event_type_check';
  SELECT coalesce(array_agg(DISTINCT m[1]), '{}') INTO types FROM regexp_matches(coalesce(def, ''), '''([a-z0-9_.]+)''', 'g') AS m;
  types := types || ARRAY['candidate.document_uploaded.v1', 'candidate.document_reviewed.v1'];
  ALTER TABLE public.outbox_event DROP CONSTRAINT outbox_event_event_type_check;
  EXECUTE format('ALTER TABLE public.outbox_event ADD CONSTRAINT outbox_event_event_type_check CHECK(event_type IN (%s))',
    (SELECT string_agg(quote_literal(x), ',' ORDER BY x) FROM (SELECT DISTINCT unnest(types) AS x) u));
END $$;

