# F0.12: Holiday and work-week calendar

Authoritative implementation plan, 25 October 2026. Closes the largest shared gap in LVE-01 and ATT-01. All records remain synthetic.

## Outcome

HR maintains a working week and holidays for the legal entity. A holiday applies either entity-wide or to one work location. Everyone sees the year's holidays and the next one coming up. Leave counts only business days for the requester's location. Attendance shows holidays as holidays and uses the work week instead of a fixed Saturday/Sunday weekend.

## Approach

- Migration 017 adds FORCE-RLS `work_week` (one row per entity, ISO weekday array, versioned; defaults to Monday–Friday) and `holiday` (date, name, optional location, active flag, versioned). There is at most one active holiday per date and scope.
- Writes reuse the existing HR organization scope (`app.hr_scope='write'`); every authenticated workspace reads its entity's calendar. Guards keep date and location immutable, version every change, and require changes to happen in place.
- `calendar_business_days(tenant, entity, employee, start, end)` is a STABLE `SECURITY DEFINER` function owned by NOLOGIN `anvione_calendar_keeper`. The leave guard is replaced to use it, so new requests count business days only. Existing requests keep the days recorded at submission.
- Endpoints: `GET /calendar?year=`, `POST /calendar/holidays`, `PUT /calendar/holidays/:id`, `PUT /calendar/work-week`. Audit and outbox records commit with each change.
- The leave overview carries the requester's calendar so the request dialog counts days exactly as the server does. Attendance days and the team board gain a `holiday` status.
- Portal route `/calendar`: the next-holiday hero, a 12-month holiday loom, and, for HR, holiday and work-week editors with a mandatory reason.

## Decisions

- Optional or restricted holidays, regional calendars beyond one location, and half-day holidays are out of scope.
- Changing the calendar does not recalculate submitted leave. The ledger stays as approved, and HR cancels and re-requests when needed.
- Seeded holidays are illustrative synthetic examples, not a statutory list.

## Verification

- Contract tests: ISO weekday sets, date and name bounds, reasons, strict bodies.
- Integration tests: HR-only writes, immutable date and location, versioning and concurrency, duplicate active date, location-scoped holidays reducing leave days only for that location, work-week changes, attendance holiday status, RLS isolation, audit and outbox.
- Browser tests: view holidays, add and deactivate a holiday as HR, change the work week, plus axe, dark mode and the 390px width.

## Recovery

Deactivate rather than delete. Rollback is forward-only.
