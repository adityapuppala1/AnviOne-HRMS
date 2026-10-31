# Architecture: dependencies and workflows

A map of how AnviOne is put together. Run instructions are in [HANDOFF.md](HANDOFF.md); project rules are in [CLAUDE.md](../CLAUDE.md). File names below were checked against the code on the date of the last commit to this file.

## 1. Workspace

A pnpm monorepo (`pnpm-workspace.yaml`: `apps/*`, `packages/*`).

| Path                 | What it is                                                                                                                                                                                                                              | Depends on                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `apps/portal`        | React Router single-page portal (Vite, port 5173). Routes in `app/routes`, module screens in `app/components/<module>`, data hooks in `app/lib/api.ts` and `app/lib/*-api.ts`, all user text in `app/lib/copy*.ts` and `app/lib/copy/`. | `@anvi/ui`, `@anvi/contracts`                      |
| `apps/api`           | NestJS API (port 4000, prefix `/api/v1`). One `*.controller.ts` and one `*.store.ts` per module.                                                                                                                                        | `@anvi/contracts`, `@anvi/authz`, `@anvi/database` |
| `apps/worker`        | Background loop (`src/main.ts`): drains the outbox, purges stale sessions, applies due profile changes (hourly by default). Connects as its own database role.                                                                          | `@anvi/database`                                   |
| `apps/candidate`     | Candidate preview app (`src/main.tsx`) served by `apps/api/src/candidate-main.ts` on port 4001.                                                                                                                                         |                                                    |
| `packages/contracts` | zod schemas shared by portal and API (`src/index.ts` plus `engage.ts`, `helpdesk.ts`, `learn.ts`, `shift.ts`, `onboarding.ts`). OpenAPI is generated into `docs/api/openapi.json` by `pnpm contracts:generate`.                         |                                                    |
| `packages/authz`     | Role to permission to scope policy (`src/index.ts`).                                                                                                                                                                                    | `@anvi/contracts`                                  |
| `packages/database`  | `pg` pool helpers, per-request context (`src/index.ts`), migration runner (`src/migrate.ts`), seed (`src/seed.ts`), SQL in `migrations/`.                                                                                               |                                                    |
| `packages/ui`        | Untitled UI components vendored in `src/untitled`, Loom theme (`src/theme.css`), `CollectionView` (`src/collection.tsx`, ADR 0010), patterns (`src/patterns.tsx`).                                                                      |                                                    |

Dependency direction: `portal` and `api` depend on the shared packages; the packages do not depend on apps. The portal never imports from the API.

## 2. Modules

Each module has a controller and store in `apps/api/src`, a screen in `apps/portal/app/routes` (some with parts in `app/components/<module>`), and a plan in `docs/plans`.

| Module                           | API files                                              | Portal route                                 |
| -------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| Directory and people             | `people.controller.ts`                                 | `people`, `teams`, `chart`                   |
| Organization masters             | `organization.*`                                       | `organization`                               |
| Pre-boarding                     | `onboarding.*`, `candidate.store.ts`, `checklist.ts`   | `onboarding`, `assigned-tasks`, `candidates` |
| Leave, attendance, calendar      | `leave.*`, `attendance.*`, `calendar.*`                | `leave`, `attendance`, `calendar`            |
| Approvals                        | `approvals.*`                                          | `approvals`                                  |
| Documents, policies, assets      | `document.*`, `policy.*`, `asset.*`                    | `documents`, `policies`, `assets`            |
| Exit                             | `exit.*`                                               | `exit`                                       |
| Expenses, projects               | `expense.*`, `project.*`                               | `expenses`, `projects`                       |
| Profile changes                  | `profile.*`, `profile.crypto.ts`                       | `details`                                    |
| Recruitment                      | `recruit.*`, `recruit.crypto.ts`                       | `recruitment`                                |
| Performance                      | `performance.*`                                        | `performance`                                |
| Helpdesk                         | `helpdesk.*`                                           | `helpdesk`                                   |
| Engagement                       | `engage.*`                                             | `engage`                                     |
| Learning                         | `learn.*`                                              | `learning`                                   |
| Shifts                           | `shift.*`                                              | `shifts`                                     |
| Reports and insights             | `report.*`, `insights.*`                               | `reports`, `insights`                        |
| Admin configuration              | `platform.store.ts` (permission matrix, branding)      | `configuration`                              |
| Sessions, sign-in, demo personas | `session.controller.ts`, `auth.ts`, `demo-personas.ts` | `login`                                      |

## 3. How a request flows

```
Browser (portal, port 5173)
  |  fetch("/api/v1/...") with the session cookie, X-CSRF-Token on writes
  |  (Vite proxies /api to 127.0.0.1:4000 in development)
  v
Express middleware in apps/api/src/app.ts: helmet, cookies, request id, rate limits
  |  (counters live in Valkey when RATE_LIMIT_URL is set: rate-limit.ts)
  v
SessionGuard (auth.ts)
  |  looks the session up through PlatformStore.session(), which yields the actor
  |  (tenant, entity, employee, active role, role list, csrf token)
  |  for writes: checks Origin and the CSRF token
  v
Controller (<module>.controller.ts)
  |  validates input with the zod schema from @anvi/contracts
  v
Store (<module>.store.ts)
  |  checks the permission with scopeFor(actor, "<permission>") from @anvi/authz
  |  opens a transaction (transaction() in packages/database)
  |  calls setContext(client, actor), which runs set_config('app.*', ..., true)
  v
PostgreSQL as role anvione_app (NOBYPASSRLS)
     row-level security policies read current_setting('app.*') so a query only
     sees the rows the actor's scope allows, whatever the SQL says
```

Notes:

- The `set_config` values are transaction-local (`true` as the third argument), so a pooled connection never carries one actor's scope into the next request. The variables are `app.tenant_id`, `app.entity_id`, `app.employee_id`, `app.actor_id`, `app.actor_label` and one `app.<module>_scope` per module (for example `app.leave_scope`, `app.shift_scope`).
- The check in the store is the first gate and RLS is the second. Neither replaces the other.
- Audit rows are written in the same transaction, with ids, statuses and counts only. No names, notes or values.
- Errors are shaped by `ProblemFilter` in `app.ts` as `application/problem+json`; a 500 logs only the request id.
- On the portal side, TanStack Query hooks (`useQuery`) call `api()` with a zod schema from `@anvi/contracts`, so a response that does not match fails loudly.

## 4. Permission model

- Roles: `employee`, `manager`, `hr_admin`, `auditor`, `platform_admin` (type `Role` in `@anvi/contracts`). A person can hold several roles and switch the active one (`POST /session/role-context`, `canSwitch` in `@anvi/authz`).
- `policy` in `packages/authz/src/index.ts` maps each role to permissions, each with a scope: `self`, `team` or `entity`. `scopeFor(actor, permission)` returns the scope, or nothing if the active role does not hold it.
- `setContext` turns scopes into the `app.*_scope` settings that RLS reads. Where a module has a "self" and a "manage" permission, the wider one wins and the narrower one is the fallback; people with neither get `none`.
- The matrix is visible to HR in Configuration (`/admin/permissions`, `permissionMatrix()`).
- Personal data in profile and recruitment tables is sealed with application-level keys (`profile.crypto.ts`, `recruit.crypto.ts`).

## 5. Database roles and migrations

- Migrations are plain SQL in `packages/database/migrations`, applied in file-name order by `packages/database/src/migrate.ts` using `MIGRATION_DATABASE_URL`. The runner takes an advisory lock, records each file in `schema_migration`, and runs each file in its own transaction.
- Migrations are forward-only. A fix to an applied migration goes in a new file. The current files run `001` to `070` (there is no `040`).
- Roles created in `001_foundation.sql`: `anvione_app` (the API), `anvione_worker`, plus `anvione_identity_operator` and `anvione_candidate`. None can bypass RLS. The runner sets their passwords from `.env` after migrating and refuses to run without generated secrets (`pnpm setup:local`).
- Append-only tables (audit, history, decisions) block updates and deletes with triggers, even for the app role. That is why test runs leave synthetic rows behind.

Sequence by theme:

| Files      | Theme                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------- |
| 001 to 014 | Foundation, identity, people and organization, candidate preview and onboarding                   |
| 015 to 021 | Leave, attendance, calendar, workflow routing, documents, session cleanup                         |
| 022 to 031 | Assets, policies, exit, each followed by hardening fixes                                          |
| 032 to 036 | Expenses, profile changes                                                                         |
| 037 to 050 | Organization masters, reports, org chart, classification, key rotation, branding history          |
| 051 to 055 | Projects, recruitment                                                                             |
| 056 to 070 | Performance, helpdesk, engagement, learning, shifts (each: feature, security fixes, review fixes) |

## 6. Delivery workflow

Each module slice follows the shape in [CLAUDE.md](../CLAUDE.md): plan doc, forward-only migration, contracts, store and controller, UI, integration and Playwright tests, acceptance evidence, backlog and traceability, an independent review for anything touching security, RLS or migrations (fixes in a new migration), the full suite once, then one commit.

Verification commands: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit, Vitest), `pnpm test:integration` (node:test against the live database, one port per file), `pnpm build`, `pnpm test:e2e` (Playwright against the built portal).

## 7. Known limits

No notifications, email or SMS; no payroll, benefits or overtime; AI features are gated off; most list endpoints return no sort order from the server and some return no total (see the tracker, item P2).
