<?php
declare(strict_types=1);
require_once __DIR__ . '/_config.php';

/** Shared application boundaries. LiveKit credentials are never application credentials. */
final class MeetHttpError extends RuntimeException {
  public function __construct(public readonly string $error, public readonly int $status = 400, public readonly array $details = []) { parent::__construct($error); }
}
function fail(string $error, int $status = 400, array $details = []): never { throw new MeetHttpError($error, $status, $details); }
function out(array $data, int $code = 200): never {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  header('X-Content-Type-Options: nosniff');
  header('Referrer-Policy: no-referrer');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
  exit;
}
if (!defined('MEET_TEST_MODE')) set_exception_handler(static function (Throwable $e): never {
  if ($e instanceof MeetHttpError) out(['error' => $e->error] + $e->details, $e->status);
  error_log('Meeting request failed: ' . get_class($e)); // Never log request bodies, provider errors or secrets.
  out(['error' => 'server_error'], 500);
});
function meet_int_env(string $key, int $default, int $min, int $max): int {
  return config_int($key, $default, $min, $max);
}
function app_secret(): string {
  $secret = (string)(env()['APP_SECRET'] ?? '');
  if (strlen($secret) < 32) fail('server_config', 503);
  return $secret;
}
function b64u(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64ud(string $s): string {
  if (!preg_match('/^[A-Za-z0-9_-]*$/D', $s)) return '';
  $r = base64_decode(strtr($s, '-_', '+/'), true);
  return $r === false ? '' : $r;
}
function jwt_sign(array $payload, string $secret): string {
  if ($secret === '') fail('server_config', 503);
  $h = b64u('{"alg":"HS256","typ":"JWT"}');
  $p = b64u(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
  return "$h.$p." . b64u(hash_hmac('sha256', "$h.$p", $secret, true));
}
function jwt_verify(string $jwt, string $secret, bool $requireType = true): ?array {
  if ($secret === '' || strlen($jwt) > 16384) return null;
  $parts = explode('.', $jwt);
  if (count($parts) !== 3) return null;
  [$h, $p, $s] = $parts;
  $header = json_decode(b64ud($h), true);
  if (!is_array($header) || ($header['alg'] ?? '') !== 'HS256' || ($requireType && ($header['typ'] ?? '') !== 'JWT') || (isset($header['typ']) && $header['typ'] !== 'JWT')) return null;
  if (!hash_equals(b64u(hash_hmac('sha256', "$h.$p", $secret, true)), $s)) return null;
  $c = json_decode(b64ud($p), true);
  if (!is_array($c) || !isset($c['exp']) || !is_int($c['exp']) || $c['exp'] <= time()) return null;
  if (isset($c['nbf']) && (!is_int($c['nbf']) || $c['nbf'] > time() + 5)) return null;
  return $c;
}
function bearer(): string {
  $t = (string)($_SERVER['HTTP_X_MEET_TOKEN'] ?? '');
  if ($t !== '') return trim($t);
  $h = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
  return stripos($h, 'Bearer ') === 0 ? trim(substr($h, 7)) : '';
}
function request_origin(): void {
  $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
  if ($origin === '') return; // CLI/server clients authenticate explicitly; browser origins are checked when supplied.
  $u = parse_url(PUBLIC_ORIGIN);
  $expected = ($u['scheme'] ?? '') . '://' . ($u['host'] ?? '') . (isset($u['port']) ? ':' . $u['port'] : '');
  if (!hash_equals($expected, $origin)) fail('origin', 403);
}
function require_post(): void {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { header('Allow: POST'); fail('method', 405); }
  request_origin();
}
function body(int $limit = 16384): array {
  static $cache = null;
  if ($cache !== null) return $cache;
  if (isset($_SERVER['CONTENT_LENGTH']) && (int)$_SERVER['CONTENT_LENGTH'] > $limit) fail('too_large', 413);
  $raw = file_get_contents('php://input', false, null, 0, $limit + 1);
  if ($raw === false) fail('body_read', 400);
  if (strlen($raw) > $limit) fail('too_large', 413);
  if ($raw === '') return $cache = [];
  $type = strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
  if ($type !== 'application/json') fail('content_type', 415);
  try { $j = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); } catch (JsonException) { fail('bad_json'); }
  if (!is_array($j) || !str_starts_with(ltrim($raw), '{')) fail('bad_json');
  return $cache = $j;
}
function private_dir(string $path): void {
  if (is_link($path)) fail('storage', 503);
  if (!is_dir($path) && !@mkdir($path, 0700, true) && !is_dir($path)) fail('storage', 503);
  @chmod($path, 0700);
}
function private_json_read(string $path, ?array $missing = null): ?array {
  if (is_link($path)) fail('storage', 503);
  if (!is_file($path)) return $missing;
  $raw = @file_get_contents($path);
  if ($raw === false || strlen($raw) > 8 * 1024 * 1024) fail('storage', 503);
  try { $d = json_decode($raw, true, 64, JSON_THROW_ON_ERROR); } catch (JsonException) { fail('storage', 503); }
  if (!is_array($d)) fail('storage', 503);
  return $d;
}
/** Atomic replacement: a crash cannot expose a truncated security record. Lock read/modify/write with storage_lock. */
function private_json_write(string $path, array $data): void {
  private_dir(dirname($path));
  if (is_link($path)) fail('storage', 503);
  $raw = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
  $tmp = dirname($path) . '/.write-' . bin2hex(random_bytes(12));
  $h = @fopen($tmp, 'xb');
  if ($h === false) fail('storage', 503);
  @chmod($tmp, 0600);
  try {
    $n = 0; $len = strlen($raw);
    while ($n < $len) { $w = fwrite($h, substr($raw, $n)); if ($w === false || $w === 0) fail('storage', 503); $n += $w; }
    if (!fflush($h)) fail('storage', 503);
    if (function_exists('fsync') && !fsync($h)) fail('storage', 503);
    fclose($h); $h = null;
    if (!@rename($tmp, $path)) fail('storage', 503);
    @chmod($path, 0600);
  } finally { if (is_resource($h)) fclose($h); if (is_file($tmp)) @unlink($tmp); }
}
/** Stable, reentrant per-process locks survive atomic record replacement. */
function storage_lock(string $scope, callable $fn, bool $wait = true): mixed {
  static $held = [];
  if (isset($held[$scope])) return $fn();
  private_dir(PRIV . '/locks');
  $h = @fopen(PRIV . '/locks/' . hash('sha256', $scope) . '.lock', 'c');
  if (!$h) fail('storage', 503);
  if (!flock($h, LOCK_EX | ($wait ? 0 : LOCK_NB))) { fclose($h); if (!$wait) return null; fail('storage', 503); }
  @chmod(PRIV . '/locks/' . hash('sha256', $scope) . '.lock', 0600);
  $held[$scope] = true;
  try { return $fn(); } finally { unset($held[$scope]); flock($h, LOCK_UN); fclose($h); }
}
function ip_in_network(string $ip, string $network): bool {
  [$address, $bits] = array_pad(explode('/', trim($network), 2), 2, null);
  $a = @inet_pton($ip); $b = @inet_pton($address);
  if ($a === false || $b === false || strlen($a) !== strlen($b)) return false;
  if ($bits === null) return hash_equals($a, $b);
  if (!ctype_digit($bits) || (int)$bits > strlen($a) * 8) return false;
  $bits = (int)$bits; $whole = intdiv($bits, 8); $rem = $bits % 8;
  return substr($a, 0, $whole) === substr($b, 0, $whole) && ($rem === 0 || (ord($a[$whole]) & (255 << (8 - $rem))) === (ord($b[$whole]) & (255 << (8 - $rem))));
}
function client_ip(): string {
  $peer = (string)($_SERVER['REMOTE_ADDR'] ?? '127.0.0.1');
  if (!filter_var($peer, FILTER_VALIDATE_IP)) $peer = '127.0.0.1';
  $trusted = array_filter(array_map('trim', explode(',', (string)(env()['TRUSTED_PROXIES'] ?? ''))));
  foreach ($trusted as $network) if (ip_in_network($peer, $network)) {
    // A trusted proxy must overwrite this single-address header. Never trust arbitrary X-Forwarded-For chains.
    $header = (string)(env()['TRUSTED_CLIENT_IP_HEADER'] ?? 'HTTP_X_REAL_IP');
    if (!in_array($header, ['HTTP_X_REAL_IP', 'HTTP_CF_CONNECTING_IP'], true)) break;
    $ip = (string)($_SERVER[$header] ?? '');
    if (filter_var($ip, FILTER_VALIDATE_IP)) return $ip;
    break;
  }
  return $peer;
}
/** Sliding-window rate limit. Storage failures deny the operation. No raw IP addresses are persisted. */
function rate(string $bucket, int $max, int $windowSec): bool {
  if ($max < 1 || $windowSec < 1) return false;
  $key = hash_hmac('sha256', $bucket, app_secret());
  return storage_lock('rate:' . $key, static function () use ($key, $max, $windowSec): bool {
    $f = PRIV . '/rate/' . $key . '.json'; $now = time();
    $record = private_json_read($f, []);
    $list = array_values(array_filter((array)($record['hits'] ?? []), static fn($t) => is_int($t) && $t > $now - $windowSec && $t <= $now));
    $ok = count($list) < $max;
    if ($ok) $list[] = $now;
    private_json_write($f, ['hits' => $list, 'expires' => $now + $windowSec]);
    return $ok;
  });
}

/* ===== registry and revocable application sessions ===== */
define('ROOMS_DIR', PRIV . '/rooms');
define('MOD_DIR', PRIV . '/mod');
const SRC_ALL = ['camera', 'microphone', 'screen_share', 'screen_share_audio', 'unknown'];
function room_id_ok(string $id): bool { return preg_match('/^[a-f0-9]{10}$/D', $id) === 1; }
function clean_title(string $t): string { return trim(mb_substr((string)preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $t), 0, 80)); }
function room_reg_get(string $id): ?array {
  if (!room_id_ok($id)) return null;
  return private_json_read(ROOMS_DIR . '/' . $id . '.json');
}
function room_reg_put(string $id, array $d): void {
  if (!room_id_ok($id) || ($d['id'] ?? $id) !== $id) fail('bad_room');
  storage_lock('room:' . $id, static function () use ($id, $d): void { private_json_write(ROOMS_DIR . '/' . $id . '.json', $d + ['id' => $id]); });
}
function room_reg_edit(string $id, callable $fn): mixed {
  if (!room_id_ok($id)) fail('bad_room');
  return storage_lock('room:' . $id, static function () use ($id, $fn): mixed {
    $r = room_reg_get($id);
    if ($r === null) fail('room_closed', 410);
    $result = $fn($r);
    room_reg_put($id, $r);
    return $result;
  });
}
function room_is_open(array $r): bool {
  return empty($r['deleted']) && !in_array($r['status'] ?? 'active', ['ended', 'deleted', 'cancelled'], true)
    && (int)($r['expiresAt'] ?? 0) > time();
}
function room_require_open(string $id): array {
  $r = room_reg_get($id);
  if ($r === null || !room_is_open($r)) fail('room_closed', 410);
  return $r;
}
function room_sig(string $id): string {
  $r = room_reg_get($id);
  if ($r === null) return '';
  return substr(hash_hmac('sha256', 'invite:' . $id . ':' . (string)($r['linkVersion'] ?? '1'), app_secret()), 0, 24);
}
function room_from_link(string $link): ?string {
  if (!preg_match('/^([a-f0-9]{10})\.([a-f0-9]{24})$/D', $link, $m)) return null;
  $expected = room_sig($m[1]);
  return $expected !== '' && hash_equals($expected, $m[2]) ? $m[1] : null;
}
function host_sig(string $id): string {
  $r = room_reg_get($id);
  if ($r === null) return '';
  return hash_hmac('sha256', 'host:' . $id . ':' . (string)($r['hostVersion'] ?? '1'), app_secret());
}
function host_ok(string $id, string $h): bool {
  return preg_match('/^[a-f0-9]{64}$/D', $h) === 1 && hash_equals(host_sig($id), $h);
}
function room_links(string $id, string $title = ''): array {
  $r = room_reg_get($id);
  if ($r === null) fail('room_closed', 410);
  $base = rtrim(PUBLIC_ORIGIN, '/') . '/?r=' . $id . '.' . room_sig($id);
  $tail = $title !== '' ? '&t=' . rawurlencode($title) : '';
  return ['link' => $base . $tail, 'hostLink' => $base . $tail . '#h=' . host_sig($id)];
}
function room_create(array $o): array {
  $now = time();
  $max = (int)($o['max'] ?? MAX_PARTICIPANTS);
  if ($max < 2 || $max > MAX_PARTICIPANTS) fail('bad_limit');
  $starts = (int)($o['startsAt'] ?? 0);
  $expires = (int)($o['expiresAt'] ?? 0) ?: $now + 30 * 86400;
  if ($starts < 0 || $expires <= $now || $expires > $now + 366 * 86400 || ($starts > 0 && $expires <= $starts)) fail('bad_schedule');
  $pw = (string)($o['password'] ?? '');
  if ($pw !== '' && (mb_strlen($pw) < 4 || strlen($pw) > 72)) fail('bad_password_length');
  $id = bin2hex(random_bytes(5));
  $rec = ['id' => $id, 'title' => clean_title((string)($o['title'] ?? '')), 'max' => $max, 'created' => $now,
    'expiresAt' => $expires, 'startsAt' => $starts, 'status' => 'active', 'locked' => false, 'waitingRoom' => !empty($o['waitingRoom']),
    'linkVersion' => bin2hex(random_bytes(12)), 'hostVersion' => bin2hex(random_bytes(12)), 'epoch' => bin2hex(random_bytes(12)),
    'sessions' => [], 'waiting' => []];
  if ($pw !== '') $rec['passHash'] = password_hash($pw, PASSWORD_DEFAULT);
  room_reg_put($id, $rec);
  return $rec;
}
function room_close(string $id, string $status = 'ended'): array {
  if (!in_array($status, ['ended', 'deleted', 'cancelled'], true)) fail('bad_status');
  room_reg_edit($id, static function (array &$r) use ($status): void {
    $r['status'] = $status; $r['endedAt'] ??= min(time(), (int)($r['expiresAt'] ?? time()));
    if ($status === 'deleted') { $r['deleted'] = true; $r['deletedAt'] = time(); }
    $r['sessions'] = []; $r['waiting'] = []; $r['epoch'] = bin2hex(random_bytes(12));
    $r['mediaClosePending'] = true; $r['mediaSyncPending'] = false;
    unset($r['passHash']); // A terminal invitation cannot be reopened.
  });
  storage_lock('mod:' . $id, static function () use ($id): void { rm_tree(mod_path($id)); });
  storage_lock('usage:' . $id, static function () use ($id, $status): void {
    $path = PRIV . '/usage/' . $id . '.json';
    if ($status !== 'ended') { rm_tree($path); return; }
    $d = private_json_read($path);
    if ($d !== null && !empty($d['clients'])) { $d['clients'] = []; private_json_write($path, $d); }
  });
  $reply = lk_call('DeleteRoom', ['room' => $id], $id);
  $closed = $reply['code'] === 200 || $reply['code'] === 404;
  room_reg_edit($id, static function (array &$r) use ($closed): void { $r['mediaClosePending'] = !$closed; });
  rm_tree(UPLOAD_DIR . '/' . $id);
  if ($status !== 'ended') storage_lock('transcript:' . $id, static function () use ($id): void { rm_tree(PRIV . '/transcripts/' . $id . '.json'); });
  return ['ok' => $closed, 'closed' => true, 'mediaClosePending' => !$closed];
}
/** Anonymous device marker is server-signed and HttpOnly. It is not a strong human identity. */
function device_id(): string {
  $cookie = (string)($_COOKIE['meet_device'] ?? '');
  if (preg_match('/^([a-f0-9]{32})\.([a-f0-9]{64})$/D', $cookie, $m)
      && hash_equals(hash_hmac('sha256', 'device:' . $m[1], app_secret()), $m[2])) return $m[1];
  $id = bin2hex(random_bytes(16));
  $value = $id . '.' . hash_hmac('sha256', 'device:' . $id, app_secret());
  setcookie('meet_device', $value, ['expires' => time() + 30 * 86400, 'path' => cookie_path(), 'secure' => str_starts_with(PUBLIC_ORIGIN, 'https://'), 'httponly' => true, 'samesite' => 'Strict']);
  $_COOKIE['meet_device'] = $value;
  return $id;
}
function cookie_path(): string { return rtrim((string)(parse_url(PUBLIC_ORIGIN, PHP_URL_PATH) ?: ''), '/') . '/'; }
function issue_ticket(array $reg, string $who): string {
  $s = $reg['sessions'][$who] ?? null;
  if (!is_array($s)) fail('unauthorized', 401);
  return jwt_sign(['iss' => 'auto-translate-meeting', 'aud' => 'meet-api', 'sub' => $who, 'room' => $reg['id'],
    'sid' => $s['sid'], 'epoch' => $reg['epoch'] ?? '1', 'nbf' => time() - 2, 'exp' => (int)$s['expires']], app_secret());
}
function ticket_claims(string $raw, bool $allowClosed = false): ?array {
  $c = jwt_verify($raw, app_secret());
  return $c === null ? null : ticket_resolve($c, $allowClosed);
}
/** Resolve already-verified in-request claims against current authoritative state. */
function ticket_resolve(array $c, bool $allowClosed = false): ?array {
  if ((int)($c['exp'] ?? 0) <= time() || ($c['iss'] ?? '') !== 'auto-translate-meeting' || ($c['aud'] ?? '') !== 'meet-api'
    || !room_id_ok((string)($c['room'] ?? '')) || !preg_match('/^[a-f0-9]{12}$/D', (string)($c['sub'] ?? ''))) return null;
  $r = room_reg_get($c['room']);
  if ($r === null || (!$allowClosed && !room_is_open($r)) || !hash_equals((string)($r['epoch'] ?? '1'), (string)($c['epoch'] ?? ''))) return null;
  $s = $r['sessions'][$c['sub']] ?? null;
  if (!is_array($s) || !empty($s['revoked']) || (int)($s['expires'] ?? 0) <= time()
    || !hash_equals((string)($s['sid'] ?? ''), (string)($c['sid'] ?? ''))) return null;
  $mod = mod_read($c['room']);
  if (empty($s['host']) && mod_ban($mod, (string)($s['did'] ?? ''), '') !== null) return null;
  return ['room' => $c['room'], 'who' => $c['sub'], 'host' => !empty($s['host']), 'name' => (string)($s['name'] ?? ''),
    'speak' => (string)($s['speak'] ?? 'en'), 'hear' => (string)($s['hear'] ?? 'en'), 'session' => $s, 'claims' => $c];
}
function ticket_refresh(array $t): array {
  $current = ticket_resolve((array)($t['claims'] ?? []));
  if ($current === null) fail('unauthorized', 401);
  return $current;
}
function ticket(): array {
  $t = ticket_claims(bearer());
  if ($t === null) fail('unauthorized', 401);
  return $t;
}
function file_ticket_cookie(string $room, string $token, int $expires): void {
  setcookie('meet_room_' . $room, $token, ['expires' => $expires, 'path' => cookie_path() . 'api/file.php',
    'secure' => str_starts_with(PUBLIC_ORIGIN, 'https://'), 'httponly' => true, 'samesite' => 'Strict']);
}

/* ===== LiveKit service boundary ===== */
function lk_call(string $method, array $body, string $room = ''): array {
  $methods = ['ListRooms', 'CreateRoom', 'DeleteRoom', 'ListParticipants', 'GetParticipant', 'RemoveParticipant', 'MutePublishedTrack', 'UpdateParticipant', 'UpdateRoomMetadata', 'SendData'];
  if (!in_array($method, $methods, true)) fail('bad_media_method');
  $e = env(); $url = (string)($e['LIVEKIT_URL'] ?? '');
  $key = (string)($e['LIVEKIT_API_KEY'] ?? ''); $secret = (string)($e['LIVEKIT_API_SECRET'] ?? '');
  if ($url === '' || $key === '' || $secret === '' || !function_exists('curl_init')) return ['code' => 0, 'json' => [], 'error' => 'not_configured'];
  $parts = parse_url($url);
  if (!is_array($parts) || !in_array($parts['scheme'] ?? '', ['ws', 'wss', 'http', 'https'], true) || !empty($parts['user']) || !empty($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) return ['code' => 0, 'json' => [], 'error' => 'not_configured'];
  $host = preg_replace('#^ws://#', 'http://', preg_replace('#^wss://#', 'https://', $url));
  if (str_starts_with($host, 'http://') && !in_array($parts['host'] ?? '', ['127.0.0.1', 'localhost', '::1', '[::1]'], true) && (env()['ALLOW_INSECURE_LIVEKIT'] ?? '') !== 'true') return ['code' => 0, 'json' => [], 'error' => 'not_configured'];
  $grant = match ($method) {
    'ListRooms' => ['roomList' => true],
    'CreateRoom', 'DeleteRoom' => ['roomCreate' => true],
    default => ['roomAdmin' => true, 'room' => $room],
  };
  $jwt = jwt_sign(['iss' => $key, 'nbf' => time() - 2, 'exp' => time() + 60, 'video' => $grant], $secret);
  $ch = curl_init(rtrim($host, '/') . '/twirp/livekit.RoomService/' . $method);
  $response = ''; $tooLarge = false;
  curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($body ?: new stdClass(), JSON_THROW_ON_ERROR),
    CURLOPT_RETURNTRANSFER => false, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 12, CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $jwt],
    CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (&$response, &$tooLarge): int {
      if (strlen($response) + strlen($chunk) > 2 * 1024 * 1024) { $tooLarge = true; return 0; }
      $response .= $chunk; return strlen($chunk);
    }]);
  $ok = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  $j = json_decode($response, true);
  return ['code' => $ok === false || $tooLarge ? 0 : $code, 'json' => is_array($j) ? $j : []];
}
function room_state(string $room, bool $withParticipants = true): array {
  $reg = room_reg_get($room); $meta = []; $count = 0; $exists = false;
  $rr = lk_call('ListRooms', ['names' => [$room]]);
  if ($rr['code'] !== 200) fail('media_unavailable', 503);
  foreach ($rr['json']['rooms'] ?? [] as $x) if (($x['name'] ?? '') === $room) {
    $exists = true; $count = (int)($x['numParticipants'] ?? $x['num_participants'] ?? 0);
    $m = json_decode((string)($x['metadata'] ?? ''), true); if (is_array($m)) $meta = $m;
  }
  $parts = [];
  if ($withParticipants && $exists) {
    $pp = lk_call('ListParticipants', ['room' => $room], $room);
    if ($pp['code'] !== 200) fail('media_unavailable', 503);
    $parts = (array)($pp['json']['participants'] ?? []); $count = count($parts);
  }
  return ['max' => max(2, min(MAX_PARTICIPANTS, (int)($reg['max'] ?? MAX_PARTICIPANTS))),
    'locked' => !empty($reg['locked']), 'count' => $count, 'participants' => $parts, 'meta' => $meta, 'exists' => $exists];
}
function room_media_begin(string $room): bool {
  return room_reg_edit($room, static function (array &$r): bool {
    $pending = !empty($r['mediaSyncPending']); $r['mediaSyncPending'] = true; return $pending;
  });
}
function room_media_finish(string $room, bool $ok, bool $wasPending): void {
  room_reg_edit($room, static function (array &$r) use ($ok, $wasPending): void { $r['mediaSyncPending'] = !$ok || $wasPending; });
}
function room_sync_metadata(string $room, array $reg): bool {
  return storage_lock('room:' . $room, static function () use ($room, $reg): bool {
    $reg = room_reg_get($room); // A caller's snapshot may have changed before this lock.
    if ($reg === null || !room_is_open($reg)) return false;
    $pending = room_media_begin($room);
    try { $st = room_state($room, false); }
    catch (MeetHttpError $e) { if ($e->error !== 'media_unavailable') throw $e; return false; }
    $ok = true;
    if ($st['exists']) {
      $meta = ['max' => (int)$reg['max'], 'locked' => !empty($reg['locked']), 'waitingRoom' => !empty($reg['waitingRoom'])];
      $reply = lk_call('UpdateRoomMetadata', ['room' => $room, 'metadata' => json_encode($meta)], $room);
      $ok = $reply['code'] === 200;
    }
    room_media_finish($room, $ok, $pending); return $ok;
  });
}
function participant_metadata(array $s): string {
  return json_encode(['speak' => $s['speak'], 'hear' => $s['hear']] + (!empty($s['host']) ? ['role' => 'host'] : []), JSON_THROW_ON_ERROR);
}
function lk_set_sources(string $room, string $identity, array $sources): bool {
  $r = lk_call('UpdateParticipant', ['room' => $room, 'identity' => $identity, 'permission' => [
    'canSubscribe' => true, 'canPublish' => count($sources) > 0, 'canPublishData' => true,
    'canUpdateMetadata' => false, 'canPublishSources' => array_map('strtoupper', $sources)]], $room);
  return in_array($r['code'], [200, 404], true); // A departed participant is checked again on its next join.
}
/** Reconcile only journaled failures; do not keep participant IDs in a separate retry log. */
function room_media_reconcile(string $room): bool {
  return storage_lock('room:' . $room, static function () use ($room): bool {
    $reg = room_reg_get($room);
    if ($reg === null || !room_is_open($reg) || empty($reg['mediaSyncPending'])) return true;
    try { $st = room_state($room); }
    catch (MeetHttpError $e) { if ($e->error !== 'media_unavailable') throw $e; return false; }
    $ok = true; $mod = mod_read($room);
    foreach ($st['participants'] as $p) {
      $id = (string)($p['identity'] ?? ''); if ($id === '') continue;
      $s = $reg['sessions'][$id] ?? null;
      if (!is_array($s) || !empty($s['revoked']) || (int)($s['expires'] ?? 0) <= time()
        || (empty($s['host']) && mod_ban($mod, (string)($s['did'] ?? '')) !== null)) {
        $reply = lk_call('RemoveParticipant', ['room' => $room, 'identity' => $id], $room);
      } else {
        $sources = !empty($s['host']) ? SRC_ALL : mod_sources($mod, (string)$s['did']);
        $reply = lk_call('UpdateParticipant', ['room' => $room, 'identity' => $id,
          'name' => (string)$s['name'], 'metadata' => participant_metadata($s), 'permission' => [
            'canSubscribe' => true, 'canPublish' => count($sources) > 0, 'canPublishData' => true,
            'canUpdateMetadata' => false, 'canPublishSources' => array_map('strtoupper', $sources)]], $room);
      }
      $ok = in_array($reply['code'], [200, 404], true) && $ok;
    }
    if ($st['exists']) {
      $meta = ['max' => (int)$reg['max'], 'locked' => !empty($reg['locked']), 'waitingRoom' => !empty($reg['waitingRoom'])];
      $reply = lk_call('UpdateRoomMetadata', ['room' => $room, 'metadata' => json_encode($meta)], $room);
      $ok = in_array($reply['code'], [200, 404], true) && $ok;
    }
    room_media_finish($room, $ok, false); return $ok;
  });
}

/* ===== moderation: device matches only, never punish everybody behind the same NAT ===== */
function ip_hash(): string { return substr(hash_hmac('sha256', client_ip(), app_secret()), 0, 32); }
function clean_did(string $d): string { return preg_match('/^[a-f0-9]{32}$/D', $d) === 1 ? $d : ''; }
function mod_path(string $room): string { if (!room_id_ok($room)) fail('bad_room'); return MOD_DIR . '/' . $room . '.json'; }
function mod_read(string $room): array { return (private_json_read(mod_path($room), []) ?? []) + ['seen' => [], 'locks' => [], 'bans' => []]; }
function mod_edit(string $room, callable $fn): mixed {
  return storage_lock('mod:' . $room, static function () use ($room, $fn): mixed {
    $d = mod_read($room); $r = $fn($d); private_json_write(mod_path($room), $d); return $r;
  });
}
function sweep_moderation(): void {
  foreach (glob(MOD_DIR . '/*.json') ?: [] as $path) {
    $room = basename($path, '.json'); if (!room_id_ok($room)) continue;
    storage_lock('room:' . $room, static function () use ($room, $path): void {
      $reg = room_reg_get($room);
      storage_lock('mod:' . $room, static function () use ($reg, $path): void {
        if ($reg === null || !room_is_open($reg)) { rm_tree($path); return; }
        $d = private_json_read($path); if ($d === null) return; $before = $d;
        unset($d['seen']); // Historical names/devices duplicated session state and served no feature.
        $d['bans'] = array_values(array_filter((array)($d['bans'] ?? []),
          static fn($b) => (int)($b['until'] ?? 0) === 0 || (int)$b['until'] > time()));
        foreach ($d['locks'] ?? [] as $key => $lock) unset($d['locks'][$key]['name']);
        if ($d !== $before) private_json_write($path, $d);
      });
    });
  }
}
function mod_match(array $entry, string $did, string $ip = ''): bool {
  return $did !== '' && ($entry['did'] ?? '') !== '' && hash_equals((string)$entry['did'], $did);
}
function mod_ban(array $d, string $did, string $ip = ''): ?int {
  $hit = null;
  foreach ($d['bans'] as $b) if (mod_match($b, $did)) {
    $until = (int)($b['until'] ?? 0); if ($until === 0) return 0;
    if ($until > time()) $hit = max((int)$hit, $until);
  }
  return $hit;
}
function mod_sources(array $d, string $did, string $ip = ''): array {
  $deny = [];
  foreach ($d['locks'] as $l) if (mod_match($l, $did)) {
    if (!empty($l['mic'])) { $deny[] = 'microphone'; $deny[] = 'screen_share_audio'; $deny[] = 'unknown'; }
    if (!empty($l['cam'])) $deny[] = 'camera';
  }
  return array_values(array_diff(SRC_ALL, $deny));
}

/* ===== private attachments and retention ===== */
define('UPLOAD_DIR', PRIV . '/uploads');
define('FILE_TTL', meet_int_env('FILE_TTL', 86400, 300, 7 * 86400));
define('MAX_IMAGE', meet_int_env('MAX_IMAGE_BYTES', 32 * 1024 * 1024, 1024, 32 * 1024 * 1024));
define('MAX_VIDEO', meet_int_env('MAX_VIDEO_BYTES', 100 * 1024 * 1024, 1024, 100 * 1024 * 1024));
const CHUNK_SIZE = 4 * 1024 * 1024;
define('ROOM_QUOTA', meet_int_env('UPLOAD_ROOM_QUOTA', 512 * 1024 * 1024, 1024, 5 * 1024 * 1024 * 1024));
define('UPLOAD_TOTAL_QUOTA', meet_int_env('UPLOAD_TOTAL_QUOTA', 5 * 1024 * 1024 * 1024, 1024, 100 * 1024 * 1024 * 1024));
const ALLOWED_TYPES = ['image/jpeg' => 'image', 'image/png' => 'image', 'image/webp' => 'image', 'video/mp4' => 'video', 'video/webm' => 'video'];
function rm_tree(string $p): void {
  if (is_link($p) || is_file($p)) { if (!@unlink($p) && file_exists($p)) fail('storage', 503); return; }
  if (!is_dir($p)) return;
  foreach (scandir($p) ?: [] as $f) if ($f !== '.' && $f !== '..') rm_tree($p . '/' . $f);
  if (!@rmdir($p) && is_dir($p)) fail('storage', 503);
}
function dir_size(string $p): int {
  if (is_link($p)) return 0;
  if (!is_dir($p)) return is_file($p) ? (int)filesize($p) : 0;
  $n = 0;
  foreach (scandir($p) ?: [] as $f) if ($f !== '.' && $f !== '..') $n += dir_size($p . '/' . $f);
  return $n;
}
/** Counts reserved total bytes for partial uploads, not only bytes received so far. */
function upload_reserved(string $dir): int {
  if (!is_dir($dir)) return 0;
  $total = 0;
  foreach (scandir($dir) ?: [] as $name) {
    if ($name === '.' || $name === '..' || $name[0] === '.') continue;
    $p = $dir . '/' . $name;
    if (is_link($p)) continue;
    if (str_ends_with($name, '.part')) {
      $m = private_json_read($p . '/meta.json', []); $total += max((int)($m['reservedBytes'] ?? $m['size'] ?? 0), dir_size($p));
    } elseif (preg_match('/^[a-f0-9]{10}$/D', $name)) $total += upload_reserved($p);
    else $total += dir_size($p);
  }
  return $total;
}
function sweep_uploads(bool $force = false): void {
  if (!is_dir(UPLOAD_DIR)) return;
  storage_lock('uploads', static function () use ($force): void {
    $stamp = UPLOAD_DIR . '/.swept';
    if (!$force && is_file($stamp) && time() - (int)filemtime($stamp) < 600) return;
    @touch($stamp);
    foreach (scandir(UPLOAD_DIR) ?: [] as $room) {
      if (!room_id_ok($room)) continue;
      $rd = UPLOAD_DIR . '/' . $room;
      if (is_link($rd) || !is_dir($rd)) continue;
      foreach (scandir($rd) ?: [] as $d) {
        if (!preg_match('/^[a-f0-9]{16}(?:\.part)?$/D', $d)) continue;
        $path = $rd . '/' . $d;
        storage_lock('upload:' . $room . ':' . preg_replace('/\.part$/', '', $d), static function () use ($path, $d): void {
          if (is_dir($path) && time() - (int)filemtime($path) > (str_ends_with($d, '.part') ? 3600 : FILE_TTL)) rm_tree($path);
        }, false);
      }
      if (count(scandir($rd) ?: []) === 2) @rmdir($rd);
    }
  });
}
function file_sig(string $room, string $fid, int $exp): string {
  return hash_hmac('sha256', "file:$room:$fid:$exp", app_secret());
}
function file_url(string $room, string $fid, int $exp): string {
  return 'api/file.php?r=' . $room . '&f=' . $fid . '&e=' . $exp . '&s=' . file_sig($room, $fid, $exp);
}
function safe_name(string $n): string {
  $n = basename(str_replace(chr(92), '/', $n));
  $n = (string)preg_replace('/[\x00-\x1F\x7F<>:"|?*]+/u', '', $n);
  $n = trim(mb_substr($n, 0, 80));
  return $n !== '' ? $n : 'file';
}
function sweep_rooms(bool $force = false): void {
  if (!is_dir(ROOMS_DIR)) return;
  storage_lock('room-sweep', static function () use ($force): void {
    $stamp = ROOMS_DIR . '/.swept';
    if (!$force && is_file($stamp) && time() - (int)filemtime($stamp) < 600) return;
    @touch($stamp);
    foreach (glob(ROOMS_DIR . '/*.json') ?: [] as $f) {
      $id = basename($f, '.json'); if (!room_id_ok($id)) continue;
      storage_lock('room:' . $id, static function () use ($id, $f): void {
        $r = room_reg_get($id); if ($r === null) return;
        if (room_is_open($r)) {
          $before = $r;
          $r['waiting'] = array_filter((array)($r['waiting'] ?? []), static fn($w) => (int)($w['expires'] ?? 0) > time());
          foreach ((array)($r['sessions'] ?? []) as $who => $s) {
            if ((int)($s['expires'] ?? 0) <= time()) $r['mediaSyncPending'] = true;
            if ((int)($s['expires'] ?? 0) <= time() || !empty($s['revoked'])) unset($r['sessions'][$who]);
          }
          if ($r !== $before) room_reg_put($id, $r);
          if (!empty($r['mediaSyncPending'])) room_media_reconcile($id);
          return;
        }
        if (!room_is_open($r) && (empty($r['endedAt']) || !empty($r['mediaClosePending']))) {
          room_close($id, !empty($r['deleted']) ? 'deleted' : (($r['status'] ?? '') === 'cancelled' ? 'cancelled' : 'ended'));
          $r = room_reg_get($id);
        }
        $dead = (int)($r['endedAt'] ?? 0) ?: (int)($r['expiresAt'] ?? 0);
        // Unknown rooms are always denied, so deleting old tombstones never revives a link.
        if ($dead > 0 && $dead + 31 * 86400 <= time()) {
          if (!empty($r['mediaClosePending'])) {
            $r['title'] = ''; $r['sessions'] = []; $r['waiting'] = []; unset($r['passHash']); room_reg_put($id, $r);
          } else {
            rm_tree(mod_path($id)); rm_tree(UPLOAD_DIR . '/' . $id);
            storage_lock('transcript:' . $id, static function () use ($id): void { rm_tree(PRIV . '/transcripts/' . $id . '.json'); });
            storage_lock('usage:' . $id, static function () use ($id): void { rm_tree(PRIV . '/usage/' . $id . '.json'); });
            rm_tree($f);
          }
        }
      });
    }
  });
}
function sweep_rates(): void {
  foreach (glob(PRIV . '/rate/*.json') ?: [] as $f) {
    if (time() - (int)filemtime($f) < 2 * 86400) continue;
    $key = basename($f, '.json');
    storage_lock('rate:' . $key, static function () use ($f): void {
      $r = private_json_read($f, []);
      if ((int)($r['expires'] ?? 0) < time()) @unlink($f);
    });
  }
}
