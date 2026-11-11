<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';
require_post();
$tk = ticket(); $in = body(); $action = (string)($in['action'] ?? 'languages');
if (!rate('participant:' . $tk['who'], $action === 'state' ? 1800 : 180, 3600)) fail('rate', 429);
$result = storage_lock('room:' . $tk['room'], static function () use ($in, $action): array {
  $tk = ticket(); $room = $tk['room']; $who = $tk['who']; $reg = room_require_open($room);
  if ($action === 'state') return ['ok' => true, 'speak' => $tk['speak'], 'hear' => $tk['hear'], 'expiresAt' => $reg['expiresAt'],
    'sources' => $tk['host'] ? SRC_ALL : mod_sources(mod_read($room), (string)$tk['session']['did'])];
  if ($action === 'leave') {
    $pending = !empty($reg['mediaSyncPending']); $reg['mediaSyncPending'] = true;
    $reg['sessions'][$who]['revoked'] = true; $reg['sessions'][$who]['reservedUntil'] = 0; room_reg_put($room, $reg);
    file_ticket_cookie($room, '', time() - 3600);
    $r = lk_call('RemoveParticipant', ['room' => $room, 'identity' => $who], $room);
    $ok = in_array($r['code'], [200, 404], true); room_media_finish($room, $ok, $pending);
    return ['ok' => $ok, 'revoked' => true];
  }
  if ($action !== 'languages') fail('bad_action');
  $speak = (string)($in['speak'] ?? ''); $hear = (string)($in['hear'] ?? '');
  if (!in_array($speak, LANGS, true) || !in_array($hear, LANGS, true)) fail('bad_lang');
  $session = $reg['sessions'][$who]; $session['speak'] = $speak; $session['hear'] = $hear;
  $r = lk_call('UpdateParticipant', ['room' => $room, 'identity' => $who, 'metadata' => participant_metadata($session)], $room);
  if ($r['code'] !== 200) fail('media_unavailable', 503);
  $reg['sessions'][$who] = $session; room_reg_put($room, $reg);
  return ['ok' => true, 'speak' => $speak, 'hear' => $hear];
});
out($result, !empty($result['ok']) ? 200 : 502);
