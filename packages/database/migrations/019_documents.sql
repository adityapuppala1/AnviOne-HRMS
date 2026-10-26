-- F0.14 employee documents: self uploads, HR verification, immutable content.
-- Content lives beside its metadata under the same FORCE RLS, so a reader who
-- cannot see a document's record cannot read its bytes either.
CREATE ROLE anvione_document_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_document_keeper;

CREATE TABLE employee_document (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 category text NOT NULL CHECK(category IN ('identity','education','employment','other')),
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 2 AND 80 AND title=btrim(title)),
 file_name text NOT NULL CHECK(char_length(file_name) BETWEEN 1 AND 120),
 content_type text NOT NULL CHECK(content_type IN ('application/pdf','image/png','image/jpeg')),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 5242880),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN ('pending','verified','rejected','withdrawn')),
 version integer NOT NULL CHECK(version>0),
 uploaded_by_actor uuid NOT NULL,
 uploaded_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by_employee uuid,
 reviewer_label text,
 review_note text CHECK(review_note IS NULL OR char_length(btrim(review_note)) BETWEEN 3 AND 300),
 reviewed_at timestamptz,
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 CHECK((status='pending')=(reviewed_at IS NULL)),
 CHECK(status<>'rejected' OR review_note IS NOT NULL)
);
CREATE UNIQUE INDEX employee_document_active_file ON employee_document(tenant_id,employee_id,sha256)
 WHERE status IN ('pending','verified');
CREATE INDEX employee_document_owner_idx ON employee_document(tenant_id,entity_id,employee_id,uploaded_at DESC);
CREATE INDEX employee_document_queue_idx ON employee_document(tenant_id,entity_id,status,uploaded_at);

CREATE TABLE employee_document_content (
 document_id uuid PRIMARY KEY REFERENCES employee_document(id),
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 5242880)
);

CREATE FUNCTION guard_employee_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 actor uuid := nullif(current_setting('app.actor_id',true),'')::uuid;
 scope text := coalesce(current_setting('app.document_scope',true),'none');
 verdict text;
BEGIN
 IF TG_OP='INSERT' THEN
  IF me IS NULL OR actor IS NULL OR NEW.employee_id<>me OR scope NOT IN ('self','team')
    OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
    OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
   RAISE EXCEPTION 'You can only upload your own documents' USING ERRCODE='DC006';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM employee e WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id
    AND e.id=me AND e.status IN ('active','notice')) THEN
   RAISE EXCEPTION 'Only current employees can upload documents' USING ERRCODE='DC006';
  END IF;
  -- Per-person caps bound storage growth; withdrawn and rejected files do not count.
  PERFORM pg_advisory_xact_lock(hashtextextended('documents:'||me::text,0));
  IF (SELECT count(*) FROM employee_document d WHERE d.tenant_id=NEW.tenant_id
    AND d.employee_id=me AND d.status='pending')>=10 THEN
   RAISE EXCEPTION 'You have 10 documents waiting for HR; wait for a review or withdraw one' USING ERRCODE='DC003';
  END IF;
  IF (SELECT count(*) FROM employee_document d WHERE d.tenant_id=NEW.tenant_id
    AND d.employee_id=me AND d.status IN ('pending','verified'))>=25 THEN
   RAISE EXCEPTION 'You can keep up to 25 active documents' USING ERRCODE='DC003';
  END IF;
  NEW.status := 'pending';
  NEW.version := 1;
  NEW.uploaded_by_actor := actor;
  NEW.uploaded_at := now();
  NEW.reviewed_by_employee := NULL;
  NEW.reviewer_label := NULL;
  NEW.review_note := NULL;
  NEW.reviewed_at := NULL;
  RETURN NEW;
 END IF;

 IF (to_jsonb(NEW)-ARRAY['status','version','reviewed_by_employee','reviewer_label','review_note','reviewed_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','reviewed_by_employee','reviewer_label','review_note','reviewed_at'])
   OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'Documents change only through their review' USING ERRCODE='DC004';
 END IF;
 IF OLD.status<>'pending' OR NEW.status=OLD.status THEN
  RAISE EXCEPTION 'This document is already final' USING ERRCODE='DC004';
 END IF;
 IF NEW.status IN ('verified','rejected') THEN
  verdict := workflow_decision_error(OLD.tenant_id,OLD.entity_id,OLD.employee_id,'hr',NULL,me,scope);
  IF verdict='self' THEN
   RAISE EXCEPTION 'You cannot verify your own document' USING ERRCODE='DC005';
  ELSIF verdict='inactive' THEN
   RAISE EXCEPTION 'Only current employees can verify documents' USING ERRCODE='DC006';
  ELSIF verdict IS NOT NULL THEN
   RAISE EXCEPTION 'Only HR verifies documents' USING ERRCODE='DC006';
  END IF;
  IF NEW.status='rejected' AND NEW.review_note IS NULL THEN
   RAISE EXCEPTION 'Explain why the document is rejected' USING ERRCODE='DC003';
  END IF;
  NEW.reviewed_by_employee := me;
  NEW.reviewer_label := nullif(current_setting('app.actor_label',true),'');
 ELSIF NEW.status='withdrawn' THEN
  IF me IS NULL OR me<>OLD.employee_id OR scope NOT IN ('self','team') THEN
   RAISE EXCEPTION 'Only the owner can withdraw a document' USING ERRCODE='DC006';
  END IF;
  NEW.reviewed_by_employee := me;
  NEW.reviewer_label := nullif(current_setting('app.actor_label',true),'');
 ELSE
  RAISE EXCEPTION 'Unsupported document transition' USING ERRCODE='DC004';
 END IF;
 NEW.reviewed_at := now();
 RETURN NEW;
END $$;

-- Content is written once, by the uploader, for their own pending document.
CREATE FUNCTION guard_employee_document_content() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'Document content is immutable' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM employee_document d
   WHERE d.id=NEW.document_id AND d.tenant_id=NEW.tenant_id AND d.entity_id=NEW.entity_id
    AND d.status='pending'
    AND d.employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
    AND d.uploaded_by_actor=nullif(current_setting('app.actor_id',true),'')::uuid
    AND d.size_bytes=octet_length(NEW.bytes)
    AND d.sha256=encode(sha256(NEW.bytes),'hex')) THEN
  RAISE EXCEPTION 'Content must match its own pending upload' USING ERRCODE='DC006';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION reject_document_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Withdraw or reject a document instead of deleting it' USING ERRCODE='23514';
END $$;

CREATE TRIGGER employee_document_guard BEFORE INSERT OR UPDATE ON employee_document
FOR EACH ROW EXECUTE FUNCTION guard_employee_document();
CREATE TRIGGER employee_document_no_delete BEFORE DELETE ON employee_document
FOR EACH ROW EXECUTE FUNCTION reject_document_delete();
CREATE TRIGGER employee_document_content_guard BEFORE INSERT OR UPDATE ON employee_document_content
FOR EACH ROW EXECUTE FUNCTION guard_employee_document_content();
CREATE TRIGGER employee_document_content_no_delete BEFORE DELETE ON employee_document_content
FOR EACH ROW EXECUTE FUNCTION reject_document_delete();

ALTER FUNCTION guard_employee_document() OWNER TO anvione_document_keeper;
ALTER FUNCTION guard_employee_document_content() OWNER TO anvione_document_keeper;
REVOKE ALL ON FUNCTION guard_employee_document(),guard_employee_document_content(),
 reject_document_delete() FROM PUBLIC;
GRANT SELECT ON employee,employee_document TO anvione_document_keeper;
GRANT EXECUTE ON FUNCTION workflow_decision_error(uuid,uuid,uuid,text,uuid,uuid,text) TO anvione_document_keeper;

ALTER TABLE employee_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_document FORCE ROW LEVEL SECURITY;
ALTER TABLE employee_document_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_document_content FORCE ROW LEVEL SECURITY;
CREATE POLICY employee_document_keeper_emp ON employee FOR SELECT TO anvione_document_keeper USING(true);
CREATE POLICY employee_document_keeper ON employee_document FOR SELECT TO anvione_document_keeper USING(true);

-- Owners see their own documents; HR sees the entity. Managers have no access.
CREATE POLICY employee_document_visible ON employee_document FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  (current_setting('app.document_scope',true) IN ('self','team')
   AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
  OR current_setting('app.document_scope',true)='entity'
 )
);
CREATE POLICY employee_document_upload ON employee_document FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
 AND current_setting('app.document_scope',true) IN ('self','team')
);
CREATE POLICY employee_document_transition ON employee_document FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND (
   (current_setting('app.document_scope',true) IN ('self','team')
    AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
   OR current_setting('app.document_scope',true)='entity'
  )
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );
CREATE POLICY employee_document_content_visible ON employee_document_content FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM employee_document d WHERE d.id=employee_document_content.document_id)
);
CREATE POLICY employee_document_content_upload ON employee_document_content FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.document_scope',true) IN ('self','team')
);

GRANT SELECT ON employee_document,employee_document_content TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,employee_id,category,title,file_name,content_type,size_bytes,sha256,
 status,version,uploaded_by_actor) ON employee_document TO anvione_app;
GRANT UPDATE(status,version,review_note) ON employee_document TO anvione_app;
GRANT INSERT(document_id,tenant_id,entity_id,bytes) ON employee_document_content TO anvione_app;

ALTER TABLE outbox_event DROP CONSTRAINT outbox_event_event_type_check;
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_event_type_check CHECK(event_type IN (
 'branding.published.v1','organization.created.v1','organization.updated.v1',
 'candidate.created.v1','candidate.invited.v1','candidate.revoked.v1','candidate.reviewed.v1',
 'candidate.submitted.v1','candidate.checklist_started.v1','candidate.task_created.v1','candidate.task_updated.v1',
 'candidate.local_review_proposed.v1','candidate.local_review_decided.v1','candidate.local_review_withdrawn.v1',
 'candidate.task_assigned.v1','candidate.assigned_task_updated.v1',
 'leave.requested.v1','leave.approved.v1','leave.rejected.v1','leave.cancelled.v1',
 'attendance.checked_in.v1','attendance.checked_out.v1',
 'attendance.correction_requested.v1','attendance.correction_approved.v1',
 'attendance.correction_rejected.v1','attendance.correction_cancelled.v1',
 'calendar.holiday_created.v1','calendar.holiday_updated.v1','calendar.work_week_updated.v1',
 'document.uploaded.v1','document.verified.v1','document.rejected.v1','document.withdrawn.v1'
));
