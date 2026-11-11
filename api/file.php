<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';
$method = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');
if (!in_array($method, ['GET', 'HEAD'], true)) { header('Allow: GET, HEAD'); fail('method', 405); }
$r = (string)($_GET['r'] ?? ''); $f = (string)($_GET['f'] ?? ''); $e = (int)($_GET['e'] ?? 0); $s = (string)($_GET['s'] ?? '');
$bad = static function (int $code): never {
  http_response_code($code); header('Content-Type: text/plain; charset=utf-8'); header('Cache-Control: no-store');
  header('X-Content-Type-Options: nosniff'); echo $code === 410 ? 'expired' : 'not found'; exit;
};
if (!room_id_ok($r) || !preg_match('/^[a-f0-9]{16}$/D', $f) || !preg_match('/^[a-f0-9]{64}$/D', $s)) $bad(404);
if ($e <= time()) $bad(410);
if (!hash_equals(file_sig($r, $f, $e), $s)) $bad(404);
$auth = bearer(); if ($auth === '') $auth = (string)($_COOKIE['meet_room_' . $r] ?? '');
$tk = ticket_claims($auth);
if ($tk === null || $tk['room'] !== $r) $bad(404);
if (!rate('file:' . $tk['who'], 2400, 3600)) $bad(429);
$dir = UPLOAD_DIR . "/$r/$f"; $path = $dir . '/data';
$meta = private_json_read($dir . '/meta.json');
if (!is_array($meta) || !is_file($path) || is_link($path) || !isset(ALLOWED_TYPES[(string)($meta['type'] ?? '')])) $bad(404);
if ((int)($meta['expiresAt'] ?? (int)($meta['created'] ?? 0) + FILE_TTL) <= time() || $e > (int)($meta['created'] ?? 0) + FILE_TTL) $bad(410);
$fh = @fopen($path, 'rb'); if ($fh === false) $bad(404);
$size = (int)(fstat($fh)['size'] ?? 0); if ($size < 1) { fclose($fh); $bad(404); }
$start = 0; $end = $size - 1; $code = 200;
if (isset($_SERVER['HTTP_RANGE'])) {
  $range = (string)$_SERVER['HTTP_RANGE'];
  if (!preg_match('/^bytes=(\d{0,15})-(\d{0,15})$/D', $range, $m) || ($m[1] === '' && $m[2] === '')) {
    fclose($fh); header("Content-Range: bytes */$size"); $bad(416);
  }
  if ($m[1] === '') {
    $suffix = (int)$m[2]; if ($suffix <= 0) { fclose($fh); header("Content-Range: bytes */$size"); $bad(416); }
    $start = max(0, $size - $suffix);
  } else { $start = (int)$m[1]; if ($m[2] !== '') $end = min($end, (int)$m[2]); }
  if ($start > $end || $start >= $size) { fclose($fh); header("Content-Range: bytes */$size"); $bad(416); }
  $code = 206;
}
$len = $end - $start + 1;
$name = preg_replace('/[^A-Za-z0-9._ -]+/', '_', (string)($meta['name'] ?? 'file'));
http_response_code($code);
header('Content-Type: ' . $meta['type']); header('Content-Length: ' . $len); header('Accept-Ranges: bytes');
if ($code === 206) header("Content-Range: bytes $start-$end/$size");
header('X-Content-Type-Options: nosniff'); header("Content-Security-Policy: default-src 'none'; sandbox");
header('Cross-Origin-Resource-Policy: same-origin'); header('Referrer-Policy: no-referrer');
header('Cache-Control: private, no-store, max-age=0');
header('Content-Disposition: ' . (isset($_GET['dl']) ? 'attachment' : 'inline') . '; filename="' . $name . '"; filename*=UTF-8\'\'' . rawurlencode((string)($meta['name'] ?? 'file')));
if ($method === 'HEAD') { fclose($fh); exit; }
if (fseek($fh, $start) !== 0) { fclose($fh); exit; }
$left = $len;
while ($left > 0 && !feof($fh) && !connection_aborted()) {
  $buf = fread($fh, min(262144, $left)); if ($buf === false || $buf === '') break;
  echo $buf; $left -= strlen($buf); flush();
}
fclose($fh);
