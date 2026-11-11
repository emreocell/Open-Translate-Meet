<?php
declare(strict_types=1);
require __DIR__ . '/_transcript.php';
$t = ticket();
if (!config_bool('TRANSCRIPT_ENABLED')) fail('feature_disabled', 503);
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
  if (!rate('transcript-state:' . $t['room'] . ':' . $t['who'], 60, 60)) fail('rate', 429);
  out(transcript_status($t));
}
require_post(); $in = body(32768); $action = (string)($in['action'] ?? '');
if (!rate('transcript-action:' . $t['room'] . ':' . $t['who'], 240, 60)) fail('rate', 429);
if ($action === 'consent') {
  if (!is_bool($in['record'] ?? null) || !is_bool($in['summary'] ?? null)) fail('invalid');
  out(transcript_set_consent($t, $in['record'], $in['summary']));
}
if ($action === 'append') out(transcript_append($t, $in));
if ($action === 'export') {
  $data = transcript_export($t['room']);
  if (!$t['host']) $data['entries'] = array_values(array_filter($data['entries'], static fn($e) => $e['speaker'] === $t['who']));
  if (!$t['host']) $data['summary'] = null;
  out($data);
}
if (!$t['host']) fail('forbidden', 403);
if ($action === 'enabled') {
  if (!is_bool($in['enabled'] ?? null)) fail('invalid');
  $result = storage_lock('room:' . $t['room'], static function () use ($t, $in): array {
    $t = ticket_refresh($t); if (!$t['host']) fail('forbidden', 403);
    return transcript_edit($t['room'], static function (array &$d) use ($in): array {
      $d['active'] = $in['enabled']; $d['revision']++;
      return ['ok' => true, 'enabled' => $d['active']];
    });
  });
  out($result);
}
if ($action === 'delete') {
  storage_lock('room:' . $t['room'], static function () use ($t): void {
    $t = ticket_refresh($t); if (!$t['host']) fail('forbidden', 403);
    storage_lock('transcript:' . $t['room'], static function () use ($t): void { rm_tree(transcript_path($t['room'])); });
  });
  out(['ok' => true]);
}
if ($action === 'summary') out(transcript_summary($t['room'], (string)($in['language'] ?? $t['hear'])));
fail('bad_action');
