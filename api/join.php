<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';
require __DIR__ . '/_admission.php';
require_post();
$in = body();
$room = room_from_link((string)($in['r'] ?? ''));
if ($room === null) fail('bad_link', 403);
$did = device_id();
$isPoll = (string)($in['waitingToken'] ?? '') !== '';
if (!rate(($isPoll ? 'wait-poll:' : 'join:') . client_ip(), $isPoll ? 1800 : 90, 3600)) fail('rate', 429);

$result = storage_lock('room:' . $room, static function () use ($room, $in, $did, $isPoll): array {
  $reg = room_require_open($room);
  $h = (string)($in['h'] ?? '');
  $isHost = $h !== '' && host_ok($room, $h);
  if ($h !== '' && !$isHost) fail('bad_host', 403);
  $resume = ticket_claims((string)($in['resumeToken'] ?? ''));
  if ($resume !== null && ($resume['room'] !== $room || ($resume['session']['did'] ?? '') !== $did)) $resume = null;
  if ($resume !== null) $isHost = $resume['host'];
  $mod = mod_read($room);
  if (!$isHost) {
    $until = mod_ban($mod, $did);
    if ($until !== null) fail('banned', 403, ['until' => $until]);
  }
  $waiting = null;
  if ($isPoll) {
    $wc = waiting_claims((string)$in['waitingToken'], $room, $did);
    if ($wc === null) fail('waiting_expired', 410);
    $waiting = $reg['waiting'][$wc['id']] ?? null;
    if (!is_array($waiting) || (int)($waiting['expires'] ?? 0) <= time() || ($waiting['did'] ?? '') !== $did) fail('waiting_expired', 410);
    if (($waiting['status'] ?? '') === 'rejected') fail('waiting_rejected', 403);
    if (($waiting['status'] ?? '') === 'pending') return ['status' => 'waiting', 'waitingToken' => $in['waitingToken'], '_status' => 202];
    if (!empty($waiting['identity']) && isset($reg['sessions'][$waiting['identity']])) {
      $resume = ticket_claims(issue_ticket($reg, $waiting['identity']));
      if ($resume === null) fail('waiting_expired', 410);
    }
  } elseif (!$isHost && $resume === null && !empty($reg['passHash'])) {
    $pw = (string)($in['pw'] ?? '');
    if ($pw === '') fail('password_required', 401);
    if (strlen($pw) > 128 || !rate('pw:' . $room . ':' . client_ip(), 10, 600) || !rate('pw-room:' . $room, 80, 600)) fail('rate', 429);
    if (!password_verify($pw, (string)$reg['passHash'])) fail('bad_password', 401);
  }
  $st = room_state($room);
  if (!$isHost) {
    if (!empty($reg['locked']) && $resume === null && ($waiting['status'] ?? '') !== 'admitted') fail('room_locked', 423);
    $starts = (int)($reg['startsAt'] ?? 0);
    $hostPresent = false;
    foreach ($st['participants'] as $p) if (!empty($reg['sessions'][(string)($p['identity'] ?? '')]['host'])) { $hostPresent = true; break; }
    if ($starts > time() + 600 && !$hostPresent) fail('too_early', 425, ['startsAt' => $starts]);
  }
  $name = clean_title((string)($waiting['name'] ?? $in['name'] ?? ''));
  $name = mb_substr($name, 0, 40);
  if ($name === '') $name = $isHost ? 'Host' : 'Guest';
  $default = in_array(config_string('DEFAULT_LOCALE', 'en'), LANGS, true) ? config_string('DEFAULT_LOCALE', 'en') : LANGS[0];
  $speak = (string)($waiting['speak'] ?? $in['speak'] ?? $default);
  $hear = (string)($waiting['hear'] ?? $in['hear'] ?? $speak);
  if (!in_array($speak, LANGS, true) || !in_array($hear, LANGS, true)) fail('bad_lang');
  if (!$isHost && $resume === null && !$isPoll && !empty($reg['waitingRoom'])) {
    $now = time();
    $reg['waiting'] = array_filter((array)($reg['waiting'] ?? []), static fn($w) => (int)($w['expires'] ?? 0) > $now);
    foreach ($reg['waiting'] as $id => $w) if (($w['did'] ?? '') === $did && ($w['status'] ?? '') === 'pending')
      return ['status' => 'waiting', 'waitingToken' => waiting_token($room, $id, $did, (int)$w['expires']), '_status' => 202];
    if (count($reg['waiting']) >= 100) fail('waiting_full', 429);
    $id = bin2hex(random_bytes(12)); $expires = min($now + 900, (int)$reg['expiresAt']);
    $reg['waiting'][$id] = ['id' => $id, 'did' => $did, 'name' => $name, 'speak' => $speak, 'hear' => $hear,
      'requestedAt' => $now, 'expires' => $expires, 'status' => 'pending'];
    room_reg_put($room, $reg);
    return ['status' => 'waiting', 'waitingToken' => waiting_token($room, $id, $did, $expires), '_status' => 202];
  }
  if (!$isHost && $resume === null && !empty($reg['waitingRoom']) && (!$waiting || ($waiting['status'] ?? '') !== 'admitted')) fail('waiting_required', 403);
  $e = env();
  if (empty($e['LIVEKIT_URL']) || empty($e['LIVEKIT_API_KEY']) || empty($e['LIVEKIT_API_SECRET'])) fail('server_config', 503);
  $now = time(); $ttl = meet_int_env('JOIN_TOKEN_TTL', 120, 30, 600);
  $identity = $resume['who'] ?? bin2hex(random_bytes(6));
  $liveIds = array_map(static fn($p) => (string)($p['identity'] ?? ''), $st['participants']);
  $reserved = [];
  foreach ((array)($reg['sessions'] ?? []) as $id => $s) {
    $id = (string)$id; // PHP converts all-digit hexadecimal object keys to integers.
    if ((int)($s['expires'] ?? 0) <= $now || !empty($s['revoked'])) { unset($reg['sessions'][$id]); continue; }
    if ($id !== $identity && !in_array($id, $liveIds, true) && (int)($s['reservedUntil'] ?? 0) > $now) $reserved[] = $id;
  }
  $occupied = count(array_unique(array_merge(array_filter($liveIds, static fn($id) => $id !== $identity), $reserved)));
  if ($occupied >= (int)$reg['max']) fail('room_full', 409, ['max' => (int)$reg['max']]);
  if (!$st['exists']) {
    // LiveKit enforces the deployment ceiling; the serialized registry applies the room's mutable limit.
    $r = lk_call('CreateRoom', ['name' => $room, 'emptyTimeout' => 300, 'maxParticipants' => MAX_PARTICIPANTS,
      'metadata' => json_encode(['max' => $reg['max'], 'locked' => !empty($reg['locked']), 'waitingRoom' => !empty($reg['waitingRoom'])])]);
    if ($r['code'] !== 200) fail('media_unavailable', 503);
  }
  $session = $resume['session'] ?? ['sid' => bin2hex(random_bytes(16)), 'created' => $now];
  $session = array_merge($session, ['did' => $did, 'name' => $name, 'speak' => $speak, 'hear' => $hear, 'host' => $isHost,
    'reservedUntil' => $now + $ttl, 'expires' => min($now + meet_int_env('SESSION_TTL', 28800, 600, 86400), (int)$reg['expiresAt'])]);
  $reg['sessions'][$identity] = $session;
  if ($waiting !== null) { $reg['waiting'][$waiting['id']]['status'] = 'consumed'; $reg['waiting'][$waiting['id']]['identity'] = $identity; }
  room_reg_put($room, $reg);
  $grant = ['room' => $room, 'roomJoin' => true, 'canPublish' => true, 'canSubscribe' => true,
    'canPublishData' => true, 'canUpdateOwnMetadata' => false];
  if (!$isHost) {
    $allowed = mod_sources($mod, $did);
    if (count($allowed) < count(SRC_ALL)) $grant['canPublishSources'] = $allowed;
  }
  $token = jwt_sign(['iss' => (string)$e['LIVEKIT_API_KEY'], 'sub' => $identity, 'name' => $name,
    'nbf' => $now - 2, 'exp' => $now + $ttl, 'metadata' => participant_metadata($session), 'video' => $grant], (string)$e['LIVEKIT_API_SECRET']);
  $ticket = issue_ticket($reg, $identity);
  file_ticket_cookie($room, $ticket, $session['expires']);
  return ['url' => $e['LIVEKIT_URL'], 'token' => $token, 'ticket' => $ticket, 'resumeToken' => $ticket,
    'identity' => $identity, 'room' => $room, 'host' => $isHost, 'speak' => $speak, 'hear' => $hear,
    'expiresAt' => $reg['expiresAt'], 'ticketExpiresAt' => $session['expires'], 'translation' => translation_configured()];
});
$status = $result['_status'] ?? 200; unset($result['_status']);
out($result, $status);
