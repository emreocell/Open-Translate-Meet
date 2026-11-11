<?php
declare(strict_types=1);
/** CLI maintenance: configure a scheduled run every five minutes in production. */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/_lib.php';
sweep_uploads(true);
sweep_rooms(true);
sweep_moderation();
sweep_rates();
require_once __DIR__ . '/_ai.php';
sweep_usage();
require_once __DIR__ . '/_webhook.php';
sweep_webhooks();
if (config_bool('BOOKING_ENABLED') || is_dir(PRIV . '/bookings')) {
  require_once __DIR__ . '/_google.php';
  bk_sweep();
}
foreach (glob(PRIV . '/transcripts/*.json') ?: [] as $file) {
  $room = basename($file, '.json');
  if (!room_id_ok($room)) continue;
  storage_lock('transcript:' . $room, static function () use ($file): void {
    $data = private_json_read($file, []);
    if ((int)($data['expiresAt'] ?? 0) <= time()) rm_tree($file);
  });
}
echo "Retention and room cleanup complete.\n";
