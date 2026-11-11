<?php
declare(strict_types=1);
require __DIR__ . '/_ai.php'; $t = ticket();
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') { if (!$t['host']) fail('forbidden', 403); out(usage_view($t['room'])); }
require_post(); $in = body();
if (!rate('usage:' . $t['room'] . ':' . $t['who'], 15, 60)) fail('rate', 429);
$result = storage_lock('room:' . $t['room'], static function () use ($in, $t): array {
 $t = ticket_refresh($t);
 return usage_edit($t['room'], static function (array &$d) use ($in, $t): array {
  $prior = $d['clients'][$t['who']] ?? ['lastAt' => time() - 30]; $elapsed = min(60, max(0, time() - (int)$prior['lastAt']));
  $maxSessions = config_int('TRANSLATION_MAX_SESSIONS', 3, 1, 8);
  $input = min((float)($in['inputSeconds'] ?? 0), $elapsed * $maxSessions); $session = min((float)($in['sessionSeconds'] ?? 0), $elapsed * $maxSessions);
  if (!is_finite($input) || !is_finite($session) || $input < 0 || $session < 0) fail('invalid');
  $d['clientInputSeconds'] += $input; $d['clientSessionSeconds'] += $session;
  $d['clients'][$t['who']] = ['lastAt' => time(), 'activeSessions' => max(0, min($maxSessions, (int)($in['activeSessions'] ?? 0)))];
  return ['ok' => true, 'clientReported' => true];
 });
}); out($result);
