# F0.14: Employee documents with HR verification

Authoritative implementation plan, 26 October 2026. Advances DOC-01. Synthetic files only; no real personal documents.

## Outcome

Employees and managers upload their own documents (identity, education, employment, other) as PDF, PNG or JPEG up to 5 MB, see their status, download them and withdraw pending ones. HR verifies or rejects documents with a note, from a Documents review list or the shared Approvals inbox. Managers cannot see their reports' documents. Every upload, download and decision is audited.

## Approach

- Migration 019 adds FORCE-RLS `employee_document` (metadata, SHA-256, detected type, size, versioned review state) and `employee_document_content` (bytes, separate so lists never load content). A `SECURITY DEFINER` guard owned by NOLOGIN `anvione_document_keeper`:
  - binds uploads to the requester and the current actor;
  - lets content be written only once, for the uploader's own pending document;
  - keeps metadata and content immutable;
  - allows only these transitions: HR verifies or rejects (deciding through the shared `workflow_decision_error`, so nobody verifies their own document), and the owner withdraws while pending.
    Nothing is deleted.
- Permissions: `document.self` (Employee, Manager) and `document.review` (HR entity), exposed as `app.document_scope`.
- Upload validation happens before storage:
  - the file type is detected from magic bytes; the extension and the client's stated type are ignored;
  - files are rejected when empty, oversized, or of a mismatched or unsupported type;
  - PDFs with active or outbound content (JavaScript, actions, Launch, embedded files, form submission, remote documents, media) are rejected;
  - display file names are sanitized;
  - a duplicate active upload of the same file is refused.
- Endpoints:
  - `GET /documents` (mine)
  - `POST /documents` (multipart, one file)
  - `POST /documents/:id/withdraw`
  - `GET /documents/review` (HR)
  - `POST /documents/:id/decision` (HR)
  - `GET /documents/:id/content`: an authorized, audited download that always serves the file as an attachment with `nosniff` and no caching.
- The Approvals inbox gains a `document_review` kind for HR.
- Portal: a `/documents` route for "Your documents" and, for HR, "Review documents". The upload dialog validates on the client too.

## Decisions

- PostgreSQL stores content for this slice so RLS covers the bytes too. A private object store with signed, short-lived downloads is the production target, owned by platform.
- Malware scanning is not available locally. Structural validation is not antivirus. Real scanning and quarantine release remain open under DOC-01.

## Verification

- Contract tests: categories, titles, decision notes.
- Integration tests:
  - type detection and spoofing;
  - size and empty files;
  - active-content PDFs;
  - duplicates;
  - self-only uploads and reads, with managers denied;
  - HR review, with no self-verification;
  - stale versions;
  - withdrawal;
  - immutable content;
  - download authorization and headers;
  - audit and outbox;
  - inbox items.
- Browser tests: upload, download link, withdraw, HR verify from the inbox, axe, dark mode and 390px.

## Recovery

Forward-only. Withdraw or reject rather than delete; content rows are retained with their document.
