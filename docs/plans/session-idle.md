# Idle sessions that really expire

Part of IAM-05 (idle expiry UI). It supersedes nothing; it is linked from the backlog entry F0.18 and the README.

## The problem

The database ends a session after 15 idle minutes (HR admin, platform admin, auditor) or 30 (employee, manager). But every authenticated request refreshed the session's last-seen time, and the portal polls the API every minute for the approvals count, attendance and updates. A browser tab left open therefore never went idle, and the limits could not fire: a forgotten, unlocked tab stayed signed in.

## The fix

**Server**

- A GET request carrying `X-Anvi-Idle: 1` still has its session validated (expired or idle sessions still get 401), but it does not refresh the last-seen time. Writes always count as activity, whatever the header says.
- The header can only ever bring expiry closer, so it gives a stolen cookie nothing: the holder could already refresh the session with any normal request.
- `/me` now includes `idleLimitSeconds` (900 or 1800), mirroring the database rule, so the portal can warn in time. The database stays the authority.
- Idle polls no longer write to the database at all.

**Portal**

- Real input (click, key, touch, scroll or wheel; not mouse movement) is tracked. A read made more than 20 seconds after the last input is sent as background polling.
- While someone is active, a heartbeat tells the server at most once a minute. Activity in one tab counts for all tabs, through two timestamps in `localStorage`.
- Two minutes before the limit, if the person is idle, a dialog asks "Still there?" with a countdown, **Stay signed in** and **Sign out now**. Staying sends a heartbeat. The countdown is hidden from screen readers; the dialog text carries the message.
- When the limit passes, the portal signs out and the login screen says "You were signed out after a period of inactivity."

## What is unchanged

The absolute 8 hour session lifetime (a separate rule), CSRF and origin checks, role-switching, and every permission.

## Tests

- Integration (`tests/idle.integration.ts`, against the real database rules): `/me` reports 1800 and 900 for the right roles; a request marked idle validates but does not refresh; polling alone cannot keep a session past its limit (401); employees and managers are valid at 29 minutes and expired at 31; HR, platform admin and auditor are valid at 14 and expired at 16.
- Browser (`tests/e2e/idle.spec.ts`, using a fake clock): the warning appears before the HR limit and is accessible; "Stay signed in" closes it and tells the server; going idle past the limit signs out with the explanation; ordinary use never shows the warning.

## Review

An Opus security review found no critical, high or medium issues. Its low finding (writes should always count as activity) is applied; its note about the portal's offline behaviour is already handled, because the guard's own timer signs out locally once the limit passes even if the heartbeat cannot reach the server.

## Not included

A visible "session expires at" for the 8 hour absolute lifetime, and administrator-configurable limits. Access reviews, the rest of IAM-05, remain open.
