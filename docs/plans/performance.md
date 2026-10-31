# Performance basics (PERF-01)

Workflow module from the HRMS plan, linked from the backlog (PERF-01) and [the benchmark](../research/hrms-benchmark.md) ("Performance basics: goals/OKRs and review cycles with manager and self review"). This slice is the backend only: migrations `056_performance.sql`, `057_performance_review_fixes.sql` (self security review) and `058_performance_security_fixes.sql` (independent review: perf_sees_entry scoped to the caller's tenant and entity, one alignment error that never reveals a goal's existence or status, percent progress limited to 0..100, TRUNCATE blocked), `apps/api/src/performance.store.ts` and `performance.controller.ts`, contracts and `tests/perf.integration.ts`. 360 feedback is not part of it.

## Goal

Employees, their managers and HR set goals (objectives with measurable key results) and record progress against them, and HR runs review cycles in which each person writes a self-review, their manager writes a manager review, and HR finalises a rating with a reason.

## Who does what

| Role                                    | Can                                                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HR admin (`performance.manage`, entity) | Everything on goals for anyone in the entity; open, close and cancel review cycles; see every review; finalise reviews (never their own, nor one where they are the manager) |
| Manager (`performance.review`, team)    | Goals for themselves and their direct reports; manager reviews for the people they review in a cycle; see their own review and their reports' reviews                        |
| Employee (`performance.self`, self)     | Their own goals and progress; their own self-review; their own results once finalised                                                                                        |
| Auditor, platform admin                 | No access                                                                                                                                                                    |

"Team" means direct reports (`employee.manager_id`). For a review, the manager is snapshotted when the cycle opens.

## How it works

- **Goals (objectives):** owner, title, optional description, period (start and end, at most 366 days), optional alignment to a parent goal (your own draft or active goals, your manager's active goals, or for HR any active goal; someone else's draft is never listed or alignable; loops are refused), status draft, active, completed or cancelled. Activating needs at least one key result; cancelling needs a reason. Completed and cancelled goals are final. The period changes only while a draft. `GET /performance/objectives/alignable?ownerId=` lists the goals someone may align to (id, title, owner name only).
- **Key results:** up to 10 per goal, each with a unit (number, percent, currency, hours), a start value and a target (they must differ). Targets are edited only while the goal is a draft. Progress is recorded as append-only updates (value and an optional note) while the goal is active; the current value is always the latest update and progress is `(current - start) / (target - start)`, clamped to 0..100. A goal's progress is the average of its key results. Updates are never edited or deleted.
- **Review cycles:** HR creates a draft (name, period, self-review due date, manager-review due date, optional department; none means the whole entity), edits it while draft, then opens it. Opening generates one review for each active or notice-period employee in scope who has a manager; people without a manager are skipped and counted. A cycle closes only when every review is finalised; only a draft can be cancelled.
- **Reviews:** self pending, then manager pending, then calibration, then finalised. The employee rates five fixed competencies (quality, delivery, collaboration, ownership, growth) from 1 to 5 with an optional comment; then the manager does the same. Reviews are blind, like scorecards: the manager cannot see the self-review until they have submitted their own, and the employee sees the manager review only once the review is finalised. HR finalises with a final rating (1 to 5) and a reason of 10 to 500 characters; HR cannot finalise their own review or one they reviewed as manager. When HR is also the employee or manager on a review, they see it under those rules, not as HR. Submitted entries and finalised reviews never change.
- **Ratings are human inputs only.** There is no AI scoring, suggestion or summarising. The `overall` on an entry is the plain average of its five ratings.
- **Audit and outbox:** every write records an audit event and an outbox event in the same transaction with ids, statuses and counts only. Titles, names, comments, reasons, ratings and key-result values never appear in either.
- **Concurrency:** every change carries the row's `version`; a stale version gets 409. Writes serialise on per-goal, per-cycle and per-review advisory locks.
- **Errors:** database guards raise `PF003` (400), `PF004` (409) and `PF005` (403).

## Limits

- No 360 or peer feedback, no calibration grid, no rating distribution or forced ranking, no goal weights, no check-in reminders or notifications, no due-date enforcement (due dates are shown, late submissions are accepted while the cycle is open).
- People who join after a cycle opens, or whose manager changes, are not added or re-routed; open a new cycle.
- People without a manager are not reviewed in a cycle. If the reviewing manager leaves mid-cycle the review waits at manager pending; there is no reassignment.
- Finalising needs an HR user who is neither the employee nor their manager; an entity whose only HR user manages everyone cannot finalise.
- A manager can edit, complete and cancel their direct reports' goals as well as see them.
- Key results cannot be removed; cancel the goal and create another.
- Results are not linked to compensation or payroll.

## Tests

- Integration (`tests/perf.integration.ts`, port 4517): role access (auditor and platform admin refused), visibility scope (employee own, manager team, HR entity), tenant isolation, goal lifecycle and alignment rules, append-only progress history and derived progress, cycle open and generation, blind reviews, immutability of entries and finalised reviews, four-eyes finalisation, direct statements as the app role refused, optimistic concurrency, pagination, and no personal or free-text values in audit or outbox.
