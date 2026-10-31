# Projects, tasks and time tracking (PRJ-01)

Workflow module from the HRMS plan, linked from the backlog (PRJ-01), the README and the traceability matrix.

## Goal

Managers and HR run projects with members and tasks; people log time against the projects they belong to; project owners or HR approve that time. Time is recorded for approval only and does not feed payroll or billing.

## Who does what

| Role                                      | Can                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Employee, manager (`project.self`)        | See projects they own or belong to, update the status of tasks assigned to them, log time on active projects, withdraw their own waiting entries |
| Manager (`project.manage`, team)          | Create projects they own, manage members and tasks, approve or reject time from members of projects they own                                     |
| HR admin (`project.manage`, organization) | Everything above for any project, assign owners, reopen closed projects, decide any time entry (including an owner's own)                        |
| Auditor, platform admin                   | No access                                                                                                                                        |

Nobody decides their own time. An owner's own time goes to HR.

## Lifecycle and rules

- **Project:** planned, active, on hold, completed or cancelled. Completed and cancelled projects are read-only; only HR can reopen one.
- **Members and tasks:** members are current employees; removal is a soft removal refused while the person still has open tasks. Tasks are assigned only to active members.
- **Time entries:** logged by a member or owner for themselves on an active project; work date today or up to 60 days back; 15 to 720 minutes in 15-minute steps; at most 24 hours a day per person across all projects, held under a lock so two entries cannot both pass. Approved, rejected and withdrawn entries are final.
- Everything is versioned, audited and written to the outbox in one transaction; no row is ever deleted.

## Limits

- No billing, rates, budgets or payroll link; no weekly timesheet submission step (entries are approved one by one).
- The `lead` member role is a label only. Task status can move in any direction for the assignee.
- Time that was already logged can still be decided after a project closes.
- Names copied onto rows (owner, member, person) are not refreshed when someone is renamed.
- Owners who are plain employees (not managers) cannot see or decide others' time; HR should pick managers as owners.

## Tests

- Integration (`tests/projects.integration.ts`): visibility, the full flow, the refusals (own time, owner's own time, non-members, closed projects, dates, steps, the 24-hour cap), direct-statement refusals, audit and outbox, concurrency, ownership-transfer race.
- Browser (`tests/e2e/projects.spec.ts`): HR creates a project, adds a member and a task; the member logs and withdraws time; axe in light and dark; no sideways scroll at 390 px. Approve and reject run through the API tests because the demo person holds every role.
