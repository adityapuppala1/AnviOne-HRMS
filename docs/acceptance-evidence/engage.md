# Recognition and engagement (ENG-01): acceptance evidence

Plan: [engagement](plans/engagement.md). Benchmark: [HRMS benchmark](../research/hrms-benchmark.md). Screen: `/engage` (nav label "Recognition"), source in `apps/portal/app/routes/engage.tsx` and `apps/portal/app/components/engage/`, text in `apps/portal/app/lib/copy/engage.ts`. The backend (migrations 062 to 064) is covered by `tests/engage.integration.ts`; this slice is the screen.

## What was verified

`tests/e2e/engage.spec.ts` drives the browser as Aarav Shah (employee), Neel Rao (manager) and Kabir Sethi (HR admin), plus API sign-ins for Maya, Kabir and a fifth synthetic colleague.

| Step                                                                                    | Result                                                                                                                     |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| HR adds and renames a company value (Manage)                                            | Listed as Active after each change                                                                                         |
| Employee gives recognition to Neel                                                      | Colleague search, value, message with counter, "x of 10 given today"; card shows giver, recipient, value chip and message  |
| Colleague reacts                                                                        | One reaction per person; choosing another code swaps it; employee has no Manage tab                                        |
| HR hides the post with a reason                                                         | Reason required; the post leaves the feed for HR, employee and manager                                                     |
| HR restores it from Hidden posts                                                        | The earlier reason is shown in the moderation history; the post returns to the feed                                        |
| HR creates and publishes a survey (rating, choice, text)                                | Draft, then Publish with confirmation                                                                                      |
| Results while open                                                                      | "Results are withheld: the survey is still open ..."                                                                       |
| Five different people answer                                                            | Aarav and Neel on screen; Maya, Kabir and a synthetic fifth colleague through the API (only four demo personas can answer) |
| A second answer                                                                         | Refused by the API; on screen the survey shows "You responded" and no Respond button                                       |
| HR closes the survey                                                                    | Results released: counts and averages in text beside plain bars, shuffled written answers                                  |
| Every tab for employee, manager and HR, light and dark, and the give dialog and results | axe (WCAG 2.0, 2.1, 2.2 A and AA tags): no violations                                                                      |
| All tabs at 390 px                                                                      | No horizontal page scroll                                                                                                  |

`tests/e2e/devices.spec.ts` includes `/engage` (320 to 1920 px). `tests/e2e/personas.spec.ts` checks the Recognition nav entry. Screenshots are in `docs/acceptance-evidence/engage/`.

## Honest limits

Recognition is a thank-you: no points, cash value, rewards or leaderboard. No sentiment analysis or AI, no benchmarks, no trend charts. No email, chat or push notifications. Anonymity depends on group size (the screen says so, including that free text can identify its author). All user text is shown as plain text, never HTML or Markdown, with `dir="auto"` for mixed-direction text. Survey answers write no audit row by design. HR cannot hide or restore a post they gave or received; the dialog tells them to ask another HR colleague. A survey closed by its end time releases results 2 minutes later. Survey management (create, edit, publish, close, results) sits in the Surveys tab for HR; the Manage tab holds values and hidden posts. The give-recognition motion (a small confetti burst on a new reaction) stops under reduced motion.

## Leftover data

Records are kept by design, so each run leaves one company value, one recognition post (hidden then restored), one closed survey with five answers and the sessions it opened. The synthetic sign-in `rohan-e2e-engage` (employee Rohan, role Employee) stays bound in the local demo database. Each person can give 10 posts a day, so very many reruns in one UTC day would hit the cap.
