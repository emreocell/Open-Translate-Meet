# Verification and acceptance

## Automated checks

The test suite uses temporary private directories and local protocol stubs. It does not read production state, send real mail, book a real calendar or spend provider credits.

```sh
composer install --no-scripts --no-plugins
composer validate --strict
composer audit
npm ci --ignore-scripts
npm audit --omit=dev
npm run vendor:verify
npm test
php tests/backend_security.php
php tests/portability.php
php tests/root_security_review.php
php tests/bookings.php
php tests/bookings.php google
python3 tests/install.py
python3 tests/integration_backend.py
```

`PHP_BIN` can select a PHP executable for the Python integration harness. CI also lints authored PHP/JS and runs all `tests/*.php` files, so new feature regression files should follow that convention. It builds the Docker image and verifies that private implementation paths are not served. A green build verifies those checks at that commit; it does not substitute for the following external checks.

CI runs for pull requests, pushes to `main`, and manual dispatches, with separate concurrency groups for each event and pull request or Git ref.

The Google booking variant is a separate invocation with local protocol mocks; it does not authorize an account or modify a real calendar. The HTTP suite covers signed LiveKit callbacks, capacity/admission races, uploads and after-provider revocation/consent changes. Install FFmpeg/FFprobe to run the actual offline video-validation fixtures; only those assertions are skipped when the tools are absent.

The first-install regression uses fresh temporary directories outside the repository. It checks random signing-key generation, restrictive permissions, refusal to overwrite configuration, administrator setup over standard input, password hashing and local configuration diagnostics. Its fake media settings never contact a provider. `PHP_BIN` also selects the executable for this regression.

## Browser fixtures and CI artifacts

```sh
npm ci --ignore-scripts
npx --no-install playwright install --with-deps chromium
npm run test:browser
```

Playwright is exactly pinned in the lockfile. The browser runner serves the real HTML/CSS/JavaScript through a local fixture server and replaces external APIs and the media SDK with deterministic stubs. It checks meeting/consent/translation controls, booking behavior, administrator authentication and room management, and Arabic mobile layouts. Screenshots and machine-readable results are written to `test-results/`; CI attempts to retain them on both success and failure for seven days. This proves browser UI behavior under the fixtures, not an actual camera, WebRTC transport or provider connection.

The browser suite requires a host that permits Chromium to start and create its local sockets. A restricted development sandbox may prevent startup even when the JavaScript tests pass. In that case, use the GitHub browser job or another compatible test host; inspect the screenshots and results at the reviewed commit before release. Never treat an unstarted browser suite as a pass.

The secrets job checks out complete history and verifies a pinned Gitleaks release by SHA-256 before scanning every reachable ref. Output is fully redacted; raw secret reports are not uploaded. A passing secret scan does not resolve private-code or restricted-font history: see [Release preparation](RELEASE.md).

## Real-service acceptance

Use separate test accounts, a staging origin and consenting testers. Create two or more browser sessions and verify camera/microphone permission denial, join/leave, locked rooms, wrong passwords, waiting-room approval/rejection, host reconnection, participant removal and irreversible room end. Check expiry and old invitations after record cleanup; sharing an ordinary invitation must not share host authority.

Test two languages, the same language, at least three listener languages, language changes during speech, microphone mute/device replacement, provider quota errors, WebSocket interruption and stale output after reconnect. Original audio should remain intelligible when translated audio is unavailable. Track actual behavior on desktop Chrome/Edge/Firefox/Safari and relevant mobile hardware; mark unavailable features explicitly.

Test chat attribution, malformed/oversized data packets, text provider errors and access to original text. Upload valid/invalid images/video, exceed room/global quotas, interrupt chunks, request files without current membership and verify retention cleanup. Only submitted/re-encoded content should be downloadable.

For transcripts, default state is off. Enable capture, join a non-consenting speaker, grant/revoke recording and summary consent separately, and ensure only authorized rows persist or reach the provider. Exports and summaries must remain access-controlled; summaries are reviewable drafts with evidence references. Confirm expiry and manual deletion.

For booking, request/approve/reject/cancel/reschedule with local and Google modes. Re-send the same request, race requests for one slot, cross a timezone/DST boundary, disconnect Google/SMTP, and inspect both local status and provider state. A notification failure must not become a fake success or a duplicate reservation.

Check keyboard-only use, modal focus return, screen-reader labels, long names, 320px layouts and RTL. Review source and static requests for unconfigured organization branding or missing locale keys.
