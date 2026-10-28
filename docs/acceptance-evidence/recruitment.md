# Recruitment (REC-01): acceptance evidence

Plan: [recruitment](../plans/recruitment.md). Benchmark: [HRMS benchmark](../research/hrms-benchmark.md). Screen: `/recruitment`, source in `apps/portal/app/routes/recruitment.tsx` and `apps/portal/app/components/recruit/`.

## What was verified

`tests/e2e/recruitment.spec.ts` drives the browser as four demo personas (Kabir Sethi, HR admin; Maya Iyer, a second HR user; Neel Rao, manager; Aarav Shah, employee):

| Step                                                                                           | Result                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Manager opens Recruitment                                                                      | Sees Requisitions, Pipeline, Interviews and Funnel; no Candidates or Offers tab                                                       |
| Manager raises a requisition (department and location from `GET /recruit/lookups`), submits it | Form says they will be the hiring manager (no picker); appears as "Waiting for approval" with Neel Rao as hiring manager              |
| A second HR user approves and opens it                                                         | Approved, then Open                                                                                                                   |
| Manager follows the requisition                                                                | Visible in the manager's list                                                                                                         |
| HR adds a candidate with consent                                                               | List and card show a masked email; the details panel does not contain the full address                                                |
| HR reveals contact details                                                                     | Full email and phone appear with the note that the view was recorded in the activity log (one audited read, never refetched on focus) |
| Manager asks for `/api/v1/recruit/candidates`                                                  | 403                                                                                                                                   |
| HR adds the candidate to the requisition, moves it to Interview                                | Card moves to the Interview column                                                                                                    |
| HR schedules an interview with Aarav on the panel, then schedules the same slot                | The second attempt is refused and the reason is shown in the dialog                                                                   |
| Aarav sees only the Interviews view, opens the round                                           | "Scorecards are blind" is shown before he submits                                                                                     |
| Aarav submits a blind scorecard (ratings, recommendation)                                      | His scorecard shows as "(you)" and the blind note is gone                                                                             |
| HR makes an offer; Kabir (the creator) is not offered Approve                                  | Offer waits for approval                                                                                                              |
| Maya approves the offer (four-eyes)                                                            | Approved                                                                                                                              |
| HR records it as sent, then records acceptance with an `@anvi.example` address                 | Notice that a draft pre-boarding case was created; the application is in the Hired column                                             |
| Funnel for the requisition                                                                     | Bars labelled "Applied: 1" and "Hired: 1"; the page contains no candidate name                                                        |
| Every tab, light and dark                                                                      | axe (WCAG 2.0, 2.1 and 2.2 A and AA tags): no violations                                                                              |
| Every tab at 390 px                                                                            | No horizontal page scroll                                                                                                             |

`tests/e2e/devices.spec.ts` now includes `/recruitment` and passes from 320 to 1920 px (no sideways scroll, no clipping, touch targets at least 24 px). `tests/e2e/personas.spec.ts` still passes.

## Screenshots

In [`recruitment/`](recruitment/): `manager-raise`, `requisition-pending`, `manager-requisitions`, `candidate-masked`, `candidate-revealed`, `pipeline`, `interview-conflict`, `interviewer-blind`, `interviewer-submitted`, `offer-accepted`, `funnel`, `requisitions-light`, `requisitions-dark`, and one per tab at phone width (`phone-requisitions`, `phone-candidates`, `phone-pipeline`, `phone-interviews`, `phone-offers`, `phone-funnel`).

## How the screen is built

- Free MIT Untitled UI components only, through `@anvi/ui`: `UTabs`, `CollectionView` with the details panel and server paging (requisitions, candidates, interviews, offers; cards and table), `Select`, `Input`, `RangeInput`, `TextArea`, `Checkbox`, `StatusBadge`, `StatCard`, `DialogPanel`.
- The pipeline is a board of stage columns that wrap on small screens. Every move is a labelled "Move" button that opens a dialog, so it works with the keyboard. Offer and Hired are never offered as moves; rejecting asks for a reason; moving back asks for a note.
- All user text is in `apps/portal/app/lib/copy/recruitment.ts`; `recruit.*` audit events have labels and an "Recruitment" filter in the activity log.
- Visible only with `recruit.manage`, `recruit.request` or `recruit.interview`; the nav entry and the command bar follow the same rule.

## Limits and known gaps

- No email or offer dispatch ("Sent" is a recorded status), no career page, no resume upload or parsing, no calendar or video integration. The screen says so.
- The raise form reads its department, location and designation lists from `GET /api/v1/recruit/lookups` (holders of `recruit.request` or `recruit.manage` only). It returns just the id, code and name of units in effect today in the caller's tenant and entity, so managers can raise without `organization.read`. This closes the earlier gap where HR had to raise on a manager's behalf.
- A scorecard opens only once the interview has started (or been completed), and an interview can be marked completed or no-show only after it starts, so the test schedules a slot about two minutes ahead and waits for it. The panel shows this when it applies.
- Recruitment records are kept by database triggers (deletes are refused even for the owner), so the test cannot remove its synthetic rows. Each run uses a random tag in names and emails, and at the start cancels still-scheduled "Priya Test" interviews left by earlier runs so the interviewer's calendar stays free.
- The pipeline loads up to 100 applications per requisition and says so when there are more; the requisition picker loads up to 100 entries; the lookups return every in-effect department, location and designation.
- People pickers (hiring manager, interviewers, referrer) use a small search over the directory because the kit combobox is not vendored.
- Scorecard rating uses a select per competency rather than radio groups.
