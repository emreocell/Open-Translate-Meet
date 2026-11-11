<?php
declare(strict_types=1);
// Legacy email approval links now open the authenticated administration screen.
// Opening a link (including an email scanner) never approves or rejects a booking.
header('Cache-Control: no-store'); header('Referrer-Policy: no-referrer');
if (($_SERVER['REQUEST_METHOD']??'')!=='GET') { http_response_code(405); header('Allow: GET'); exit; }
header('Location: ../admin/',true,303);
