# F0.8: Assigned onboarding task workspace

Authoritative implementation plan, 25 October 2026. Extends F0.5–F0.7; all records remain synthetic and activation remains unavailable.

## Outcome

HR can assign a non-candidate checklist task to a named active employee in the same legal entity. Employees and managers receive a least-privilege **My onboarding tasks** workspace listing only tasks assigned to their immutable employee identity. The assignee can record a status change with a mandatory note; HR retains coordination and reassignment control. Assignment and task changes remain versioned, audited and atomic with the case/outbox aggregate.

Acceptance requires same-entity active-assignee validation, no candidate-task assignment, self-only reads and writes, dependency enforcement, stale/concurrent rejection, reassignment auditability, responsive accessible UI, and no broader candidate-case disclosure.

## Approach

- Migration 010 adds a FORCE-RLS `candidate_task_assignment` record keyed by task, with employee, version, assigner identity/label and timestamps. Its trigger binds the assigner to transaction-local identity and prevents cross-entity or candidate-owned assignments. The task record remains the source of status/version truth.
- Add `onboarding.task.update`; Employee and Manager receive self scope, while HR continues using `onboarding.manage`. Transaction context exposes this scope to RLS.
- HR receives active same-entity assignee options and a versioned assign/reassign endpoint. Assignment, candidate-case version, audit and outbox commit together.
- Add self-scoped list and update endpoints. Responses include only task label, coordinating owner, due/status/dependency flags, minimal candidate identification and assignment metadata—never the candidate email, draft, submissions or review notes.
- Add an Atlas work-docket route. Its signature is a dated vertical docket with dependency/status rails; surrounding controls stay quiet. It supports filters, empty/error/loading states, keyboard dialogs, narrow layouts, themes and reduced motion.

## Decisions

- Assignment is separate from the immutable task definition. This preserves F0.5 task metadata while allowing audited reassignment.
- Any active same-entity employee may be assigned in this preview; owner categories communicate coordination context but do not manufacture unavailable IT/Administration roles. HR chooses the accountable person explicitly.
- Assignees do not gain candidate-detail permission. The self endpoint is a purpose-built projection and RLS authorizes every read/write against `app.employee_id`.
- Candidate-owned tasks remain controlled only by the separate candidate origin/session.

## Boundaries

No bulk assignment, templates, teams, delegation, reminders, escalation, file evidence, real notification, configurable workflow engine, employment activation or new identity provisioning. Assignment notes remain fictional and are not verified evidence.

## Verification

- Contract tests reject unknown/mass-assigned fields and invalid versions, states or notes.
- Database/API tests prove active same-entity assignment, cross-entity/inactive/candidate-task denial, self-only projection/update, HR visibility, dependency rules, stale/concurrent writes, reassignment, atomic rollback, audit/outbox records and no employee/activation side effects.
- Browser tests assign a task as HR, switch to Employee, complete it from the docket, verify HR sees the result, and cover keyboard focus, axe, light/dark, reduced motion and 320/768/1440 overflow.
- Run generated-contract drift, format, lint, TypeScript, unit/build, dependency audit, serial integration/E2E, container smoke and branch CI.

## Recovery

Disable the route and endpoints if necessary; preserve assignment and audit history. Database rollback is forward-only: retire active assignments rather than deleting records. Existing unassigned tasks remain valid throughout migration.
