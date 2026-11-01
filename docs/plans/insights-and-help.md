# Insights and Help centre

Decision record: [ADR 0007](../adr/0007-adaptive-component-kit.md).

## Goal

Give managers and HR a quick, trustworthy picture of their workforce, and give everyone short answers for everyday tasks, without adding any new way to see people's records.

## Insights

- Endpoint `GET /api/v1/insights`, permission `insights.read` (manager: team, HR admin: entity; employees, auditors and platform admins are refused).
- The response is strict and counts-only: totals, department and location counts, joiners by month, approved leave days by month and type, open and today's leave, and check-ins per day for 14 days. It contains no names, IDs, e-mail addresses or codes.
- Every query runs in the caller's scoped transaction. Row-level security on the employee directory view, leave requests and attendance limits each figure to what that role may already see; leave counts also require the person to be visible, so they follow the current reporting line like headcount.
- Small groups: a manager with one report can tell that person's leave or attendance, and HR can identify a one-person department. Both can already open those records, so nothing new is revealed. If the permission is ever given to a role without record access, hide groups below a minimum size.
- Load: about eight aggregate queries per view. Migration 021 adds `leave_request_window_idx (tenant_id, entity_id, state, start_date)`; month joins use date ranges; the portal caches the response for 60 seconds.

## Help centre

Static, searchable articles written from what the product does today. Nothing refers to features that are not built (payroll, notifications, the AI helper).

## Tests

- Integration (`tests/insights.integration.ts`): anonymous refused; HR counts match the directory and are internally consistent; a manager sees the team's total; employee, auditor and platform admin get 403; the response carries no personal keys.
- Unit: `insights.read` scope per role.
- Browser (`tests/e2e/insights.spec.ts`): figures count up, five charts each with a table, axe in light and dark, manager scope text, employee has no link and sees the denial, one column and no sideways scroll at 390 px; Help search, filtering, empty result and clearing.

## Review

An Opus security review found no critical, high or medium issues. Its two low findings were applied: leave counts now follow the visible reporting line, and the queries are date-bounded with a supporting index.

## Not included

Trend comparisons against earlier periods, exports, and per-person drill-downs. Each needs its own access decision.
