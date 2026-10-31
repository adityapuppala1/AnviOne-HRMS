# F0.11: Attendance, provisional LOP and corrections

Authoritative implementation plan, 25 October 2026. Advances ATT-01. All records remain synthetic; nothing affects pay.

## Outcome

Employees and managers check in and out for the current business day using server time in the legal entity's time zone. A 30-day view shows each day as present, on leave, weekend, incomplete, or unaccounted. Unaccounted past working days are labelled provisional LOP: a review flag, never a deduction. For a past day, the employee can request a correction with times and a reason. Their current manager decides it, or HR when they have no manager. Approval rewrites that day's record with an audit trail. Managers and HR see a live board of who is in today.

## Approach

- Migration 016 adds FORCE-RLS `attendance_record` (one per employee per date, local `time` check-in/check-out) and `attendance_correction` (versioned workflow, approver snapshot, one pending correction per day).
- `SECURITY DEFINER` guards owned by NOLOGIN `anvione_attendance_keeper`:
  - Punches are self-only, today-only and stamped from the server clock; clients cannot choose times.
  - Corrections must be for one of the previous 30 days, have ordered times and a reason, and follow leave's decision rules: no self-decision, current manager or HR, decider still employed.
  - An approved correction is applied by an `AFTER UPDATE` trigger. The record guard accepts a correction write only when it matches an approved correction exactly.
- Permissions: `attendance.self` (Employee/Manager self) and `attendance.review` (Manager team, HR entity), exposed as `app.attendance_scope`.
- Endpoints: `GET /attendance`, `POST /attendance/check-in`, `POST /attendance/check-out`, `POST /attendance/corrections`, `POST /attendance/corrections/:id/cancel`, `GET /attendance/team`, `POST /attendance/corrections/:id/decision`.
- Portal route `/attendance`: a day thread from 06:00 to 22:00 with the check-in/out action, a 30-day status grid with day detail and a correction dialog, the correction history, and a team board with correction approvals.

## Decisions

- Day status is derived on read, not stored. Approved leave takes precedence over missing punches; weekends are Saturday and Sunday until a holiday/shift calendar exists.
- Overnight shifts are out of scope: check-out must be later the same local day.
- Provisional LOP is informational. No payroll record, deduction or notification is created.
- The HR admin role reviews but does not punch; HR people record their own attendance from Employee or Manager roles, as with leave.

## Boundaries

No geofencing, devices or biometric sources, shifts, holidays, overtime, regularisation policies, bulk corrections, notifications, payroll effect or attendance export.

## Verification

- Contract tests reject client-chosen punch times, bad dates and unordered times.
- Integration tests prove self-only punches, double check-in, check-out ordering, correction window, a single pending correction per day, routing, no self-decision, a stale manager, application on approval, RLS isolation, and audit/outbox.
- Browser tests check in/out, request and cancel a correction, view the team board, and cover axe, dark mode and the 390px width.

## Recovery

Disable the route and endpoints; keep records, corrections and audit. Rollback is forward-only.
