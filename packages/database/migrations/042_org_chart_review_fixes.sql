-- Review fixes for 041 (041 stays as applied):
-- * org_chart_context() also refuses a session whose employee id is not an active or
--   notice-period employee of the session's own tenant and entity (forged/stale ids).
-- * Both functions carry a function-level statement_timeout of 2s on top of the pool's 5s.
--   No trigram index yet: entities are small; add pg_trgm on person.name if they grow.
-- * The department is LEFT JOINed, so a person without a department in their entity
--   still appears, with department NULL.
-- CREATE OR REPLACE keeps the keeper ownership, the PUBLIC revoke and the app grant.
CREATE OR REPLACE FUNCTION org_chart_context() RETURNS TABLE(tenant_id uuid, entity_id uuid)
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 t uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
 en uuid := nullif(current_setting('app.entity_id',true),'')::uuid;
 me uuid := nullif(current_setting('app.employee_id',true),'')::uuid;
 scope text := coalesce(current_setting('app.directory_scope',true),'none');
BEGIN
 IF t IS NULL OR en IS NULL OR me IS NULL OR scope NOT IN ('self','team','entity')
   OR NOT EXISTS (SELECT 1 FROM public.employee e WHERE e.id=me AND e.tenant_id=t AND e.entity_id=en
     AND e.status IN ('active','notice')) THEN
  RAISE EXCEPTION 'The organization chart is not available in this session' USING ERRCODE='42501';
 END IF;
 tenant_id := t;
 entity_id := en;
 RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION org_chart_search(p_query text, p_limit integer)
RETURNS TABLE(id uuid, name text, initials text, title text, department text, manager_id uuid, direct_report_count integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp SET statement_timeout='2s' AS $$
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
  LEFT JOIN public.org_unit d ON d.tenant_id=e.tenant_id AND d.entity_id=e.entity_id AND d.kind='department' AND d.id=e.department_id
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
CREATE OR REPLACE FUNCTION org_chart_neighborhood(p_employee uuid, p_report_cap integer)
RETURNS TABLE(relation text, id uuid, name text, initials text, title text, department text, manager_id uuid, direct_report_count integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp SET statement_timeout='2s' AS $$
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
 LEFT JOIN public.org_unit d ON d.tenant_id=e.tenant_id AND d.entity_id=e.entity_id AND d.kind='department' AND d.id=e.department_id
 ORDER BY i.rank,p.name,e.id;
$$;

