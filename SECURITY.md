# Security policy

This repository is an early foundation preview. It is not approved for real employee data or production use. Security controls and known gaps are tracked in [the backlog](docs/backlog.md) and [the threat model](docs/threat-model/foundation.md).

Report vulnerabilities privately using GitHub's **Report a vulnerability** feature if enabled. Otherwise contact the repository owner privately; do not include secrets or personal data in a public issue. A dedicated security contact and response owner must be assigned before deployment.

Keep dependencies and container digests reviewed, use the committed lockfile, and run `pnpm audit --audit-level=moderate`. CI checks source hygiene, tests, accessibility, package advisories and secrets. Scanner results do not establish compliance or replace a security review. No unresolved Critical or High release findings are acceptable; lower findings require an owner and documented disposition.

Never commit `.env`, keys, certificates, production fixtures, employee exports or database backups. Only synthetic development identities may use demo mode. Demo authentication rejects production mode and non-loopback binds/origins. Corporate SSO uses approved immutable identity bindings; unknown identities are denied.
