# Data protection policy — implementation draft

Version 0.3, 25 October 2026. Status: proposed operational policy, not legal approval or a compliance certification. Owners required: HR data owner, Privacy/Legal, Security and Platform Operations. Only synthetic data is permitted in the current preview.

## Purpose and minimization

Process personal data only for a documented employment or organizational purpose with an approved lawful basis appropriate to the jurisdiction. Do not assume employee consent is the basis for every process. Keep a category/purpose/recipient/location register and provide notices before collection. Do not collect biometric, continuous location, medical, bank or government-ID data merely because a form could support it.

The current schema stores synthetic professional identity only: name, employee code, work email at `.example`, job title, department, office location, joining date, employment status and a direct manager reference. The application does not currently store salary, private addresses, tax IDs, health details or documents. Future sensitive domains require an explicit inventory update, field-level authorization, masking and envelope encryption before implementation is enabled.

Person records now hold canonical names/initials; employment records reference that person and scoped organization masters. Code-allocation tombstones contain opaque employment references and codes, without names/emails, and remain controlled data because they can be linked. Identity-operation attestations additionally retain the verified official email, approval/verification references, declared operator identifier and authenticated database principal. These are purpose-limited access evidence, not proof that the software verified email ownership. Audit output exposes the change reason; restricted proof metadata is not returned by the activity API. Operators must keep reasons/references free of unnecessary private data and secrets.

## Access and accountability

- Access is tied to a pre-approved active employment identity. Domain membership and email text do not authorize an account.
- Enforce tenant, entity, role and relationship checks in application services and database policies. Configuration administration is separate from access to employee records.
- Recheck active status and role grants on each authenticated request. No impersonation or public registration exists.
- Record required business mutations transactionally with their audit event. Audit reads require the auditor role. Application credentials cannot rewrite audit records.
- Audit metadata contains the actor label and target reference for accountability; it is itself controlled personal data. Ordinary diagnostics contain event names and request IDs, not request bodies, cookies, tokens or employee data.
- No production records, credentials, reports, screenshots or backups may enter Git, test fixtures or public issue attachments. The public repository receives only synthetic code, examples and reviewed documentation.

## Protection and storage

Use HTTPS and certificate-validated database TLS, secret-manager references, least-privilege identities and encrypted infrastructure volumes/backups before real data. Highly sensitive future fields require managed envelope keys and access auditing. Store documents privately; quarantine until type/content validation and scanning succeed. No public buckets, browser bearer tokens or unrestricted download URLs.

The preview runs on loopback, uses generated local credentials, hashes session tokens, uses HttpOnly cookies, checks request origin and CSRF tokens, and sends `Cache-Control: no-store` on API responses. Local PostgreSQL volumes are **not an implementation of production encryption at rest**. Do not load production data into this environment. Browser storage holds only a visual preference; there is no offline personal-data cache.

## Retention and disposal register

Legal/HR must approve durations and statutory holds before each category is collected. Do not invent a blanket seven-year retention rule or a universal candidate purge deadline.

| Category                       | Current collection       | Retention decision owner    | Disposal boundary                                                                                                                                    |
| ------------------------------ | ------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Professional employee record   | Synthetic only           | HR + Legal                  | Approved record disposal, derived views and backups; employee code allocation tombstone handled separately                                           |
| Code allocation tombstone      | Synthetic only           | HR + Security + Legal       | Preserve non-reuse invariant; govern linkable identifiers and restore reconciliation separately                                                      |
| Identity approval attestation  | Synthetic only           | Identity + Security + Legal | Restricted evidence retention, revoked bindings and lawful disposal; no operator/runtime update or delete interface                                  |
| Candidate/invitation/documents | Disabled                 | HR + Privacy                | Candidate workspace, objects, tokens, scans and derived text                                                                                         |
| Payroll/bank/tax/medical       | Disabled                 | Finance/HR + Legal          | Statutory retention and holds; managed key lifecycle                                                                                                 |
| Session and OIDC attempt       | Active during preview    | Security                    | 8-hour absolute session limit; 15-minute privileged or 30-minute employee/manager idle limit; 5-minute OIDC attempt; production cleanup job required |
| Business audit                 | Synthetic only           | Security + Legal            | Independent archive, retention and lawful disposal; no app-role deletion                                                                             |
| Operational telemetry          | Minimal request metadata | Security + Operations       | Short purpose-limited retention, restricted access and provider deletion                                                                             |

Soft deletion is not erasure. Approved disposal must cover databases, objects, indexes, caches, exports, processors and restoration workflows, with documented backup expiry and legal-hold exceptions. Automatic disposal is not enabled in this increment.

## Individual rights and incident handling

Before production, designate a contact and workflow for access, correction, erasure, grievances and appeals. Verify the requester's identity, apply necessary statutory retention/holds, track the response and avoid exposing third-party data. Set jurisdiction-specific response deadlines after legal review.

On suspected exposure, contain access, revoke affected sessions/credentials, preserve limited evidence, assess impacted people and processors, and escalate to Security and Privacy/Legal. Notification decisions and deadlines follow applicable law and contracts. Do not publish affected records in tickets or logs.

## Processors, residency and AI

Maintain approved processors, processing locations, subprocessor/retention/training terms and contractual safeguards. AI, MCP, analytics exporters and TimeSphere remain disabled until authorized contracts and data-flow reviews are complete. Payroll and employment decisions cannot be delegated to an AI tool.

## Synthetic candidate preview

The local preview accepts only fictional `@anvi.example` intake records. HR records a proposed assignment and reviews a preferred name, professional introduction and preview acknowledgement. It collects no bank, tax, health, private contact or document data. The acknowledgement is a preview-use instruction, not a legal consent mechanism.

Invitation hashes expire after 72 hours; OTP challenges expire after 10 minutes with five attempts. Candidate sessions have a one-hour absolute and 15-minute idle limit. A development-only AES-GCM encrypted delivery tray temporarily contains the invitation/code, is HR-scoped and audited on read, and is deleted after successful verification or credential rotation/revocation. Expiry denies access; scheduled physical cleanup is still pending. Form drafts/submissions currently have no automated disposal and must remain synthetic. A real deployment requires approved retention, notices/legal basis, delivery providers and key management before collecting personal data.

## Legal validation

India is an initial planning assumption. Assess entity-specific obligations rather than inferring jurisdiction from developer location. Review the [official MeitY DPDP Rules and enforcement resources](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025%3B) and [government announcement](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190014&lang=1&reg=3), including phased commencement, with qualified owners. Additional-country rules require their own review. This draft supplies control intent and current implementation boundaries, not a determination of legal obligations.
