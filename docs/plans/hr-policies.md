# HR policies (POL-01)

Workflow module from the HRMS plan, linked from the backlog (POL-01), the README and the traceability matrix.

## Goal

HR publishes versioned policies to everyone or to one department, and keeps evidence of who has read and acknowledged the current version.

## Who does what

| Role                                             | Can                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| HR admin (`policy.manage`, organization scope)   | Create policies, draft and edit versions, publish, withdraw with a reason, see the full history and who has acknowledged |
| Employee and manager (`policy.self`, self scope) | Read published policies addressed to them, acknowledge the current version once                                          |
| Auditor, platform admin                          | No access; changes appear in the activity log                                                                            |

Acknowledgement belongs to the person, so a user who holds both HR and employee roles acknowledges in the Employee context. A pure HR-admin identity is counted in the audience but cannot acknowledge; this is a known limit.

## Lifecycle

A version is `draft` → `published` → `superseded` (when a newer version is published) or `withdrawn`. Only one draft and one published version exist per policy. Wording is editable only while a draft; published wording never changes. A new version needs a fresh acknowledgement.

## Rules the database enforces

- Only HR writes policies; only the person acknowledges, once, for themselves, and only the current published version addressed to them.
- Published wording and identity fields are immutable; allowed status moves only; no deletes on any table.
- Employees only see published versions addressed to everyone or their department.
- Every change is versioned (stale edits conflict) and writes an audit record and an outbox event in one transaction.

## Review

An Opus review found no critical or high issues. Applied: exact compliance totals beyond 500 people, and department checks no longer block superseding or withdrawing (migration 028). Recorded, not changed: the policy list caps versions rather than policies at 500, and new drafts are logged as `policy.draft_updated`.

## Tests

- Integration (`tests/policies.integration.ts`, 9 checks): versions, publish and supersede, acknowledgement once, audience, role access, audit and outbox, direct-statement refusals.
- Browser (`tests/e2e/policies.spec.ts`): HR drafts and publishes; the employee reads and acknowledges; HR sees the evidence; axe in light and dark; no sideways scroll at 390 px. The device audit covers `/policies`.
