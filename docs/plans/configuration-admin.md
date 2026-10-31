# Configuration history and administration views (ADM-02)

Workflow module from the HRMS plan, linked from the backlog (ADM-02), the README and the traceability matrix. It builds on ADM-01 (named palettes and branding with version checks).

## Goal

Platform administrators can see how the workspace configuration changed over time and roll it back safely; platform administrators and auditors can see who holds which permission and which integrations are ready, without anything being editable at runtime.

## What it adds

| Area                  | Detail                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branding history      | Every published branding version is kept in an immutable history (who, when, why, edit or rollback or baseline). A trigger records every write path, so none can skip it.                                                       |
| Safe rollback         | Rolling back publishes a NEW version whose values equal the chosen old one; history is never rewritten. It needs the current version, a reason of 10-300 characters, and is audited.                                            |
| Permission matrix     | A read-only role by permission table with scopes, generated from the code-defined policy. It cannot edit anything.                                                                                                              |
| Integration readiness | A read-only list of integrations (sign-in, rate-limit store, document scanning, notifications, profile data keys, worker schedules, AI helper) with configured, not configured or demo status, and no secrets, URLs or key ids. |

## Who does what

| Role                        | Can                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Platform admin              | Read history, roll back branding, read the permission matrix and integration readiness |
| Auditor                     | Read the permission matrix and integration readiness (`admin.read`)                    |
| HR admin, manager, employee | No configuration access                                                                |

## Rules the database enforces

- History rows can only be written by the recording trigger (which runs even in replica mode) and can never be updated, deleted or truncated.
- A rollback row must match the recorded version exactly; clients send only the target version, the current version and a reason.
- Two rollbacks, or a rollback and an edit, serialize on the single branding row and the version check; a stale version gets 409.

## Limits

- Only branding is versioned so far; other configuration areas have no history yet.
- Permissions and policies are defined in code and change only through a reviewed release; there is no runtime permission editor.
- Integration status is derived from configuration; notifications, document scanning and the AI helper do not exist yet and show as not configured. The worker schedule can show not configured if only the worker has the interval setting.

## Tests

- Integration (`tests/admin-config.integration.ts`): history for baseline, edit and rollback; rollback semantics and refusals; immutability; no-op updates and long labels; audit and outbox; permission matrix by role; integrations never leak secrets.
- Browser (`tests/e2e/configuration.spec.ts`): rollback through the dialog, permission search, seven integration cards, axe in light and dark, no sideways scroll at 390 px, and employees do not see Configuration.
