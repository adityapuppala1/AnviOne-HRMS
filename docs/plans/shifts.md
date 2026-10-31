# Shifts and rosters (SHF-01)

Workflow module from the HRMS plan, linked from the backlog (SHF-01). This slice is the backend only: migrations `068_shifts.sql` and `069_shifts_security_fixes.sql` (self security review), `apps/api/src/shift.store.ts` and `shift.controller.ts`, contracts in `packages/contracts/src/shift.ts` and `tests/shift.integration.ts`. The screen (`/shifts`) is built: see [acceptance evidence](../acceptance-evidence/shifts.md).

## Goal

HR keeps a set of shift templates, and HR or a manager puts people on shifts for a date, a date range or a weekly pattern. HR publishes a roster week, after which employees see it and any change needs a reason. Employees swap shifts with a colleague (with an approver who is neither of them) and claim open shifts. Everyone sees planned hours for a week.

## Who does what

| Role                                            | Can                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employee (`shift.self`, self)                   | See their own shifts in published weeks with change history and planned hours, propose a swap with a colleague, accept or decline a swap proposed to them, claim open shifts they are eligible for and withdraw their claim                                                       |
| Manager (`shift.self` self + `shift.team` team) | Everything an employee can, plus put their current direct reports on shifts (draft and published weeks), cancel those shifts, see their reports' rosters and planned hours, approve or reject swaps between two of their reports, post team open shifts and decide claims on them |
| HR admin (`shift.manage`, entity)               | Manage shift templates and the minimum rest setting, roster anyone in the entity, publish roster weeks, approve or reject any swap, post entity-wide open shifts and decide any claim                                                                                             |
| Auditor, platform admin                         | No access                                                                                                                                                                                                                                                                         |

## How it works

- **Templates:** code (2 to 12, `A-Z`, `0-9`, `-`, unique per entity, never changes), name (2 to 60), start and end local time (whole minutes), a crosses-midnight flag (derived: the end is at or before the start), unpaid break minutes (0 to 180, less than the shift), a colour token from a fixed list and an active flag. A shift lasts 15 minutes to 16 hours. Inactive templates cannot be used for new shifts. Templates are never deleted.
- **Shifts (assignments):** one row per person and date. The start and end are copied from the template at assign time (local wall-clock timestamps in the entity's time zone), so editing a template never moves existing shifts. A request covers one date, or a range of up to 62 days filtered by weekdays (ISO 1 = Monday to 7); a range is all or nothing and shares a batch id. Dates run from today (entity local) to a year ahead.
- **Conflicts (database-enforced, under a per-person lock):** a shift is refused if it overlaps another active shift of the same person, leaves less than the minimum rest between two of their shifts (default 11 hours, HR sets 0 to 24), or falls on a date covered by their approved leave. Pending leave does not block. Leave approved after the shift was planned is not blocked by the leave module; the roster shows an `onLeave` flag instead.
- **Publishing:** HR publishes a week (Monday start, entity-wide). Publishing is final. Employees see their shifts only in published weeks; managers and HR also see drafts. Assigning or cancelling a shift in a published week needs a reason (3 to 300) and marks the shift `afterPublish`, so the person sees it changed after publishing. Swaps and filled open shifts in a published week are flagged the same way (their reason is the swap or claim record).
- **History:** every assignment, cancellation, swap (out and in) and open-shift fill writes a row to an append-only history by a narrow writer role. Nobody can update, delete or truncate it.
- **Swaps:** an employee proposes swapping one of their own future shifts in a published week with a colleague's shift on the same date (the colleague must have exactly one). The colleague accepts or declines; the proposer can cancel before a decision. Then an approver decides: HR, or a manager when both people are their direct reports. **Four-eyes:** the approver is never one of the two people (guard plus a check constraint). On approval both shifts change hands in one transaction, conflict checks run again for both people, and both get history rows. A shift can be in only one open swap at a time. An undecided swap whose date has passed shows as expired and can no longer be accepted or approved.
- **Open shifts:** HR posts an entity-wide open shift (anyone can claim) and a manager a team one (only their direct reports can claim), from a template and a date. People claim (one pending claim per person; conflicts are checked at claim time and again at approval). The poster's side decides: HR any claim, a manager claims on their own team open shifts. The approver is never the claimant. Approving one claim fills the shift, creates the shift for the claimant and closes the other pending claims as not selected, all in one transaction. The poster or HR can withdraw an open shift that is still open.
- **Planned hours:** derived per person and week (shift length minus unpaid break, active shifts only). Never stored.
- **Attendance:** read-only, by date only. A roster row shows the attendance check-in and check-out for that person and date when the caller can already see that attendance record. Nothing is compared or computed (no lateness, no variance).
- **Visibility:** self own (published weeks), team own plus current direct reports, manage the entity. Swaps: the two people, plus approvers who may decide them. Open shifts: the ones you can claim, post or have claimed.
- **Audit and outbox:** every write records an audit event and an outbox event in the same transaction with ids, statuses, counts and flags only. Reasons and names never appear in either.
- **Concurrency:** templates, settings, shifts, swaps, open shifts and claims carry a `version`; a stale version gets 409. Writes serialise on advisory locks shared with the guards (per person, per week, per swap shift, per open shift).
- **Errors:** guards raise `SF003` (400), `SF004` (409) and `SF005` (403). A record the caller cannot see answers like one that does not exist (404).

## Honest limits

- No payroll, overtime, allowance or premium calculation. Planned hours are a plain sum for planning only.
- No automatic scheduling, demand forecasting or AI suggestions. People are put on shifts by hand.
- No clock-in integration: attendance is shown next to the shift by date only, never matched or enforced.
- The leave check covers the shift's start date only; a night shift that ends on a leave day is not refused.
- Publishing is entity-wide and by HR only; managers cannot publish their team's week. Weeks cannot be unpublished.
- Proposing a swap tells the proposer whether a colleague has a published shift that day (that is how the swap is found), and, without saying which rule or when, whether the swap would break the colleague's overlap, rest or leave rules.
- Reasons given for changes in a published week are shown to the person whose shift changed, in its history.
- No notifications (email, chat or push) for rosters, swaps or claims.
- Changing the minimum rest does not re-check shifts already planned.
- Times are local wall-clock times, so a daylight-saving changeover is off by an hour. Migration 070 (review fixes): approving a claim on an open shift whose date has passed is refused (409; reject it instead), and conflict messages no longer name dates of the person's unpublished-week shifts.

## Tests

- Integration (`tests/shift.integration.ts`, port 4525): role access, visibility scopes, overlap, rest and leave conflicts, the swap flow with four-eyes, publish lock and reasons, the open-shift claim race, immutability of history, tenant isolation, direct-statement refusals, concurrency, no free text or names in audit or outbox, and pagination.
