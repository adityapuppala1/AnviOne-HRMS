-- Migration 073: Allow candidate document upload to bump candidate_case version under RLS

CREATE POLICY candidate_document_version ON candidate_case FOR UPDATE TO anvione_candidate
  USING(id = nullif(current_setting('candidate.id', true), '')::uuid AND state NOT IN ('cancelled', 'approved') AND current_setting('candidate.operation', true) = 'document')
  WITH CHECK(id = nullif(current_setting('candidate.id', true), '')::uuid AND state NOT IN ('cancelled', 'approved') AND current_setting('candidate.operation', true) = 'document');

CREATE OR REPLACE FUNCTION enforce_candidate_case_task_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF current_user = 'anvione_candidate' AND current_setting('candidate.operation', true) IN ('task', 'document') AND
  ((to_jsonb(NEW) - ARRAY['version', 'department_kind', 'location_kind']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['version', 'department_kind', 'location_kind']) OR NEW.version <> OLD.version + 1) THEN
    RAISE EXCEPTION 'Checklist or document writes may only increment the case version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

