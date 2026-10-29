# HR helpdesk (HLP-01)

Workflow module from the HRMS plan, linked from the backlog (HLP-01) and [the benchmark](../research/hrms-benchmark.md) ("HR helpdesk: employee cases with categories, SLAs and knowledge links"). This slice is the backend only: migrations `059_helpdesk.sql` and `060_helpdesk_security_fixes.sql` (self security review: internal notes no longer move the requester-visible last-activity time; a non-requester setting a rating is refused as forbidden), `apps/api/src/helpdesk.store.ts` and `helpdesk.controller.ts`, contracts and `tests/helpdesk.integration.ts`. There is no screen yet.

## Goal

Employees raise questions and cases with HR (payroll queries, leave, policy, IT and assets, benefits, other, and confidential grievances), follow them through to resolution in one thread, and rate the help they got. HR agents work a shared queue against service targets.

## Who does what

| Role                                                    | Can                                                                                                                                                                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employee, manager (`helpdesk.self`, self)               | Raise cases for themselves; see only their own cases (managers do not see their team's); comment; cancel before resolution; reopen within 7 days of resolution; close a resolved case and rate it 1 to 5; read published articles |
| HR admin (`helpdesk.agent` + `helpdesk.manage`, entity) | Everything an agent does on any case in the entity, plus assign to any HR agent, cancel, change confidentiality, manage categories, service targets and knowledge articles. On their own case an HR admin is only the requester   |
| Auditor, platform admin                                 | No access                                                                                                                                                                                                                         |

`helpdesk.agent` on its own (no role holds it alone today; the database supports it) works the non-confidential queue, takes unassigned cases for themselves, and sees a confidential case only while it is assigned to them.

## How it works

- **Cases:** `HLP-000001` codes per entity, category (admin-managed list), subject (3 to 160), description (10 to 4000), priority (low, normal, high, urgent), status, requester (always the caller), assignee (an active employee whose sign-in carries the HR admin role, never the requester).
- **States:** open, in progress, waiting on employee, resolved, closed, cancelled. Agents start (needs an assignee), wait, resume and resolve (the assignee or an HR manager); the requester reopens within 7 days of resolution (back to in progress), closes a resolved case (with an optional 1 to 5 rating, only at that moment), or cancels before resolution; HR managers may cancel too. An agent may close a resolved case only once the 7-day reopen window has passed. Closed and cancelled cases are final.
- **Four-eyes:** the requester can never be the assignee, never resolve, never add an internal note, and never act as an agent on their own case, even when they are HR. Someone else must work and resolve it.
- **Service targets:** each priority has a first-response and a resolution target in hours (seeded: urgent 1 and 8, high 4 and 24, normal 8 and 72, low 24 and 120; HR can change them). Due times are computed by the database at creation and recomputed from the creation time when the priority changes, except that a due time already passed (and the response due time once a public reply has been given) never moves, so a breach cannot be erased by changing the priority (061). Targets run on the clock: **no business hours, holidays or pause while waiting on the employee**. A case is response-breached when the first public agent reply came (or still has not come) after the response due time, and resolve-breached when it was resolved or cancelled (or still is not) after the resolution due time. Breach is derived when read, never stored. Reopening does not reset the due times.
- **Thread:** comments and internal notes are append-only. Internal notes are visible only to agents who can see the case, never to the requester (enforced in row-level security and the guard, including for HR on their own case), and emit their own outbox event (`helpdesk.internal_note_added.v1`). A case takes at most 300 public comments and 300 internal notes, counted separately (061). Status, assignment, priority and confidentiality changes are written to an append-only history by a narrow writer role.
- **Confidential cases:** a category can be confidential (seeded "Grievance or harassment"), and a requester may mark any case confidential when raising it. A confidential case is visible only to the requester, the assigned agent and `helpdesk.manage`. Only `helpdesk.manage` may clear the flag; an agent may only set it, and only on a case assigned to them (enforced in the guard since 061).
- **Knowledge articles:** HR writes articles (title, body, keywords, optional category) and publishes or archives them. Employees read published articles. **Suggestions are rule-based keyword matching, not AI:** published articles in the case's category or uncategorised, ranked by how many words of the subject match an article's keywords or title words. Agents link articles to a case; the requester sees linked articles.
- **Audit and outbox:** every write records an audit event and an outbox event in the same transaction with ids, statuses, kinds and counts only. Subjects, descriptions, comments, article text, ratings, categories of a case and the confidential flag of a case never appear in either.
- **Concurrency:** every change carries the row's `version`; a stale version gets 409. Writes serialise on per-case advisory locks shared with the database guards.
- **Errors:** database guards raise `HD003` (400), `HD004` (409) and `HD005` (403). A case the caller cannot see answers exactly like one that does not exist (404 from the API, one uniform guard message for direct statements).

## Limits

- No email, chat or notification channel; no automatic assignment, escalation or auto-close job (a resolved case stays resolved until the requester or, after 7 days, an agent closes it).
- Service targets are wall-clock hours, not business hours; no pause while waiting on the employee; reopening keeps the original due times.
- Cases are raised only by the employee for themselves (no raising on behalf, no manager view of team cases).
- No attachments. Comments cannot be edited or deleted. Categories and articles are retired, never deleted.
- Suggestions are plain keyword matches; there is no AI, ranking model or summarising. AI helpers stay off.
- Case codes run per entity, so a code hints at how many cases the entity has.
- New entities get no seeded categories or service targets until HR adds them (missing targets fall back to the seeded defaults).
- An entity whose only HR admin raises a case cannot work it; another HR admin is needed.
- Every HR admin holds both `helpdesk.agent` and `helpdesk.manage`, so every HR admin sees every confidential case, including a grievance about themselves. There is no conflict-of-interest exclusion yet.
- Before a due time passes, an agent can still lower a case's priority and lengthen its targets; the change is in the case history and audit.
- Article bodies are plain text; the portal must render them as text, never as HTML or Markdown.

## Tests

- Integration (`tests/helpdesk.integration.ts`, port 4519): role access (auditor and platform admin refused), visibility (employee own, manager own only, HR entity), internal-note secrecy (API and direct reads, including HR as requester), confidential cases (agent-only scope sees them only when assigned), service-target derivation and breach, the state machine, the reopen window, four-eyes, immutability of comments and history (update, delete and truncate refused), tenant isolation, direct statements as the app role refused, optimistic concurrency, the 061 review fixes (breach kept on priority change, confidential flag refused for an agent who has not taken the case, thread caps, separate internal-note event), pagination, and no free text or personal values in audit or outbox.
