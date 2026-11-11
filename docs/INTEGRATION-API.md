# Optional server-to-server integration API

The application works independently through `/admin/`. An existing control panel or internal service can optionally manage rooms through this signed API.

The integrating service must authenticate its own administrators and enforce a dedicated meeting-management role before signing a request. Possession of the integration secret grants management authority; do not place it in browser JavaScript, a public repository or an ordinary participant client.

## Configuration and authentication

Set `INTEGRATION_SECRET` to an independently generated secret of at least 32 bytes in the external private environment. Store the matching value in the integrating service's secret store. Rotate both sides together.

Send `POST https://meet.example.org/api/v1.php?a=ACTION` with a JSON object, at most 65,536 bytes, and these headers:

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-Meet-Timestamp` | Current Unix time in whole seconds; accepted within 120 seconds of server time |
| `X-Meet-Signature` | Lowercase hexadecimal HMAC-SHA256 of the canonical string below, using the integration secret |

```text
timestamp + "\nPOST\n" + action + "\n" + lowercase_hex_sha256(exact_request_body_bytes)
```

The method, action and exact serialized body are signed. A signature is accepted once; it cannot be replayed. Two identical bodies for the same action in the same second produce the same signature. Include an otherwise ignored `_requestNonce` field with a fresh random value to make separate requests distinct. This nonce is **not an idempotency key**. A lost response to `create` does not mean creation failed: reconcile through `list` before deliberately creating another room.

The API rate limit is 600 authenticated requests per hour per deployment. Synchronize server clocks. Keep HTTPS certificate verification enabled and do not log secrets, signatures, complete invitation URLs or host capabilities.

### PHP caller

Configure the origin and secret on the integrating server; the following code deliberately performs no automatic mutation retry.

```php
function meeting_call(string $origin, string $secret, string $action, array $body = []): array
{
    if (strlen($secret) < 32 || !preg_match('~^https://[A-Za-z0-9.-]+(?::[0-9]+)?/?$~D', $origin)) {
        throw new InvalidArgumentException('Invalid integration configuration');
    }
    $body['_requestNonce'] = bin2hex(random_bytes(16));
    $raw = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $timestamp = (string) time();
    $canonical = $timestamp . "\nPOST\n" . $action . "\n" . hash('sha256', $raw);
    $signature = hash_hmac('sha256', $canonical, $secret);
    $request = curl_init(rtrim($origin, '/') . '/api/v1.php?a=' . rawurlencode($action));
    curl_setopt_array($request, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $raw,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-Meet-Timestamp: ' . $timestamp,
            'X-Meet-Signature: ' . $signature,
        ],
    ]);
    $response = curl_exec($request);
    $status = (int) curl_getinfo($request, CURLINFO_HTTP_CODE);
    curl_close($request);
    if ($response === false) {
        throw new RuntimeException('Transport failed; reconcile state before retrying');
    }
    return ['status' => $status, 'data' => json_decode($response, true, 32, JSON_THROW_ON_ERROR)];
}
```

## Room actions

Every action uses POST, including reads. Times are Unix seconds. `max` is between 2 and the configured `MAX_PARTICIPANTS` ceiling, whose default is 8; that default is an application policy, not a provider quota guarantee. A room password must contain at least four characters and at most 72 UTF-8 bytes.

| Action | JSON fields | Successful response |
| --- | --- | --- |
| `create` | Optional `title`, `max`, `password`, `startsAt`, `expiresAt`, `waitingRoom` | HTTP 201; new room view, including participant and host links. Default expiry is 30 days. |
| `list` | Empty object, or just a nonce | `{rooms, mediaAvailable, truncated}`; at most 200 records ordered by file modification time. |
| `get` | `room` | One room view. |
| `host_link` | `room` | `{room, link, hostLink}` for an open room. Request only when an authorized manager needs host access. |
| `rotate_links` | `room` | `{room, link, hostLink}` with new participant and host capabilities. Previous invitation links stop granting new entry. |
| `update` | `room`; optional `title`, `max`, `password`, `clearPassword`, `waitingRoom`, `locked`, `startsAt`, `expiresAt` | Updated room view with `ok` and `policySaved`. Boolean fields must be JSON booleans. |
| `delete` | `room` | `{ok, closed, mediaClosePending}`. Application access is closed durably, retained data is removed, and remote media cleanup is attempted. |

Room views include `room`, `title`, `max`, `hasPassword`, `created`, `expiresAt`, `startsAt`, `deleted`, `status`, `locked`, `waitingRoom`, `live` and `link`. `hostLink` is returned only by creation or explicit host-link operations. `live:null` means the media service did not provide a reliable count; never display it as zero. `list.mediaAvailable:false` makes that distinction visible for the whole list.

`startsAt:0` means no scheduled start; a nonzero scheduled start gates entry until that time. Expiry must be in the future, after any scheduled start, and no more than 366 days ahead. An empty `password` leaves the current password unchanged; use `clearPassword:true` to remove it. Terminal rooms cannot be reopened through update or link rotation.

Lowering a room's capacity gates new application admissions; it does not evict existing participants or guarantee an instantaneous media-layer ceiling for cached LiveKit reconnect credentials. Link rotation also does not disconnect already admitted members by itself. Use room termination and appropriate provider controls when active access must end. See [Security model](SECURITY_MODEL.md).

## Failures and partial operations

Errors are JSON objects with an `error` code. Common examples:

| HTTP | Codes and handling |
| --- | --- |
| 400 | `bad_json`, `bad_action`, `bad_room`, `bad_limit`, `bad_password_length`, `bad_setting`, `bad_schedule`; correct the input. |
| 401 | `unauthorized`, `replay`; check secret, clock, canonical bytes and nonce. |
| 404 | `not_found`; the registry has no such room. |
| 410 | `room_closed`; the room is expired or terminal. |
| 413 | `too_large`; reduce the request body. |
| 429 | `rate`; back off instead of immediately retrying. |
| 502 | `media_unavailable`; inspect the accompanying saved-state fields and reconcile. |
| 503 | `not_configured`; configure the integration secret, or inspect server configuration when a required service is missing. |

An update can return HTTP 502 **after** the local policy was saved (`policySaved:true`). A delete can return HTTP 502 **after** durable closure (`closed:true`, `mediaClosePending:true`). Display that state honestly and arrange cleanup retry. Do not tell the operator that the room remained open simply because a provider call failed. A transport timeout has similarly uncertain completion; read the current registry before repeating a mutation.

The administrator API's booking, Google OAuth, usage and transcript operations are separate, cookie-authenticated browser contracts. They are not currently exposed through this integration API. Do not fabricate corresponding `a=` actions or distribute an administrator password to an integration.

## Source of truth

The executable contract is [api/v1.php](../api/v1.php), with lifecycle and admission behavior in [api/_lib.php](../api/_lib.php). Release consumers should review those files at their pinned commit and run the isolated integration tests before upgrading an external panel.
