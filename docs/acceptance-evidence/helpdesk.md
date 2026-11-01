# Helpdesk (HLP-01): acceptance evidence

Plan: [helpdesk](../plans/helpdesk.md). Benchmark: [HRMS benchmark](../research/hrms-benchmark.md). Screen: `/helpdesk`, source in `apps/portal/app/routes/helpdesk.tsx` and `apps/portal/app/components/helpdesk/`, text in `apps/portal/app/lib/copy/helpdesk.ts`. The backend (migrations 059, 060 and 061) is covered by `tests/helpdesk.integration.ts`; this slice is the screen.

## What was verified

`tests/e2e/helpdesk.spec.ts` drives the browser as three demo personas (Aarav Shah, employee; Neel Rao, manager; Kabir Sethi, HR admin):

| Step                                                                          | Result                                                                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| HR writes an article with keywords and publishes it (Settings)                | Article saved, then Publish switches to Archive; the wall-clock note is shown                                                                    |
| Employee raises a case                                                        | The form lists the article under "Suggested by keyword match, not AI" and expands its text; employee has no Agent queue or Settings tab          |
| HR takes the case, starts work, adds an internal note and a public reply      | The note is marked "Internal — the employee cannot see this"; an article is linked; the Assign dialog offers Maya; priority changed to Urgent    |
| HR waits on the employee with a question                                      | Status "Waiting on employee", question appears in the thread                                                                                     |
| Employee opens the case                                                       | Sees the reply, the question and the linked article; the internal note text and its label are absent; no internal-note button; adds a comment    |
| HR resumes, then resolves                                                     | Status moves through In progress to Resolved                                                                                                     |
| Employee reopens (reason required), HR resolves again, employee closes with 5 | Status Closed, "Your rating 5 of 5", no Reopen button                                                                                            |
| Confidential case                                                             | Visible to the employee and HR (marked Confidential), invisible to the manager (no match, no Agent queue); the employee cancels it with a reason |
| HR raises their own case                                                      | Four-eyes message shown; no Take button and no internal-note button                                                                              |
| HR adds a category and opens a service target                                 | Category listed; the dialog repeats "not business hours"                                                                                         |
| Every tab for employee, manager and HR, light and dark, plus the case panel   | axe (WCAG 2.0, 2.1 and 2.2 A and AA tags): no violations                                                                                         |
| HR and employee tabs at 390 px                                                | No horizontal page scroll                                                                                                                        |

`tests/e2e/devices.spec.ts` includes `/helpdesk` (320 to 1920 px). `tests/e2e/personas.spec.ts` checks the Helpdesk nav entry (shown for employee, manager, HR and Maya; hidden for auditor and platform admin). Screenshots are in `docs/acceptance-evidence/helpdesk/`.

## Honest limits

No email, chat or notifications (people check the screen for replies); no automatic assignment, escalation or auto-close; no attachments; service targets are wall-clock hours, not business hours, and do not pause while waiting on the employee; suggestions are keyword matches, not AI; article text is shown as plain text, never HTML or Markdown; a thread holds at most 300 public and 300 internal entries and the screen says so when the limit is hit.

## Leftover data

Helpdesk records are kept by design (deletes are blocked), so each run leaves one category, one archived article and three cases (one closed, one cancelled, one raised by HR) with random tags in their names.
