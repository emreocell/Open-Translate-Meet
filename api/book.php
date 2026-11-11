<?php
declare(strict_types=1);
require __DIR__ . '/_google.php';
if (!config_bool('BOOKING_ENABLED')) fail('feature_disabled', 503);
$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method === 'GET') {
  if (!rate('booking-slots:' . client_ip(), 120, 3600)) fail('rate',429);
  $grid = book_grid(time(), time()+BOOK_DAYS*86400); if ($grid === null) fail('calendar_unavailable',503);
  out(['slots'=>array_keys(array_filter($grid)), 'taken'=>array_keys(array_filter($grid,static fn($free)=>!$free)), 'slotMin'=>BOOK_SLOT_MIN, 'tz'=>BOOK_TZ]);
}
require_post(); $in=body();
if (($in['action']??'')!=='request') fail('bad_action');
if (trim((string)($in['website']??''))!=='') fail('invalid');
out(bk_request($in));
