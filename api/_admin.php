<?php
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';

function admin_password_hash(): string {
  $configured = config_string('ADMIN_PASSWORD_HASH');
  if ($configured !== '') return $configured;
  return (string)(private_json_read(PRIV . '/admin.json', [])['passwordHash'] ?? '');
}

function admin_session(): array {
  if (session_status() !== PHP_SESSION_ACTIVE) {
    private_dir(PRIV . '/admin-sessions');
    ini_set('session.use_strict_mode', '1'); ini_set('session.use_only_cookies', '1'); ini_set('session.cookie_httponly', '1');
    session_save_path(PRIV . '/admin-sessions'); session_name('meet_admin');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => str_starts_with(PUBLIC_ORIGIN, 'https://'), 'httponly' => true, 'samesite' => 'Lax']);
    if (!session_start()) fail('storage', 503);
  }
  $now = time();
  if (!empty($_SESSION['admin']) && ((int)($_SESSION['expires'] ?? 0) <= $now || (int)($_SESSION['last'] ?? 0) + 1800 < $now
    || !hash_equals((string)($_SESSION['credentialVersion'] ?? ''), hash('sha256', admin_password_hash())))) $_SESSION = [];
  $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
  if (!empty($_SESSION['admin'])) $_SESSION['last'] = $now;
  return $_SESSION;
}

function admin_require(bool $mutation = false): array {
  request_origin(); $s = admin_session();
  if (empty($s['admin'])) fail('unauthorized', 401);
  if ($mutation) {
    $csrf = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if ($csrf === '' || !hash_equals($s['csrf'], $csrf)) fail('csrf', 403);
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') fail('origin', 403);
  }
  session_write_close(); return $s;
}

function admin_login(string $password): array {
  if (!rate('admin-login:' . client_ip(), 8, 900) || !rate('admin-login-global', 120, 3600)) fail('rate', 429);
  $hash = admin_password_hash();
  $dummy = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
  $valid = password_verify($password, $hash !== '' ? $hash : $dummy);
  if (!$valid || $hash === '') fail('forbidden', 403);
  admin_session(); if (!session_regenerate_id(true)) fail('storage', 503);
  $_SESSION = ['admin' => true, 'csrf' => bin2hex(random_bytes(32)), 'expires' => time() + 8 * 3600,
    'last' => time(), 'credentialVersion' => hash('sha256', $hash)];
  $result = ['authenticated' => true, 'csrf' => $_SESSION['csrf']]; session_write_close(); return $result;
}

function admin_room_view(array $r, ?int $live = null): array {
  return ['id' => $r['id'], 'title' => $r['title'] ?? '', 'created' => $r['created'] ?? 0,
    'startsAt' => $r['startsAt'] ?? 0, 'expiresAt' => $r['expiresAt'] ?? 0,
    'status' => !empty($r['deleted']) ? 'deleted' : (!empty($r['ended']) ? 'ended' : ($r['status'] ?? 'active')),
    'open' => room_is_open($r), 'max' => $r['max'] ?? MAX_PARTICIPANTS, 'waitingRoom' => !empty($r['waitingRoom']),
    'locked' => !empty($r['locked']), 'hasPassword' => !empty($r['passHash']), 'live' => $live,
    'mediaClosePending' => !empty($r['mediaClosePending'])];
}

function admin_rooms(): array {
  $response = lk_call('ListRooms', []); $live = [];
  if ($response['code'] === 200) foreach ($response['json']['rooms'] ?? [] as $row) $live[(string)($row['name'] ?? '')] = (int)($row['numParticipants'] ?? $row['num_participants'] ?? 0);
  $rooms = [];
  foreach (glob(ROOMS_DIR . '/*.json') ?: [] as $path) {
    $id = basename($path, '.json'); if (!room_id_ok($id)) continue;
    $r = room_reg_get($id); if (!$r || !empty($r['deleted']) || ($r['status'] ?? '') === 'deleted') continue;
    $rooms[] = admin_room_view($r, $response['code'] === 200 ? ($live[$id] ?? 0) : null);
  }
  usort($rooms, static fn($a, $b) => $b['created'] <=> $a['created']);
  return ['rooms' => $rooms, 'mediaAvailable' => $response['code'] === 200];
}
