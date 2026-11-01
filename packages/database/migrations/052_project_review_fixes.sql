-- PRJ-01 review fixes.
-- * Only an owner who can manage (project scope team or entity) sees and decides the project's
--   time; a plain-employee owner sees only their own entries.
-- * A project owner must hold an active manager or HR role binding, so every owner can manage.
-- * Deciding and withdrawing time take the project's advisory lock first, so a decision cannot
--   race an ownership transfer: the old owner loses the right as soon as the transfer commits.
-- * A missing entity "today" is a refusal (PJ003), never a silent pass.
-- * Deciding time already logged on a completed or cancelled project stays allowed on purpose:
--   closing a project must not strand submitted time; only new logging is refused.
CREATE OR REPLACE FUNCTION project_owned_by_me(p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.project p WHERE p.id=p_project
  AND p.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND p.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND p.owner_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid);
$$;

DROP POLICY time_entry_visible ON time_entry;
DROP POLICY time_entry_update ON time_entry;
CREATE POLICY time_entry_visible ON time_entry FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  current_setting('app.project_scope',true)='entity'
  OR (current_setting('app.project_scope',true) IN ('self','team')
   AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
  OR (current_setting('app.project_scope',true)='team' AND project_owned_by_me(project_id))
 )
);
CREATE POLICY time_entry_update ON time_entry FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND (
   current_setting('app.project_scope',true)='entity'
   OR (current_setting('app.project_scope',true) IN ('self','team')
    AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)
   OR (current_setting('app.project_scope',true)='team' AND project_owned_by_me(project_id))
  )
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );

CREATE FUNCTION guard_project_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF (TG_OP='INSERT' OR NEW.owner_employee_id IS DISTINCT FROM OLD.owner_employee_id)
   AND NOT EXISTS(SELECT 1 FROM identity_binding b WHERE b.tenant_id=NEW.tenant_id AND b.entity_id=NEW.entity_id
    AND b.employee_id=NEW.owner_employee_id AND b.active AND b.roles && ARRAY['manager','hr_admin']) THEN
  RAISE EXCEPTION 'A project owner must be a manager or HR' USING ERRCODE='PJ003';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_owner_guard BEFORE INSERT OR UPDATE ON project FOR EACH ROW EXECUTE FUNCTION guard_project_owner();
ALTER FUNCTION guard_project_owner() OWNER TO anvione_project_keeper;
REVOKE ALL ON FUNCTION guard_project_owner() FROM PUBLIC;
GRANT SELECT(tenant_id,entity_id,employee_id,active,roles) ON identity_binding TO anvione_project_keeper;

CREATE OR REPLACE FUNCTION guard_time_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.project_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Employee');
 today date := leave_entity_today();
 managed text[] := ARRAY['status','version','decision_note','decided_at','approved_by_label','decided_by_employee','withdrawn_at'];
 proj record;
 who text;
 logged integer;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This time entry belongs to another organization' USING ERRCODE='PJ005';
 END IF;
 IF TG_OP='INSERT' THEN
  IF me IS NULL OR NEW.employee_id<>me OR scope NOT IN ('self','team')
    OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
   RAISE EXCEPTION 'You can only log your own time' USING ERRCODE='PJ005';
  END IF;
  IF today IS NULL THEN
   RAISE EXCEPTION 'The organization''s current date is unavailable' USING ERRCODE='PJ003';
  END IF;
  SELECT p.name INTO who FROM employee e JOIN person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
  WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=NEW.employee_id AND e.status IN ('active','notice');
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Only current employees can log time' USING ERRCODE='PJ003';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('project:'||NEW.project_id::text,0));
  SELECT p.code, p.status, p.owner_employee_id AS owner INTO proj FROM project p
  WHERE p.tenant_id=NEW.tenant_id AND p.entity_id=NEW.entity_id AND p.id=NEW.project_id;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'This project is unavailable' USING ERRCODE='PJ003';
  END IF;
  IF proj.owner<>me AND NOT EXISTS(SELECT 1 FROM project_member m WHERE m.project_id=NEW.project_id
    AND m.employee_id=me AND m.removed_at IS NULL) THEN
   RAISE EXCEPTION 'Only project members can log time on this project' USING ERRCODE='PJ005';
  END IF;
  IF proj.status<>'active' THEN
   RAISE EXCEPTION 'Time can only be logged on an active project' USING ERRCODE='PJ004';
  END IF;
  IF NEW.task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_task t WHERE t.id=NEW.task_id
    AND t.project_id=NEW.project_id) THEN
   RAISE EXCEPTION 'That task is not part of this project' USING ERRCODE='PJ003';
  END IF;
  IF NEW.work_date IS NULL OR NEW.work_date>today OR NEW.work_date<today-60 THEN
   RAISE EXCEPTION 'The work date must be today or within the last 60 days' USING ERRCODE='PJ003';
  END IF;
  IF NEW.minutes IS NULL OR NEW.minutes<15 OR NEW.minutes>720 OR NEW.minutes%15<>0 THEN
   RAISE EXCEPTION 'Log between 15 minutes and 12 hours, in steps of 15 minutes' USING ERRCODE='PJ003';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('time-day:'||NEW.employee_id::text||':'||NEW.work_date::text,0));
  SELECT coalesce(sum(t.minutes),0) INTO logged FROM time_entry t
  WHERE t.tenant_id=NEW.tenant_id AND t.entity_id=NEW.entity_id AND t.employee_id=NEW.employee_id
   AND t.work_date=NEW.work_date AND t.status IN ('submitted','approved');
  IF logged+NEW.minutes>1440 THEN
   RAISE EXCEPTION 'That would log more than 24 hours on %', to_char(NEW.work_date,'YYYY-MM-DD') USING ERRCODE='PJ003';
  END IF;
  NEW.employee_name := who;
  NEW.project_code := proj.code;
  NEW.status := 'submitted';
  NEW.decision_note := NULL;
  NEW.decided_at := NULL;
  NEW.approved_by_label := NULL;
  NEW.decided_by_employee := NULL;
  NEW.withdrawn_at := NULL;
  NEW.version := 1;
  NEW.submitted_by_label := label;
  NEW.created_at := now();
  RETURN NEW;
 END IF;

 -- Same lock as an ownership transfer, so the owner check below reads the settled owner.
 PERFORM pg_advisory_xact_lock(hashtextextended('project:'||OLD.project_id::text,0));
 IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'A time entry changes only through its own actions' USING ERRCODE='PJ004';
 END IF;
 IF OLD.status<>'submitted' THEN
  RAISE EXCEPTION 'This time entry is final' USING ERRCODE='PJ004';
 END IF;
 IF NEW.status NOT IN ('approved','rejected','withdrawn') THEN
  RAISE EXCEPTION 'That time entry step is not allowed' USING ERRCODE='PJ004';
 END IF;
 NEW.decided_at := NULL;
 NEW.approved_by_label := NULL;
 NEW.decided_by_employee := NULL;
 NEW.withdrawn_at := NULL;
 IF NEW.status='withdrawn' THEN
  IF me IS NULL OR me<>OLD.employee_id OR scope NOT IN ('self','team') THEN
   RAISE EXCEPTION 'Only the person who logged this time can withdraw it' USING ERRCODE='PJ005';
  END IF;
  NEW.decision_note := NULL;
  NEW.withdrawn_at := now();
  RETURN NEW;
 END IF;
 IF me IS NULL OR me=OLD.employee_id THEN
  RAISE EXCEPTION 'Someone else must approve your own time' USING ERRCODE='PJ005';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM employee d WHERE d.tenant_id=OLD.tenant_id AND d.entity_id=OLD.entity_id
   AND d.id=me AND d.status IN ('active','notice')) THEN
  RAISE EXCEPTION 'Only current employees can decide time entries' USING ERRCODE='PJ005';
 END IF;
 IF NOT (scope='entity' OR (scope='team' AND EXISTS(SELECT 1 FROM project p WHERE p.id=OLD.project_id
   AND p.tenant_id=OLD.tenant_id AND p.entity_id=OLD.entity_id AND p.owner_employee_id=me))) THEN
  RAISE EXCEPTION 'Only the project owner or HR can decide this time entry' USING ERRCODE='PJ005';
 END IF;
 IF NEW.status='rejected' AND (NEW.decision_note IS NULL OR char_length(btrim(NEW.decision_note))<3) THEN
  RAISE EXCEPTION 'Say why the time is rejected' USING ERRCODE='PJ003';
 END IF;
 NEW.decided_at := now();
 NEW.approved_by_label := label;
 NEW.decided_by_employee := me;
 RETURN NEW;
END $$;
