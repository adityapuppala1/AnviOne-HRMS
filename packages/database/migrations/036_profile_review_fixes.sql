-- PRF-01 review fixes.
-- 1. An approved change that is not yet due can be withdrawn by the employee, or cancelled by
--    HR with a note (never their own), so it no longer blocks new requests for up to 90 days.
--    A withdrawn request may keep its approval stamps, and records who withdrew it.
-- 2. The guard refuses to run when the entity's business date is unknown instead of letting
--    NULL date comparisons pass silently.
ALTER TABLE profile_change_request ADD COLUMN withdrawn_by_label text;
ALTER TABLE profile_change_request DROP CONSTRAINT profile_change_request_check1;
ALTER TABLE profile_change_request ADD CONSTRAINT profile_change_request_decided_check CHECK(
 (status NOT IN ('approved','rejected','applied') OR decided_at IS NOT NULL)
 AND (status<>'submitted' OR decided_at IS NULL)
);

CREATE OR REPLACE FUNCTION guard_profile_change_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.profile_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Employee');
 today date := leave_entity_today();
 managed text[] := ARRAY['status','version','decision_note','decided_at','decided_by_label','decided_by_employee',
  'applied_at','withdrawn_at','withdrawn_by_label'];
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This profile change belongs to another organization' USING ERRCODE='PF005';
 END IF;
 IF today IS NULL THEN
  RAISE EXCEPTION 'The organization''s business date is unavailable' USING ERRCODE='PF005';
 END IF;
 IF TG_OP='INSERT' THEN
  IF me IS NULL OR NEW.employee_id<>me OR scope<>'self'
    OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
   RAISE EXCEPTION 'You can only ask to change your own profile' USING ERRCODE='PF005';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM employee e WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id
    AND e.id=NEW.employee_id AND e.status IN ('active','notice')) THEN
   RAISE EXCEPTION 'Only current employees can change their profile' USING ERRCODE='PF003';
  END IF;
  IF NEW.effective_on IS NULL OR NEW.effective_on<today OR NEW.effective_on>today+90 THEN
   RAISE EXCEPTION 'The change must take effect today or within the next 90 days' USING ERRCODE='PF003';
  END IF;
  NEW.status := 'submitted';
  NEW.decision_note := NULL;
  NEW.decided_at := NULL;
  NEW.decided_by_label := NULL;
  NEW.decided_by_employee := NULL;
  NEW.applied_at := NULL;
  NEW.withdrawn_at := NULL;
  NEW.withdrawn_by_label := NULL;
  NEW.version := 1;
  NEW.submitted_by_label := label;
  NEW.created_at := now();
  RETURN NEW;
 END IF;

 IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'A profile change request changes only through its own actions' USING ERRCODE='PF004';
 END IF;
 IF OLD.status IN ('rejected','withdrawn','applied') THEN
  RAISE EXCEPTION 'This profile change request is final' USING ERRCODE='PF004';
 END IF;
 IF NOT ((OLD.status='submitted' AND NEW.status IN ('approved','rejected','withdrawn'))
   OR (OLD.status='approved' AND NEW.status IN ('applied','withdrawn'))) THEN
  RAISE EXCEPTION 'That profile change step is not allowed' USING ERRCODE='PF004';
 END IF;
 NEW.decided_at := OLD.decided_at;
 NEW.decided_by_label := OLD.decided_by_label;
 NEW.decided_by_employee := OLD.decided_by_employee;
 NEW.applied_at := NULL;
 NEW.withdrawn_at := NULL;
 NEW.withdrawn_by_label := NULL;

 IF NEW.status='withdrawn' THEN
  IF OLD.status='approved' AND OLD.effective_on<=today THEN
   RAISE EXCEPTION 'This change is already due and will be applied' USING ERRCODE='PF004';
  END IF;
  IF scope='self' AND me=OLD.employee_id THEN
   NEW.decision_note := OLD.decision_note;
  ELSIF scope='entity' AND OLD.status='approved' THEN
   -- HR cancels an approved change that is not yet due; submitted ones are rejected instead.
   IF me IS NULL OR me=OLD.employee_id THEN
    RAISE EXCEPTION 'Someone else must cancel your own profile change' USING ERRCODE='PF005';
   END IF;
   IF NEW.decision_note IS NULL OR NEW.decision_note IS NOT DISTINCT FROM OLD.decision_note
     OR char_length(btrim(NEW.decision_note))<3 THEN
    RAISE EXCEPTION 'Say why the approved change is cancelled' USING ERRCODE='PF003';
   END IF;
  ELSE
   RAISE EXCEPTION 'Only the employee, or HR for an approved change, can withdraw this request'
    USING ERRCODE='PF005';
  END IF;
  NEW.withdrawn_at := now();
  NEW.withdrawn_by_label := label;
  RETURN NEW;
 END IF;

 IF NEW.status='applied' THEN
  IF NOT (scope='entity' OR (scope='self' AND me=OLD.employee_id)) THEN
   RAISE EXCEPTION 'Only the employee or HR can apply this change' USING ERRCODE='PF005';
  END IF;
  IF OLD.effective_on>today THEN
   RAISE EXCEPTION 'This change takes effect on a later date' USING ERRCODE='PF004';
  END IF;
  NEW.decision_note := OLD.decision_note;
  NEW.applied_at := now();
  RETURN NEW;
 END IF;

 IF scope<>'entity' THEN
  RAISE EXCEPTION 'Only HR can decide profile changes' USING ERRCODE='PF005';
 END IF;
 IF me IS NULL OR me=OLD.employee_id THEN
  RAISE EXCEPTION 'Someone else must decide your own profile change' USING ERRCODE='PF005';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM employee d WHERE d.tenant_id=OLD.tenant_id AND d.entity_id=OLD.entity_id
   AND d.id=me AND d.status IN ('active','notice')) THEN
  RAISE EXCEPTION 'Only current employees can decide profile changes' USING ERRCODE='PF005';
 END IF;
 IF NEW.status='rejected' AND (NEW.decision_note IS NULL OR char_length(btrim(NEW.decision_note))<3) THEN
  RAISE EXCEPTION 'Say why the change is rejected' USING ERRCODE='PF003';
 END IF;
 NEW.decided_at := now();
 NEW.decided_by_label := label;
 NEW.decided_by_employee := me;
 IF NEW.status='approved' AND OLD.effective_on<=today THEN
  NEW.status := 'applied';
  NEW.applied_at := now();
 END IF;
 RETURN NEW;
END $$;

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
 'profile.change_withdrawn.v1','profile.change_applied.v1','profile.change_cancelled.v1'
));
