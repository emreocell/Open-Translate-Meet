<?php
declare(strict_types=1);
require __DIR__ . '/_admin.php';
require __DIR__ . '/_google.php';
require_post(); admin_require(true);
$c=g_cfg(); if (!$c || !bk_uses_google()) fail('calendar_not_configured',503);
$state=bin2hex(random_bytes(32)); admin_session();
$_SESSION['googleState']=hash('sha256',$state); $_SESSION['googleStateExpires']=time()+600; session_write_close();
out(['url'=>'https://accounts.google.com/o/oauth2/v2/auth?'.http_build_query([
  'client_id'=>$c['client_id'],'redirect_uri'=>PUBLIC_ORIGIN.'/api/google-callback.php','response_type'=>'code',
  'scope'=>'https://www.googleapis.com/auth/calendar.events','access_type'=>'offline','prompt'=>'consent','state'=>$state
])]);
