-- Workforce insights read approved leave by year and month for a whole entity.
-- The existing indexes lead with employee or manager, so this one serves the
-- state + date range scans without touching row-level security or grants.
CREATE INDEX leave_request_window_idx
  ON leave_request(tenant_id, entity_id, state, start_date);
