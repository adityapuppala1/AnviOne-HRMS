# F0.5: Onboarding checklist and submission comparison

Authoritative implementation plan, 25 October 2026. Extends F0.4; all records remain synthetic and real email/activation remain unavailable.

## Outcome

HR can start a versioned starter checklist or add up to 30 case-specific tasks. Each task records a coordinating owner (candidate, HR, manager, IT or administration), required flag, a due date relative to joining, an optional earlier prerequisite, status and an evidence/reopening note. Candidate sessions see and change only their own candidate-owned tasks, including after form submission. HR coordinates internal owners until dedicated assignee workspaces exist; owner labels grant no access. HR sees field-by-field changes between immutable submissions.

## Decisions and approach

Use the existing candidate case as the aggregate lock and increment its version on each checklist mutation. Task versions prevent stale row updates. Dependencies reference existing tasks in the same case and cannot be changed, so creation cannot form cycles. Completion requires a completed dependency. Reopening/blocking a completed prerequisite with completed dependents is rejected; reverse dependent completion explicitly first. Required tasks cannot be waived or deleted. Cancellation prevents further changes. Task metadata is immutable in this slice.

Migration 006 adds FORCE-RLS task records and fixed validation functions under the existing restricted auth-function owner. Candidate grants cover only own task reads and status/note/version updates; employee source-table access stays denied. Fixed dependency lookup reveals only a waiting flag for the current candidate's own task. HR and candidate APIs reuse exact Origin, CSRF and session revalidation. Task/case/audit/outbox writes commit together. No new dependencies or external services are required.

Starter v1 has five explicitly fictional coordination tasks. Applying it is explicit and allowed only to an empty checklist; existing cases do not silently acquire requirements. Custom task creation is available to HR. Completed notes are evidence of a synthetic action, not verified identity, document approval or legal consent. Checklist completion never approves a form, creates employment or grants employee access.

Atlas HR cards gain a checklist with owner/status filters, required progress, due/waiting indicators and a focused task dialog. Candidate tasks have a separate, compact progress panel and deliberate completion/reopening actions. Reduced-motion, keyboard focus, narrow layouts and theme contrast follow existing controls. Submission comparison uses text rendering and named fields, never HTML diff injection.

## Verification

- Unit: strict task inputs, starter definition/dependency order and submission field comparisons.
- Database/API: scoped owner reads/writes, foreign-case dependencies, immutable metadata, prerequisite/reopen rules, cancellation/revocation, stale/concurrent versions, due dates, atomic rollback, and no employee creation/access.
- Browser: explicit starter setup, HR waiting/completion, isolated candidate task completion, correction field comparison, filters, keyboard dialogs, light/dark axe checks and 320/768/1440 overflow checks. Existing suites remain required.
- Run format, lint, TypeScript, unit/build, serial integration then browser suites, dependency audit, container smoke and CI. Publish evidence and update backlog/contracts.

## Recovery and remaining gates

Rollback is feature disablement or a forward migration; preserve task notes, submissions and audit history. No external messages are sent. Real delivery/verified ownership, complete forms/documents/checks, assigned internal task workspaces, template administration, escalation, shared workflows and transactional activation remain future increments.

Research: [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) supports deny-by-default and per-request object authorization. The supplied Dribbble HRMS shot was unavailable through the research tool; retain the existing reviewed Atlas visual language instead of inferring unseen details.
