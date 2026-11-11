# Security reporting

Report a suspected vulnerability privately before publishing exploit details, credentials or user data. If GitHub private vulnerability reporting is enabled, use the repository's **Security → Report a vulnerability** channel. Otherwise contact the maintainer through their GitHub profile to establish a private channel; do not put sensitive details in a public issue.

Include the affected commit/version, deployment conditions, a minimal reproduction using accounts and data you control, expected versus actual behavior, and likely impact. Redact tokens, private links, emails and recordings. Do not test against someone else's live meeting or provider account.

Security maintenance currently targets the latest development/release branch. There is no promised response-time SLA or independently audited security certification. Supported versions will be listed when releases are tagged. Dependencies are pinned and checked by automated audit tooling, which is one input to review rather than proof of safety.

Operators should read `docs/SECURITY_MODEL.md`, configure provider quotas and TLS, keep private state outside the web root, and validate deployment access controls. A default-off optional feature must not be represented as active protection.
