# Recruitment / ATS (REC-01)

Workflow module from the HRMS plan, linked from the backlog (REC-01), the README, the traceability matrix and [the benchmark](../research/hrms-benchmark.md). It sits in front of the existing candidate intake: an accepted offer creates a pre-boarding case.

## Goal

HR and hiring managers open job requisitions, track candidates through a pipeline, run interviews with structured scorecards, make approved offers, and hand an accepted offer into pre-boarding.

## Who does what

| Role                                    | Can                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HR admin (`recruit.manage`)             | Everything: approve requisitions, add candidates, move any application, schedule interviews, make and approve offers, see contact details, withdraw consent   |
| Manager (`recruit.request`, team)       | Raise requisitions with themselves as hiring manager, see and advance applications for their requisitions, schedule interviews; no contact details, no offers |
| Employee, manager (`recruit.interview`) | See interviews they sit on and submit their own scorecard                                                                                                     |
| Auditor, platform admin                 | No access                                                                                                                                                     |

## How it works

- **Requisitions:** `REQ-000001` codes, department, location and designation in effect, headcount, hiring manager. Draft, pending approval, approved, open, on hold, closed, rejected or cancelled. HR approves; the requester and hiring manager cannot. The raise form's pick-lists come from `GET /recruit/lookups` (`recruit.request` or `recruit.manage`): only id, code and name of departments, locations and designations in effect today, tenant- and entity-scoped by RLS, so managers do not need `organization.read`. Raising headcount or changing the hiring manager, title or placement after approval sends it back for approval.
- **Candidates:** consent is required; email and phone are sealed and never appear in audit or outbox rows; lists show masked contact details and each full read is audited. A duplicate email is refused, and only HR learns who the existing candidate is. Retention defaults to two years; consent withdrawal and an irreversible anonymise action are available to HR.
- **Applications and pipeline:** applied, screening, interview, assessment, offer, hired, rejected, withdrawn. Moving back needs HR and a reason; rejecting needs a rejection reason; offer and hired are reached only through the offer flow. Every move is kept in an immutable stage history.
- **Interviews and scorecards:** 15 to 240 minutes, a panel of one to six, with conflict checks for interviewers and the candidate. Scorecards (five competencies rated 1 to 5 and a recommendation) are blind: an interviewer sees others' scorecards only after submitting their own. Submitted scorecards never change.
- **Offers:** HR creates, a different HR user who is neither the offer's reporting manager nor the requisition's hiring manager approves, then it is sent, and HR records the response. Accepting marks the application hired and creates a draft pre-boarding case in the same transaction.
- **Funnel:** counts by stage, conversion, average days in stage and sources, with no personal data.

## Limits

- No email or offer dispatch, no public career page or job-board posting, no resume upload or parsing, no calendar or video integration.
- No salary or CTC is stored; that belongs with Payroll.
- Anonymise clears the record but does not delete it; there is no scheduled purge.
- The pre-boarding preview requires an `@anvi.example` address, so accepting an offer needs one entered explicitly.
- Interview panels are fixed when scheduled; change one by cancelling and scheduling again.
- The email duplicate hash is keyed; run `pnpm recruit:rehash` before retiring the oldest key.

## Tests

- Integration (`tests/recruit.integration.ts`): role access, lookups (manager and HR allowed, employee and auditor refused, only id/code/name, in-effect units of the caller's tenant only), contact visibility, requisition lifecycle and re-approval, duplicates, consent, stage matrix, interview conflicts, blind scorecards, offer four-eyes and hand-off, no personal data in audit or outbox, pagination, direct-statement refusals, concurrency.
- Browser (`tests/e2e/recruitment.spec.ts`): a hiring manager raises and submits a requisition, two HR users approve it and run it with an interviewer to an accepted offer, with accessibility checks in light and dark and a phone-width overflow check. See [acceptance evidence](../acceptance-evidence/recruitment.md).
