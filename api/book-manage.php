<?php
declare(strict_types=1);
require __DIR__ . '/_google.php';
request_origin();
$id=(string)($_GET['b']??''); $token=(string)($_SERVER['HTTP_X_BOOKING_TOKEN']??'');
if (!rate('booking-manage:' . client_ip(), 120, 3600)) fail('rate',429);
$b=bk_authorize($id,$token);
if (($_SERVER['REQUEST_METHOD']??'')==='GET') {
  if (($_GET['action']??'')==='slots') {
    $slots=book_slots(time(),time()+BOOK_DAYS*86400,$id); if ($slots===null) fail('calendar_unavailable',503);
    out(['slots'=>$slots,'slotMin'=>BOOK_SLOT_MIN,'tz'=>BOOK_TZ]);
  }
  out(bk_view($b));
}
require_post(); $in=body();
// Serialize authorization with the mutation: an operator revocation cannot race an accepted request.
$result=storage_lock('bookings',static function () use ($id,$token,$in): array {
  bk_authorize($id,$token);
  return match ($in['action']??'') {
    'cancel'=>bk_cancel($id), 'reschedule'=>bk_reschedule($id,(int)($in['slot']??0)), default=>throw new MeetHttpError('bad_action')
  };
});
out($result);
