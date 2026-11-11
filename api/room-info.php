<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';
require_post();
if (!rate('info:' . client_ip(), 240, 3600)) fail('rate', 429);
$room = room_from_link((string)(body()['r'] ?? ''));
if ($room === null) fail('bad_link', 403);
$reg = room_require_open($room);
out(['ok' => true, 'title' => (string)($reg['title'] ?? ''), 'password' => !empty($reg['passHash']),
  'max' => (int)($reg['max'] ?? MAX_PARTICIPANTS), 'waitingRoom' => !empty($reg['waitingRoom']),
  'startsAt' => (int)($reg['startsAt'] ?? 0), 'expiresAt' => (int)$reg['expiresAt'], 'earlySec' => 600, 'now' => time()]);
