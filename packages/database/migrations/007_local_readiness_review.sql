CREATE TABLE candidate_local_review (
 id uuid PRIMARY KEY,
 candidate_id uuid NOT NULL REFERENCES candidate_case(id),
 kind text NOT NULL DEFAULT 'candidate_local_readiness_v1' CHECK(kind='candidate_local_readiness_v1'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected','withdrawn')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 proposed_by uuid NOT NULL,
 proposer_label text NOT NULL CHECK(length(proposer_label) BETWEEN 2 AND 120),
 proposal_note text NOT NULL CHECK(length(proposal_note) BETWEEN 10 AND 300),
 proposed_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid,
 decision_note text CHECK(length(decision_note) BETWEEN 10 AND 300),
 decided_at timestamptz,
 CHECK(
  (state='pending' AND decided_by IS NULL AND decision_note IS NULL AND decided_at IS NULL)
  OR (state<>'pending' AND decided_by IS NOT NULL AND decision_note IS NOT NULL AND decided_at IS NOT NULL)
 )
);
CREATE UNIQUE INDEX candidate_local_review_pending
 ON candidate_local_review(candidate_id,kind) WHERE state='pending';
CREATE INDEX candidate_local_review_history
 ON candidate_local_review(candidate_id,proposed_at DESC,id);

ALTER TABLE candidate_local_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_local_review FORCE ROW LEVEL SECURITY;
CREATE POLICY local_review_hr ON candidate_local_review TO anvione_app
 USING(EXISTS(SELECT 1 FROM candidate_case c WHERE c.id=candidate_id))
 WITH CHECK(EXISTS(SELECT 1 FROM candidate_case c WHERE c.id=candidate_id));
GRANT SELECT,INSERT,UPDATE ON candidate_local_review TO anvione_app;

CREATE FUNCTION enforce_candidate_local_review() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor uuid := nullif(current_setting('app.actor_id',true),'')::uuid;
BEGIN
 IF actor IS NULL THEN
  RAISE EXCEPTION 'Actor context is required' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.proposed_by<>actor OR NEW.state<>'pending' OR NEW.version<>1
   OR NEW.decided_by IS NOT NULL OR NEW.decision_note IS NOT NULL OR NEW.decided_at IS NOT NULL THEN
   RAISE EXCEPTION 'New reviews must be actor-bound pending proposals' USING ERRCODE='23514';
  END IF;
 ELSE
  IF OLD.state<>'pending' THEN
   RAISE EXCEPTION 'Review decisions are terminal' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.id,NEW.candidate_id,NEW.kind,NEW.proposed_by,NEW.proposer_label,NEW.proposal_note,NEW.proposed_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.candidate_id,OLD.kind,OLD.proposed_by,OLD.proposer_label,OLD.proposal_note,OLD.proposed_at)
   OR NEW.version<>OLD.version+1 OR NEW.state='pending'
   OR NEW.decided_by<>actor OR NEW.decision_note IS NULL THEN
   RAISE EXCEPTION 'Only a versioned actor-bound decision is allowed' USING ERRCODE='23514';
  END IF;
  IF NEW.state='withdrawn' AND actor<>OLD.proposed_by THEN
   RAISE EXCEPTION 'Only the maker can withdraw a proposal' USING ERRCODE='23514';
  END IF;
  IF NEW.state IN ('approved','rejected') AND actor=OLD.proposed_by THEN
   RAISE EXCEPTION 'Maker and checker must be different identities' USING ERRCODE='23514';
  END IF;
  NEW.decided_at=now();
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION enforce_candidate_local_review() FROM PUBLIC;
CREATE TRIGGER candidate_local_review_guard
 BEFORE INSERT OR UPDATE ON candidate_local_review
 FOR EACH ROW EXECUTE FUNCTION enforce_candidate_local_review();
