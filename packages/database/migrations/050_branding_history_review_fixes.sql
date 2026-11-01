-- Review fixes for 049 (which stays as applied):
-- * No-op updates (NEW IS NOT DISTINCT FROM OLD) are not recorded and not refused.
-- * changed_by is truncated to the column limit so long labels cannot fail the CHECK.
-- * The history triggers fire ALWAYS, so session_replication_role=replica cannot skip them.
--   Only the (trusted) migration owner can alter or disable triggers.
DO $$ BEGIN
 IF current_user IN ('anvione_app','anvione_worker','anvione_candidate','anvione_identity_operator') THEN
  RAISE EXCEPTION 'Migrations must run as the migration role, not %', current_user;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION record_branding_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 src text := coalesce(nullif(current_setting('app.branding_source',true),''),'edit');
 why text := nullif(current_setting('app.branding_reason',true),'');
 restored integer := nullif(current_setting('app.branding_restored_version',true),'')::integer;
 old_row record;
BEGIN
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
  RETURN NULL;
 END IF;
 IF TG_OP='UPDATE' AND NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'Branding publishes exactly one new version at a time' USING ERRCODE='BR001';
 END IF;
 IF src NOT IN ('edit','rollback') THEN
  RAISE EXCEPTION 'Unknown branding change source' USING ERRCODE='BR001';
 END IF;
 IF src='rollback' THEN
  SELECT * INTO old_row FROM public.branding_history h
  WHERE h.tenant_id=NEW.tenant_id AND h.entity_id=NEW.entity_id AND h.version=restored;
  IF NOT FOUND OR (old_row.platform_name,old_row.employee_name,old_row.organization_name,old_row.theme)
     IS DISTINCT FROM (NEW.platform_name,NEW.employee_name,NEW.organization_name,NEW.theme) THEN
   RAISE EXCEPTION 'A rollback must restore a recorded version exactly' USING ERRCODE='BR001';
  END IF;
 ELSE
  restored := NULL;
 END IF;
 INSERT INTO public.branding_history(tenant_id,entity_id,version,platform_name,employee_name,
  organization_name,theme,source,restored_version,changed_by,reason)
 VALUES (NEW.tenant_id,NEW.entity_id,NEW.version,NEW.platform_name,NEW.employee_name,
  NEW.organization_name,NEW.theme,src,restored,
  left(coalesce(nullif(current_setting('app.actor_label',true),''),'System'),200),why);
 RETURN NULL;
END $$;
ALTER FUNCTION record_branding_history() OWNER TO anvione_branding_keeper;
REVOKE ALL ON FUNCTION record_branding_history() FROM PUBLIC;

ALTER TABLE branding ENABLE ALWAYS TRIGGER branding_history_record;
ALTER TABLE branding_history ENABLE ALWAYS TRIGGER branding_history_immutable;
ALTER TABLE branding_history ENABLE ALWAYS TRIGGER branding_history_no_truncate;

COMMENT ON TABLE branding IS 'Every change must bump version by exactly 1; each version is recorded once in branding_history (no-op updates are ignored).';
