-- PRJ-01 projects, tasks and time tracking. A manager (or HR) creates a project and owns it;
-- the owner (or HR) manages its members and tasks; members log their time against it and the
-- owner or HR approves it. Nothing is deleted: members are soft-removed, closed time entries
-- are final, and a completed or cancelled project is read-only until HR reopens it (status
-- back to active; nothing else changes in that step). The owner's own time is approved by HR.
-- Guards run as a SELECT-only keeper role and serialise on advisory locks, never row locks.
-- Money (rates, billing, cost) is out of scope.
CREATE ROLE anvione_project_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_project_keeper;

CREATE TABLE project (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^[A-Z][A-Z0-9_-]{1,19}$'),
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 2 AND 80 AND name=btrim(name)),
 description text CHECK(description IS NULL OR char_length(description) BETWEEN 1 AND 500),
 owner_employee_id uuid NOT NULL,
 owner_name text NOT NULL,
 status text NOT NULL CHECK(status IN ('planned','active','on_hold','completed','cancelled')),
 start_date date NOT NULL,
 end_date date,
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES legal_entity(tenant_id,id),
 FOREIGN KEY(tenant_id,entity_id,owner_employee_id) REFERENCES employee(tenant_id,entity_id,id),
 CHECK(end_date IS NULL OR end_date>=start_date),
 UNIQUE(tenant_id,entity_id,code),
 UNIQUE(tenant_id,entity_id,id)
);
CREATE INDEX project_owner_idx ON project(tenant_id,entity_id,owner_employee_id);
CREATE INDEX project_status_idx ON project(tenant_id,entity_id,status,name);

CREATE TABLE project_member (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 project_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 employee_name text NOT NULL,
 employee_code text NOT NULL,
 role text NOT NULL CHECK(role IN ('member','lead')),
 added_by_label text NOT NULL,
 added_at timestamptz NOT NULL DEFAULT now(),
 removed_at timestamptz,
 removed_by_label text,
 version integer NOT NULL CHECK(version>0),
 FOREIGN KEY(tenant_id,entity_id,project_id) REFERENCES project(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 CHECK((removed_at IS NULL)=(removed_by_label IS NULL))
);
CREATE UNIQUE INDEX project_member_active_key ON project_member(project_id,employee_id) WHERE removed_at IS NULL;
CREATE INDEX project_member_employee_idx ON project_member(tenant_id,entity_id,employee_id) WHERE removed_at IS NULL;

CREATE TABLE project_task (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 project_id uuid NOT NULL,
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 3 AND 120 AND title=btrim(title)),
 description text CHECK(description IS NULL OR char_length(description) BETWEEN 1 AND 1000),
 assignee_employee_id uuid,
 status text NOT NULL CHECK(status IN ('todo','in_progress','blocked','done')),
 priority text NOT NULL CHECK(priority IN ('low','normal','high')),
 due_date date,
 version integer NOT NULL CHECK(version>0),
 created_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by_label text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,project_id) REFERENCES project(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,assignee_employee_id) REFERENCES employee(tenant_id,entity_id,id),
 UNIQUE(project_id,id)
);
CREATE INDEX project_task_project_idx ON project_task(project_id,status,created_at DESC);
CREATE INDEX project_task_assignee_idx ON project_task(tenant_id,entity_id,assignee_employee_id) WHERE status<>'done';

CREATE TABLE time_entry (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 employee_name text NOT NULL,
 project_id uuid NOT NULL,
 project_code text NOT NULL,
 task_id uuid,
 work_date date NOT NULL,
 minutes integer NOT NULL CHECK(minutes BETWEEN 15 AND 720 AND minutes%15=0),
 note text CHECK(note IS NULL OR char_length(note) BETWEEN 1 AND 300),
 status text NOT NULL CHECK(status IN ('submitted','approved','rejected','withdrawn')),
 decision_note text CHECK(decision_note IS NULL OR char_length(btrim(decision_note)) BETWEEN 3 AND 500),
 decided_at timestamptz,
 approved_by_label text,
 decided_by_employee uuid,
 withdrawn_at timestamptz,
 version integer NOT NULL CHECK(version>0),
 submitted_by_label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id,employee_id) REFERENCES employee(tenant_id,entity_id,id),
 FOREIGN KEY(tenant_id,entity_id,project_id) REFERENCES project(tenant_id,entity_id,id),
 FOREIGN KEY(project_id,task_id) REFERENCES project_task(project_id,id),
 CHECK(status<>'rejected' OR decision_note IS NOT NULL),
 CHECK((status IN ('approved','rejected'))=(decided_at IS NOT NULL)),
 CHECK((status='withdrawn')=(withdrawn_at IS NOT NULL))
);
CREATE INDEX time_entry_employee_idx ON time_entry(tenant_id,entity_id,employee_id,work_date DESC);
CREATE INDEX time_entry_project_idx ON time_entry(project_id,status,work_date DESC);
CREATE INDEX time_entry_task_idx ON time_entry(project_id,task_id) WHERE task_id IS NOT NULL;

-- Row-security helpers. They run as the keeper so a policy on one table can look at another
-- without recursing through that table's own policies.
CREATE FUNCTION project_can_see(p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE coalesce(current_setting('app.project_scope',true),'none')
  WHEN 'entity' THEN EXISTS(SELECT 1 FROM public.project p WHERE p.id=p_project
   AND p.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND p.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid)
  WHEN 'none' THEN false
  ELSE EXISTS(SELECT 1 FROM public.project p WHERE p.id=p_project
   AND p.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND p.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
   AND (p.owner_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
    OR EXISTS(SELECT 1 FROM public.project_member m WHERE m.project_id=p.id AND m.removed_at IS NULL
     AND m.employee_id=nullif(current_setting('app.employee_id',true),'')::uuid)))
 END;
$$;
CREATE FUNCTION project_can_manage(p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(current_setting('app.project_scope',true),'none') IN ('team','entity')
  AND EXISTS(SELECT 1 FROM public.project p WHERE p.id=p_project
   AND p.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND p.entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
   AND (current_setting('app.project_scope',true)='entity'
    OR p.owner_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid));
$$;
CREATE FUNCTION project_owned_by_me(p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.project p WHERE p.id=p_project
  AND p.owner_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid);
$$;

CREATE FUNCTION guard_project() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.project_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Manager');
 managed text[] := ARRAY['name','description','owner_employee_id','owner_name','status','start_date','end_date',
  'version','updated_by_label','updated_at'];
 owner_label text;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This project belongs to another organization' USING ERRCODE='PJ005';
 END IF;
 IF me IS NULL OR scope NOT IN ('team','entity') OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Only managers and HR manage projects' USING ERRCODE='PJ005';
 END IF;
 IF TG_OP='INSERT' THEN
  IF scope='team' AND NEW.owner_employee_id IS DISTINCT FROM me THEN
   RAISE EXCEPTION 'Managers create projects they own; HR can assign another owner' USING ERRCODE='PJ005';
  END IF;
  IF NEW.status NOT IN ('planned','active') THEN
   RAISE EXCEPTION 'A new project starts as planned or active' USING ERRCODE='PJ003';
  END IF;
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('project:'||OLD.id::text,0));
  IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'A project changes only through its own actions and its code never changes' USING ERRCODE='PJ004';
  END IF;
  IF NOT (scope='entity' OR OLD.owner_employee_id=me) THEN
   RAISE EXCEPTION 'Only the project owner or HR can change this project' USING ERRCODE='PJ005';
  END IF;
  IF NEW.owner_employee_id IS DISTINCT FROM OLD.owner_employee_id AND scope<>'entity' THEN
   RAISE EXCEPTION 'Only HR can hand a project to another owner' USING ERRCODE='PJ005';
  END IF;
  IF OLD.status IN ('completed','cancelled') THEN
   -- A closed project is read-only; HR may reopen it, and that step changes nothing else.
   IF scope<>'entity' OR NEW.status<>'active'
     OR (to_jsonb(NEW)-ARRAY['status','version','updated_by_label','updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updated_by_label','updated_at']) THEN
    RAISE EXCEPTION 'This project is closed; only HR can reopen it' USING ERRCODE='PJ004';
   END IF;
  ELSIF NEW.status<>OLD.status AND NOT (
    (OLD.status='planned' AND NEW.status IN ('active','on_hold','cancelled'))
    OR (OLD.status='active' AND NEW.status IN ('on_hold','completed','cancelled'))
    OR (OLD.status='on_hold' AND NEW.status IN ('active','completed','cancelled'))) THEN
   RAISE EXCEPTION 'A project cannot move from % to %', OLD.status, NEW.status USING ERRCODE='PJ004';
  END IF;
  IF NEW.owner_employee_id IS NOT DISTINCT FROM OLD.owner_employee_id THEN
   NEW.owner_name := OLD.owner_name;
  END IF;
 END IF;
 IF TG_OP='INSERT' OR NEW.owner_employee_id IS DISTINCT FROM OLD.owner_employee_id THEN
  SELECT p.name INTO owner_label FROM employee e JOIN person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
  WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=NEW.owner_employee_id
   AND e.status IN ('active','notice');
  IF NOT FOUND THEN
   RAISE EXCEPTION 'The project owner must be a current employee' USING ERRCODE='PJ003';
  END IF;
  NEW.owner_name := owner_label;
 END IF;
 IF NEW.end_date IS NOT NULL AND NEW.end_date<NEW.start_date THEN
  RAISE EXCEPTION 'The end date cannot be before the start date' USING ERRCODE='PJ003';
 END IF;
 IF TG_OP='INSERT' THEN
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

-- Shared by the member guard: the caller manages an open project. Takes the project lock.
CREATE FUNCTION project_require_open_managed(p_tenant uuid, p_entity uuid, p_project uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.project_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 proj record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('project:'||p_project::text,0));
 SELECT p.status, p.owner_employee_id AS owner INTO proj FROM project p
 WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.id=p_project;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'This project is unavailable' USING ERRCODE='PJ003';
 END IF;
 IF me IS NULL OR NOT (scope='entity' OR (scope='team' AND proj.owner=me)) THEN
  RAISE EXCEPTION 'Only the project owner or HR can change this project' USING ERRCODE='PJ005';
 END IF;
 IF proj.status IN ('completed','cancelled') THEN
  RAISE EXCEPTION 'This project is closed' USING ERRCODE='PJ004';
 END IF;
END $$;

CREATE FUNCTION guard_project_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Manager');
 person_row record;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This project belongs to another organization' USING ERRCODE='PJ005';
 END IF;
 PERFORM project_require_open_managed(NEW.tenant_id,NEW.entity_id,NEW.project_id);
 IF TG_OP='INSERT' THEN
  SELECT p.name, e.code INTO person_row FROM employee e JOIN person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
  WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=NEW.employee_id AND e.status IN ('active','notice');
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Only current employees can join a project' USING ERRCODE='PJ003';
  END IF;
  IF EXISTS(SELECT 1 FROM project_member m WHERE m.project_id=NEW.project_id AND m.employee_id=NEW.employee_id
    AND m.removed_at IS NULL) THEN
   RAISE EXCEPTION 'This person is already on the project' USING ERRCODE='PJ004';
  END IF;
  NEW.employee_name := person_row.name;
  NEW.employee_code := person_row.code;
  NEW.added_by_label := label;
  NEW.added_at := now();
  NEW.removed_at := NULL;
  NEW.removed_by_label := NULL;
  NEW.version := 1;
  RETURN NEW;
 END IF;
 -- The only change to a membership is removing it, once.
 IF OLD.removed_at IS NOT NULL THEN
  RAISE EXCEPTION 'This person has already left the project' USING ERRCODE='PJ004';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['removed_at','removed_by_label','version'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['removed_at','removed_by_label','version'])
   OR NEW.version<>OLD.version+1 OR NEW.removed_at IS NULL THEN
  RAISE EXCEPTION 'A membership changes only by removing it' USING ERRCODE='PJ004';
 END IF;
 IF EXISTS(SELECT 1 FROM project_task t WHERE t.project_id=OLD.project_id AND t.assignee_employee_id=OLD.employee_id
   AND t.status<>'done') THEN
  RAISE EXCEPTION 'Reassign this person''s open tasks before removing them' USING ERRCODE='PJ004';
 END IF;
 NEW.removed_at := now();
 NEW.removed_by_label := label;
 RETURN NEW;
END $$;

CREATE FUNCTION guard_project_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope text := coalesce(current_setting('app.project_scope',true),'none');
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'Employee');
 managed text[] := ARRAY['title','description','assignee_employee_id','status','priority','due_date',
  'version','updated_by_label','updated_at'];
 can_manage boolean;
 proj_status text;
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'This project belongs to another organization' USING ERRCODE='PJ005';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('project:'||NEW.project_id::text,0));
 SELECT p.status, (me IS NOT NULL AND (scope='entity' OR (scope='team' AND p.owner_employee_id=me)))
  INTO proj_status, can_manage
 FROM project p WHERE p.tenant_id=NEW.tenant_id AND p.entity_id=NEW.entity_id AND p.id=NEW.project_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'This project is unavailable' USING ERRCODE='PJ003';
 END IF;
 IF proj_status IN ('completed','cancelled') THEN
  RAISE EXCEPTION 'This project is closed' USING ERRCODE='PJ004';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NOT can_manage THEN
   RAISE EXCEPTION 'Only the project owner or HR can add tasks' USING ERRCODE='PJ005';
  END IF;
  NEW.status := 'todo';
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
 ELSE
  IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'A task changes only through its own actions and never moves between projects' USING ERRCODE='PJ004';
  END IF;
  IF NOT can_manage THEN
   -- The assignee may move their own task's status, and nothing else.
   IF me IS NULL OR scope NOT IN ('self','team') OR OLD.assignee_employee_id IS DISTINCT FROM me
     OR NOT EXISTS(SELECT 1 FROM project_member m WHERE m.project_id=OLD.project_id AND m.employee_id=me
      AND m.removed_at IS NULL)
     OR (to_jsonb(NEW)-ARRAY['status','version','updated_by_label','updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updated_by_label','updated_at']) THEN
    RAISE EXCEPTION 'Only the project owner or HR can change this task; its assignee can update its status'
     USING ERRCODE='PJ005';
   END IF;
  END IF;
 END IF;
 IF NEW.assignee_employee_id IS NOT NULL
   AND (TG_OP='INSERT' OR NEW.assignee_employee_id IS DISTINCT FROM OLD.assignee_employee_id)
   AND NOT EXISTS(SELECT 1 FROM project_member m WHERE m.project_id=NEW.project_id
    AND m.employee_id=NEW.assignee_employee_id AND m.removed_at IS NULL) THEN
  RAISE EXCEPTION 'A task can only be assigned to a current project member' USING ERRCODE='PJ003';
 END IF;
 NEW.updated_by_label := label;
 NEW.updated_at := now();
 RETURN NEW;
END $$;

CREATE FUNCTION guard_time_entry() RETURNS trigger
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
  SELECT p.name INTO who FROM employee e JOIN person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
  WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=NEW.employee_id AND e.status IN ('active','notice');
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Only current employees can log time' USING ERRCODE='PJ003';
  END IF;
  -- Same lock as project status changes, so a project cannot close under this entry.
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
  -- One day holds at most 24 hours across all projects; entries for the same day queue here.
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
 -- HR decides any entry; the project owner decides the others' time (theirs goes to HR).
 IF NOT (scope='entity' OR (scope='team' AND EXISTS(SELECT 1 FROM project p WHERE p.id=OLD.project_id
   AND p.owner_employee_id=me))) THEN
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

CREATE FUNCTION reject_project_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Projects, members, tasks and time entries are kept, never deleted' USING ERRCODE='23514';
END $$;

CREATE TRIGGER project_guard BEFORE INSERT OR UPDATE ON project FOR EACH ROW EXECUTE FUNCTION guard_project();
CREATE TRIGGER project_member_guard BEFORE INSERT OR UPDATE ON project_member FOR EACH ROW EXECUTE FUNCTION guard_project_member();
CREATE TRIGGER project_task_guard BEFORE INSERT OR UPDATE ON project_task FOR EACH ROW EXECUTE FUNCTION guard_project_task();
CREATE TRIGGER time_entry_guard BEFORE INSERT OR UPDATE ON time_entry FOR EACH ROW EXECUTE FUNCTION guard_time_entry();
CREATE TRIGGER project_no_delete BEFORE DELETE ON project FOR EACH ROW EXECUTE FUNCTION reject_project_delete();
CREATE TRIGGER project_member_no_delete BEFORE DELETE ON project_member FOR EACH ROW EXECUTE FUNCTION reject_project_delete();
CREATE TRIGGER project_task_no_delete BEFORE DELETE ON project_task FOR EACH ROW EXECUTE FUNCTION reject_project_delete();
CREATE TRIGGER time_entry_no_delete BEFORE DELETE ON time_entry FOR EACH ROW EXECUTE FUNCTION reject_project_delete();

ALTER FUNCTION project_can_see(uuid) OWNER TO anvione_project_keeper;
ALTER FUNCTION project_can_manage(uuid) OWNER TO anvione_project_keeper;
ALTER FUNCTION project_owned_by_me(uuid) OWNER TO anvione_project_keeper;
ALTER FUNCTION project_require_open_managed(uuid,uuid,uuid) OWNER TO anvione_project_keeper;
ALTER FUNCTION guard_project() OWNER TO anvione_project_keeper;
ALTER FUNCTION guard_project_member() OWNER TO anvione_project_keeper;
ALTER FUNCTION guard_project_task() OWNER TO anvione_project_keeper;
ALTER FUNCTION guard_time_entry() OWNER TO anvione_project_keeper;
REVOKE ALL ON FUNCTION project_can_see(uuid),project_can_manage(uuid),project_owned_by_me(uuid),
 project_require_open_managed(uuid,uuid,uuid),guard_project(),guard_project_member(),guard_project_task(),
 guard_time_entry(),reject_project_delete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_can_see(uuid),project_can_manage(uuid),project_owned_by_me(uuid) TO anvione_app;
GRANT SELECT ON employee,person,project,project_member,project_task,time_entry TO anvione_project_keeper;
GRANT EXECUTE ON FUNCTION leave_entity_today() TO anvione_project_keeper;

ALTER TABLE project ENABLE ROW LEVEL SECURITY;
ALTER TABLE project FORCE ROW LEVEL SECURITY;
ALTER TABLE project_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_member FORCE ROW LEVEL SECURITY;
ALTER TABLE project_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_task FORCE ROW LEVEL SECURITY;
ALTER TABLE time_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY project_keeper_emp ON employee FOR SELECT TO anvione_project_keeper USING(true);
CREATE POLICY project_keeper_person ON person FOR SELECT TO anvione_project_keeper USING(true);
CREATE POLICY project_keeper ON project FOR SELECT TO anvione_project_keeper USING(true);
CREATE POLICY project_member_keeper ON project_member FOR SELECT TO anvione_project_keeper USING(true);
CREATE POLICY project_task_keeper ON project_task FOR SELECT TO anvione_project_keeper USING(true);
CREATE POLICY time_entry_keeper ON time_entry FOR SELECT TO anvione_project_keeper USING(true);

-- Members and owners see their projects; HR sees every project in the entity.
CREATE POLICY project_visible ON project FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND project_can_see(id)
);
CREATE POLICY project_insert ON project FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND current_setting('app.project_scope',true) IN ('team','entity')
);
CREATE POLICY project_update ON project FOR UPDATE TO anvione_app
 USING(project_can_manage(id))
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );
CREATE POLICY project_member_visible ON project_member FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND project_can_see(project_id)
);
CREATE POLICY project_member_insert ON project_member FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND project_can_manage(project_id)
);
CREATE POLICY project_member_update ON project_member FOR UPDATE TO anvione_app
 USING(project_can_manage(project_id))
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );
CREATE POLICY project_task_visible ON project_task FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND project_can_see(project_id)
);
CREATE POLICY project_task_insert ON project_task FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND project_can_manage(project_id)
);
CREATE POLICY project_task_update ON project_task FOR UPDATE TO anvione_app
 USING(
  project_can_manage(project_id)
  OR (current_setting('app.project_scope',true) IN ('self','team')
   AND assignee_employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
   AND project_can_see(project_id))
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );
-- Time is seen by the person who logged it, the project owner and HR; nobody else.
CREATE POLICY time_entry_visible ON time_entry FOR SELECT TO anvione_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND (
  current_setting('app.project_scope',true)='entity'
  OR (current_setting('app.project_scope',true) IN ('self','team')
   AND (employee_id=nullif(current_setting('app.employee_id',true),'')::uuid OR project_owned_by_me(project_id)))
 )
);
CREATE POLICY time_entry_insert ON time_entry FOR INSERT TO anvione_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND employee_id=nullif(current_setting('app.employee_id',true),'')::uuid
 AND current_setting('app.project_scope',true) IN ('self','team')
);
CREATE POLICY time_entry_update ON time_entry FOR UPDATE TO anvione_app
 USING(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
  AND (
   current_setting('app.project_scope',true)='entity'
   OR (current_setting('app.project_scope',true) IN ('self','team')
    AND (employee_id=nullif(current_setting('app.employee_id',true),'')::uuid OR project_owned_by_me(project_id)))
  )
 )
 WITH CHECK(
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 );

GRANT SELECT ON project,project_member,project_task,time_entry TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,code,name,description,owner_employee_id,status,start_date,end_date) ON project TO anvione_app;
GRANT UPDATE(name,description,owner_employee_id,status,start_date,end_date,version) ON project TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,project_id,employee_id,role) ON project_member TO anvione_app;
GRANT UPDATE(removed_at,version) ON project_member TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,project_id,title,description,assignee_employee_id,priority,due_date) ON project_task TO anvione_app;
GRANT UPDATE(title,description,assignee_employee_id,status,priority,due_date,version) ON project_task TO anvione_app;
GRANT INSERT(id,tenant_id,entity_id,employee_id,project_id,task_id,work_date,minutes,note) ON time_entry TO anvione_app;
GRANT UPDATE(status,version,decision_note) ON time_entry TO anvione_app;

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
 'time.logged.v1','time.withdrawn.v1','time.approved.v1','time.rejected.v1'
));
