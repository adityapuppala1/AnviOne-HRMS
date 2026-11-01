ALTER TABLE candidate_local_review ADD COLUMN decider_label text;

ALTER TABLE candidate_local_review DISABLE TRIGGER candidate_local_review_guard;
UPDATE candidate_local_review r
SET decider_label = COALESCE(
  (
    SELECT a.actor_label
    FROM audit_event a
    WHERE a.actor_id=r.decided_by
      AND a.target=r.candidate_id::text
      AND a.action IN ('candidate.local_review_decided','candidate.local_review_withdrawn')
    ORDER BY abs(extract(epoch FROM (a.occurred_at-r.decided_at))),a.id
    LIMIT 1
  ),
  'Recorded reviewer'
)
WHERE r.state<>'pending';
ALTER TABLE candidate_local_review ENABLE TRIGGER candidate_local_review_guard;

ALTER TABLE candidate_local_review
 ADD CONSTRAINT candidate_local_review_decider_label_state CHECK(
  (state='pending' AND decider_label IS NULL)
  OR (state<>'pending' AND length(decider_label) BETWEEN 2 AND 120)
 );

CREATE OR REPLACE FUNCTION enforce_candidate_local_review() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 actor uuid := nullif(current_setting('app.actor_id',true),'')::uuid;
 actor_label text := nullif(current_setting('app.actor_label',true),'');
BEGIN
 IF actor IS NULL OR actor_label IS NULL THEN
  RAISE EXCEPTION 'Actor context is required' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.proposed_by<>actor OR NEW.proposer_label<>actor_label OR NEW.state<>'pending' OR NEW.version<>1
   OR NEW.decided_by IS NOT NULL OR NEW.decider_label IS NOT NULL
   OR NEW.decision_note IS NOT NULL OR NEW.decided_at IS NOT NULL THEN
   RAISE EXCEPTION 'New reviews must be actor-bound pending proposals' USING ERRCODE='23514';
  END IF;
 ELSE
  IF OLD.state<>'pending' THEN
   RAISE EXCEPTION 'Review decisions are terminal' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.id,NEW.candidate_id,NEW.kind,NEW.proposed_by,NEW.proposer_label,NEW.proposal_note,NEW.proposed_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.candidate_id,OLD.kind,OLD.proposed_by,OLD.proposer_label,OLD.proposal_note,OLD.proposed_at)
   OR NEW.version<>OLD.version+1 OR NEW.state='pending'
   OR NEW.decided_by<>actor OR NEW.decider_label<>actor_label OR NEW.decision_note IS NULL THEN
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
