# Personal details changes with approval (PRF-01)

Workflow module from the HRMS plan, linked from the backlog (PRF-01), the README and the traceability matrix.

## Goal

People keep their own contact details (personal phone and email, emergency contact, address) up to date. Each change is requested, approved by HR, applied on its effective date, and kept in a permanent history.

## Who does what

| Role                                            | Can                                                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Employee, manager (`profile.self`, self scope)  | See their own details and history, request changes with an effective date, withdraw a request while it is waiting or approved but not due |
| HR admin (`profile.review`, organization scope) | List and read requests (reads are audited), approve, reject, cancel an approved change before it is due, apply due changes                |
| Auditor, platform admin                         | No access                                                                                                                                 |

Managers never see anyone else's personal details. HR cannot decide their own request; HR changes their own details by switching to their Employee role.

## Lifecycle

`submitted` → `approved` → `applied`, or `rejected` (needs a reason) or `withdrawn`. A change effective today or earlier applies as soon as HR approves it. A future-dated change (up to 90 days ahead) stays approved and applies when the owner opens their details, when HR opens that person, or when HR runs "apply due changes". Only one request can be open per person.

## Personal data protection

- Values are encrypted in the API (AES-256-GCM, bound to the person and the field) before they reach the database, which only holds ciphertext in the profile, the requests and the history.
- Production refuses to start without `PROFILE_DATA_KEY`. In local development the key is derived from the onboarding preview key.
- Audit rows carry field names and dates only; outbox rows carry ids only. HR list screens show no values; values appear to the owner and on two audited HR reads.
- Writes to the current profile and history go through one database path; the app role has no write access to either, and history can never be changed or deleted.

## Limits

- Only contact details can change. Names, job details and bank details are out of scope.
- No document proof (for example proof of address), and managers play no part in approval.
- Future-dated changes apply on read or on demand, not on a schedule.
- No key rotation yet; values carry a version marker so it can be added. If the key changes, old values cannot be read.
- Formats (phone, email, postal code) are validated in the API, because the database only sees ciphertext.

## Tests

- Integration (`tests/profile.integration.ts`): role access, submit, approve and apply, future-dated apply, reject, withdraw and cancel, one open request, no personal values in audit or outbox, direct-statement refusals, HR reads audited, concurrent apply and cancel races, tampered ciphertext.
- Browser (`tests/e2e/profile.spec.ts`): an employee asks for a change; HR sees it without values in the list, opens it and approves; the employee sees the applied value and its history; axe in light and dark; no sideways scroll at 390 px. The device audit covers `/details`.
