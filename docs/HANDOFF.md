# AnviOne / MyAnvi HRMS: handoff

Read this first, whichever model or tool you are. It says what exists, what is still open, and how to start. Project rules are in [CLAUDE.md](../CLAUDE.md) (also summarised in [AGENTS.md](../AGENTS.md)). Product overview is in the [README](../README.md).

Last updated: 2026-11-01. Branch `feat/phase-0-foundation`, remote `origin`.

## 1. Start the app

Prerequisites: Node 22 or newer, pnpm (`corepack enable`), Docker Desktop running.

```bash
pnpm install
pnpm setup:local      # writes random local secrets to .env once; never overwrites
pnpm db:up            # Postgres and Valkey containers
pnpm db:migrate       # applies every migration in packages/database/migrations
pnpm dev              # portal http://127.0.0.1:5173, API http://127.0.0.1:4000
```

Or run `pnpm start:all` (see `scripts/start.mjs`), which does these steps and refuses to start a second copy if the ports are taken.

Demo sign-in: "Explore demo workspace" on the login page, or a persona button per role (see `docs/runbooks/demo-personas.md`).

Stop: `Ctrl+C` in the `pnpm dev` terminal, then `pnpm db:down` if you want the containers stopped.

## 2. Verify before you commit

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test                 # unit, about 1 minute
pnpm test:integration     # node:test against the live database, about 6 minutes
pnpm build
pnpm test:e2e             # Playwright against the built portal, 60+ minutes for the full run
```

Stop `pnpm dev` before `test:e2e`, or Playwright reuses the dev servers and tests misbehave. Run `pnpm build` first.

Targeted runs while fixing: `pnpm exec playwright test tests/e2e/<spec>.spec.ts --workers=1`.

### Workflow

- **Branches:** work on a feature branch, one per slice. Parallel agents each use their own git worktree from the same base branch. Merge them one at a time, and resolve `docs/TRACKER.md` by hand, since every branch edits it.
- **Tracker:** when a task finishes, update its row in `docs/TRACKER.md` with the date and commit. Do not leave a row `doing` after the work has stopped.
- **Time limits:** run the integration and browser suites with a timeout, and watch the log file. A log that has not changed for 10 minutes is stalled. On Windows, stop it with `taskkill /PID <pid> /T /F`, then rerun the failing file alone.
- **Port and process hygiene:** stop `pnpm dev` before `pnpm test:e2e`. Before an integration run, check that the API, portal and test ports are free with `netstat -ano | findstr LISTENING`. A leftover test server causes `EADDRINUSE` and misleading failures.
- **Shared demo logins:** an integration test must not insert a second active identity binding for a demo person, because the database allows one. Reuse the existing binding, grant the roles the test needs, and restore them in cleanup. The projects and recruitment tests do this.
- **CI:** `.github/workflows/ci.yml` runs format, the contracts diff, `pnpm check`, the audit, integration, browser and Docker smoke tests on each push.

## 3. What is built

Every module follows the same slice shape: plan doc in `docs/plans`, forward-only migration, contracts, store and controller, UI, integration and Playwright tests, acceptance evidence in `docs/acceptance-evidence`, backlog and traceability rows.

| Area        | Module                                                          | Backend | Portal route                         | Status                          |
| ----------- | --------------------------------------------------------------- | ------- | ------------------------------------ | ------------------------------- |
| Core        | Directory, org masters, org chart                               | yes     | `/people`, `/organization`, `/chart` | built                           |
| Time        | Attendance, leave, calendar                                     | yes     | `/attendance`, `/leave`, `/calendar` | built                           |
| Onboarding  | Pre-boarding intake                                             | yes     | `/onboarding`                        | built                           |
| Documents   | Documents, policies, assets                                     | yes     | `/documents`, `/policies`, `/assets` | built                           |
| Spend       | Expenses, projects and time                                     | yes     | `/expenses`, `/projects`             | built                           |
| Exit        | Offboarding                                                     | yes     | `/exit`                              | built, no dues or settlement    |
| Profile     | Personal details changes (PRF-01)                               | yes     | `/details`                           | built                           |
| Recruitment | Requisitions, candidates, pipeline, interviews, offers (REC-01) | yes     | `/recruitment`                       | built, no email or career page  |
| Performance | Goals, OKRs, review cycles, blind reviews (PERF-01)             | yes     | `/performance`                       | built                           |
| Helpdesk    | HR cases, SLA, knowledge articles (HLP-01)                      | yes     | `/helpdesk`                          | built, wall-clock SLA only      |
| Engagement  | Recognition, anonymous pulse surveys (ENG-01)                   | yes     | `/engage`                            | built, no notifications         |
| Learning    | Courses, assignments, completion (LRN-01)                       | yes     | `/learning`                          | built, self-declared completion |
| Shifts      | Shift templates, rosters, swaps, open shifts (SHF-01)           | yes     | `/shifts`                            | built, no payroll or overtime   |
| Reports     | Reports and insights                                            | yes     | `/reports`, `/insights`              | built                           |
| Admin       | Configuration, permission matrix, branding history              | yes     | `/configuration`                     | built                           |
| Demo        | Persona sign-in                                                 | yes     | `/login`                             | built                           |

Migrations run from `053` to `070` at the time of writing. Each integration file has its own port (`tests/*.integration.ts`); check the file before adding one.

## 4. Pending work

Current as of 2026-11-01. The live list with statuses is in [TRACKER.md](TRACKER.md).

**Done and pushed** (`feat/phase-0-foundation`, head `a5dd956`): the Untitled UI upgrade (U1 to U16, each on its own branch and merged), the product backlog P1 to P8, the helpdesk, recognition, learning, shifts and performance modules, and the test fixes for shared demo logins in the projects and recruitment integration tests.

**Not yet verified on the pushed code:**

1. The full browser suite (`pnpm test:e2e`) has not been run since the UI branches were merged.
2. The new UI has not been checked in a browser: the navigation rail and mobile drawer, dialogs, the sliding tab line, the Reports results table, and each new module at 390px and 1440px in light and dark.
3. The P2 totals and sorting, and the learning "due soon" filter, have only unit tests. Their integration tests have not run.

**Known test issues:** 4. The org-chart per-person budget test (`tests/org-neighborhood.integration.ts`) passes alone and on rerun, but fails in some full integration runs because the rate-limit counter resets mid-test. 5. The `wow` reduced-motion browser test fails intermittently. The cause is not confirmed. 6. The Performance browser test once could not find "New review cycle" in a full run. The cause is not confirmed. 7. There is no dev reset for synthetic test data. Deletes are blocked on append-only tables, so test runs leave rows behind. Each module's `docs/acceptance-evidence/<module>.md` lists what its tests leave.

**Product limits, by design:** no notifications or email, no AI features (the helper stays gated off), no 360 feedback, no payroll, benefits or overtime, no business-hours SLA, no calendar or video integration, no public career site. The approvals inbox total is capped at 100 rows across its four sources.

**Needs an outside owner before it can be built:** payroll and benefits, notification dispatch, calendar and video integrations, and a public career site (hosting, bot protection and a privacy review).

**Machine note:** on the author's Windows machine, two system utilities hold port 4471, so the attendance integration test runs on 4531.

## 5. Next plan

1. Run the full integration and browser suites on the pushed code, with time limits, and fix what fails.
2. Make the org-chart budget test, the `wow` test and the Performance test stable, with a confirmed cause for each.
3. Browser-check the new UI at 390px and 1440px in light and dark, and log findings in `docs/acceptance-evidence/ui-audit.md`.
4. Add a dev-only reset for synthetic test data, scoped to the local database.
5. Add integration tests for the P2 totals and sorting and the learning due-soon filter.
6. Pick the next module from [backlog.md](backlog.md) only after the steps above.

## 6. Conventions that matter

- **Untitled UI first.** Import components from `@anvi/ui`, never copy them into a route. Only free MIT components. See [ADR 0008](adr/0008-untitled-ui-everywhere.md).
- **Copy lives in catalogues.** All user text is in `apps/portal/app/lib/copy*.ts`. Activity labels for each new audit action go in `lib/copy.ts`.
- **Security-sensitive work gets an independent review** before commit (CLAUDE.md). Fixes go in a new forward-only migration. Never edit an applied migration.
- **Personal data is sealed.** Audit and outbox rows carry ids, statuses and counts only, never names, notes or values.
- **AI features stay off.** Suggestions are rule-based and labelled as such.
- **Commits:** one per slice. No attribution lines in commits or PR descriptions.
- **Memory:** `C:\Users\pinku\.claude\projects\...\memory` is Claude-only. Anything another tool needs must be in this file or in the repo.

## 7. Where things are

- `apps/api/src` NestJS API: one `*.store.ts` and `*.controller.ts` per module.
- `apps/portal/app` React Router portal: `routes/`, `components/<module>/`, `lib/api.ts` and `lib/*-api.ts` hooks, `lib/copy/` text.
- `packages/contracts/src` zod schemas. OpenAPI is generated into `docs/api/openapi.json` by `pnpm contracts:generate`.
- `packages/database` migrations, RLS setup (`src/index.ts` sets per-request scope variables).
- `packages/authz` permissions by role.
- `packages/ui` shared Untitled UI wrappers and `CollectionView` (ADR 0010).
- `tests/` integration, unit and e2e. `tests/e2e/support/test.ts` clears sign-in rate limits before each test.
- `docs/plans` one plan per module. `docs/adr` decisions. `docs/research` benchmark against Keka and other HRMS.
