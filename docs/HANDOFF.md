# AnviOne / MyAnvi HRMS: handoff

Read this first, whichever model or tool you are. It says what exists, what is still open, and how to start. Project rules are in [CLAUDE.md](../CLAUDE.md) (also summarised in [AGENTS.md](../AGENTS.md)). Product overview is in the [README](../README.md).

Last updated: 2026-10-31. Branch `feat/phase-0-foundation`, remote `origin`.

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

## 3. What is built

Every module follows the same slice shape: plan doc in `docs/plans`, forward-only migration, contracts, store and controller, UI, integration and Playwright tests, acceptance evidence in `docs/acceptance-evidence`, backlog and traceability rows.

| Area | Module | Backend | Portal route | Status |
|---|---|---|---|---|
| Core | Directory, org masters, org chart | yes | `/people`, `/organization`, `/chart` | built |
| Time | Attendance, leave, calendar | yes | `/attendance`, `/leave`, `/calendar` | built |
| Onboarding | Pre-boarding intake | yes | `/onboarding` | built |
| Documents | Documents, policies, assets | yes | `/documents`, `/policies`, `/assets` | built |
| Spend | Expenses, projects and time | yes | `/expenses`, `/projects` | built |
| Exit | Offboarding | yes | `/exit` | built, no dues or settlement |
| Profile | Personal details changes (PRF-01) | yes | `/details` | built |
| Recruitment | Requisitions, candidates, pipeline, interviews, offers (REC-01) | yes | `/recruitment` | built, no email or career page |
| Performance | Goals, OKRs, review cycles, blind reviews (PERF-01) | yes | `/performance` | built |
| Helpdesk | HR cases, SLA, knowledge articles (HLP-01) | yes | `/helpdesk` | built, wall-clock SLA only |
| Engagement | Recognition, anonymous pulse surveys (ENG-01) | yes | `/engage` | built, no notifications |
| Learning | Courses, assignments, completion (LRN-01) | yes | `/learning` | built, self-declared completion |
| Shifts | Shift templates, rosters, swaps, open shifts (SHF-01) | yes | `/shifts` | built, no payroll or overtime |
| Reports | Reports and insights | yes | `/reports`, `/insights` | built |
| Admin | Configuration, permission matrix, branding history | yes | `/configuration` | built |
| Demo | Persona sign-in | yes | `/login` | built |

Migrations run from `053` to `070` at the time of writing. Each integration file has its own port (`tests/*.integration.ts`); check the file before adding one.

## 4. Pending work

Verified state as of this handoff:

1. **Full verification on the combined code has not completed.** Unit tests, format, lint and typecheck pass. The integration suite and the full browser suite were started, then cancelled to free the services. Run them again.
2. **Open-shift browser test skipped itself** because of a backend 500 that is now fixed (`apps/api/src/shift.store.ts`, `COALESCE` on the `posted` flag). It has not run since the fix, and there is no integration regression test for it yet.
3. **Flaky browser tests:** `wow` reduced-motion (intermittent), and the Performance test once failed in a full run and passed alone. Causes are not known.
4. **Nobody has reviewed the new screens by eye.** Recruitment, Performance, Helpdesk, Recognition, Learning and Shifts pass axe, 390px and their own specs only.
5. **Test data is not cleaned up.** Deletes are blocked on append-only tables, so test runs leave synthetic rows (see each module's `docs/acceptance-evidence/<module>.md`). A dev reset script is needed.
6. **Not converted to the card/table list view:** Settings, and the Reports result table (its columns change per run).
7. **API gaps:** most list endpoints return no total, so paging is client-side only. The Activity log shows the latest 50 events. No endpoint sorts on the server. Department and location pickers load 50 entries.
8. **UI polish:** the tab indicator pops in rather than sliding. No `?detail=` URL state on most lists.
9. **Known product limits, by design:** no notifications, no email or SMS, no AI features (AI helper gated off), no 360 feedback, no payroll, benefits or overtime, no business-hours SLA, no calendar or video integration, no public career site.

Outside owners needed before these can be built: payroll and benefits, notification dispatch, calendar and video integrations, a public career site (hosting, bot protection, privacy review).

## 5. Next plan

In priority order:

1. Run the full verification in section 2 and fix what fails. Add an integration regression test for the open-shift list fix.
2. Look at each new module in a browser, as each persona, at 390px and 1440px. Log findings in `docs/acceptance-evidence/ui-audit.md`.
3. Add a dev-only reset for synthetic test data, scoped to the local database.
4. Convert Settings and the Reports result table to the card/table pattern (ADR 0010).
5. Add server-side totals and sorting where the list endpoints lack them.
6. Only after that, new modules: shifts and rosters follow-ups, then engagement and learning follow-ups from their plan docs.

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
