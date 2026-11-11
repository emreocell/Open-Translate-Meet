# Open Translate Meet

Self-hosted video meetings with optional live speech translation. Plain PHP, browser JavaScript and LiveKit, with a standalone administrator interface. No proprietary management panel, application WebSocket server or application database is required.

The interface retains 12 languages, including Arabic with right-to-left layout. Operators control their own branding, credentials, meeting policies and retention. **AI features and persistent transcripts are disabled by default.**

## What it does

- Video, microphone, screen sharing, device selection, chat and bounded image/video attachments.
- Separate participant invitations and private host capabilities; authenticated server-side moderation, waiting-room admission, room expiration and permanent closure.
- Optional Gemini Live speech translation, in-meeting speaking/listening language changes, reconnection status and an original-audio fallback.
- Optional chat translation using Gemini or an OpenAI-compatible text endpoint; the original message stays available.
- Optional transcript capture with each speaker's explicit consent and a separate consent for AI summary processing. JSON/text export and evidence-linked draft summaries.
- Optional booking requests, approval, cancellation and rescheduling, using local availability or Google Calendar. SMTP is configurable and notification failures remain visible.
- Administrator room/booking management, provider configuration status and usage counters. Browser-reported audio and operator-rate estimates are explicitly distinguished from provider billing.

LiveKit carries media; the PHP application controls admission and retained state. A configured Gemini project receives each translating speaker's audio. Text and summary providers receive only the content needed for the requested feature. [Read the data-flow and privacy guide](docs/PRIVACY.md).

## Quick start

Requirements: PHP **8.2+** with curl, fileinfo, GD, mbstring, OpenSSL and sessions; Composer 2; HTTPS for real browser media; LiveKit Cloud or a self-hosted LiveKit server. FFmpeg and FFprobe are required for video attachments. A single application instance with reliable local storage is the supported starting point.

```sh
git clone https://github.com/emreocell/Open-Translate-Meet.git
cd Open-Translate-Meet
composer install --no-dev --no-scripts --no-plugins --prefer-dist
export MEET_PRIVATE_DIR=/absolute/path/outside-the-web-root/meeting-private
php bin/init-config.php
```

Edit the generated private `.env`: set `APP_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`. `APP_SECRET` is already generated; do not replace it with a provider key. Set the same `MEET_PRIVATE_DIR` in PHP-FPM/Apache or the container environment. Configure LiveKit's signed webhook destination at `APP_URL/api/livekit-webhook.php`; self-hosted LiveKit must also use `room.auto_create:false` as explained in the self-hosting guide.

```sh
php bin/set-admin.php
php bin/check-config.php
php -S localhost:8080 -t . deploy/dev-router.php
```

For the last command, `APP_URL=http://localhost:8080` is the local development origin. Open **http://localhost:8080/admin/**, sign in, create a room and share its **participant** link. The private host link grants meeting control. The PHP development server is for a local smoke test only; use the supplied Apache/Nginx deployment configuration for real users.

[Docker and production installation](docs/SELF_HOSTING.md) · [Configuration](docs/CONFIGURATION.md)

## Enable only the integrations you need

| Capability | Configuration | External requirement |
| --- | --- | --- |
| Basic meetings | LiveKit URL/key/secret | LiveKit Cloud account or your own server |
| Speech translation | `TRANSLATION_PROVIDER=gemini`, an explicit `GEMINI_MODEL`, API key | A model supporting Live translation and ephemeral credentials; provider quota/billing applies |
| Chat translation and summaries | `TEXT_PROVIDER`, `TEXT_MODEL`, `TEXT_API_KEY`; base URL for compatible endpoints | A supported text generation API; provider quota/billing applies |
| Persistent transcript | `TRANSCRIPT_ENABLED=true`, then host enables capture and speakers opt in | Live captions; the transcript is partial when participants do not consent or transcription is unavailable |
| Booking | `BOOKING_ENABLED=true` | Local calendar by default; Google OAuth only when selected |
| Notifications | SMTP settings and owner email | An SMTP account |

No model is silently selected. Preview model IDs, supported languages, quota and availability change; choose a supported model for your account using the provider's current documentation. An unconfigured translation provider leaves normal meetings available. This is not an offline translation engine.

## Project layout

| Path | Purpose |
| --- | --- |
| `api/` | Authentication, room state, provider adapters, booking, transcripts and attachments |
| `assets/js/` | Browser meeting, translation, chat, admin and accessibility behavior |
| `assets/i18n/` | Interface catalogs in 12 languages |
| `admin/` | Standalone administrator interface |
| `privacy/`, `randevu/` | Privacy information and independent booking page |
| `bin/` | Local configuration/administrator commands |
| `deploy/` | Apache, Nginx, PHP and development-server examples |
| `tests/` | Regression tests and isolated protocol integration tests |
| `LICENSES/` | Third-party license texts and notices |

## Verification

```sh
npm ci --ignore-scripts
npm run vendor:verify
npm test
php tests/backend_security.php
php tests/portability.php
php tests/root_security_review.php
php tests/bookings.php
php tests/bookings.php google
python3 tests/integration_backend.py
composer audit
npm audit --omit=dev
```

Node 22+ is development tooling; the deployed application serves committed browser assets without a build step. CI also checks PHP/JS syntax, dependency manifests, full-history secrets, browser fixtures with screenshots, and the container. Isolated integration tests stub provider protocols: they do **not** prove real microphone, WebRTC, Gemini, Google or SMTP behavior. [Testing guide and live acceptance checks](docs/TESTING.md).

## Scope and limits

Default capacity is eight participants. Raising it changes a deployment ceiling; it does not demonstrate media capacity or provider quota. The file store uses filesystem locks and is designed for one application host, not uncoordinated replicas or eventually consistent network filesystems.

Anonymous-device bans can be evaded by clearing browser storage or switching devices. Use a password and host admission when participant identity matters. LiveKit controls already-issued media tokens independently; self-hosted deployments must disable automatic room creation. [Security model and residual limits](docs/SECURITY_MODEL.md).

Current desktop Chrome/Edge/Firefox and Safari are the target browsers; device selection, system-audio sharing and autoplay differ. Mobile browsers may suspend media in the background. Actual device/browser and paid-provider acceptance testing remains an operator responsibility; no browser matrix is claimed solely from unit tests.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [release preparation](docs/RELEASE.md), and [third-party notices](THIRD_PARTY_NOTICES.md).

Licensed under the [Apache License 2.0](LICENSE), which permits personal and commercial use, modification and redistribution. See [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and third-party licenses. Company and provider trademarks retain their own rights.
