-- ORG-CHART: anyone with directory.read (self, team or entity) may look up the basic
-- reporting structure of their own legal entity: search people by name, title or
-- department, and open one person's neighbourhood (manager one level up, direct
-- reports one level down). This deliberately exposes ONLY id, name, initials, title,
-- department name, manager id and a direct-report count for active/notice people of
-- the caller's tenant and entity. RLS on employee/person/org_unit and the
-- employee_directory view are NOT widened and anvione_app gains no table access: the
-- two functions below run as a NOLOGIN keeper that can read only those columns,
-- only inside the session's tenant/entity, and only while a directory scope and an
-- employee context are set. Searches and neighbourhoods are not audited (structure
-- data, not personal records) and the search text is never stored or logged.
CREATE ROLE anvione_orgchart_keeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anvione_orgchart_keeper;

-- Column-level reads only: no email, code, location, joined date, phone or person details.
GRANT SELECT(id,tenant_id,entity_id,person_id,title,department_id,status,manager_id) ON employee TO anvione_orgchart_keeper;
GRANT SELECT(id,tenant_id,name,initials) ON person TO anvione_orgchart_keeper;
GRANT SELECT(id,tenant_id,entity_id,kind,name) ON org_unit TO anvione_orgchart_keeper;

-- Even the keeper sees only the session's tenant (and entity, where the table has one).
CREATE POLICY employee_orgchart_keeper ON employee FOR SELECT TO anvione_orgchart_keeper USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
);
CREATE POLICY person_orgchart_keeper ON person FOR SELECT TO anvione_orgchart_keeper USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
);
CREATE POLICY org_unit_orgchart_keeper ON org_unit FOR SELECT TO anvione_orgchart_keeper USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
 AND kind='department'
);

-- Counting direct reports and finding them by manager is the hot path.
CREATE INDEX employee_manager_idx ON employee(tenant_id,entity_id,manager_id);

-- The session context both functions require; refuses (42501) when any part is missing.
CREATE FUNCTION org_chart_context() RETURNS TABLE(tenant_id uuid, entity_id uuid)
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 t uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
 en uuid := nullif(current_setting('app.entity_id',true),'')::uuid;
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 scope text := coalesce(current_setting('app.directory_scope',true),'none');
BEGIN
 IF t IS NULL OR en IS NULL OR me IS NULL OR scope NOT IN ('self','team','entity') THEN
  RAISE EXCEPTION 'The organization chart is not available in this session' USING ERRCODE='42501';
 END IF;
 tenant_id := t;
 entity_id := en;
 RETURN NEXT;
END $$;

-- Up to p_limit (1-10) active/notice people whose name, title or department contains
-- the 2-60 character text literally (% and _ are escaped). Anything else: no rows.
CREATE FUNCTION org_chart_search(p_query text, p_limit integer)
RETURNS TABLE(id uuid, name text, initials text, title text, department text, manager_id uuid, direct_report_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 -- A statement of its own, so the refusal never depends on the plan reaching it.
 SELECT public.org_chart_context();
 WITH c AS (SELECT * FROM public.org_chart_context()),
 q AS (
  SELECT '%'||replace(replace(replace(btrim(p_query),'\','\\'),'%','\%'),'_','\_')||'%' AS pattern
  WHERE char_length(btrim(coalesce(p_query,''))) BETWEEN 2 AND 60 AND p_limit BETWEEN 1 AND 10
 ),
 hits AS (
  SELECT e.id,p.name,p.initials,e.title,d.name AS department,e.manager_id,e.tenant_id,e.entity_id
  FROM c CROSS JOIN q
  JOIN public.employee e ON e.tenant_id=c.tenant_id AND e.entity_id=c.entity_id AND e.status IN ('active','notice')
  JOIN public.person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
  JOIN public.org_unit d ON d.tenant_id=e.tenant_id AND d.entity_id=e.entity_id AND d.kind='department' AND d.id=e.department_id
  WHERE p.name ILIKE q.pattern ESCAPE '\' OR e.title ILIKE q.pattern ESCAPE '\' OR d.name ILIKE q.pattern ESCAPE '\'
  ORDER BY p.name,e.id
  LIMIT p_limit
 )
 SELECT h.id,h.name,h.initials,h.title,h.department,
  (SELECT m.id FROM public.employee m WHERE m.tenant_id=h.tenant_id AND m.entity_id=h.entity_id
    AND m.id=h.manager_id AND m.status IN ('active','notice')),
  (SELECT count(*)::int FROM public.employee r WHERE r.tenant_id=h.tenant_id AND r.entity_id=h.entity_id
    AND r.manager_id=h.id AND r.status IN ('active','notice'))
 FROM hits h ORDER BY h.name,h.id;
$$;

-- One person's neighbourhood: relation 'focus', then 'manager' (when active/notice),
-- then up to p_report_cap (1-201) direct reports by name. Unknown, inactive or
-- other-entity ids return no rows. One level each way, so reporting loops cannot recurse.
CREATE FUNCTION org_chart_neighborhood(p_employee uuid, p_report_cap integer)
RETURNS TABLE(relation text, id uuid, name text, initials text, title text, department text, manager_id uuid, direct_report_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 -- A statement of its own, so the refusal never depends on the plan reaching it.
 SELECT public.org_chart_context();
 WITH c AS (SELECT * FROM public.org_chart_context()),
 f AS (
  SELECT e.id,e.manager_id,e.tenant_id,e.entity_id FROM c
  JOIN public.employee e ON e.tenant_id=c.tenant_id AND e.entity_id=c.entity_id
   AND e.id=p_employee AND e.status IN ('active','notice')
  WHERE p_report_cap BETWEEN 1 AND 201
 ),
 ids AS (
  SELECT 0 AS rank,'focus'::text AS relation,f.id FROM f
  UNION ALL
  SELECT 1,'manager',m.id FROM f JOIN public.employee m ON m.tenant_id=f.tenant_id AND m.entity_id=f.entity_id
   AND m.id=f.manager_id AND m.status IN ('active','notice')
  UNION ALL
  (SELECT 2,'report',r.id FROM f JOIN public.employee r ON r.tenant_id=f.tenant_id AND r.entity_id=f.entity_id
    AND r.manager_id=f.id AND r.status IN ('active','notice')
   JOIN public.person rp ON rp.tenant_id=r.tenant_id AND rp.id=r.person_id
   ORDER BY rp.name,r.id LIMIT p_report_cap)
 )
 SELECT i.relation,e.id,p.name,p.initials,e.title,d.name,
  (SELECT m.id FROM public.employee m WHERE m.tenant_id=e.tenant_id AND m.entity_id=e.entity_id
    AND m.id=e.manager_id AND m.status IN ('active','notice')),
  (SELECT count(*)::int FROM public.employee r WHERE r.tenant_id=e.tenant_id AND r.entity_id=e.entity_id
    AND r.manager_id=e.id AND r.status IN ('active','notice'))
 FROM ids i CROSS JOIN c
 JOIN public.employee e ON e.tenant_id=c.tenant_id AND e.entity_id=c.entity_id AND e.id=i.id
 JOIN public.person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
 JOIN public.org_unit d ON d.tenant_id=e.tenant_id AND d.entity_id=e.entity_id AND d.kind='department' AND d.id=e.department_id
 ORDER BY i.rank,p.name,e.id;
$$;

ALTER FUNCTION org_chart_context() OWNER TO anvione_orgchart_keeper;
ALTER FUNCTION org_chart_search(text,integer) OWNER TO anvione_orgchart_keeper;
ALTER FUNCTION org_chart_neighborhood(uuid,integer) OWNER TO anvione_orgchart_keeper;
REVOKE ALL ON FUNCTION org_chart_context(),org_chart_search(text,integer),org_chart_neighborhood(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org_chart_search(text,integer),org_chart_neighborhood(uuid,integer) TO anvione_app;
