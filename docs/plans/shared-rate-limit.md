# Shared rate limiting (OPS-02)

## Goal

Rate limits hold across every API replica. Before this change each process counted on its own, so N replicas granted N times the sign-in, upload and candidate-code budgets.

## Design

- `RATE_LIMIT_URL` (optional outside production) points at Valkey/Redis. When set, every limiter in the employee API and the candidate API keeps its counters there through `rate-limit-redis`, one key prefix per limiter (`anvione:rl:<limiter>:<client>`).
- Production refuses to start without a `rediss://` URL, so counters are shared and travel over TLS.
- Startup fails if the store cannot be reached or rejects the credentials. After a successful start the client reconnects with backoff, never queues commands while disconnected, and gives each counter call one second; a connected but unresponsive store therefore cannot hold requests open.
- During a store outage:
  - the general per-client limiters (240/min API, 120/min candidate) let requests through, keeping the service available;
  - sign-in (20/min), document upload (20/min), candidate code request (20/min) and code exchange (30/min) fail closed with a `503` problem response and `Retry-After: 30`, logged as `rate_limit.store_unavailable` with the request ID, so an outage cannot be used to bypass them.
- Store errors are logged as `rate_limit.store_error` with the error name only; URLs and passwords are never logged.
- Without `RATE_LIMIT_URL` the limiters stay in memory, which is acceptable only for a single local instance.

## Local environment

`pnpm setup:local` generates `VALKEY_PASSWORD` and `RATE_LIMIT_URL` (also for an existing `.env`, without replacing other secrets). Compose starts Valkey with that password on `127.0.0.1:56379` only, with persistence disabled.

## Tests

- Unit (`config.test.ts`): production requires `rediss://`; non-Redis URLs are refused.
- Integration (`tests/rate-limit.integration.ts`): two API instances share the 20/min sign-in budget (the 21st call on either is refused), an unresponsive (paused) store returns 503 for sign-in while health checks still answer, and startup with a wrong password is refused.
- `tests/support/reset-rate-limits.ts` clears the local counters before every integration file, because suites now share one store.

## Out of scope

Managed Valkey provisioning, TLS certificates and high availability for the store belong to platform operations (OPS-03/SEC-03).
