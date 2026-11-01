-- Search hardening: trigram (pg_trgm) GIN indexes for the ILIKE '%term%' searches, which a
-- btree cannot serve. pg_trgm ships with the postgres:18 image used locally (contrib) and is
-- a trusted extension, so the migration role can create it.
-- Covered: org_chart_search (person name, job title, department name) and the organization
-- unit list (org_unit.name). Not covered on purpose: codes (short, exact-ish lookups) and the
-- employee_directory view search, whose OR spans joined tables so the planner cannot combine
-- per-table indexes; it scans one entity's rows, which is bounded.
-- Migrations run inside a transaction, so CREATE INDEX CONCURRENTLY is not possible here:
-- each build briefly blocks writes to its table (employee, person, org_unit). For a large
-- production table, build the same index CONCURRENTLY beforehand with the same name; the
-- IF NOT EXISTS below then skips it.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE INDEX IF NOT EXISTS person_name_trgm_idx ON person USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS employee_title_trgm_idx ON employee USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS org_unit_name_trgm_idx ON org_unit USING gin (name gin_trgm_ops);
-- Department members, for the department branch of the search (and department rosters).
CREATE INDEX IF NOT EXISTS employee_department_idx ON employee (tenant_id, entity_id, department_id);

-- org_chart_search: same contract and rows as 042, but matches are found per table and
-- unioned, so each ILIKE can use its trigram index (an OR across a join cannot).
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
 matched AS (
  SELECT e.id FROM c CROSS JOIN q
  JOIN public.employee e ON e.tenant_id=c.tenant_id AND e.entity_id=c.entity_id
  WHERE e.title ILIKE q.pattern ESCAPE '\'
  UNION
  SELECT e.id FROM c CROSS JOIN q
  JOIN public.person p ON p.tenant_id=c.tenant_id
  JOIN public.employee e ON e.tenant_id=p.tenant_id AND e.person_id=p.id AND e.entity_id=c.entity_id
  WHERE p.name ILIKE q.pattern ESCAPE '\'
  UNION
  SELECT e.id FROM c CROSS JOIN q
  JOIN public.org_unit d ON d.tenant_id=c.tenant_id AND d.entity_id=c.entity_id AND d.kind='department'
  JOIN public.employee e ON e.tenant_id=d.tenant_id AND e.entity_id=d.entity_id AND e.department_id=d.id
  WHERE d.name ILIKE q.pattern ESCAPE '\'
 ),
 hits AS (
  SELECT e.id,p.name,p.initials,e.title,d.name AS department,e.manager_id,e.tenant_id,e.entity_id
  FROM matched x
  JOIN public.employee e ON e.id=x.id AND e.status IN ('active','notice')
  JOIN public.person p ON p.tenant_id=e.tenant_id AND p.id=e.person_id
  LEFT JOIN public.org_unit d ON d.tenant_id=e.tenant_id AND d.entity_id=e.entity_id AND d.kind='department' AND d.id=e.department_id
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
