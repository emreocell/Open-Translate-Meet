# Configuration

Set `MEET_PRIVATE_DIR` as a process/web-server environment variable before PHP starts. It must be an absolute directory outside the document root and repository. The application reads `.env` from that directory. Environment variables override file values, including an explicitly empty value. Parsing is literal: no shell execution, interpolation or environment expansion. Single/double quotes around a value are removed; embedded shell syntax stays text. Do not use multiline values.

`env.template` lists the usual settings. `bin/init-config.php` creates a new private configuration without overwriting an existing file and generates a random application secret. `bin/set-admin.php` stores a password hash in private `admin.json`. A nonempty `ADMIN_PASSWORD_HASH` takes precedence over that file. The obsolete plaintext `admin-pass.txt` is not used.

## Core

| Setting | Default / meaning |
| --- | --- |
| `APP_URL` | `http://localhost:8080`; explicit HTTPS origin for production, no path/query/userinfo |
| `APP_SECRET` | Required independent random secret, at least 32 characters; use generated 64-hex value |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Required for real media meetings; Cloud and self-hosted supported |
| `LIVEKIT_WEBHOOK_API_KEY`, `LIVEKIT_WEBHOOK_API_SECRET` | Optional dedicated webhook signing credentials; empty values use the media credentials above |
| `WEBHOOK_MAX_AGE_SECONDS`, `WEBHOOK_REQUESTS_PER_HOUR` | 86400 / 10000; reject stale events and limit authenticated webhook processing |
| `MAX_PARTICIPANTS` | 8; deployment ceiling, configurable 2–64; no capacity claim is implied |
| `JOIN_TOKEN_TTL` | 120 seconds, short initial LiveKit token validity |
| `SESSION_TTL` | 28800 seconds for application membership, not provider billing |
| `TRUSTED_PROXIES` | Empty; comma-separated exact IP/CIDR list |
| `TRUSTED_CLIENT_IP_HEADER` | Supported forwarded header for trusted proxies; consult the backend policy before changing |
| `INTEGRATION_SECRET` | Empty disables external signed management API; use at least 32 random characters |

Administrator cookie sessions also have idle/absolute limits and are invalidated by a changed administrator password hash. Credentials are never returned by the public configuration endpoint.

## Brand and interface

`APP_NAME`, `BRAND_LOGO`, `BRAND_FAVICON`, `BRAND_ACCENT`, `DEFAULT_LOCALE`, `DEFAULT_THEME`, `CONTACT_EMAIL`, `CONTACT_PHONE`, `CONTACT_WEBSITE` and `SOURCE_URL` configure public identity. Logo/favicon URLs can be safe local asset paths or HTTPS. The default is a neutral icon with platform fonts. No company contact details are enabled by default.

`DEFAULT_LOCALE` chooses a fallback among the 12 interface languages; a visitor's saved/browser choice takes precedence. `DEFAULT_THEME` accepts `auto`, `dark` or `light`. `BRAND_ACCENT` is a six-digit hex color. `SOURCE_URL` must identify the corresponding source for the version you actually run when the license requires an offer of source. A third-party image host will see requests for a logo you configure on it.

## Speech and text providers

`TRANSLATION_PROVIDER=none|gemini` defaults to `none`. Gemini additionally requires an explicit `GEMINI_MODEL` and `GEMINI_API_KEY`. Existing numbered `GEMINI_KEY_1` … `GEMINI_KEY_8` can be used; `config.json` may constrain the legacy key indices with `{"gemini_seats":[1,2]}`. Use multiple projects only within the provider's terms and quota rules, not to evade enforcement.

`TRANSLATION_LANGUAGES` is a comma-separated list of language codes accepted by your model. It is separate from the fixed interface catalog list. Do not advertise languages without verifying your chosen provider/model. `TRANSLATION_MAX_SESSIONS=3` limits simultaneous target-language sessions per speaker. An uncatered-for listener keeps original audio instead of silently losing speech. `LIVE_SESSION_SECONDS=600` limits each issued provider session; token issue limits default to 36/person/hour, 180/room/hour and 500/installation/hour (`LIVE_TOKENS_PER_PERSON_HOUR`, `LIVE_TOKENS_PER_ROOM_HOUR`, `LIVE_TOKENS_PER_HOUR`). Issued ephemeral credentials remain provider credentials until their expiry; application counters cannot independently revoke them.

`TEXT_PROVIDER=none|gemini|openai-compatible`, `TEXT_MODEL` and `TEXT_API_KEY` control chat translation and summaries. An OpenAI-compatible adapter also requires an HTTPS `TEXT_BASE_URL` ending at the API base (for example a provider's `/v1`); the app appends `/chat/completions`. Compatibility means the implemented chat-completions request/response contract, not support for every vendor's features. `TEXT_JSON_MODE=true` requests structured output when supported. No API key is delivered to the browser for these calls.

`AI_REQUESTS_PER_ROOM_HOUR=180` and `AI_REQUESTS_PER_HOUR=1000` bound server-mediated text requests. `ESTIMATED_AUDIO_COST_PER_MINUTE=0` disables the money estimate. If you set a rate and currency, the estimate uses browser-reported input audio only; output audio, text, taxes and plan-specific billing are excluded. Actual spend caps must also be configured at the provider.

`USAGE_RETENTION_DAYS=30` (1–365) sets a fixed usage window from its first measurement. Reading a report does not create an empty record or extend its deadline. A new measured operation, including an authorized post-meeting summary, can start a new window after expiry while its room registry remains eligible. Deleted/cancelled/unknown rooms cannot create usage records; registry deletion can shorten the window. Identity heartbeat detail is pruned after 90 seconds and cleared immediately on terminal closure; retained aggregate counters have the configured bound.

## Transcript and retention

`TRANSCRIPT_ENABLED=false` is the safe default. If enabled globally, the host must activate capture in each room and each speaker must opt in. A second opt-in allows their original text to be sent to the summary provider. `TRANSCRIPT_RETENTION_HOURS=24` (1–720), `TRANSCRIPT_MAX_ENTRIES=4000` (100–10000), and a bounded file size limit apply. Revoking a speaker's recording consent removes their retained rows and invalidates cached summaries. Neither recording consent nor summary consent is inferred from joining a room.

`FILE_TTL=86400` (300–604800 seconds), `UPLOAD_ROOM_QUOTA=536870912` and `UPLOAD_TOTAL_QUOTA=5368709120` (bytes) bound stored attachments. Video processing uses `FFMPEG_BIN` and `FFPROBE_BIN`. Keep uploads outside the public tree and run cleanup during idle periods when strict deletion timing is needed.

## Booking, calendar and mail

`BOOKING_ENABLED=false` controls the public request flow. `BOOKING_CALENDAR_PROVIDER=none` uses the locally locked booking registry; `google` adds Google Calendar. Configure `BOOKING_TIMEZONE` with an IANA zone (`UTC` by default), `BOOKING_SLOT_MINUTES=30`, `BOOKING_NOTICE_HOURS=12`, `BOOKING_DAYS=21` and `BOOKING_HOURS` as a JSON object of ISO weekdays and local start/end hours:

```dotenv
BOOKING_HOURS='{"1":[9,17],"2":[9,17],"3":[9,17],"4":[9,17],"5":[9,17]}'
```

Pending requests expire after `BOOKING_PENDING_HOURS=48` (1–720). `BOOKING_RETENTION_DAYS=120` (7–365) removes stored requests after that many days from the later of creation and booked slot. Listing requests and CLI cleanup apply expiry; schedule cleanup to cover idle periods. Provider-side calendar/mail records follow their own lifecycle and retention.

For Google use `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_ID=primary` and register `APP_URL/api/google-callback.php` in the Google OAuth client. Connect through the authenticated administrator page. OAuth state is bound to the administrator session; the callback stores private tokens. The old `google-oauth.json` format is readable for migration if no environment override is present.

Approved bookings are bound to the calendar provider, calendar ID and OAuth connection generation that created their event. Changing the provider/account is a migration, not a harmless configuration toggle. A renewed Google connection can rebind an event only after the exact event proves ownership through its private booking and room identifiers. Legacy approved bookings without a binding fail closed until explicitly reviewed and migrated; see [Migration](MIGRATION.md).

SMTP settings: `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_ENCRYPTION=starttls|smtps|none`, `SMTP_FROM`, `SMTP_FROM_NAME`, `BOOKING_OWNER_EMAIL`. Plain SMTP requires explicit `SMTP_ALLOW_INSECURE=true` and should only be used for an appropriate controlled relay. Certificate verification remains enabled. A missing/unavailable SMTP service does not pretend a notification was sent; the booking management link remains available in the requesting browser and failed notifications can be retried.

The legacy private `mail.json` can be read for migration. Empty environment settings deliberately override legacy values, so migrate settings carefully. The application does not send mail during installation or automated stub tests.
