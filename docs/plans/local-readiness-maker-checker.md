# F0.7: Local readiness maker-checker

Authoritative implementation plan, 25 October 2026. Extends F0.6. This workflow signs off synthetic local readiness only; it is not employee activation or production evidence.

## Outcome

After form approval and completion of every required checklist task, one HR administrator can propose a local-readiness review. A different active HR identity in the same legal entity can approve or reject it. The maker can withdraw a pending proposal but cannot decide it. Every transition is version checked, transactionally audited and emitted once. Approval does not clear external readiness gates or create employment, employee code, credentials, policy balances or a welcome notification.

## Delivery slices

1. Bind `app.actor_id` to every scoped database transaction and prove it is transaction-local. Database workflow guards use this value rather than a caller-supplied identity.
2. Add an immutable proposal plus versioned decision record under FORCE RLS. Enforce one pending proposal per candidate/kind, maker/checker separation, same-entity HR scope, terminal decision immutability and case-lock ordering.
3. Add strict propose/decide/withdraw contracts and HR endpoints. Recompute local readiness while holding the case lock; reject stale versions, cancelled cases and incomplete local controls. Commit workflow, audit and outbox together.
4. Add an Atlas decision lane to candidate detail: eligibility explanation, proposer/time, pending state, independent-review message and immutable decision history. Do not expose decision controls to the maker.
5. Cover concurrent proposals/decisions, self-approval, cross-entity access, stale versions, audit rollback and zero activation side effects. Publish acceptance evidence and update OpenAPI/backlog/threat model.

## Decisions and boundaries

- Workflow kind is fixed to `candidate_local_readiness_v1`; configurable workflow definitions, delegation and escalation remain later work.
- Actor identity is the immutable identity-binding UUID, not display name, employee ID, role or request input.
- A role switch does not create independence because the actor ID remains unchanged.
- Rejection is terminal; a later attempt requires a new proposal after the case remains locally eligible.
- Candidate sessions receive no workflow data. Auditors continue to use audit events rather than candidate payloads.
- External email ownership, identity, documents and privacy controls stay blocked in the activation dossier. There is no activation endpoint.

## Verification

- Database/API: fail closed without actor context; deny self/cross-entity/stale/duplicate decisions; exactly one concurrent decision; audit/outbox rollback; local-readiness revalidation under lock.
- Browser: eligibility, propose/pending/history states; self-decision unavailable; 320/768/1440 layouts, light/dark, keyboard and reduced-motion checks.
- Full format, generated-contract, lint/type/unit/build, serial integration, browser, dependency audit, container smoke and CI gates.

## Recovery

Disable workflow endpoints and panel, then use a forward migration. Preserve proposals, decisions, audit events and outbox records; never delete decision history as rollback.
