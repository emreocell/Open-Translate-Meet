<?php
declare(strict_types=1);
require __DIR__ . '/_admin.php';
require __DIR__ . '/_google.php';
header('Cache-Control: no-store'); header('Referrer-Policy: no-referrer');
if (($_SERVER['REQUEST_METHOD']??'')!=='GET') fail('method',405);
admin_require(); admin_session();
$expected=(string)($_SESSION['googleState']??''); $expires=(int)($_SESSION['googleStateExpires']??0);
unset($_SESSION['googleState'],$_SESSION['googleStateExpires']); session_write_close();
$state=(string)($_GET['state']??'');
if ($state==='' || $expires<=time() || $expected==='' || !hash_equals($expected,hash('sha256',$state))) fail('oauth_state',403);
if (isset($_GET['error'])) { header('Location: ../admin/?calendar=cancelled',true,303); exit; }
$code=(string)($_GET['code']??''); $c=g_cfg();
if ($code==='' || strlen($code)>4096 || !$c) fail('oauth_response',400);
[$status,$j]=g_http('POST','https://oauth2.googleapis.com/token',['code'=>$code,'client_id'=>$c['client_id'],'client_secret'=>$c['client_secret'],
  'redirect_uri'=>PUBLIC_ORIGIN.'/api/google-callback.php','grant_type'=>'authorization_code']);
// Never combine a new account's access token with the previous account's refresh token.
if ($status!==200) fail('oauth_exchange',502);
g_store_authorization($j);
header('Location: ../admin/?calendar=connected',true,303);
