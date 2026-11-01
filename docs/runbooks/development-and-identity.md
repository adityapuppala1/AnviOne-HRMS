# Development and identity runbook

## Local environment

Use the commands in the root README. Keep `.env` private. `pnpm exec node --version` should report 24.22.1. Docker Compose runs PostgreSQL 18.6 and a reserved Valkey service; only PostgreSQL has a host port, bound to loopback. API and frontend run as host development processes. There is no object-store, email or file-scanning service because those capabilities are not enabled.

If sign-in fails, check `/readyz` on port 4000, verify migrations and synthetic seed completed, and use the exact origin `http://127.0.0.1:5173`. Avoid logging the contents of `.env`, session cookies or HTTP bodies while diagnosing. An API readiness failure does not justify disabling auth or RLS.

Run migrations with the dedicated `MIGRATION_DATABASE_URL`. The application starts only with a non-owner role without superuser/BYPASSRLS. Migration 001 creates the foundation; migration 002 transfers identity lookup functions to a narrowly granted NOLOGIN role. Migrations take an advisory lock and commit their ledger entry atomically. Re-running does not recreate tables. Do not edit a migration that has shipped; append a new migration.

`pnpm db:seed` creates a fake team, a separate isolation fixture, and a fake identity binding. It never modifies existing employee rows or resets published branding. It is blocked unless `NODE_ENV=development` and `AUTH_MODE=demo`.

## Corporate identity setup (requires organization configuration)

1. Register a confidential web application in the approved Entra tenant. Register the exact HTTPS callback `/api/v1/auth/callback` at the deployment origin.
2. Provide tenant-specific `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `OIDC_REDIRECT_URI` through the environment/secret manager. Never use the common/organizations/consumers issuers or commit the client secret.
3. Configure a tested Entra authentication context with the required MFA/conditional-access policy. Set its identifier in `OIDC_REQUIRED_ACR`; production refuses to start without it, and callback processing requires the corresponding signed `acrs` claim. Validate this with the identity owner; merely setting the environment variable does not configure Entra policy.
4. Provision an approved effective employment through the organization's controlled process, then use the [dedicated identity-binding command](identity-operations.md) with externally verified HR/identity evidence. It defaults to dry-run and grants only Employee. The candidate approval/activation workflow and privileged role administration remain separate milestones; do not use the seed or a web signup as a substitute. Identity resolution never trusts email or creates an employee from a token.
5. Set `AUTH_MODE=oidc`, `NODE_ENV=production`, `APP_ORIGIN=https://your-approved-host` and certificate-validated database TLS (`sslmode=verify-full`, appropriate trusted CA). Configure the API's private bind/port and TLS reverse proxy; preserve the configured Host.
6. Exercise known/unknown/inactive identity cases, wrong issuer/audience, invalid nonce/state, replay, missing authentication context, revoked roles, failed callback, idle/absolute expiry and logout. Record evidence before real access.

The API uses openid-client for discovery and signature/claim processing, authorization code with PKCE S256, per-attempt state/nonce, a five-minute single-use database attempt and HttpOnly browser binding. Access/ID tokens are not sent to the frontend or persisted. A successful login creates a random opaque session with only its hash stored. HTTPS uses a host-only `__Host-anvi_session` cookie. All cookie-authenticated mutations require exact Origin and CSRF token checks. GET endpoints cannot change business records.

## Outbox operations

Run `pnpm worker` with the separate worker credential. It polls due, unprocessed branding and organization events using row locks, writes an idempotent internal receipt, and marks processed in the same transaction. Two workers can run without duplicate receipts. A failed transaction remains eligible. The worker has no employee-table access. No queue service is the system of record and Valkey loss cannot erase these events.

Future external delivery must add leases/retries/dead-letter handling and provider idempotency while preserving event/receipt atomicity. Current receipts are **not evidence of email or webhook delivery**.

## Packaging and production gates

`pnpm build` produces the static portal at `apps/portal/build/client` and bundled Node entrypoints at `dist/api/src/main.js` and `dist/worker/src/main.js`. The API image recipe uses a pinned Node image digest, a pruned production dependency installation and the non-root `node` user. It has no secrets or seed execution. Running it requires the separately provisioned database and verified OIDC environment.

Portal hosting, TLS gateway, CSP for React Router's static bootstrap scripts, worker image, deployment manifests, secret manager, shared rate-limit store, encrypted volumes, independent audit archive, observability and certified HA profiles are not delivered by the API image. These remain release gates. No Kubernetes profile is represented as tested.

## Recovery and rollback

Local development can stop/restart without dropping the named PostgreSQL volume. Do not run `docker compose down -v` unless intentionally discarding the synthetic environment. There is no verified production backup/restore system yet.

Before real deployment, operators must approve encrypted off-host database/object backups, key recovery, restore isolation, restore-time session revocation, outbox reconciliation and employee-code high-water reconciliation. Prove RPO/RTO with a recorded drill. An image rollback does not reverse a database migration. Migration 003 moves repeated employee labels into person/master records; deploy the matching application during a controlled maintenance window. An older API querying removed columns is not a supported rollback. Use a reviewed forward fix or coordinated verified restore; never erase audit/issuance records or reset the sequence as a rollback shortcut.

Behind a TLS gateway or load balancer, set `TRUST_PROXY` to the number of proxy hops (1–5) or to the proxies' IPs/CIDRs, so rate limits and audit see real client addresses. Leave it empty when the API faces clients directly. Trusting every proxy is refused, and demo sign-in cannot run behind a proxy.
