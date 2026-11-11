# Release checklist

1. Run CI (`.github/workflows/quality.yml`) and a clean installation from a fresh clone.
2. Verify the license files, third-party notices, vendor checksums and dependency audits (`npm run vendor:verify`, `composer audit`, `npm audit --omit=dev`).
3. Run real multi-browser media and translation tests. Check Google Calendar and SMTP with isolated test accounts before enabling them for real bookings, and record untested device/provider cases honestly.
4. Make sure no credentials, customer meeting data or uploads are committed. If a credential was ever exposed, rotate it with its provider; removing it from Git does not revoke it.
5. Update `CHANGELOG.md` with configuration changes, invitation invalidation/migration notes, data retention and known limits.
6. Tag the release (`vX.Y.Z`) and publish the notes.

For large upgrades, keep a known-good code/state backup and migrate outside active meetings. Passing protocol stubs or lint does not by itself establish production readiness.