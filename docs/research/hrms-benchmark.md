# HRMS benchmark and gap analysis

Research date: 2026-10-28. Sources are vendor marketing pages (Keka and general ATS feature roundups), so treat feature claims as indicative, not verified. Sources: [Keka](https://www.keka.com/), [Keka ATS](https://keka.com/applicant-tracking-system), [Keka recruitment](https://keka.com/recruitment-management-software), [SelectHub ATS requirements](https://www.selecthub.com/hris/ats-2/applicant-tracking-system-requirements-features), [Recruiterflow ATS features](https://recruiterflow.com/blog/applicant-tracking-system-features/), [PeopleFluent recruiting](https://www.peoplefluent.com/products/recruiting/). Duplicate detection and talent pools were not covered by the sources found; they are included from common ATS practice and are not verified here.

## What Keka offers (from its own site)

| Suite    | Areas                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payroll  | Compliance, payroll runs, expenses, benefits, global payroll, analytics                                                                            |
| HR       | Onboarding, timekeeping (attendance, leave, shifts), HRIS, AI helpdesk, HR analytics                                                               |
| Talent   | Hiring (sourcing, screening and interviews with scorecards, analytics), learning, engagement surveys, 360 reviews, OKRs, recognition, skills paths |
| PSA      | Timesheets, resource management, billing, project and task management                                                                              |
| Platform | Marketplace of 100+ integrations, AI features                                                                                                      |

## Where AnviOne stands

| Area                        | Status                                                                |
| --------------------------- | --------------------------------------------------------------------- |
| HRIS, directory, org chart  | Built (masters, effective dates, merges, chart, classification)       |
| Attendance, leave, calendar | Built; shifts and rosters are not                                     |
| Onboarding (pre-boarding)   | Built, but only after an offer is accepted                            |
| Documents, policies, assets | Built                                                                 |
| Expenses, projects, time    | Built; no billing, rates or payroll link                              |
| Exit                        | Built; no dues or settlement (needs Payroll)                          |
| Reports, insights           | Built                                                                 |
| Recruitment / ATS           | **Not built.** Candidate intake is pre-boarding only (see below)      |
| Performance, OKRs, 360      | Not built                                                             |
| Learning, engagement, kudos | Not built                                                             |
| Helpdesk / HR cases         | Not built                                                             |
| Payroll, benefits           | Needs an outside owner (compliance)                                   |
| Integrations marketplace    | Not built; notification dispatch and live sign-in need outside owners |

## Is candidate intake ATS-friendly?

No, and it was not designed to be. The candidate intake starts from a person who is already hired: each case needs a department, location, manager and joining date, and its states are `draft, invited, in_progress, submitted, changes_requested, approved, cancelled`. Missing for an ATS:

- Job requisitions with approval and headcount
- Applications as a separate record from the candidate, with a source
- Configurable pipeline stages and stage history, rejection reasons
- Interview scheduling with interviewer conflict checks
- Structured scorecards and blind feedback
- Duplicate detection across applications
- Candidate consent and retention dates
- Offers with approval, and a hand-off of an accepted offer into the existing pre-boarding intake
- A hiring funnel and time-in-stage view

## Recommended build order

1. **Recruitment (ATS) core** (built next): requisitions, candidates and applications, pipeline, interviews and scorecards, offers, hand-off to pre-boarding, funnel view.
2. **Performance basics:** goals/OKRs and review cycles with manager and self review.
3. **HR helpdesk:** employee cases with categories, SLAs and knowledge links.
4. **Recognition and engagement:** kudos feed, pulse surveys.
5. **Learning:** course catalogue, assignments and completion tracking.
6. **Shifts and rosters** for attendance.
7. Needs outside owners: payroll and benefits, notification dispatch, calendar and video integrations, a public career site (needs hosting, bot protection and a privacy review).

## Honest limits for the first ATS slice

- No public career page, job-board posting, resume file upload or parsing (needs object storage and malware scanning), and no calendar or video-meeting integration.
- Candidate contact details are personal data: sealed with the profile data keys, never in audit or outbox rows, and excluded from reports.
- Duplicate detection compares a keyed hash of the normalized email; it does not fuzzy-match names.
