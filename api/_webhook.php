<?php
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';

/** Verify LiveKit's standard-base64 SHA-256 claim over the exact raw HTTP payload. */
function webhook_event(string $raw, string $authorization): array {
  $key = config_string('LIVEKIT_WEBHOOK_API_KEY'); $secret = config_string('LIVEKIT_WEBHOOK_API_SECRET');
  if ($key === '' && $secret === '') { $key = config_string('LIVEKIT_API_KEY'); $secret = config_string('LIVEKIT_API_SECRET'); }
  if ($key === '' || $secret === '') fail('not_configured', 503);
  $token = stripos($authorization, 'Bearer ') === 0 ? trim(substr($authorization, 7)) : trim($authorization);
  // JOSE-based SDKs may omit typ; alg, issuer, expiry, signature and body digest remain mandatory.
  $claims = jwt_verify($token, $secret, false);
  if ($claims === null || ($claims['iss'] ?? '') !== $key || !is_string($claims['sha256'] ?? null)) fail('unauthorized', 401);
  $hash = base64_decode($claims['sha256'], true);
  if ($hash === false || !hash_equals(hash('sha256', $raw, true), $hash)) fail('unauthorized', 401);
  try { $event = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); } catch (JsonException) { fail('bad_json'); }
  if (!is_array($event) || !str_starts_with(ltrim($raw), '{')) fail('bad_json');
  if (!preg_match('/^[A-Za-z0-9_-]{1,128}$/D', (string)($event['id'] ?? ''))) fail('bad_event');
  $created = $event['createdAt'] ?? $event['created_at'] ?? null;
  if ((!is_int($created) && !(is_string($created) && ctype_digit($created))) || (int)$created > time() + 60
    || (int)$created < time() - config_int('WEBHOOK_MAX_AGE_SECONDS', 86400, 300, 604800)) fail('stale_event', 400);
  return $event;
}
function webhook_remove(string $room, string $identity): void {
  $pending = room_media_begin($room);
  $r = lk_call('RemoveParticipant', ['room' => $room, 'identity' => $identity], $room);
  if (!in_array($r['code'], [200, 404], true)) fail('media_unavailable', 503);
  room_media_finish($room, true, $pending);
}
function webhook_handle(array $event, string $bodyHash): array {
  $eventKey = hash('sha256', (string)$event['id']);
  return storage_lock('webhook:' . $eventKey, static function () use ($event, $bodyHash, $eventKey): array {
    $path = PRIV . '/webhooks/' . $eventKey . '.json'; $processed = private_json_read($path);
    if ($processed !== null) {
      if (!hash_equals((string)($processed['bodyHash'] ?? ''), $bodyHash)) fail('event_conflict', 409);
      return ['ok' => true, 'duplicate' => true];
    }
    $room = (string)($event['room']['name'] ?? ''); $type = (string)($event['event'] ?? '');
    $result = ['ok' => true, 'ignored' => true];
    if (room_id_ok($room) && in_array($type, ['participant_joined', 'participant_left', 'room_finished'], true)) {
      $result = storage_lock('room:' . $room, static function () use ($event, $room, $type): array {
        $reg = room_reg_get($room);
        // A natural empty-room finish does not end/revoke the application's meeting.
        if ($type === 'room_finished') return ['ok' => true];
        $identity = (string)($event['participant']['identity'] ?? '');
        if ($identity === '' || strlen($identity) > 256) fail('bad_event');
        $eventSid = (string)($event['participant']['sid'] ?? '');
        if ($type === 'participant_left') {
          if ($reg !== null && isset($reg['sessions'][$identity])) {
            $session = &$reg['sessions'][$identity];
            if ($eventSid === '' || empty($session['participantSid']) || $session['participantSid'] === $eventSid) {
              $session['lastLeftAt'] = (int)($event['createdAt'] ?? $event['created_at']);
              // Unexpected disconnects can retain refreshed media tokens for ten minutes.
              $session['reservedUntil'] = !empty($session['revoked']) ? 0 : min((int)$session['expires'], $session['lastLeftAt'] + 600);
              room_reg_put($room, $reg);
            }
            unset($session);
          }
          return ['ok' => true];
        }
        if ($reg === null || !room_is_open($reg)) {
          if ($reg !== null) room_reg_edit($room, static function (array &$r): void { $r['mediaClosePending'] = true; });
          $r = lk_call('DeleteRoom', ['room' => $room], $room);
          if (!in_array($r['code'], [200, 404], true)) fail('media_unavailable', 503);
          if ($reg !== null) room_reg_edit($room, static function (array &$r): void { $r['mediaClosePending'] = false; });
          return ['ok' => true, 'removed' => true, 'reason' => 'room_closed'];
        }
        $current = lk_call('GetParticipant', ['room' => $room, 'identity' => $identity], $room);
        if ($current['code'] === 404) return ['ok' => true, 'gone' => true];
        if ($current['code'] !== 200) fail('media_unavailable', 503);
        if ($eventSid !== '' && ($current['json']['sid'] ?? '') !== $eventSid) return ['ok' => true, 'stale' => true];
        $session = $reg['sessions'][$identity] ?? null;
        $mod = mod_read($room);
        if (!is_array($session) || !empty($session['revoked']) || (int)($session['expires'] ?? 0) <= time()
          || (empty($session['host']) && mod_ban($mod, (string)($session['did'] ?? '')) !== null)) {
          webhook_remove($room, $identity);
          return ['ok' => true, 'removed' => true, 'reason' => 'unauthorized'];
        }
        $st = room_state($room);
        if ($st['count'] > (int)$reg['max']) {
          $joinedAt = static fn(array $p): int => (int)($p['joinedAtMs'] ?? $p['joined_at_ms'] ?? ((int)($p['joinedAt'] ?? $p['joined_at'] ?? 0) * 1000));
          $thisAt = $joinedAt($current['json']); $latest = $thisAt;
          foreach ($st['participants'] as $p) $latest = max($latest, $joinedAt($p));
          // Only remove the participant named by the actual latest join event. Never select an unrelated host.
          if ($thisAt >= $latest) {
            webhook_remove($room, $identity);
            $reg['sessions'][$identity]['reservedUntil'] = 0;
            room_reg_put($room, $reg);
            return ['ok' => true, 'removed' => true, 'reason' => 'room_full'];
          }
        }
        $sources = !empty($session['host']) ? SRC_ALL : mod_sources($mod, (string)$session['did']);
        $pending = !empty($reg['mediaSyncPending']); $reg['mediaSyncPending'] = true; room_reg_put($room, $reg);
        $r = lk_call('UpdateParticipant', ['room' => $room, 'identity' => $identity,
          'name' => (string)$session['name'], 'metadata' => participant_metadata($session), 'permission' => [
            'canSubscribe' => true, 'canPublish' => count($sources) > 0, 'canPublishData' => true,
            'canUpdateMetadata' => false, 'canPublishSources' => array_map('strtoupper', $sources)]], $room);
        if ($r['code'] !== 200) fail('media_unavailable', 503);
        $reg['mediaSyncPending'] = $pending;
        $reg['sessions'][$identity]['participantSid'] = (string)($current['json']['sid'] ?? $eventSid);
        $reg['sessions'][$identity]['lastSeenAt'] = time();
        $reg['sessions'][$identity]['reservedUntil'] = min((int)$session['expires'], time() + 600);
        room_reg_put($room, $reg);
        return ['ok' => true, 'enforced' => true];
      });
    }
    private_json_write($path, ['bodyHash' => $bodyHash, 'processedAt' => time()]);
    return $result;
  });
}
function sweep_webhooks(): void {
  $age = config_int('WEBHOOK_MAX_AGE_SECONDS', 86400, 300, 604800) + 3600;
  foreach (glob(PRIV . '/webhooks/*.json') ?: [] as $path) {
    if (time() - (int)filemtime($path) <= $age) continue;
    $id = basename($path, '.json');
    storage_lock('webhook:' . $id, static function () use ($path, $age): void {
      if (is_file($path) && time() - (int)filemtime($path) > $age) @unlink($path);
    });
  }
}
