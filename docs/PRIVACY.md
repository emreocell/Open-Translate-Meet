# Privacy and data flows

The software supplies controls and technical defaults. Each installation operator remains responsible for its own notices, legal basis, processor agreements, retention, access and jurisdiction-specific obligations; installing this project does not automatically establish GDPR/KVKK compliance.

## Default behavior

- LiveKit handles meeting video/audio and participant metadata. The app does not record audio/video to disk by default.
- In-browser chat is ephemeral; files are deliberately retained for the configured time outside the document root. Files can be downloaded by admitted meeting members.
- Speech translation, text providers, booking and persistent transcripts are disabled until configured.
- Routine diagnostics must not contain passwords, API keys, session tokens or meeting content. Protect web/proxy access logs too: capability-bearing URLs and query strings are sensitive.

## Optional processing

| Feature | Data sent / stored | Control |
| --- | --- | --- |
| Live translation | The speaking browser sends microphone audio directly to Gemini; returned audio travels through LiveKit | Translation settings, provider configuration, microphone controls |
| Chat translation | Text to the configured server-side text provider | Feature can be disabled; original text stays visible |
| Transcript | Caption segments submitted by the authenticated speaking participant | Global enable, host capture switch, per-speaker opt-in |
| AI summary | Original transcript rows from speakers who separately consented | Explicit summary processing consent; host request; evidence-linked draft |
| Booking | Name, email, requested time, company/note; optional Google event and email | Optional feature, cancellation/rescheduling capabilities and admin access |
| Usage | Request counters, provider-returned token totals and browser-reported audio/session durations | Admin/host views; estimates are not invoices |

A participant cannot provide another participant's trusted identity in a transcript request. This authenticates attribution, not semantic truth: a speaker can still submit inaccurate captions about themselves. Automatic recognition is imperfect and unconsented/missing audio makes transcripts partial. Summaries are drafts; valid evidence identifiers do not prove every generated statement is correct.

Revoking recording consent removes that speaker's retained transcript entries and invalidates summaries. Revoking summary consent prevents future summary use and invalidates the cached summary. Content already sent to a provider, emailed or downloaded cannot be recalled by the application. Apply the relevant provider policies instead of promising zero provider retention.

Transcripts expire after the configured fixed retention window; attachments expire after their file TTL. Request-triggered cleanup alone does not guarantee deletion while a site is idle: schedule the CLI cleanup command if timing matters. Backups, SMTP mailboxes and provider records have separate retention that operators must define.

## Stored metadata and deletion

Usage records have a fixed window from the first measurement (`USAGE_RETENTION_DAYS`, 30 days by default); reading a dashboard never extends it or creates an empty record. A newly measured operation may start a new window after expiry while its room is still retained, including an authorized summary after the meeting. Per-identity heartbeat entries are pruned after 90 seconds, on revocation or expiry, and immediately when the meeting closes; aggregates may remain until their deadline. Room cancellation/deletion removes usage, and a late provider response cannot restore it.

Room closure erases participant/moderation history and password hashes. A terminal registry tombstone normally survives 31 days from its original closure or expiry so an old invitation cannot reopen the room; retrying cleanup does not restart that interval. Pending remote media shutdown can keep a scrubbed tombstone longer until cleanup succeeds. Deleting the registry also removes associated usage records. Waiting-room requests expire after 15 minutes; application sessions use the configured `SESSION_TTL`. Cleanup removes expired entries while preserving still-valid reconnect reservations.

Pending booking requests expire after 48 hours by default (`BOOKING_PENDING_HOURS`). Stored booking records are removed after `BOOKING_RETENTION_DAYS` (120 by default), measured from the later of creation and scheduled slot. Cancellation updates local/calendar state and invalidates meeting access; it does not erase mail that has already been delivered. Calendar/account migration must preserve the verified ownership binding described in the migration guide.

Stable zero-byte lock files have hashed names and can remain after the corresponding data is erased. They do not contain meeting content. Do not unlink those lock files while PHP workers run: replacing a locked inode could break serialization between workers. Operator-managed filesystem backups can retain old state regardless of application cleanup.

## Operator notice checklist

Publish your organization's contact and controller identity; list the enabled processors and their regions; explain optional consent and withdrawal; state actual retention and backup policies; provide an access/deletion contact; and identify any workplace/recording requirements. The generic `/privacy/` page explains software behavior and points to the installation's configured contact; it is not a substitute for an operator's policy.
