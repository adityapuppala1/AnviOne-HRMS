# Learning (LRN-01)

Workflow module from the HRMS plan, linked from the backlog (LRN-01) and [the benchmark](../research/hrms-benchmark.md) ("Learning: course catalogue, assignments and completion tracking"). This slice is the backend only: migrations `065_learning.sql` and `066_learning_security_fixes.sql` (self security review), `apps/api/src/learn.store.ts` and `learn.controller.ts`, contracts in `packages/contracts/src/learn.ts` and `tests/learn.integration.ts`. The screen (`/learning`) is built; see [the evidence](../acceptance-evidence/learning.md).

## Goal

HR keeps a catalogue of courses, assigns them to people (one person, or everyone in a department or location), and sees who has completed, who is in progress, who is overdue and whose certification is due for renewal. Employees see what is assigned to them, enrol themselves in optional courses and mark their own progress.

## Who does what

| Role                                            | Can                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employee (`learn.self`, self)                   | Browse published courses, enrol in published non-mandatory courses, see their own assignments and completion history, mark their own assignment started and completed (optional note up to 280)                                                          |
| Manager (`learn.self` self + `learn.team` team) | Everything an employee can, plus read (only) the assignments and completion history of their current direct reports                                                                                                                                      |
| HR admin (`learn.manage`, entity)               | Manage the catalogue (draft, edit, publish, archive), assign courses to a person or to a department or location audience, record a completion on someone's behalf or waive an assignment with a reason, see every assignment, read the compliance report |
| Auditor, platform admin                         | No access                                                                                                                                                                                                                                                |

## How it works

- **Courses:** `LRN-C-000001` codes per entity, title (3 to 120), description (up to 2000), category (2 to 60), delivery mode (`online`, `classroom`, `self_study`), duration in minutes (1 to 10000), optional external link (`https://` only, up to 500), mandatory flag, optional validity in months (1 to 120) for recertification. Status `draft` → `published` → `archived` (a draft can also be archived). Archived courses are frozen and can never be newly assigned or enrolled in; drafts cannot be assigned either. Courses are never deleted.
- **Assignments:** HR assigns a published course to one current employee, or to a department or location. An audience is a **snapshot**: the current employees (active or on notice, already joined) of that unit at assign time get one assignment each; people who join the unit later do not. Each carries a due date (today or later), a mandatory flag (defaults to the course's) and a batch id. People who already have an open assignment for that course are skipped and counted.
- **Self-enrolment:** any learner can enrol in a published, non-mandatory course. No due date.
- **One open assignment per person and course** (a partial unique index and the guard under a per-person-and-course advisory lock). After completion or a waiver, the course can be assigned again (for example for renewal).
- **Progress:** `assigned` → `in_progress` (the learner starts) → `completed`. A learner can complete straight from `assigned`. HR can record a completion on someone's behalf with a reason (3 to 500), or waive an open assignment with a reason. **Four-eyes:** HR can never record an on-behalf completion for, or waive, their own assignment (guard plus a check constraint); they complete their own like anyone else.
- **Completion history:** every completion and waiver is a row in an append-only history (`lrn_completion`, one per assignment), written by the caller through the guard; the assignment's status is then moved by a narrow writer role. Nobody can update, delete or truncate the history.
- **Certificate-style record:** the completion row is the record (who, when, how recorded, expiry). There is no file upload and no certificate document is generated.
- **Recertification:** completing a course that has a validity sets an expiry date (completion date plus the validity months). Derived, never stored: `renewal` is `current`, `due` (expires within 30 days) or `expired`.
- **Overdue:** derived, never stored: an open assignment whose due date has passed.
- **Visibility:** employee their own, manager their own plus their current direct reports (read only), HR the entity. Courses: HR sees all; others see published courses plus any course they have an assignment for.
- **Compliance report (HR):** per course, counts of not started, in progress, overdue, completed, waived and due for renewal. Counts only, no free text.
- **Audit and outbox:** every write records an audit event and an outbox event in the same transaction with ids, statuses and counts only. Course titles, descriptions, notes and reasons never appear in either.
- **Concurrency:** courses and assignments carry a `version`; a stale version gets 409. Writes serialise on advisory locks shared with the guards.
- **Errors:** guards raise `LN003` (400), `LN004` (409) and `LN005` (403). A course or assignment the caller cannot see answers exactly like one that does not exist (404).

## Honest limits

- No content hosting, SCORM/xAPI, quizzes or attendance capture. The external link is only a link; the system does not know whether anyone opened it.
- Completion is self-declared by the learner (or recorded by HR). There is no verification of the learning itself.
- No certificate generation and no file uploads.
- No notifications or reminders (no email, chat or push) for assignments, due dates or renewals.
- No automatic re-assignment on expiry: HR assigns the course again.
- Audience assignment is a one-time snapshot; there are no rules that keep assigning to new joiners.
- Managers cannot assign courses or record completions for their team; they read only.
- No AI recommendations; nothing is suggested.
- Course codes run per entity, so a code hints at how many courses the entity has.

## Tests

- Integration (`tests/learn.integration.ts`, port 4523): role access, visibility scopes (self, team, entity), audience snapshot, the state machine, four-eyes, one open assignment, overdue and renewal derivation, immutability, tenant isolation, direct-statement refusals, concurrency, no free text in audit or outbox, and pagination.
