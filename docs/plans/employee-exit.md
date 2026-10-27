# Employee exit (EXT-01)

Workflow module from the HRMS plan, linked from the backlog (EXT-01), the README and the traceability matrix. It builds on [company assets](company-assets.md): an exit cannot finish while the person still holds equipment.

## Goal

A person can resign, HR can accept the exit and set a last working day, five clearances are worked through, and HR completes the exit so the person's access ends. Every step is recorded.

## Who does what

| Role                                         | Can                                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Employee, manager (`exit.self`, self scope)  | Submit their own resignation, see its progress and clearances, withdraw it while it is still waiting for HR                  |
| HR admin (`exit.manage`, organization scope) | Start an exit for anyone, accept (setting the last working day) or reject, clear or waive items, complete, withdraw, see all |
| Auditor, platform admin                      | No access; changes appear in the activity log                                                                                |

HR cannot decide on their own exit; another HR admin must.

## Lifecycle

`submitted` → `accepted` (clearances are created) → `completed`. A case can also be `rejected` (needs a reason) or `withdrawn` (an accepted case needs a reason). Closed cases are final. Only one open case exists per person.

Clearances: assets, finance, IT access, manager handover, HR documents. Each is cleared or waived (a waiver needs a note). The assets item cannot be cleared or waived while the person holds equipment that has not been returned.

## Effect on the person

Accepting moves the person to notice. Completing makes them inactive: sign-in is refused and existing sessions stop working on the next request. Withdrawing an accepted case returns them to active.

## Rules the database enforces

- Only HR decides; people only submit and withdraw their own case; the notice date of a resignation is today.
- Allowed steps only; the last working day is on or after the notice date and within 180 days.
- Completion needs every clearance done and no unreturned equipment, checked under the same lock that issuing equipment takes.
- Cases and clearances are never deleted; every change is versioned, audited and recorded in the outbox in one transaction.

## Limits

- External systems (email, directory, payroll) are not touched; no sessions or identity bindings are rewritten, they simply stop resolving.
- Access ends when HR completes the case, not automatically on the last working day.
- No dues calculation or final settlement (needs Payroll); the finance clearance is a manual confirmation.
- The employee cannot propose a last working day; HR sets it.

## Tests

- Integration (`tests/exit.integration.ts`): role access, submit and withdraw, the full flow including asset recovery, rejection, audit and outbox, direct-statement refusals.
- Browser (`tests/e2e/exit.spec.ts`): an employee submits and HR accepts, clears, and completes; axe in light and dark; no sideways scroll at 390 px. The device audit covers `/exit`.
