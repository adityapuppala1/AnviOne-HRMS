# Home "Today" panel

Workflow improvement on top of the Loom home screen. It supersedes nothing; it is referenced from the backlog entry F0.18 and the README.

## Goal

The home screen showed directory counts to everyone, even though what people do first each day (record attendance, see leave left, know the next holiday, find what is waiting on them) lived on four other screens.

## What it shows

A **Today** section under the welcome banner, one card per thing the active role can do:

| Card            | Who sees it                                                  | Content                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attendance      | Roles with `attendance.self` (employee, manager)             | Not checked in, checked in with elapsed time, or day complete with hours; on leave, holiday and non-working days are named instead. A **Check in** or **Check out** button does it in place. |
| Leave           | Roles with `leave.request`                                   | Total days available across limited leave types with a count-up number, a bar per type, how many requests await a decision, and a link to request leave.                                     |
| Next holiday    | Everyone                                                     | Name, date and "in N days" from the working calendar.                                                                                                                                        |
| Waiting for you | Roles that decide (leave, attendance, documents, onboarding) | The number of waiting decisions, highlighted when above zero, or "You're all caught up".                                                                                                     |

On phones the Today section comes before the welcome banner, because those are the actions people came to take.

## Access and data

No new endpoint and no change to who can see what. The panel reads the attendance, leave, calendar and approvals data that the screens already load, and the only write is the existing check-in and check-out, which keep their server-side rules (server-stamped time, versioned record, audit and outbox).

## Tests

Browser (`tests/e2e/today.spec.ts`): HR sees holiday and waiting cards but no punch button; an employee sees attendance (checking in if the day is still open), leave with a settled number, and no waiting card; a manager sees both; axe in light and dark; one column and no sideways scroll at 390 px. The check-in itself and its rules are covered by `tests/attendance.integration.ts`.

## Not included

Check-out from the panel is wired but not exercised by the browser test, to avoid completing the shared demo day that other tests also use.
