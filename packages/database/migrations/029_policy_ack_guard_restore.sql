-- Restores the acknowledgement guard: the keeper role has SELECT only, so FOR SHARE is not allowed.
-- An acknowledgement on a just-superseded version stays truthful evidence, so no lock is needed.
CREATE OR REPLACE FUNCTION guard_policy_acknowledgement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 scope text := coalesce(current_setting('app.policy_scope',true),'none');
 v record;
 department uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'Acknowledgements are permanent' USING ERRCODE='PL004';
 END IF;
 IF me IS NULL OR NEW.employee_id<>me OR scope NOT IN ('self','team')
   OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR NEW.entity_id IS DISTINCT FROM nullif(current_setting('app.entity_id',true),'')::uuid THEN
  RAISE EXCEPTION 'You can only acknowledge a policy for yourself' USING ERRCODE='PL005';
 END IF;
 SELECT pv.status, pv.requires_acknowledgement, pv.audience_department_id INTO v
  FROM policy_version pv WHERE pv.id=NEW.policy_version_id AND pv.tenant_id=NEW.tenant_id AND pv.entity_id=NEW.entity_id;
 IF NOT FOUND OR v.status<>'published' THEN
  RAISE EXCEPTION 'Only the current published version can be acknowledged' USING ERRCODE='PL004';
 END IF;
 IF NOT v.requires_acknowledgement THEN
  RAISE EXCEPTION 'This policy does not need acknowledgement' USING ERRCODE='PL004';
 END IF;
 SELECT e.department_id INTO department FROM employee e
  WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id AND e.id=me AND e.status IN ('active','notice');
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Only current employees acknowledge policies' USING ERRCODE='PL005';
 END IF;
 IF v.audience_department_id IS NOT NULL AND v.audience_department_id IS DISTINCT FROM department THEN
  RAISE EXCEPTION 'This policy is not addressed to you' USING ERRCODE='PL005';
 END IF;
 NEW.acknowledged_at := now();
 RETURN NEW;
END $$;
