# Updates feed (in-app)

First, honest slice of NOT-01: people see decisions on their own requests inside the portal. No e-mail, push or other external delivery exists or is claimed.

## What it does

A bell in the top bar shows a count of new decisions and opens an **Updates** dialog listing, for the last 30 days:

- leave requests that were approved or declined,
- attendance corrections that were approved or declined,
- documents that were verified or rejected.

Each entry shows the outcome, what it was about (leave type and days, dates, or the document title), who decided, the decision note if there is one, and how long ago. A link opens the relevant page. Decisions are marked **New** until the person closes the dialog.

Cancelling or withdrawing your own request is not an update, because you did it yourself.

## Access

- Endpoint `GET /api/v1/updates`; it takes no input.
- Every query runs in the caller's scoped transaction **and** filters on the caller's own employee id. Managers and HR have wider row-level access to other people's requests, so the explicit filter is what keeps the feed personal.
- A category appears only if the active role can make that kind of request (`leave.request`, `attendance.self`, `document.self`). Auditors and platform admins get an empty feed; in the HR context the feed is empty because HR does not request leave there, so switch to the Employee context to see your own.
- Only fields the owner's own screens already show are returned: outcome, title, dates, reviewer label, decision note, time. No file content, hashes or reviewer-only data.
- Output is bounded (20 per category, 30 in total, titles capped at 120 characters) and validated by a strict schema before it leaves the server.
- The browser remembers one "last seen" timestamp per person in `localStorage` to count what is new. It holds no record content, is optional, and nothing breaks without it.

## Tests

- Integration (`tests/updates.integration.ts`): anonymous refused; an employee sees their own decisions newest first with note, reviewer, title and dates; old (45 days), pending, cancelled and other people's requests never appear; a manager's wider visibility does not widen the feed; roles without personal requests get an empty feed.
- Browser (`tests/e2e/updates.spec.ts`): the bell opens the dialog, the intro and either entries or the empty state show, axe passes, Escape closes it, and it works in dark mode on a phone without sideways scroll. A one-off check with planted records confirmed the populated layout.

## Review

An Opus security review found no blocking issues. Its robustness point (a very long title would fail the whole feed) is fixed in SQL; clearing the remembered timestamp on sign-out is optional and not done.

## Not included

E-mail or push delivery, per-event preferences, and updates about things other people do (for example "someone requested leave from you"): the Approvals inbox and its count already cover waiting decisions.
