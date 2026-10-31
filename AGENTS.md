# AGENTS.md

This is AnviOne / MyAnvi, an HRMS monorepo (pnpm, NestJS API, React Router portal, PostgreSQL with row-level security).

Before you change anything, read these in order:

1. [docs/HANDOFF.md](docs/HANDOFF.md): module status, pending work, how to run, how to verify, the next plan.
2. [CLAUDE.md](CLAUDE.md): project rules. Follow them exactly. Key ones:
   - Build screens from Untitled UI components imported from `@anvi/ui`. Only free MIT components.
   - Migrations are forward-only. Never edit an applied migration; add a new one.
   - Security, auth, RLS and migration work gets an independent review before commit.
   - Audit and outbox rows carry ids and counts only, never personal values.
   - AI features stay off; suggestions are rule-based and labelled as such.
   - One commit per slice. No attribution lines in commits or PR descriptions.

Run the app with `pnpm start:all` (checks prerequisites, refuses to start a duplicate, starts the database and the servers). Run checks with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e`. Stop `pnpm dev` before `pnpm test:e2e`.
