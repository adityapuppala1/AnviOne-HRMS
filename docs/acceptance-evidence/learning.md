# Learning (LRN-01): acceptance evidence

Plan: [learning](../plans/learning.md). Benchmark: [HRMS benchmark](../research/hrms-benchmark.md). Screen: `/learning`, source in `apps/portal/app/routes/learning.tsx` and `apps/portal/app/components/learning/`, text in `apps/portal/app/lib/copy/learning.ts`, data hooks in `apps/portal/app/lib/learning-api.ts`. The backend (migrations 065 to 067) is covered by `tests/learn.integration.ts`; this slice is the screen.

## What was verified

`tests/e2e/learning.spec.ts` drives the browser as three demo personas (Aarav Shah, employee; Neel Rao, manager; Kabir Sethi, HR admin):

| Step                                                                               | Result                                                                                                                                       |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| HR creates three courses (Manage) and publishes them; the honest-limits note shows | Courses listed with Publish switching to Assign; the New course dialog passes axe                                                            |
| Employee opens the Catalogue                                                       | Sees the published optional course, no drafts; the external link shows its host, opens in a new tab with `rel="noopener noreferrer"`; enrols |
| HR assigns two courses to Aarav (directory search, due date)                       | Result message "Assigned to 1 person. Skipped 0"                                                                                             |
| An assignment is moved into the past (test-only SQL, the product refuses it)       | Aarav sees the Overdue badge in his details panel                                                                                            |
| Employee starts a course, then marks it complete with a note                       | Status goes Not started, In progress, Completed; "Certification current"; the note is in the history                                         |
| Manager opens Team                                                                 | Sees Aarav's assignment and note read-only (no Start, Complete or Waive); no Manage or Compliance tab                                        |
| HR filters Overdue only and one course, then waives with a reason                  | Waive needs a reason; the assignment leaves the overdue list; Aarav sees "Waived" with the reason and no Overdue badge                       |
| HR assigns a course to themselves                                                  | Four-eyes message shown; no Record completion or Waive button; "Mark complete" is available (self-attestation)                               |
| HR reads Compliance                                                                | Per-course bars with every count also written in text; no names or notes                                                                     |
| Every tab for employee, manager and HR, light and dark, plus the history panel     | axe (WCAG 2.0, 2.1 and 2.2 A and AA tags): no violations                                                                                     |
| All tabs at 390 px                                                                 | No horizontal page scroll                                                                                                                    |

`tests/e2e/devices.spec.ts` includes `/learning` (320 to 1920 px). `tests/e2e/personas.spec.ts` checks the Learning nav entry (shown for employee, manager, HR and Maya; hidden for auditor and platform admin). Screenshots are in `docs/acceptance-evidence/learning/`.

## Behaviour worth knowing

- All user text is rendered as plain text nodes. A course link is checked with the API's own `externalUrl` rule before it becomes an `<a>`; anything else is shown as text. The host is shown next to the link.
- Archived courses: learners with an open assignment can still start and complete it; the panel says so. The course can no longer be assigned or enrolled in.
- Department and location assignment is capped at 1,000 people by the API; its message is shown in the assign dialog. A concurrent audience assignment answers 409 for the whole batch and the dialog says nothing was assigned and to try again.
- Due dates are validated by the database in its session time zone; the form uses India time for its minimum date.
- Anyone, HR included, can complete their own assignment (self-attestation). Only HR recording or waiving their own is blocked.
- Unit pickers list the first 50 departments or locations from the organization API.

## Honest limits

No content hosting, quizzes, attendance capture or certificate files; an external link is only a link and nothing knows whether it was opened. Completion is self-declared or HR-recorded and not verified. No emails, chat or push reminders for assignments, due dates or renewals. Audience assignment is a one-time snapshot and expiry does not re-assign automatically. Managers read their team but cannot assign or record. No AI. The same limits are printed on the screen.

## Leftover data

Learning records are kept by design (deletes are blocked), but the spec removes its own synthetic courses, assignments, completions, audit and outbox rows at the end as the migrator (the same way `tests/learn.integration.ts` does), so a passing run leaves nothing. A run that is killed before the cleanup can leave three courses and four assignments with a random tag in the title.
