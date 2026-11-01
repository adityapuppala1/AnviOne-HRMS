# ADR 0001: Consolidated foundation and delivery boundary

Accepted for implementation, 25 October 2026. Production release approval remains outstanding.

## Context and decision

The local workspace contained three requirements documents and no application. The requested GitHub repository contained only a README and MIT license. No existing application needed migration. `RTK.md` and repository `AGENTS.md` files were not present in the workspace or its ancestor directories when inspected; the instructions supplied in chat remain applicable.

Use **ChatGPT_AnviOne_MyAnvi_Master_System_Prompt.md** as the controlling architecture/security baseline. Use **Claude V2** for the module inventory, workspace navigation, and implementation layering. The user explicitly requested independent research, selection, and implementation, authorizing the decisions in this record.

| Topic           | Selected direction                                                                | Reason                                                                                             |
| --------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Architecture    | TypeScript modular monolith, separate durable-work process                        | Both plans agree; supports transactional HR rules and a manageable installation                    |
| Frontend        | React + React Router framework SPA + Vite                                         | ChatGPT baseline; authenticated workspace has no SSR/SEO requirement                               |
| Server          | NestJS, versioned REST, shared Zod contracts                                      | Clear service boundaries and independently validated inputs                                        |
| Identity        | Corporate OIDC, immutable issuer/subject, approved active employment              | Email can change; a matching domain is insufficient authorization                                  |
| Local access    | Explicit loopback-only synthetic demo, blocked outside development                | Allows review without corporate credentials; never a production fallback                           |
| Local passwords | Deferred                                                                          | Avoid introducing a second identity/MFA system before an approved operational need                 |
| Role context    | Granted-role intersection, session rotation, cache clearing                       | Platform configuration authority does not confer employee-data authority                           |
| Candidate       | Separate origin and session boundary, later slice                                 | Do not reuse employee sessions or create employees from SSO                                        |
| Attendance      | Provisional LOP with human review and appeals                                     | Missing attendance must not silently become a salary deduction                                     |
| Impersonation   | Disabled, no endpoints                                                            | Normal role switching never changes the actor identity                                             |
| Offline         | No employee-data service worker or offline PII cache                              | Explicit privacy review before allowing cached payslips/profile data                               |
| Audit           | Transactional append-only runtime access now; independent immutable archive later | A hash chain in a mutable database does not prove protection against DB administrators             |
| Integrations    | TimeSphere, mail, AI and MCP disabled until their respective contracts/gates      | A proposed endpoint or synthetic adapter is not integration evidence                               |
| Data access     | Parameterized `pg` and committed SQL for the foundation                           | Small schema with explicit RLS transactions; Prisma adoption evaluated when lifecycle writes begin |
| UI libraries    | Original Anvi components over React Aria, Lucide, Tailwind tokens                 | Same accessible primitives as Untitled UI; no PRO components or unlicensed assets copied           |
| Motion          | CSS transforms on decorative illustrations, no blocking animation                 | No need to add Magic UI/Motion solely for a small effect; reduced motion fully supported           |
| Capacity        | ChatGPT workload is a sizing hypothesis                                           | No performance or employee-capacity claims before measurements                                     |

The first implementation increment is **foundation F0.1**, spanning ChatGPT Phase 0 decisions and part of its Phase 1 skeleton (Claude calls this Phase 0). It is not completion of either full phase.

## Implemented vertical slices

- Synthetic approved identity -> server session -> role-scoped directory -> profile -> sign-out.
- Assigned platform-admin context -> version-checked branding update -> atomic audit + outbox -> refresh without rebuild.
- Assigned auditor context -> latest 50 audit events for the current entity.
- PostgreSQL outbox -> internal receipt with row locking and idempotent primary key.

The directory is deliberately read-only. Employee context sees self; manager context sees self and **direct reports only**; HR sees the current legal entity. Indirect-report traversal and organization-wide employee directory visibility require a later approved policy and tests. Counts, facets, dashboard summaries and profile endpoints use the same RLS context. No compensation, bank, medical, private contact or identity-document columns exist in this increment.

## Structure

```text
apps/portal        React SPA, route modules and query hooks
apps/api           NestJS HTTP boundary, sessions/OIDC, platform services
apps/worker        PostgreSQL outbox receipt consumer
packages/contracts Zod request/response schemas and role vocabulary
packages/authz     Pure deny-by-default permission and scope decisions
packages/database  SQL migrations, context transactions, audit/outbox, synthetic seed
packages/ui        React Aria wrappers, visual tokens, dialogs and common states
infra/docker       Non-root API image recipe
docs               Decisions, contracts, policy drafts, runbooks and evidence
tests              Database/API integration and browser regression journeys
```

## Research used to make the decision

Reviewed on 25 October 2026. These links explain decisions, not certifications.

- [Microsoft ID-token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference): email is unsuitable as an authorization key; use stable provider identifiers.
- [React Router SPA mode](https://reactrouter.com/how-to/spa): framework routing can produce a static SPA with `ssr: false`.
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): owners/superusers/BYPASSRLS require explicit care. Runtime is neither owner nor bypass role; connection context is transaction-local.
- [PostgreSQL version policy](https://www.postgresql.org/support/versioning/): use supported current minor releases; local database is pinned to 18.6.
- [Node October security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases): project runtime pinned to patched 24.22.1; no machine-wide runtime modification.
- [pnpm runtime pinning](https://pnpm.io/package_json#devenginesruntime): project scripts use the lockfile-pinned runtime.
- [openid-client example](https://github.com/panva/openid-client/blob/main/examples/oidc.ts): supported code flow and PKCE library; application additionally binds state, nonce, fixed callback and approved employee identity.
- [OWASP ASVS](https://asvs.owasp.org/): Level 2 is the future verification target, with evidence required per applicable control.
- [MeitY DPDP Rules and enforcement resources](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025%3B): legal owners must determine applicable obligations and effective dates before employee data is introduced.
- [Dribbble HRMS collection](https://dribbble.com/search/hrms), [Monkyne HRMS dashboard](https://dribbble.com/shots/21873524-HRMS-Dashboard), [Allsec employee dashboard](https://dribbble.com/shots/10762453-Allsec-HRMS-Employee-dashboard): inspiration for navigation, scan-friendly people panels and contextual information. No images or source components copied into the product.
- [Untitled UI public repository](https://github.com/untitleduico/react): reviewed the React Aria foundation and public/PRO licensing distinction.

## Visual direction and critique

Audience: HR, employees and managers. Primary job: find a person or understand the current permitted workspace quickly.

Palette: evergreen action `#246453`, deep green navigation `#133630`, cool canvas `#F5F7F8`, white surface `#FFFFFF`, ink `#202D35`, muted green illustration. Manrope headings, DM Sans body, system fallback; fonts hosted locally. Two alternative palettes and dark mode use named semantic tokens.

```text
Desktop: navigation | context + search + preferences
                    | greeting / workspace context
                    | people connection illustration + directory action
                    | scoped counts
                    | recent colleagues | department breakdown
                    | directory / personal profile shortcuts

Mobile: compact context bar -> same content in one column -> drawer navigation
```

Signature: layered paper-like profile cards, rendered with CSS perspective and restrained transforms. It is decorative and hidden from assistive technology. Early review removed whole-page opacity animation because it reduced legibility during entry. Small text was enlarged after screenshot review. Only completed capabilities have interactive navigation; future domains are labeled “Soon.”

## Consequences and unresolved work

OIDC code exists but no live Entra tenant, client, conditional-access context or approved identity bindings were supplied; no live SSO completion is claimed. Production is blocked pending the backlog gates. There is no file upload, payroll, attendance, invitation, AI or external notification capability yet. Existing original requirements stay local because the destination is public; this decision record and synthetic code are published instead.
