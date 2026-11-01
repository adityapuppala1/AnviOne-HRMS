# F0.10: Leave ledger and approval workflow

Authoritative implementation plan, 25 October 2026. Advances LVE-01. All records remain synthetic.

## Outcome

Employees and managers can see their annual leave balances, request leave for working days, and cancel their own requests. The direct manager decides a request; requests from people without a manager go to HR. Nobody can decide their own request. Approved leave is debited to an append-only ledger; cancelling approved future leave writes a reversal rather than editing history.

Acceptance requires self-only requests, direct-manager or HR decisions, overlap and balance enforcement under concurrency, versioned transitions, audit/outbox in the same commit, and a responsive, accessible Loom screen.

## Approach

- Migration 015 adds FORCE-RLS `leave_type`, `leave_request` and append-only `leave_ledger`. Default types per legal entity: Casual 12, Sick 12, Earned 15 paid days; Leave without pay is uncapped and unpaid.
- A `SECURITY DEFINER` guard owned by a NOLOGIN `anvione_leave_keeper` binds the requester to `app.employee_id`, snapshots the approver at submission, counts Monday–Friday days, rejects overlaps and over-balance requests under a per-employee advisory lock, and validates every transition. An `AFTER UPDATE` trigger writes ledger debits/reversals.
- Permissions: `leave.request` (Employee/Manager self) and `leave.approve` (Manager team, HR entity), exposed as `app.leave_scope`.
- Endpoints: `GET /leave`, `POST /leave/requests`, `POST /leave/requests/:id/cancel`, `GET /leave/approvals`, `POST /leave/requests/:id/decision`.
- Portal route `/leave`: balance rails, a request dialog, a request timeline, and an approvals lane for managers/HR.

## Decisions

- Balance = annual entitlement − approved debits + reversals − pending requests, per calendar year. No accrual, proration, carry-forward or encashment yet.
- A request cannot span calendar years and must start between 7 days ago and 365 days ahead.
- Approved leave can be cancelled by the requester only before it starts.
- HR sees all entity requests but decides only those routed to HR; managers decide only their current direct reports, and a decider must still be employed.
- The HR admin role approves but does not request leave; an HR person requests their own leave from their Employee or Manager role, matching the existing role-context separation.

## Boundaries

No holiday calendar, half days, comp-off, policy administration UI, attendance/LOP linkage, payroll effect, notification delivery or delegation. Reasons are free text; the UI asks people not to include medical details.

## Verification

- Contract tests reject unknown fields, bad dates and short notes.
- Integration tests prove self-only requests, overlap/balance rejection, concurrent double-submit, manager vs HR routing, self-approval denial, stale versions, ledger debit/reversal, audit/outbox and RLS isolation.
- Browser tests request leave, approve it as manager, and cover axe, light/dark and viewport fit.

## Recovery

Disable the route and endpoints; keep ledger and audit history. Rollback is forward-only: cancel pending requests rather than deleting rows.
