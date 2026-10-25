# F0.13: Shared approval routing and inbox

Authoritative implementation plan, 26 October 2026. Advances WF-01. All records remain synthetic.

## Outcome

Leave requests and attendance corrections use one routing rule and one decision rule, defined once in the database. Managers and HR get a single Approvals inbox listing every decision waiting for them across modules, with a count in the navigation. Approving or declining from the inbox uses each module's existing versioned endpoint, so audit, outbox and ledger effects are unchanged.

## Approach

- Migration 018 adds two STABLE `SECURITY DEFINER` functions owned by NOLOGIN `anvione_workflow_keeper`:
  - `workflow_route(tenant, entity, requester)` returns the approver kind and manager snapshot: the current manager, or HR when there is none.
  - `workflow_decision_error(tenant, entity, requester, approver, manager, decider, scope)` returns `NULL` when the decider may decide, or the reason they may not. A decider may not be the requester and must be a current employee. A manager must still manage the requester; HR decides HR-routed requests and requests whose manager has moved on.
    The leave and attendance-correction guards are replaced to call them. Each keeps its own error codes and module-specific checks. Execution is granted only to the two module keeper roles.
- API: `GET /approvals` (managers and HR) merges pending leave and attendance-correction items visible under RLS into one list. Each item carries its kind, requester, summary, submitted time, version and `canDecide`. Decisions go to the existing module endpoints.
- Portal: an Approvals route and nav item, with a pending count, for anyone who can approve. The inbox groups items into "Needs your decision" and "Routed to others", and approves or declines in place.

## Decisions

- No generic workflow tables yet. Each module keeps its own record and state machine, and only the routing and authorization rules are shared. A configurable multi-step engine remains open under WF-01.
- Onboarding readiness reviews keep their maker-checker model and appear in the inbox for HR. The maker never sees their own proposal as decidable, and approval is disabled until local evidence is complete.

## Verification

- Existing leave and attendance integration suites must pass unchanged against the shared rules.
- New integration tests: inbox aggregation across both kinds, RLS scope (manager versus HR), `canDecide` parity with module rules, routing-function results, and execution grants.
- Browser test: the inbox count, approving a leave request and an attendance correction from the inbox, axe, dark mode and the 390px width.

## Recovery

Forward-only migration; the previous guard bodies remain in migrations 016–017 history. Disable the route without data impact.
