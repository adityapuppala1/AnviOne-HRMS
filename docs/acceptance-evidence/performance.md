# Performance (PERF-01): acceptance evidence

Plan: [performance](../plans/performance.md). Benchmark: [HRMS benchmark](../research/hrms-benchmark.md). Screen: `/performance`, source in `apps/portal/app/routes/performance.tsx` and `apps/portal/app/components/performance/`. The backend (migrations 056 and 057, store, controller, contracts) was built earlier and is covered by `tests/perf.integration.ts`; this slice is the screen.

## What was verified

`tests/e2e/performance.spec.ts` drives the browser as four demo personas (Aarav Shah, employee; Neel Rao, his manager; Kabir Sethi, HR admin; Maya Iyer, a second HR user):

| Step                                                                                | Result                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manager creates a goal, adds a key result, activates it                             | The details panel says to add a key result first; after adding one the goal activates and shows "Active"                                                                    |
| Employee creates a goal aligned to the manager's goal                               | The alignment list offers the manager's active goal; the employee sees "A goal that is not visible to you" for the parent (goals are visible only to owner, manager and HR) |
| Employee adds a percent key result, activates, logs progress 40                     | Overall progress bar reads 40; history shows "0% to 40%"; employee has no Review cycles or Finalise tab                                                                     |
| Manager opens Team goals and their own goal                                         | Sees the report's goal at 40%; their own goal lists the aligned goal under "Aligned goals"                                                                                  |
| HR creates a cycle for the employee's department, a second HR user opens it         | Cycle shows Draft; opening confirms, then a notice states how many reviews were generated                                                                                   |
| Employee opens My reviews                                                           | "Your self-review is waiting for you"; the blind note says the manager's review stays hidden until HR finalises; Submit stays disabled until all five areas are rated       |
| Employee submits a self-review                                                      | Status becomes "Waiting for your manager's review"; own entry visible; "Your self-review is in"                                                                             |
| Manager opens Team reviews                                                          | Blind note shown and the self-review text is absent until the manager submits                                                                                               |
| Manager submits a manager review                                                    | Both reviews are then visible                                                                                                                                               |
| Employee checks the review before finalisation                                      | "With HR for the final rating"; the manager's comment is not shown                                                                                                          |
| HR finalises (reason under 10 characters keeps the button disabled)                 | Review leaves the "Ready to finalise" list                                                                                                                                  |
| Employee reopens the review                                                         | "Your result is ready", "Final rating 4 of 5", the reason and the manager's comment are visible                                                                             |
| HR cycle for Kabir's own department; Maya opens it                                  | Notice says Maya was skipped because she has no manager; Kabir's own review shows the four-eyes message and no Finalise button                                              |
| Every tab for employee, manager and HR, light and dark, plus the goal panel in dark | axe (WCAG 2.0, 2.1 and 2.2 A and AA tags): no violations                                                                                                                    |
| HR and employee tabs at 390 px                                                      | No horizontal page scroll                                                                                                                                                   |

`tests/e2e/devices.spec.ts` now includes `/performance` and passes from 320 to 1920 px (no sideways scroll, no clipping, touch targets at least 24 px). `tests/e2e/personas.spec.ts` now also checks the Performance nav entry (shown for employee, manager, HR and Maya; hidden for auditor and platform admin).

Known failure, not caused by this slice: `personas.spec.ts` "auditor persona sees only its own workspace" fails at the sign-in step with "Too many sign-in requests" (the 20 per minute sign-in limit). It fails the same way with the original spec file, so it predates this change.

## Screenshots

In [`performance/`](performance/): `goal-form`, `key-result-form`, `goal-detail`, `team-goal`, `cycle-form`, `cycle-opened`, `self-review-form`, `my-review-waiting`, `manager-review-both`, `finalise-form`, `my-review-result`, `four-eyes`, `goals-light`, `goals-dark`, `cycles-light`, `cycles-dark`, `goal-detail-dark`, and one per tab at phone width (`phone-all-goals`, `phone-review-cycles`, `phone-finalise`, `phone-goals`, `phone-my-reviews`).

## How the screen is built

- Free MIT Untitled UI components only, through `@anvi/ui`: `UTabs`, `CollectionView` (cards and table, server paging, details panel), `Select`, `Input`, `RangeInput`, `TextArea`, `StatusBadge`, `StatCard`, `DialogPanel`. Progress bars and the 1 to 5 rating pickers are small custom pieces (the free kit has neither a progress bar nor a fitting five-point rating control); the ratings are real radio buttons with 44 px targets.
- Tabs follow permissions: Goals and My reviews need `performance.self`; Team goals (All goals for HR) and Team reviews need `performance.review` (HR sees every goal); Review cycles and Finalise need `performance.manage`. The nav entry and the command bar follow the same rule.
- What is shown is what the API allows: buttons follow the `can...` flags on each record, the blind rules come from the review detail (`blind`, and the entries the API returns), and the database still decides every write. A stale record returns 409 and the message is shown in the dialog.
- Motion follows ADR 0010: cards rise in with a stagger, the panel slides in, progress bars grow with a transform (not width or opacity), the chosen rating chip scales slightly. All of it stops under reduced motion.
- All user text is in `apps/portal/app/lib/copy/performance.ts`; `performance.*` audit events have labels and a "Performance" filter in the activity log.

## Limits shown on the screen

No 360 or peer feedback, no calibration grid or forced ranking, no reminders or notifications (due dates are shown, not enforced), no link to pay. Ratings are typed in by people; nothing is scored, suggested or summarised, and there is no AI.

Other limits worth knowing:

- Reviews search matches the employee and manager names only (the API does not search cycle names).
- The department list on the cycle form comes from the recruitment lookups (`GET /recruit/lookups`), so it needs `recruit.manage` as well; without it the form says the cycle will cover the whole entity.
- Opening a goal's record from an aligned goal is not offered; aligned goals are listed read-only.
- The demo HR persona (Kabir) holds only `hr_admin`, which has `performance.manage` but not `performance.self`, so he has no Goals or My reviews tab; Maya (all roles) does.

## Test data

Performance records are kept by design (database triggers refuse deletes), so each run of `performance.spec.ts` leaves synthetic rows tagged with a random code in their names: two goals, two review cycles (one for Customer experience, one for People & culture), and the reviews they generate (Aarav's is finalised; Kabir's and Rohan Das's stay open at "self-review due", so the People & culture cycle cannot be closed). Lists page forward in the spec, so growing leftovers do not break reruns.
