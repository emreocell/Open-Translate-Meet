# Self-hosting

## Deployment assumptions

Serve the project at a domain root, with HTTPS and PHP 8.2+; subdirectory hosting is not supported. Keep state outside both the repository and the web document root. Use a local filesystem that implements `flock()` and atomic rename. One application instance is supported; scaling PHP workers on that host is different from replicating independent storage across hosts.

Install PHP curl, fileinfo, GD with JPEG/PNG/WebP, mbstring, OpenSSL and session support. Video validation/remuxing additionally needs FFmpeg and FFprobe; configure their absolute paths when they are not under `/usr/bin/`. Composer installs PHPMailer. The browser-side VAD model and WebAssembly assets are already included with pinned hashes.

LiveKit media runs separately: the PHP host does not relay meeting video or translation audio. Read LiveKit's [deployment requirements](https://docs.livekit.io/home/self-hosting/deployment/) for its TLS, TURN and media port configuration. A web hosting plan being able to execute PHP does not mean it can host a LiveKit media server.

## Docker

```sh
docker compose build
docker compose run --rm --no-deps --user www-data app php bin/init-config.php
```

The generated private `.env` is in the named `meeting-private` volume at `/var/lib/meet/.env`. Edit it through an operator-managed volume mount or a one-off container; avoid printing secret values in logs. At minimum set `APP_URL` and the three LiveKit values. Run:

```sh
docker compose run --rm --no-deps --user www-data app php bin/set-admin.php
docker compose run --rm --no-deps --user www-data app php bin/check-config.php
docker compose up -d
```

The container binds only to `127.0.0.1:8080`. Put an HTTPS reverse proxy in front of it. Set `APP_URL` to the external origin, never the internal container address. `TRUSTED_PROXIES` should contain only the actual proxy addresses if you need forwarded client addresses. Do not trust an arbitrary Internet-supplied header.

The image uses the official PHP Apache and Composer images, includes FFmpeg, and stores only private state in its writable volume. A read-only root filesystem and temporary runtime directories are configured in Compose. Image tags are moving bases: pin an approved image digest in your own deployment process and rebuild for security updates. The health check validates local configuration; it does not authenticate to upstream services.

## Apache / PHP-FPM / shared hosting

Use `deploy/apache.conf` as a virtual-host policy or adapt `deploy/nginx.conf.example` for PHP-FPM. `deploy/php.ini` sets conservative upload and diagnostic behavior. The PHP upload endpoint uses chunks, so the web server accepts individual requests up to 6 MiB while the application enforces the total file quota.

On PHP-FPM, define `env[MEET_PRIVATE_DIR] = /var/lib/auto-translate-meeting` in the pool or pass it using the shown FastCGI parameter. On Apache/Plesk, configure it in the site's PHP environment. The default private path is a sibling `meet-private` directory, but explicit configuration avoids surprises. The application refuses a private path inside its repository or document root, including a resolved symlink into either.

The code should be readable by PHP but not writable by the web user. Private directories should be mode `0700`, files `0600`, owned by the PHP worker user. Never use `0777`. Do not give the browser access to `.git`, `.env`, `vendor/`, test scripts, deployment configuration or underscore-prefixed PHP helpers. The root `.htaccess` is a fallback for compatible Apache hosting; validate its effect instead of assuming the hosting provider permits overrides.

Check these URLs externally after deployment: `/api/_config.php`, `/vendor/autoload.php`, `/bin/set-admin.php` and `/.git/config` must be denied. `GET /api/config.php` must expose only the public configuration allowlist. Hide PHP error details; `zend.exception_ignore_args=On` reduces argument leakage into exception logs. Configure access logs to omit query strings where possible because participant invitation and booking capabilities are sensitive even though host secrets use fragments.

## LiveKit Cloud or self-hosting

Set `LIVEKIT_URL=wss://...`, and use server-side credentials from that same deployment. The application issues a short media token and a separate application ticket; it never gives ordinary participants a LiveKit `roomAdmin` permission.

For a self-hosted LiveKit server, disable token-triggered room creation:

```yaml
room:
  auto_create: false
```

The application explicitly creates the media room before issuing tokens. Keeping LiveKit auto-creation disabled prevents a cached token from recreating a deleted media room. See the [official configuration example](https://github.com/livekit/livekit/blob/master/config-sample.yaml). Keep LiveKit credentials private and restrict its administrative endpoints according to the upstream deployment guide.

There are provider-specific differences in cached-token revocation and reconnect behavior. Application API access is revoked through the application registry, while the media server independently validates already-issued/refresh tokens. Do not claim instantaneous revocation of every cached media credential. The short initial token TTL bounds newly-issued tokens; provider refresh behavior can extend a media credential's lifetime.

Configure a LiveKit webhook destination at `APP_URL/api/livekit-webhook.php` for both Cloud and self-hosted deployments. The endpoint verifies LiveKit's signed request against the exact raw body and the expected issuer. It uses `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, or an explicitly configured dedicated `LIVEKIT_WEBHOOK_API_KEY` / `LIVEKIT_WEBHOOK_API_SECRET` pair. Preserve the original request body, `Authorization` header and `application/webhook+json` content type through your proxy; do not add a browser authentication challenge to this endpoint. Refer to the [official webhook setup](https://docs.livekit.io/home/server/webhooks/).

Participant join/leave and room-finished events reconcile media membership with application policy, including ended/expired rooms, revocation, bans, capacity and source permissions. Webhooks arrive after a media event: enforcement is eventual and cannot guarantee that an unauthorized cached reconnect has zero media exposure. An unexpected disconnect temporarily reserves capacity for reconnect; an ordinary empty media room does not permanently end its application meeting. Monitor delivery errors and run cleanup so pending provider operations are retried.

## Cleanup and backup

Request-triggered cleanup removes expired data when the application is used. To enforce cleanup during idle periods, schedule `php api/cleanup.php` under the same PHP worker user and private environment (for example every five minutes). This also reconciles durable pending media-policy and room-close operations. Back up private state with encryption and a limited retention policy. Restore code and state together so signing secrets and registry records remain consistent.

Keep the stable zero-byte hashed lock files while workers run; unlinking them can give concurrent workers different lock inodes and invalidate serialization. Other private records have bounded lifetimes: see [Configuration](CONFIGURATION.md) and [Privacy](PRIVACY.md). Terminal rooms normally retain a scrubbed tombstone for 31 days from the original close/expiry, extended only while required remote cleanup remains unresolved.

`APP_SECRET` changes invalidate application tickets and signed capabilities. Plan rotation as a maintenance operation. File deletion removes the application's copy; it cannot erase copies already downloaded by participants, mail recipients or provider logs. Include those systems in your retention policy.

## Local development

`php -S localhost:8080 -t . deploy/dev-router.php` is a local-only test server. The supplied router rejects private implementation paths; PHP's raw development server does not implement Apache `.htaccess`. Never expose it as a production service. Test configuration must use a separate empty private directory and fake credentials; use the isolated test suite for provider stubs.
