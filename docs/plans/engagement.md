# Recognition and engagement (ENG-01)

Workflow module from the HRMS plan, linked from the backlog (ENG-01) and [the benchmark](../research/hrms-benchmark.md) ("Recognition and engagement surveys"). This slice is the backend only: migrations `062_engagement.sql` and `063_engagement_security_fixes.sql` (self security review: people whose joining date is still ahead are no longer offered as recipients, recognised or made survey-eligible; the giver's "given today" count now includes hidden posts, as the cap does) and `064_engagement_review_fixes.sql` (independent review: answers are checked against the wall clock under the survey lock and a survey closed by time releases results only 2 minutes after its close time, so no late answer can follow a release; HR cannot moderate a post they gave or received; a survey response writes no audit row), `apps/api/src/engage.store.ts` and `engage.controller.ts`, contracts in `packages/contracts/src/engage.ts` and `tests/engage.integration.ts`. There is no screen yet.

## Goal

Colleagues thank each other publicly for living a company value, and HR runs short pulse surveys whose answers cannot be traced back to the person who gave them.

## Who does what

| Role                                    | Can                                                                                                                                                                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employee, manager (`engage.self`, self) | Give recognition to a colleague in their entity (never themselves), read the entity feed and what they gave and received, react once per post, see published surveys they are eligible for, answer each once, see whether they answered |
| HR admin (`engage.manage`, entity)      | Everything above, plus manage the company values, hide or restore a post with a reason (moderation history), create, edit (draft only), publish and close surveys, and read survey results as aggregates only                           |
| Auditor, platform admin                 | No access                                                                                                                                                                                                                               |

## How it works

### Recognition

- **Values:** an admin-managed list per entity (name 2 to 40, active flag, sort). Seeded for existing entities: Customer first, Ownership, Teamwork, Integrity, Learning, Excellence. Retired, never deleted.
- **Posts:** giver (always the caller), recipient (a current employee of the same entity, never the giver; enforced by a check constraint and the guard), an active value and a message of 1 to 280 characters. The giver and recipient names are copied onto the post when it is written.
- **Daily cap:** at most 10 posts given per person per UTC day, counted by the database guard under a per-giver advisory lock, so parallel requests cannot exceed it.
- **Feed:** every post in the entity, newest first, paged. Views: feed, received, given; HR also has hidden.
- **Reactions:** a fixed set of codes, no emoji: `thanks`, `applause`, `inspiring`, `helpful`, `celebrate`. One reaction per person per post (unique), removable by its author, not on hidden posts.
- **Moderation:** HR hides a post with a reason (3 to 500) and can restore it with a reason. Each step is written to an append-only moderation history (HR only) and flips the post's hidden flag through a narrow writer role. Hidden posts disappear from the feed, given and received views for everyone but HR. The reason stays in the history table only, never in audit or outbox.
- **No cash value, no points, no redemption, no leaderboard.** Recognition is a thank-you, nothing more.

### Pulse surveys

- **Surveys:** title (3 to 120), an open and close time, 1 to 12 questions. Question kinds: rating 1 to 5 (required), single choice with 2 to 8 options (required), short text up to 500 characters (optional). Drafts are editable; publishing freezes the questions; HR can close a published survey early. A survey is accepting answers while it is published and the current time is inside its window.
- **Eligibility:** current employees (active or on notice) of the entity at the moment of publishing, snapshotted then. People who join later cannot answer that survey.
- **Anonymity by design:**
  - Participation (`eng_survey_participation`: survey, employee) and answers (`eng_survey_answer`: survey, question, value) are separate tables. The answer table has no employee column, no link column, no timestamp or date, and random UUID ids with no sequence.
  - Both are written in one transaction by `eng_submit_response`, a `SECURITY DEFINER` function owned by a NOLOGIN writer role that may insert answers but cannot read them. The app role has no privilege at all on the answer table. Results are read only through `eng_survey_results`, owned by a NOLOGIN keeper role that can read answers but not participation. No role the app can reach reads both.
  - Participation is visible only to the participant themselves ("you have answered"). HR sees counts only (eligible and responded), never who answered.
  - **k-anonymity:** results are released only once the survey has closed (status closed or its close time has passed) and at least 5 people answered. Below that, HR sees only the count. Waiting for the close stops HR from comparing results before and after one more person answers.
  - Free-text answers appear only under the same rule, in random order, never in submission order.
- **Results:** per rating question the count of each score and the average; per choice question the count of each option; per text question the answers (shuffled) and their count.

### Common

- **Audit and outbox:** every write records an audit event and an outbox event in the same transaction, carrying ids, statuses, codes and counts only. Messages, reasons, survey titles, question text and answers never appear in either. A survey response is the one exception: it writes an outbox event (survey id and count, no person) and no audit row, because an audit row would show anyone with `audit.read` who answered which survey and when (064).
- **Moderation conflicts:** HR cannot hide or restore a post they gave or received; another HR colleague must (064). An entity with a single HR user cannot moderate posts about that user.
- **Stored text (for the UI):** recognition messages, value names, moderation reasons, survey titles, question prompts, choice options and free-text answers are stored as typed (trimmed, length-limited, no HTML filtering). The UI must render them as plain text only, never as HTML or Markdown, and should isolate bidirectional text (`dir="auto"` / `<bdi>`) so control characters cannot spoof surrounding content.
- **Concurrency:** values, posts (moderation) and surveys carry a `version`; a stale version gets 409. Writes serialise on advisory locks shared with the guards.
- **Errors:** guards raise `EG003` (400), `EG004` (409) and `EG005` (403). A post or survey the caller cannot see answers exactly like one that does not exist (404 from the API, one uniform guard message for direct statements).
- **Immutability:** posts, moderation history, eligibility, participation and answers reject update, delete and truncate (triggers `ENABLE ALWAYS`); values and surveys reject delete and truncate. Questions can be replaced only while their survey is a draft.

## Honest limits

- No sentiment analysis, no AI, no eNPS or benchmark comparison, no trend charts across surveys.
- No notifications or reminders of any kind (no email, chat or push) for recognition or surveys.
- Anonymity depends on groups being large enough. With fewer than 5 answers there are no results at all; with exactly 5 or a little more, a manager who knows how most people answered could still infer the rest. Free text can identify its author by what it says; the system cannot prevent that.
- Anonymity is guaranteed against the application and HR, not against a database superuser or someone with access to database files or logs (a superuser could correlate rows through system columns written in the same transaction).
- HR sees the live response count and controls when a survey closes. HR could run two identical surveys and close them at different counts, then compare the results; with outside knowledge of who answered in between, the difference points at those people. The system does not detect repeated surveys; this is a governance matter.
- HR users are eligible and may answer, so for the other respondents the effective group can be smaller than 5 by the number of HR respondents.
- With a database connection as the app role, the per-table insert statistics (`pg_stat_user_tables`) show how many answer rows a response added (for example whether optional text was given); they never show what was answered or by whom.
- Results are for the whole entity; there is no breakdown by team, location or grade (it would break anonymity for small groups).
- A published survey cannot be edited or re-opened; its window cannot be extended.
- The daily recognition cap counts UTC days.
- Values and surveys are per entity; new entities get no seeded values until HR adds them.
- To pick a recipient, every employee can look up the names (only) of current colleagues in their entity, 20 at a time. This is wider than the employee directory scope.
- Reactions can be removed and added again; each change is audited. There is no per-person rate limit on reactions beyond the shared API limits.
- Recognition carries no cash value, points or redemption; there is no leaderboard.

## Tests

- Integration (`tests/engage.integration.ts`, port 4521): role access, feed visibility, self-recognition refusal, daily cap (including in parallel), reaction uniqueness and removal, moderation with history, hidden posts leaving the feed, survey lifecycle, eligibility snapshot, double-answer refusal, anonymity (the answer table has no employee, link or time column; the app role cannot read answers; participation is self-only), the k=5 threshold and close rule, tenant isolation, immutability, direct-statement refusals, optimistic concurrency, no free text in audit or outbox, and pagination.
