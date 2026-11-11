<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';
/** Provider-neutral signed management API. */
require_post();
$secret = config_string('INTEGRATION_SECRET');
if (strlen($secret) < 32) fail('not_configured', 503);
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 65536) fail('too_large', 413);
$raw = (string)file_get_contents('php://input', false, null, 0, 65537);
if (strlen($raw) > 65536) fail('too_large', 413);
$a = (string)($_GET['a'] ?? '');
$ts = (string)($_SERVER['HTTP_X_MEET_TIMESTAMP'] ?? '');
$sig = (string)($_SERVER['HTTP_X_MEET_SIGNATURE'] ?? '');
if (!preg_match('/^[0-9]{10,12}$/D', $ts) || abs(time() - (int)$ts) > 120 || !preg_match('/^[a-f0-9]{64}$/D', $sig)) fail('unauthorized', 401);
$expect = hash_hmac('sha256', $ts . "\nPOST\n" . $a . "\n" . hash('sha256', $raw), $secret);
if (!hash_equals($expect, $sig)) fail('unauthorized', 401);
if (!rate('v1:all', 600, 3600)) fail('rate', 429);
if (!rate('v1sig:' . $sig, 1, 400)) fail('replay', 401);
try { $in = $raw === '' ? [] : json_decode($raw, true, 32, JSON_THROW_ON_ERROR); } catch (JsonException) { fail('bad_json'); }
if (!is_array($in) || ($raw !== '' && !str_starts_with(ltrim($raw), '{'))) fail('bad_json');
function integration_view(array $r, ?int $live = null, bool $hostLink = false): array {
  $links = room_links($r['id'], (string)($r['title'] ?? ''));
  if (!$hostLink) unset($links['hostLink']);
  return ['room' => $r['id'], 'title' => $r['title'] ?? '', 'max' => (int)($r['max'] ?? MAX_PARTICIPANTS), 'hasPassword' => !empty($r['passHash']),
    'created' => (int)($r['created'] ?? 0), 'expiresAt' => (int)($r['expiresAt'] ?? 0), 'startsAt' => (int)($r['startsAt'] ?? 0),
    'deleted' => !empty($r['deleted']), 'status' => room_is_open($r) ? 'active' : ($r['status'] ?? 'expired'),
    'locked' => !empty($r['locked']), 'waitingRoom' => !empty($r['waitingRoom']), 'live' => $live] + $links;
}
if ($a === 'create') {
  $r = room_create($in);
  out(integration_view($r, 0, true), 201);
}
if ($a === 'list') {
  $live = []; $lr = lk_call('ListRooms', []); $available = $lr['code'] === 200;
  foreach ($lr['json']['rooms'] ?? [] as $x) $live[(string)($x['name'] ?? '')] = (int)($x['numParticipants'] ?? $x['num_participants'] ?? 0);
  $files = glob(ROOMS_DIR . '/*.json') ?: [];
  usort($files, static fn($x, $y) => filemtime($y) <=> filemtime($x));
  $rows = [];
  foreach (array_slice($files, 0, 200) as $f) {
    $r = private_json_read($f);
    if (is_array($r) && isset($r['id'])) $rows[] = integration_view($r, $available ? (int)($live[$r['id']] ?? 0) : null);
  }
  out(['rooms' => $rows, 'mediaAvailable' => $available, 'truncated' => count($files) > 200]);
}
$id = (string)($in['room'] ?? '');
if (!room_id_ok($id)) fail('bad_room');
$result = storage_lock('room:' . $id, static function () use ($id, $a, $in): array {
  $r = room_reg_get($id); if ($r === null) fail('not_found', 404);
  if ($a === 'get') { $st = room_state($id, false); return integration_view($r, $st['count']); }
  if ($a === 'delete') return room_close($id, 'deleted');
  if (!room_is_open($r)) fail('room_closed', 410);
  if ($a === 'host_link') return ['room' => $id] + room_links($id, (string)($r['title'] ?? ''));
  if ($a === 'rotate_links') {
    $r['linkVersion'] = bin2hex(random_bytes(12)); $r['hostVersion'] = bin2hex(random_bytes(12)); room_reg_put($id, $r);
    return ['room' => $id] + room_links($id, (string)($r['title'] ?? ''));
  }
  if ($a !== 'update') fail('bad_action');
  if (array_key_exists('title', $in)) $r['title'] = clean_title((string)$in['title']);
  if (array_key_exists('max', $in)) {
    $n = filter_var($in['max'], FILTER_VALIDATE_INT);
    if ($n === false || $n < 2 || $n > MAX_PARTICIPANTS) fail('bad_limit');
    $r['max'] = $n;
  }
  if (!empty($in['clearPassword'])) unset($r['passHash']);
  elseif (isset($in['password']) && $in['password'] !== '') {
    $pw = (string)$in['password'];
    if (mb_strlen($pw) < 4 || strlen($pw) > 72) fail('bad_password_length');
    $r['passHash'] = password_hash($pw, PASSWORD_DEFAULT);
  }
  foreach (['waitingRoom', 'locked'] as $flag) if (array_key_exists($flag, $in)) {
    if (!is_bool($in[$flag])) fail('bad_setting'); $r[$flag] = $in[$flag];
  }
  foreach (['startsAt', 'expiresAt'] as $field) if (array_key_exists($field, $in)) $r[$field] = (int)$in[$field];
  if ((int)$r['expiresAt'] <= time() || (int)$r['expiresAt'] > time() + 366 * 86400 || ((int)$r['startsAt'] > 0 && (int)$r['expiresAt'] <= (int)$r['startsAt'])) fail('bad_schedule');
  room_reg_put($id, $r);
  $synced = room_sync_metadata($id, $r); $live = null;
  try { $live = room_state($id, false)['count']; }
  catch (MeetHttpError $e) { if ($e->error !== 'media_unavailable') throw $e; $synced = false; }
  return integration_view($r, $live) + ['ok' => $synced, 'policySaved' => true,
    'mediaSyncPending' => !empty(room_reg_get($id)['mediaSyncPending'])];
});
$status = array_key_exists('ok', $result) && !$result['ok'] ? 502 : 200;
if ($status !== 200) $result['error'] = 'media_unavailable';
out($result, $status);
