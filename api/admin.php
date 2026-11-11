<?php
declare(strict_types=1);
require __DIR__ . '/_admin.php';
$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method === 'GET' && ($_GET['action'] ?? 'status') === 'status') {
  request_origin(); $s = admin_session(); session_write_close();
  out(['authenticated' => !empty($s['admin']), 'configured' => admin_password_hash() !== '',
    'csrf' => !empty($s['admin']) ? $s['csrf'] : null, 'config' => public_config()]);
}
if ($method === 'GET') {
  admin_require(); $action = (string)($_GET['action'] ?? 'rooms');
  if ($action === 'rooms') out(admin_rooms());
  if ($action === 'health') {
    require_once __DIR__ . '/_google.php';
    out(['app' => app_name(), 'privateStorageWritable' => is_dir(PRIV) && is_writable(PRIV),
      'mediaConfigured' => config_string('LIVEKIT_URL') !== '' && config_string('LIVEKIT_API_KEY') !== '' && config_string('LIVEKIT_API_SECRET') !== '',
      'translationConfigured' => translation_configured(), 'textConfigured' => public_config()['features']['chatTranslation'],
      'bookingEnabled' => config_bool('BOOKING_ENABLED'), 'calendarProvider' => config_string('BOOKING_CALENDAR_PROVIDER', 'none'),
      'calendarConnected' => g_tok() !== null, 'mailConfigured' => mail_cfg() !== null,
      'transcriptsEnabled' => config_bool('TRANSCRIPT_ENABLED'), 'phpVersion' => PHP_VERSION]);
  }
  if ($action === 'bookings') {
    require_once __DIR__ . '/_google.php'; bk_sweep(); $rows = bk_all();
    usort($rows, static fn($a,$b) => $b['created'] <=> $a['created']);
    out(['bookings' => array_map('bk_admin_view', $rows)]);
  }
  fail('bad_action');
}
require_post(); $in = body(32768); $action = (string)($in['action'] ?? '');
if ($action === 'login') out(admin_login((string)($in['password'] ?? '')));
admin_require(true);
if (!rate('admin-action:' . client_ip(), 120, 60)) fail('rate', 429);
if ($action === 'logout') {
  admin_session(); $_SESSION = []; session_destroy();
  setcookie('meet_admin', '', ['expires' => time() - 3600, 'path' => '/', 'secure' => str_starts_with(PUBLIC_ORIGIN, 'https://'), 'httponly' => true, 'samesite' => 'Lax']);
  out(['ok' => true]);
}
if ($action === 'create') {
  $r = room_create($in); out(admin_room_view($r) + room_links($r['id'], $r['title']));
}
if (in_array($action, ['booking_decide', 'booking_cancel', 'booking_reschedule', 'booking_retry_notifications'], true)) {
  require_once __DIR__ . '/_google.php';
  $id = (string)($in['booking'] ?? '');
  if ($action === 'booking_retry_notifications') {
    if (!rate('booking-notify:' . $id, 3, 3600)) fail('rate', 429);
    out(storage_lock('bookings', static function () use ($id): array {
      $b = bk_get($id); if (!$b) fail('not_found', 404);
      $kind = match ($b['status']) { 'pending' => 'pending', 'approved' => 'confirmed', 'rejected' => 'rejected', 'cancelled' => 'cancelled', default => null };
      if ($kind === null) fail('booking_sync_pending', 409);
      bk_notify($b, $kind); return ['ok' => true] + bk_admin_view($b);
    }));
  }
  if ($action === 'booking_decide') out(bk_decide($id, (string)($in['decision'] ?? '')));
  if ($action === 'booking_cancel') out(bk_cancel($id));
  out(bk_reschedule($id, (int)($in['slot'] ?? 0)));
}
$id = (string)($in['room'] ?? '');
if (!room_id_ok($id) || room_reg_get($id) === null) fail('not_found', 404);
if ($action === 'links') { $r = room_require_open($id); out(room_links($id, $r['title'])); }
if ($action === 'end' || $action === 'delete') {
  $closed = room_close($id, $action === 'end' ? 'ended' : 'deleted');
  out($closed + (!$closed['ok'] ? ['error' => 'media_unavailable'] : []), $closed['ok'] ? 200 : 502);
}
if ($action === 'rotate_links') {
  room_reg_edit($id, static function (array &$r): void {
    if (!room_is_open($r)) fail('room_closed', 410);
    $r['linkVersion'] = bin2hex(random_bytes(12)); $r['hostVersion'] = bin2hex(random_bytes(12));
    $r['waiting'] = [];
  });
  out(['ok' => true] + room_links($id, (string)(room_reg_get($id)['title'] ?? '')));
}
if ($action === 'update') {
  $result = room_reg_edit($id, static function (array &$r) use ($id, $in): array {
    if (!room_is_open($r)) fail('room_closed', 410);
    if (isset($in['title'])) $r['title'] = clean_title((string)$in['title']);
    if (array_key_exists('max', $in)) {
      $n = filter_var($in['max'], FILTER_VALIDATE_INT); if ($n === false || $n < 2 || $n > MAX_PARTICIPANTS) fail('bad_limit');
      $st = room_state($id); if ($n < $st['count']) fail('below_live_count', 409); $r['max'] = $n;
    }
    foreach (['locked', 'waitingRoom'] as $flag) if (array_key_exists($flag, $in)) {
      if (!is_bool($in[$flag])) fail('invalid'); $r[$flag] = $in[$flag];
    }
    if (!empty($in['clearPassword'])) unset($r['passHash']);
    elseif (isset($in['password']) && $in['password'] !== '') {
      $pw = (string)$in['password']; if (mb_strlen($pw) < 4 || strlen($pw) > 72) fail('bad_password_length');
      $r['passHash'] = password_hash($pw, PASSWORD_DEFAULT);
    }
    foreach (['startsAt', 'expiresAt'] as $field) if (array_key_exists($field, $in)) $r[$field] = (int)$in[$field];
    if ($r['expiresAt'] <= time() || $r['expiresAt'] > time() + 366 * 86400 || $r['startsAt'] < 0 || ($r['startsAt'] > 0 && $r['expiresAt'] <= $r['startsAt'])) fail('bad_schedule');
    return $r;
  });
  try { $synced = room_sync_metadata($id, $result); } catch (MeetHttpError) { $synced = false; }
  out(admin_room_view($result) + ['ok' => true, 'mediaSyncPending' => !$synced]);
}
if ($action === 'usage') { require_once __DIR__ . '/_ai.php'; out(usage_view($id)); }
if (in_array($action, ['transcript_export', 'transcript_summary', 'transcript_delete'], true)) {
  require_once __DIR__ . '/_transcript.php';
  if ($action === 'transcript_export') out(transcript_export($id));
  if ($action === 'transcript_summary') out(transcript_summary($id, (string)($in['language'] ?? 'en')));
  storage_lock('transcript:' . $id, static function () use ($id): void { rm_tree(transcript_path($id)); }); out(['ok' => true]);
}
fail('bad_action');
