# Security model and limits

The registry is authoritative for invitation validity, lifecycle, application membership and host role. Unknown, expired, ended or deleted rooms fail closed. An invitation authenticates the ability to request entry; passwords and optional waiting-room admission add controls. Ordinary media tokens do not contain LiveKit room-administration permissions.

Host authority is a private capability placed in a URL fragment rather than a query string. The browser exchanges it into authenticated membership and removes it from the displayed URL. Ordinary invitation copying deliberately excludes host authority. The administrator has a separate HttpOnly cookie session and same-origin/CSRF checks; server-to-server integrations use a dedicated HMAC secret and replay checks.

A waiting participant has no media token or admitted application ticket. Room capacity is checked under a per-room lock and new admissions reserve slots; provider failure cannot be reported as zero participants and silently bypass the gate. Media-server limits and already-issued reconnect credentials have their own semantics. Lowering the application's room limit does not retroactively prove that no cached media reconnect can occur.

Meeting closure persists the terminal state before asking the media service to disconnect. If LiveKit is unavailable, application access is denied and media cleanup remains pending for retry; the UI must not claim that all remote streams ended immediately. Self-hosted LiveKit requires `room.auto_create:false` so a cached token cannot create a deleted media room. LiveKit's own refreshed-token lifetime can exceed the application's initial token TTL.

The signed LiveKit webhook checks raw-body integrity, issuer, expiration, event age and deduplication before reconciling membership. Configure it for Cloud and self-hosted deployments. Join enforcement happens after the media server emits a join event; it is not a zero-window revocation mechanism. An unexpected departure reserves admission capacity temporarily for provider reconnect credentials. Natural empty-room shutdown preserves an otherwise valid application meeting.

Moderation uses a server-issued browser identity rather than untrusted user text. Bans/locks are not applied to every person sharing an IP address. Anonymous identity is not strong identity verification: clearing storage or changing browsers can evade a device-based ban. Passwords, host admission and fresh invite rotation are the controls for sensitive meetings. Identity-provider login is not implemented.

Provider keys stay server-side. Gemini uses a constrained, short-lived, single-use ephemeral credential, which is still a bearer credential until its provider expiry. Quota controls limit application-mediated issuance and text calls; they cannot replace provider-side spend limits. Configure provider quotas independently.

Uploads are quota-reserved, chunk-limited and MIME/content validated. Images are decoded/re-encoded and videos are inspected/remuxed with bounded external commands. Access requires current admitted membership. Do not serve the private directory directly or disable server certificate verification to repair an integration.

The file store uses local filesystem locking and atomic replacement. This is not an audited distributed database design. Public URLs, names and provider text remain untrusted data; the browser renders participant content as text and resolves attribution from the transport/session, not from message claims.

No absolute security guarantee is made. Run the regression suite, provider/browser acceptance checks, and a deployment-specific review before handling sensitive data.
