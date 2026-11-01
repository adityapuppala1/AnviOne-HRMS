-- HLP-01 independent security review fixes (forward-only; 059 and 060 are unchanged).
-- * Service-target tampering: changing a case's priority recomputed both due times from the
--   creation time, so an agent could downgrade a breached case to push its due times into the
--   future and erase the breach. A due time that has already passed, and the response due time
--   once a public reply has been given, now stay as they are when the priority changes.
-- * Confidential flag: an agent without helpdesk.manage could mark a case they had not taken as
--   confidential through a direct statement (the API refused it, the guard did not), hiding it
--   from every other agent. The guard now refuses it as well.
-- * Thread size: comments and notes were unbounded while the case view returns at most 500, so
--   a requester could flood a case and push newer replies out of view. Each case now takes at
--   most 300 public comments and 300 internal notes, counted separately so the requester's limit
--   never depends on how many notes exist.
-- * Outbox: internal notes and public comments shared one event type, so a future notification
--   consumer could tell the requester "new activity" for an internal note. Internal notes now
--   emit helpdesk.internal_note_added.v1.
-- Errors: HD003 bad input (400), HD004 conflict (409), HD005 forbidden (403).

-- Runs after hd_case_guard (triggers fire in name order) on every case update by the app.
CREATE FUNCTION guard_hd_case_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.helpdesk_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
BEGIN
 IF NEW.confidential AND NOT OLD.confidential AND scope<>'manage'
   AND OLD.assignee_employee_id IS DISTINCT FROM me THEN
  RAISE EXCEPTION 'Take the case before marking it confidential' USING ERRCODE='HD004';
 END IF;
 IF NEW.priority IS DISTINCT FROM OLD.priority THEN
  -- A passed due time (a breach, or a target already met) is history and never moves.
  IF OLD.first_responded_at IS NOT NULL OR OLD.first_response_due<=now() THEN
   NEW.first_response_due := OLD.first_response_due;
  END IF;
  IF OLD.resolve_due<=now() THEN
   NEW.resolve_due := OLD.resolve_due;
  END IF;
  NEW.resolve_due := greatest(NEW.resolve_due,NEW.first_response_due);
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION guard_hd_case_comment_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- hd_case_comment_guard already holds the per-case advisory lock.
 IF (SELECT count(*) FROM public.hd_case_comment x WHERE x.case_id=NEW.case_id AND x.kind=NEW.kind)>=300 THEN
  RAISE EXCEPTION 'This case has reached its limit of 300 %. Raise a new case to continue',
   CASE NEW.kind WHEN 'internal' THEN 'internal notes' ELSE 'comments' END USING ERRCODE='HD004';
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER hd_case_guard_rules BEFORE UPDATE ON hd_case FOR EACH ROW EXECUTE FUNCTION guard_hd_case_rules();
CREATE TRIGGER hd_case_comment_guard_cap BEFORE INSERT ON hd_case_comment FOR EACH ROW EXECUTE FUNCTION guard_hd_case_comment_cap();
ALTER TABLE hd_case ENABLE ALWAYS TRIGGER hd_case_guard_rules;
ALTER TABLE hd_case_comment ENABLE ALWAYS TRIGGER hd_case_comment_guard_cap;
ALTER FUNCTION guard_hd_case_comment_cap() OWNER TO anvione_helpdesk_keeper;
REVOKE ALL ON FUNCTION guard_hd_case_rules(), guard_hd_case_comment_cap() FROM PUBLIC;

ALTER TABLE outbox_event DROP CONSTRAINT outbox_event_event_type_check;
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_event_type_check CHECK(event_type IN (
 'branding.published.v1','organization.created.v1','organization.updated.v1','organization.merged.v1',
 'candidate.created.v1','candidate.invited.v1','candidate.revoked.v1','candidate.reviewed.v1',
 'candidate.submitted.v1','candidate.checklist_started.v1','candidate.task_created.v1','candidate.task_updated.v1',
 'candidate.local_review_proposed.v1','candidate.local_review_decided.v1','candidate.local_review_withdrawn.v1',
 'candidate.task_assigned.v1','candidate.assigned_task_updated.v1',
 'leave.requested.v1','leave.approved.v1','leave.rejected.v1','leave.cancelled.v1',
 'attendance.checked_in.v1','attendance.checked_out.v1',
 'attendance.correction_requested.v1','attendance.correction_approved.v1',
 'attendance.correction_rejected.v1','attendance.correction_cancelled.v1',
 'calendar.holiday_created.v1','calendar.holiday_updated.v1','calendar.work_week_updated.v1',
 'document.uploaded.v1','document.verified.v1','document.rejected.v1','document.withdrawn.v1',
 'asset.registered.v1','asset.updated.v1','asset.issued.v1','asset.acknowledged.v1',
 'asset.returned.v1','asset.status_changed.v1',
 'policy.created.v1','policy.draft_updated.v1','policy.published.v1','policy.withdrawn.v1',
 'policy.acknowledged.v1',
 'exit.submitted.v1','exit.accepted.v1','exit.rejected.v1','exit.withdrawn.v1',
 'exit.clearance_updated.v1','exit.completed.v1',
 'expense.submitted.v1','expense.approved.v1','expense.rejected.v1','expense.cancelled.v1',
 'expense.paid.v1','expense.category_created.v1','expense.category_updated.v1',
 'profile.change_submitted.v1','profile.change_approved.v1','profile.change_rejected.v1',
 'profile.change_withdrawn.v1','profile.change_applied.v1','profile.change_cancelled.v1',
 'report.exported.v1','report.saved.v1','report.updated.v1','report.archived.v1',
 'employee.classified.v1','branding.rolled_back.v1',
 'project.created.v1','project.updated.v1','project.status_changed.v1',
 'project.member_added.v1','project.member_removed.v1',
 'project.task_created.v1','project.task_updated.v1','project.task_status_changed.v1',
 'time.logged.v1','time.withdrawn.v1','time.approved.v1','time.rejected.v1',
 'recruit.requisition_created.v1','recruit.requisition_updated.v1','recruit.requisition_status_changed.v1',
 'recruit.candidate_created.v1','recruit.candidate_retention_extended.v1',
 'recruit.candidate_consent_withdrawn.v1','recruit.candidate_anonymised.v1',
 'recruit.application_created.v1','recruit.application_stage_changed.v1',
 'recruit.interview_scheduled.v1','recruit.interview_rescheduled.v1','recruit.interview_status_changed.v1',
 'recruit.scorecard_submitted.v1','recruit.offer_created.v1','recruit.offer_status_changed.v1',
 'performance.objective_created.v1','performance.objective_updated.v1','performance.objective_status_changed.v1',
 'performance.key_result_added.v1','performance.key_result_updated.v1','performance.progress_recorded.v1',
 'performance.cycle_created.v1','performance.cycle_updated.v1','performance.cycle_status_changed.v1',
 'performance.review_self_submitted.v1','performance.review_manager_submitted.v1','performance.review_finalised.v1',
 'helpdesk.case_created.v1','helpdesk.case_status_changed.v1','helpdesk.case_assigned.v1',
 'helpdesk.case_priority_changed.v1','helpdesk.case_confidentiality_changed.v1','helpdesk.comment_added.v1',
 'helpdesk.article_linked.v1','helpdesk.category_created.v1','helpdesk.category_updated.v1',
 'helpdesk.sla_updated.v1','helpdesk.article_created.v1','helpdesk.article_updated.v1',
 'helpdesk.article_status_changed.v1','helpdesk.internal_note_added.v1'
));
