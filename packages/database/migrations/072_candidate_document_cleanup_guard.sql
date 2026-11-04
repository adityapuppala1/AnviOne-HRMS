-- Migration 072: Refine candidate document delete triggers for administrative test teardown

CREATE OR REPLACE FUNCTION guard_candidate_document() RETURNS trigger
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
    IF current_user IN ('anvione_app', 'anvione_candidate') THEN
      RAISE EXCEPTION 'Candidate documents cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION guard_candidate_document_content() RETURNS trigger
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
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Candidate document content is strictly immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_user IN ('anvione_app', 'anvione_candidate') THEN
      RAISE EXCEPTION 'Candidate document content cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
END $$;

