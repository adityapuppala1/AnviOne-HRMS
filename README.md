# AnviOne / MyAnvi

A people workspace for HR, managers and employees. **Foundation preview: synthetic data only.**

This first increment contains a responsive portal, scoped employee directory and profiles, role switching, runtime branding, an activity log, PostgreSQL isolation and transactional audit/outbox foundations. Upcoming HR domains are visibly marked and are not operational yet.

![AnviOne foundation workspace](docs/acceptance-evidence/desktop.png)

## Run locally

Prerequisites: Git, Docker Engine/Desktop, and pnpm 11.21.0. Bootstrap Node 24.18+ is supported; `pnpm install` provisions the project-pinned **Node 24.22.1** runtime without changing the machine-wide installation.

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open **http://127.0.0.1:5173** and choose **Explore demo workspace**. Use `127.0.0.1`, not `localhost`, because the exact application origin is checked. The API binds to `127.0.0.1:4000`; PostgreSQL is exposed only on `127.0.0.1:55432`. Stop app processes with Ctrl+C; `docker compose stop` retains the local data volume. Do not tunnel or publicly expose demo mode.

`setup:local` generates random credentials in ignored `.env` and never replaces an existing file. The seed is development-only and idempotent. All names and `anvi.example` addresses are fictional. The profile button opens assigned roles: HR admin, Employee, Team manager, Platform admin and Auditor. Employee sees only self; manager sees direct reports; platform admin configures branding; auditor reads activity.

The internal outbox receipt worker can be run separately:

```sh
pnpm worker
```

It records internal event consumption. It does not send email or claim external delivery.

## Validate

```sh
pnpm format:check
pnpm check
pnpm audit --audit-level=moderate
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
docker build -f infra/docker/Dockerfile.api -t anvione-api:foundation .
pnpm exec node scripts/smoke-image.mjs
```

Integration and browser tests use the synthetic local database. They exercise role grants and branding, and must never target a production database. Run the integration suite before the browser suite, not concurrently. See [acceptance evidence](docs/acceptance-evidence/foundation.md) for measured results and limitations.

## Code map

| Location             | Responsibility                                                   |
| -------------------- | ---------------------------------------------------------------- |
| `apps/portal`        | React Router SPA, responsive screens and TanStack Query hooks    |
| `apps/api`           | NestJS HTTP boundaries, OIDC/session handling, platform services |
| `apps/worker`        | Durable PostgreSQL outbox receipt consumer                       |
| `packages/contracts` | Shared Zod input/output contracts                                |
| `packages/authz`     | Role-to-permission and scope policy                              |
| `packages/database`  | SQL migrations, RLS transactions, audit/outbox, synthetic seed   |
| `packages/ui`        | React Aria controls and Anvi design tokens                       |
| `tests`              | Real PostgreSQL/API tests and browser journeys                   |

Read [the consolidated architecture decision](docs/adr/0001-consolidated-foundation.md), [delivery backlog](docs/backlog.md), [API contract](docs/api/openapi.json), [setup/identity runbook](docs/runbooks/development-and-identity.md), [threat model](docs/threat-model/foundation.md) and [data-protection policy draft](docs/compliance/data-protection-policy.md).

## Release boundary

Corporate OIDC is implemented but has **not** been verified against the organization's Entra tenant. Real identity provisioning, candidate onboarding, file handling, attendance, leave, payroll, AI, MCP and TimeSphere remain future slices. Production requires the identity, privacy, security and operations gates in the backlog, including TLS/CSP, managed keys, independent audit storage, backup restore evidence and security review. Automated tests are not a compliance certification.

No paid UI assets, third-party profile photographs, remote fonts or tracking scripts are included. Third-party licenses and design inspiration are described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Original planning prompts remain local; reviewed decisions and synthetic implementation are published.
