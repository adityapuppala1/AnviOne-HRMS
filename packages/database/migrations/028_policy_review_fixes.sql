-- POL-01 review: an audience department removed later must not block superseding or withdrawing;
CREATE OR REPLACE FUNCTION guard_policy_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 label text := coalesce(nullif(current_setting('app.actor_label',true),''),'HR');
 managed text[] := ARRAY['title','summary','body','effective_on','requires_acknowledgement','audience_department_id','status','version','published_at','published_by_label'];
BEGIN
 IF coalesce(current_setting('app.policy_scope',true),'none')<>'entity'
   OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'Only HR manages policies' USING ERRCODE='PL005';
 END IF;
 IF NEW.audience_department_id IS NOT NULL
   AND (TG_OP='INSERT' OR NEW.audience_department_id IS DISTINCT FROM OLD.audience_department_id) AND NOT EXISTS(SELECT 1 FROM org_unit o
   WHERE o.tenant_id=NEW.tenant_id AND o.entity_id=NEW.entity_id AND o.id=NEW.audience_department_id
    AND o.kind='department') THEN
  RAISE EXCEPTION 'Choose a department that exists' USING ERRCODE='PL003';
 END IF;
 IF TG_OP='INSERT' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('policy:'||NEW.policy_id::text,0));
  IF NOT EXISTS(SELECT 1 FROM policy p WHERE p.id=NEW.policy_id AND p.tenant_id=NEW.tenant_id AND p.entity_id=NEW.entity_id) THEN
   RAISE EXCEPTION 'This policy does not exist' USING ERRCODE='PL004';
  END IF;
  NEW.version_number := coalesce((SELECT max(v.version_number) FROM policy_version v WHERE v.policy_id=NEW.policy_id),0)+1;
  NEW.status := 'draft';
  NEW.version := 1;
  NEW.created_by_label := label;
  NEW.created_at := now();
  NEW.published_at := NULL;
  NEW.published_by_label := NULL;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-managed) IS DISTINCT FROM (to_jsonb(OLD)-managed) OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'A policy version changes only through editing a draft, publishing or withdrawing' USING ERRCODE='PL004';
 END IF;
 IF NEW.status=OLD.status THEN
  IF OLD.status<>'draft' THEN
   RAISE EXCEPTION 'Published wording cannot be changed; publish a new version' USING ERRCODE='PL004';
  END IF;
  RETURN NEW;
 END IF;
 IF NOT (
  (OLD.status='draft' AND NEW.status IN ('published','withdrawn'))
  OR (OLD.status='published' AND NEW.status IN ('superseded','withdrawn'))
 ) THEN
  RAISE EXCEPTION 'That policy status change is not allowed' USING ERRCODE='PL004';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','version','published_at','published_by_label'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','published_at','published_by_label']) THEN
  RAISE EXCEPTION 'The wording cannot change while the status changes' USING ERRCODE='PL004';
 END IF;
 IF NEW.status='published' THEN
  NEW.published_at := now();
  NEW.published_by_label := label;
 ELSE
  NEW.published_at := OLD.published_at;
  NEW.published_by_label := OLD.published_by_label;
 END IF;
 RETURN NEW;
END $$;
