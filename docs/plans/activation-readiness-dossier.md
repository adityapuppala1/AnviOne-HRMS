# F0.6: Activation readiness dossier

Authoritative implementation plan, 25 October 2026. Extends F0.5; all records remain synthetic and employee activation remains unavailable.

## Outcome

HR can see one server-derived readiness dossier for a candidate case. It separates controls already evidenced in the preview from controls that require external systems or approved policy. The dossier never offers activation and cannot be edited by the browser.

Acceptance requires form approval and every required checklist task to be reported accurately, incomplete checklist items to name the remaining count without exposing private candidate data, and identity, nominated-address delivery, documents and privacy/legal gates to remain explicitly blocked. Candidate sessions receive no dossier.

## Approach and decisions

Add a strict readiness contract and a pure projection from the existing case and checklist records. The API computes the projection inside the same scoped read used for candidate detail; no readiness flags are stored, avoiding stale or forgeable state. `activationReady` is true only when every control is passed. In this preview, external controls are deliberately emitted as blocked, so it is always false even when the form and checklist are complete.

The HR detail uses an Atlas readiness rail: a vertical sequence of control markers, concise evidence text and a single truthful blocked summary. It is responsive, keyboard-neutral, light/dark compatible and uses reduced-motion-safe entry treatment. No dependency is added.

## Boundaries

This slice does not verify email ownership, create document evidence, attest identity, approve legal/privacy policy, create employment, issue an employee code, bind SSO or send a message. It does not turn synthetic notes into verified evidence.

## Verification

- Unit: strict readiness shape; approved form and required-task projection; optional tasks do not block; external controls keep activation denied.
- Database/API: HR-scoped detail returns current readiness after checklist changes; employee access remains denied; no employee/code/access side effect occurs.
- Browser: blocked and locally-complete states, responsive layouts, themes and accessible labels.
- Run formatting, lint, TypeScript, unit/build, serial integration and browser suites; then dependency audit and container smoke before push.

## Recovery

The projection and panel can be removed without data migration. Existing immutable submissions, task notes, audit records and outbox events are preserved.
