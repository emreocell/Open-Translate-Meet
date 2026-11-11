# Contributing

Use a focused branch and pull request. Explain the user-visible problem, resulting behavior, tests and any migration implications. Preserve the plain PHP/browser architecture unless a change has a clear operational benefit. Do not add a framework merely to rearrange working code.

## Local workflow

Use an isolated private directory and fake/provider-test credentials. Install Composer dependencies and `npm ci --ignore-scripts`; Node is for development only. Run the checks in `docs/TESTING.md`. Keep secrets, customer meeting data, uploads and recordings out of fixtures and pull requests.

Security and concurrency behavior needs regression coverage at the actual authorization/lifecycle boundary. UI-only checks do not demonstrate server enforcement. External service stubs should test the protocol contract without pretending to verify the real service. Avoid tests that only restate implementation details.

Keep UI strings in the relevant catalogs and preserve key parity across all 12 languages. Validate Arabic RTL, keyboard focus, accessible labels and small-screen layouts. Render untrusted text with `textContent` or escaped server output. A user cannot be a trusted role/speaker merely because their message says so.

For dependency changes, update the lockfile, vendored asset manifest and license notices together. `npm run vendor:sync` copies exact pinned upstream assets. Review the generated diff; do not hand-edit minified third-party files. Keep optional integrations optional and document provider costs honestly.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion is licensed under the Apache License 2.0 (see `LICENSE`), without additional terms. Existing third-party notices must be preserved. Do not contribute code or assets you are not authorized to license. Report security issues using `SECURITY.md` instead of a public exploit report.
