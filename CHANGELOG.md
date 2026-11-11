# Changelog

## 0.2.0 - Initial public release

### Standalone installation

- Kept plain PHP and browser JavaScript with LiveKit media. Added a standalone administrator, portable private configuration, neutral branding, configurable SMTP, optional Google Calendar, and separate speech/text provider settings.
- Added Composer/npm lockfiles, exact browser-asset provenance and checksums, third-party notices, the Apache-2.0 license, Apache/Nginx examples, Docker packaging and a local setup CLI.

### Authentication and lifecycle

- Separated revocable application membership from short-lived media credentials. Room registration, admission, capacity, expiry, closure and host roles are authoritative on the server.
- Moved private host capabilities into URL fragments; ordinary invitation copying excludes host credentials. Added invitation rotation, waiting-room approval and rejection, and server-controlled participant language changes.
- Added authenticated LiveKit webhook reconciliation, durable cleanup retries, bounded uploads, actual image/video validation, membership-protected downloads and rate/concurrency controls.
- Hardened administrator sessions, CSRF/origin checks, OAuth state and account/calendar binding. Booking state transitions and retry identifiers prevent duplicate reservations and unsafe cross-account calendar changes.

### Meeting experience

- Added in-meeting language changes, translation/connection health, bounded reconnect and audio queues, and original-audio recovery when translated output stops.
- Bound captions and chat attribution to the authenticated media sender. Added optional text translation, retained originals, upload cancellation and visible send failures.
- Added opt-in transcript capture, separate summary consent, speaker withdrawal/deletion, JSON/text export and evidence-linked AI draft summaries. Usage estimates clearly distinguish client observations from provider billing.
- Added private booking management links, cancellation/rescheduling, notification retry and explicit pending calendar/media status. Expanded localized meeting, booking, administration and privacy interfaces.

### Verification

- Added regression suites for authorization, concurrent admission, webhook replay, files, booking/DST/provider failures, consent races, media/translation state and browser flows with local provider fixtures.
- Added CI for PHP 8.2/8.4, JavaScript, dependency audits, asset integrity, masked full-history secret scanning, browser screenshots and container installation checks.
- Real WebRTC, paid providers, SMTP delivery and device/browser acceptance require separate staging validation. Passing isolated tests is not a production deployment approval.

