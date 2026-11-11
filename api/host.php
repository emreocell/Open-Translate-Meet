<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';
require __DIR__ . '/_admission.php';
require_post();
$tk = ticket();
if (!$tk['host']) fail('forbidden', 403);
$in = body(); $act = (string)($in['action'] ?? ''); $room = $tk['room']; $self = $tk['who'];
if (!rate('host:' . $self . ':' . ($act === 'state' ? 'poll' : 'mutate'), $act === 'state' ? 1800 : 240, 3600)) fail('rate', 429);
$result = storage_lock('room:' . $room, static function () use ($room, $self, $in, $act): array {
  $tk = ticket(); if (!$tk['host']) fail('forbidden', 403);
  $reg = room_require_open($room);
  if ($act === 'state') {
    $st = room_state($room);
    return ['max' => $st['max'], 'locked' => $st['locked'], 'count' => $st['count'],
      'waitingRoom' => !empty($reg['waitingRoom']), 'waiting' => waiting_public($reg), 'expiresAt' => $reg['expiresAt']];
  }
  if (in_array($act, ['admit', 'reject'], true)) {
    $id = (string)($in['waitingId'] ?? '');
    if (!preg_match('/^[a-f0-9]{24}$/D', $id)) fail('bad_target');
    $w = $reg['waiting'][$id] ?? null;
    if (!is_array($w) || (int)($w['expires'] ?? 0) <= time()) fail('waiting_expired', 410);
    if (($w['status'] ?? '') === ($act === 'admit' ? 'admitted' : 'rejected')) return ['ok' => true];
    if (($w['status'] ?? '') !== 'pending') fail('waiting_decided', 409);
    $reg['waiting'][$id]['status'] = $act === 'admit' ? 'admitted' : 'rejected';
    $reg['waiting'][$id]['decidedAt'] = time();
    room_reg_put($room, $reg);
    return ['ok' => true];
  }
  if ($act === 'waiting') {
    if (!is_bool($in['enabled'] ?? null)) fail('bad_setting');
    $reg['waitingRoom'] = $in['enabled'];
    if (!$reg['waitingRoom']) foreach ($reg['waiting'] as &$w) if (($w['status'] ?? '') === 'pending') $w['status'] = 'admitted';
    unset($w);
    room_reg_put($room, $reg);
    $ok = room_sync_metadata($room, $reg);
    return ['ok' => $ok, 'waitingRoom' => $reg['waitingRoom'], '_status' => $ok ? 200 : 502];
  }
  if ($act === 'bans') {
    $list = [];
    foreach (mod_read($room)['bans'] as $b) if ((int)($b['until'] ?? 0) === 0 || (int)$b['until'] > time())
      $list[] = ['id' => (string)$b['id'], 'name' => (string)($b['name'] ?? ''), 'until' => (int)$b['until']];
    return ['bans' => $list];
  }
  if ($act === 'unban') {
    $id = (string)($in['id'] ?? ''); if (!preg_match('/^[a-f0-9]{8}$/D', $id)) fail('bad_target');
    mod_edit($room, static function (array &$d) use ($id): void { $d['bans'] = array_values(array_filter($d['bans'], static fn($b) => ($b['id'] ?? '') !== $id)); });
    return ['ok' => true];
  }
  if ($act === 'limit' || $act === 'lock') {
    if ($act === 'limit') {
      $n = filter_var($in['max'] ?? null, FILTER_VALIDATE_INT);
      if ($n === false || $n < 2 || $n > MAX_PARTICIPANTS) fail('bad_limit');
      $reg['max'] = $n;
    } else {
      if (!is_bool($in['locked'] ?? null)) fail('bad_setting');
      $reg['locked'] = $in['locked'];
    }
    room_reg_put($room, $reg); // Authoritative policy commits before any fallible media notification.
    $ok = room_sync_metadata($room, $reg);
    return ['ok' => $ok, 'max' => $reg['max'], 'locked' => !empty($reg['locked']), 'policySaved' => true, '_status' => $ok ? 200 : 502];
  }
  if ($act === 'end') {
    $result = room_close($room);
    return $result + ['_status' => $result['ok'] ? 200 : 502];
  }
  if (!in_array($act, ['kick', 'mute', 'allow'], true)) fail('bad_action');
  $who = (string)($in['identity'] ?? '');
  if (!preg_match('/^[a-f0-9]{12}$/D', $who) || $who === $self) fail('bad_target');
  $target = $reg['sessions'][$who] ?? null;
  if (!is_array($target) || !empty($target['host'])) fail('bad_target');
  $did = (string)($target['did'] ?? '');
  if ($act === 'kick') {
    $ban = (string)($in['ban'] ?? 'none');
    if (!in_array($ban, ['none', '10m', '1h', 'room'], true)) fail('bad_ban');
    $pending = room_media_begin($room);
    $banned = $ban !== 'none';
    if ($banned) {
      $until = ['10m' => time() + 600, '1h' => time() + 3600, 'room' => 0][$ban];
      mod_edit($room, static function (array &$d) use ($did, $target, $until): void {
        $d['bans'] = array_values(array_filter($d['bans'], static fn($b) => ($b['did'] ?? '') !== $did && ((int)($b['until'] ?? 0) === 0 || (int)$b['until'] > time())));
        $d['bans'][] = ['id' => bin2hex(random_bytes(4)), 'did' => $did, 'name' => $target['name'], 'until' => $until, 'at' => time()];
      });
    }
    $revoke = [];
    foreach ($reg['sessions'] as $id => &$session) if ((string)$id === $who || ($banned && ($session['did'] ?? '') === $did && empty($session['host']))) {
      $session['revoked'] = true; $session['reservedUntil'] = 0; $revoke[] = (string)$id;
    }
    unset($session);
    $reg['mediaSyncPending'] = true; room_reg_put($room, $reg);
    $ok = true;
    foreach ($revoke as $id) {
      $r = lk_call('RemoveParticipant', ['room' => $room, 'identity' => $id], $room);
      $ok = in_array($r['code'], [200, 404], true) && $ok;
    }
    room_media_finish($room, $ok, $pending);
    return ['ok' => $ok, 'banned' => $banned, 'revoked' => true, '_status' => $ok ? 200 : 502];
  }
  $src = (string)($in['source'] ?? '');
  if (!in_array($src, ['microphone', 'camera'], true)) fail('bad_target');
  $key = $src === 'microphone' ? 'mic' : 'cam';
  $pending = room_media_begin($room);
  $allowed = mod_edit($room, static function (array &$d) use ($did, $key, $act, $target): array {
    $found = false;
    foreach ($d['locks'] as &$l) if (mod_match($l, $did)) {
      $l[$key] = $act === 'mute'; $found = true;
    }
    unset($l);
    if (!$found && $act === 'mute') $d['locks'][] = ['did' => $did, $key => true];
    $d['locks'] = array_values(array_filter($d['locks'], static fn($l) => !empty($l['mic']) || !empty($l['cam'])));
    return mod_sources($d, $did);
  });
  $ok = true;
  foreach ($reg['sessions'] as $id => $session) if (($session['did'] ?? '') === $did && empty($session['revoked']) && empty($session['host']))
    $ok = lk_set_sources($room, (string)$id, $allowed) && $ok;
  room_media_finish($room, $ok, $pending);
  return ['ok' => $ok, 'policySaved' => true, '_status' => $ok ? 200 : 502];
});
$status = $result['_status'] ?? 200; unset($result['_status']);
if ($status !== 200 && !isset($result['error'])) $result['error'] = 'media_unavailable';
out($result, $status);
