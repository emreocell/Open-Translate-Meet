<?php
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_http.php';

define('G_OAUTH', PRIV . '/google-oauth.json');
define('G_TOKEN', PRIV . '/google-token.json');
define('BOOK_DIR', PRIV . '/bookings');
define('MAIL_CFG', PRIV . '/mail.json');
define('BOOK_TZ', config_string('BOOKING_TIMEZONE', 'UTC'));
new DateTimeZone(BOOK_TZ);
define('BOOK_SLOT_MIN', config_int('BOOKING_SLOT_MINUTES', 30, 5, 240));
define('BOOK_NOTICE_H', config_int('BOOKING_NOTICE_HOURS', 12, 0, 720));
define('BOOK_DAYS', config_int('BOOKING_DAYS', 21, 1, 90));
$hours = json_decode(config_string('BOOKING_HOURS', '{"1":[9,17],"2":[9,17],"3":[9,17],"4":[9,17],"5":[9,17]}'), true);
if (!is_array($hours)) fail('booking_config', 503);
foreach ($hours as $day => $span) if (!in_array((int)$day, range(1,7), true) || !is_array($span) || count($span) !== 2 || !is_int($span[0]) || !is_int($span[1]) || $span[0] < 0 || $span[1] > 24 || $span[0] >= $span[1]) fail('booking_config', 503);
define('BOOK_HOURS', $hours); unset($hours, $day, $span);

function g_cfg(): ?array {
  $legacy = private_json_read(G_OAUTH, []) ?? [];
  $c = ['client_id' => config_string('GOOGLE_CLIENT_ID', (string)($legacy['client_id'] ?? '')), 'client_secret' => config_string('GOOGLE_CLIENT_SECRET', (string)($legacy['client_secret'] ?? ''))];
  return $c['client_id'] !== '' && $c['client_secret'] !== '' ? $c : null;
}
function g_tok(): ?array { return private_json_read(G_TOKEN); }
function g_save_tok(array $t): void { private_json_write(G_TOKEN, $t); }
/** Credential generations prevent outstanding events silently switching to another account. */
function g_connection_id(): string {
  $t = g_tok();
  if (!$t || empty($t['refresh_token'])) fail('calendar_unavailable', 503);
  return (string)($t['connectionId'] ?? hash_hmac('sha256', 'google-connection:' . $t['refresh_token'], app_secret()));
}
function g_store_authorization(array $response): void {
  if (!is_string($response['access_token'] ?? null) || $response['access_token'] === ''
    || !is_string($response['refresh_token'] ?? null) || $response['refresh_token'] === '') fail('oauth_exchange', 502);
  $scope = (string)($response['scope'] ?? '');
  $scopes = preg_split('/\s+/', trim($scope)) ?: [];
  if (!in_array('https://www.googleapis.com/auth/calendar.events', $scopes, true)
    && !in_array('https://www.googleapis.com/auth/calendar', $scopes, true)) fail('oauth_scope', 403);
  $expires = filter_var($response['expires_in'] ?? 3600, FILTER_VALIDATE_INT);
  if ($expires === false || $expires < 60 || $expires > 86400) fail('oauth_exchange', 502);
  storage_lock('google-token', static function () use ($response, $scope, $expires): void {
    g_save_tok(['refresh_token' => $response['refresh_token'], 'access_token' => $response['access_token'],
      'expires' => time() + $expires, 'scope' => $scope, 'connected' => time(), 'connectionId' => bin2hex(random_bytes(16))]);
  });
}
function g_http(string $method, string $url, ?array $form = null, ?array $json = null, array $headers = []): array { return http_json($method, $url, $json, $headers, $form); }
function g_access(): ?string {
  return storage_lock('google-token', static function (): ?string {
    $t = g_tok(); $c = g_cfg(); if (!$t || !$c || empty($t['refresh_token'])) return null;
    if (!empty($t['access_token']) && (int)($t['expires'] ?? 0) > time() + 60) return (string)$t['access_token'];
    [$status, $j] = g_http('POST', 'https://oauth2.googleapis.com/token', ['client_id' => $c['client_id'], 'client_secret' => $c['client_secret'], 'refresh_token' => $t['refresh_token'], 'grant_type' => 'refresh_token']);
    if ($status !== 200 || empty($j['access_token'])) return null;
    $t['connectionId'] ??= hash_hmac('sha256', 'google-connection:' . $t['refresh_token'], app_secret());
    $t['access_token'] = $j['access_token']; $t['expires'] = time() + (int)($j['expires_in'] ?? 3000);
    if (!empty($j['refresh_token'])) $t['refresh_token'] = $j['refresh_token'];
    g_save_tok($t); return (string)$t['access_token'];
  });
}
function g_cal(string $method, string $path, ?array $json = null, array $query = []): array {
  $token = g_access(); if ($token === null) return [0, []];
  return g_http($method, 'https://www.googleapis.com/calendar/v3' . $path . ($query ? '?' . http_build_query($query) : ''), null, $json, ['Authorization: Bearer ' . $token]);
}
function g_calendar_path(): string { return '/calendars/' . rawurlencode(config_string('GOOGLE_CALENDAR_ID', 'primary')) . '/events'; }
function bk_uses_google(): bool {
  $provider = config_string('BOOKING_CALENDAR_PROVIDER', 'none');
  if (!in_array($provider, ['none', 'google'], true)) fail('booking_config', 503);
  return $provider === 'google';
}
function h(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function mail_cfg(): ?array {
  $old = private_json_read(MAIL_CFG, []) ?? [];
  $c = ['host' => config_string('SMTP_HOST', (string)($old['host'] ?? '')),
    'user' => config_string('SMTP_USERNAME', (string)($old['user'] ?? '')), 'pass' => config_string('SMTP_PASSWORD', (string)($old['pass'] ?? '')),
    'port' => config_int('SMTP_PORT', (int)($old['port'] ?? 587), 1, 65535),
    'enc' => config_string('SMTP_ENCRYPTION', (string)($old['enc'] ?? 'starttls')),
    'from' => config_string('SMTP_FROM', (string)($old['from'] ?? '')), 'fromName' => config_string('SMTP_FROM_NAME', app_name()),
    'owner' => config_string('BOOKING_OWNER_EMAIL', (string)($old['owner'] ?? $old['from'] ?? config_string('SMTP_FROM')))];
  return $c['host'] !== '' && filter_var($c['from'], FILTER_VALIDATE_EMAIL) && filter_var($c['owner'], FILTER_VALIDATE_EMAIL) ? $c : null;
}
function mail_send(string $to, string $subject, string $html, string $replyTo = '', string $replyName = ''): bool {
  if (defined('MEET_TEST_MODE') && isset($GLOBALS['meet_mail_transport'])) return (bool)($GLOBALS['meet_mail_transport'])($to, $subject, $html);
  $c = mail_cfg(); if (!$c || !filter_var($to, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $subject . $to)) return false;
  $autoload = APP_ROOT . '/vendor/autoload.php'; if (!is_file($autoload)) return false; require_once $autoload;
  if (!class_exists(PHPMailer\PHPMailer\PHPMailer::class)) return false;
  if (!in_array($c['enc'], ['smtps', 'starttls', 'none'], true) || ($c['enc'] === 'none' && !config_bool('SMTP_ALLOW_INSECURE'))) return false;
  try {
    $m = new PHPMailer\PHPMailer\PHPMailer(true); $m->isSMTP(); $m->Host = $c['host']; $m->Port = $c['port'];
    $m->SMTPAuth = $c['user'] !== ''; $m->Username = $c['user']; $m->Password = $c['pass'];
    $m->SMTPSecure = $c['enc'] === 'smtps' ? 'ssl' : ($c['enc'] === 'starttls' ? 'tls' : ''); $m->SMTPAutoTLS = $c['enc'] !== 'none';
    $m->Timeout = 15; $m->CharSet = 'UTF-8'; $m->setFrom($c['from'], $c['fromName']); $m->addAddress($to);
    if (filter_var($replyTo, FILTER_VALIDATE_EMAIL)) $m->addReplyTo($replyTo, $replyName);
    $m->isHTML(true); $m->Subject = $subject; $m->Body = $html;
    $m->AltBody = trim(html_entity_decode(strip_tags(str_replace(['<br>', '</p>', '</tr>'], "\n", $html))));
    return $m->send();
  } catch (Throwable) { return false; }
}
function mail_html(string $title, string $intro, array $rows, ?array $button, string $foot, ?array $button2 = null, string $eyebrow = ''): string {
  $cells = '';
  foreach ($rows as [$label, $value]) $cells .= '<tr><td style="padding:12px 0;border-bottom:1px solid #e4e9f4"><small style="color:#5e6b84">' . h((string)$label) . '</small><div>' . $value . '</div></td></tr>';
  $buttons = '';
  foreach (array_filter([$button, $button2]) as $b) $buttons .= '<p><a href="' . h($b[1]) . '" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#245eea;color:#fff;text-decoration:none">' . h($b[0]) . '</a></p>';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . h($title) . '</title></head>'
    . '<body style="margin:0;background:#f1f5fb;color:#14233c;font-family:Arial,sans-serif"><div style="max-width:560px;margin:30px auto;padding:28px;background:#fff;border-radius:20px">'
    . '<p style="font-weight:700;color:#245eea">' . h(app_name()) . '</p><h1 style="font-size:25px">' . h($title) . '</h1><p>' . $intro . '</p>'
    . '<table role="presentation" style="width:100%">' . $cells . '</table>' . $buttons . '<p style="font-size:13px;color:#5e6b84">' . h($foot) . '</p></div></body></html>';
}
function when_fmt(int $ts, string $tzName, string $lang): string {
  try { $tz = new DateTimeZone($tzName); } catch (Throwable) { $tz = new DateTimeZone(BOOK_TZ); }
  return (new DateTimeImmutable('@' . $ts))->setTimezone($tz)->format('Y-m-d H:i T') . ' (' . $tz->getName() . ')';
}
function bk_text(string $language, string $key): string {
  static $cache = [];
  if (!in_array($language, UI_LANGS, true)) $language = 'en';
  foreach (array_unique(['en', $language]) as $code) if (!isset($cache[$code])) $cache[$code] = json_decode((string)file_get_contents(APP_ROOT . '/assets/i18n/book/' . $code . '.json'), true) ?: [];
  return (string)($cache[$language][$key] ?? $cache['en'][$key] ?? $key);
}
require_once __DIR__ . '/_booking.php';
