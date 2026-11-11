<?php
declare(strict_types=1);
$mode=$argv[1]??'local';
$dir=sys_get_temp_dir().'/atm-bookings-'.bin2hex(random_bytes(6));
putenv('MEET_PRIVATE_DIR='.$dir);putenv('APP_URL=http://localhost:8080');putenv('APP_SECRET='.str_repeat('booking-test-key-',3));
putenv('BOOKING_ENABLED=true');putenv('BOOKING_CALENDAR_PROVIDER='.($mode==='google'?'google':'none'));
putenv('BOOKING_TIMEZONE=Europe/Berlin');putenv('BOOKING_NOTICE_HOURS=0');
putenv('BOOKING_HOURS={"1":[9,17],"2":[9,17],"3":[9,17],"4":[9,17],"5":[9,17],"6":[9,17],"7":[1,4]}');
putenv('GOOGLE_CLIENT_ID=test-client');putenv('GOOGLE_CLIENT_SECRET=test-secret');
define('MEET_TEST_MODE',true);
require dirname(__DIR__).'/api/_google.php';
$count=0;
function check(bool $ok,string $message): void {global $count;if(!$ok)throw new RuntimeException($message);$count++;}
function rejects(callable $fn,string $error): void {try{$fn();}catch(MeetHttpError $e){check($e->error===$error,'Expected '.$error.' got '.$e->error);return;}throw new RuntimeException('Expected '.$error);}
$GLOBALS['meet_mail_transport']=static fn()=>false;
$events=[];$failure='';$calls=[];
$GLOBALS['meet_http_transport']=static function($method,$url,$json,$headers,$form)use(&$events,&$failure,&$calls):array {
 $calls[]=[$method,parse_url($url,PHP_URL_PATH)];
 if(str_contains($url,'oauth2.googleapis.com'))return [200,['access_token'=>'test-only','expires_in'=>3600]];
 $path=(string)parse_url($url,PHP_URL_PATH);$id=basename($path);
 if($method==='GET'&&$id==='events')return [200,['items'=>array_values($events)]];
 if($method==='GET')return isset($events[$id])?[200,$events[$id]]:[404,[]];
 if($method==='POST'){
  $id=$json['id'];if(isset($events[$id]))return [409,[]];$events[$id]=$json;
  if($failure==='create_timeout'){$failure='';return [0,[]];}return [200,$events[$id]];
 }
 if($method==='PATCH'){
  if($failure==='patch'){$failure='';return [503,[]];}
  if(!isset($events[$id]))return [404,[]];$events[$id]=array_replace($events[$id],$json);return [200,$events[$id]];
 }
 if($method==='DELETE'){
  if($failure==='delete'){$failure='';return [503,[]];}
  unset($events[$id]);return [204,[]];
 }
 throw new RuntimeException('Unexpected provider request');
};
try {
 private_dir(PRIV);
 if($mode==='google')g_save_tok(['refresh_token'=>'test-only','access_token'=>'test-only','expires'=>time()+3600]);
 // Calendar arithmetic across both DST transitions, without changing the host clock.
 $fall=(new DateTimeImmutable('2026-10-25 00:00:00',new DateTimeZone(BOOK_TZ)))->getTimestamp();
 $spring=(new DateTimeImmutable('2026-03-29 00:00:00',new DateTimeZone(BOOK_TZ)))->getTimestamp();
 $fg=book_grid($fall,$fall+8*3600,'',$fall-86400);$sg=book_grid($spring,$spring+8*3600,'',$spring-86400);
 check(count($fg)===8,'Autumn repeated hour offers distinct instants');check(count($sg)===4,'Spring missing hour is not offered');
 $starts=array_keys($fg);check(count(array_unique($starts))===8,'DST slots retain unique timestamps');
 $free=book_slots(time(),time()+BOOK_DAYS*86400);check(is_array($free)&&count($free)>12,'Bookable schedule exists');
 $make=static fn(int $at,string $suffix)=>['action'=>'request','name'=>'Test '.$suffix,'email'=>$suffix.'@example.invalid','company'=>'Example','note'=>'No real user data','lang'=>'en','tz'=>'Europe/Berlin','slot'=>$at,'requestId'=>'request-key-'.$suffix.'-12345678'];
 $payload=$make($free[1],'one');$first=bk_request($payload);check($first['status']==='pending','Request persists without SMTP');
 check($first['notifications']['visitor']===false,'Notification failure is explicit');check(str_contains($first['manageUrl'],'#m='),'Management secret uses URL fragment');
 $again=bk_request($payload);check($again['id']===$first['id']&&count(bk_all())===1,'Same request is idempotent');
 $changed=$payload;$changed['name']='Changed';rejects(fn()=>bk_request($changed),'request_conflict');
 rejects(fn()=>bk_request($make($free[1],'overlap')),'slot_taken');
 $b=bk_get($first['id']);$token=bk_manage_token($b);check(bk_authorize($b['id'],$token)['id']===$b['id'],'Management token validates');
 rejects(fn()=>bk_authorize($b['id'],$token.'x'),'unauthorized');
 $approved=bk_decide($b['id'],'approve');check($approved['status']==='approved','Approved state persisted');
 $room=$approved['room'];check(room_reg_get($room)['waitingRoom']===true,'Scheduled meetings require host admission by default');
 check(!str_contains(bk_view(bk_get($b['id']))['link'],'#h='),'Attendee never receives host capability');
 $moved=bk_reschedule($b['id'],$free[4]);$new=bk_get($b['id']);check($moved['slot']===$free[4],'Reschedule commits new instant');
 check($new['room']!==$room&&!room_is_open(room_reg_get($room)),'Reschedule revokes old room and creates distinct room');
 check(bk_authorize($b['id'],$token)['slot']===$free[4],'Private management capability remains usable');
 $repeat=bk_reschedule($b['id'],$free[4]);check($repeat['revision']===$moved['revision'],'Reschedule retry is idempotent');
 $cancel=bk_cancel($b['id']);check($cancel['status']==='cancelled'&&!room_is_open(room_reg_get($new['room'])),'Cancel revokes current meeting');
 check(bk_cancel($b['id'])['status']==='cancelled','Cancellation can be retried');
 $pending=bk_request($make($free[6],'two'));$rejected=bk_decide($pending['id'],'reject');check($rejected['status']==='rejected','Admin reject persists');
 rejects(fn()=>bk_decide($pending['id'],'approve'),'booking_state');
 if($mode==='google'){
  $failure='create_timeout';$p=bk_request($make($free[8],'timeout'));rejects(fn()=>bk_decide($p['id'],'approve'),'calendar_sync_pending');
  check(bk_get($p['id'])['status']==='approving','Uncertain provider success is journaled');$before=count($events);
  check(bk_decide($p['id'],'approve')['status']==='approved'&&count($events)===$before,'Retry reconciles deterministic event without duplicate');
  $failure='patch';rejects(fn()=>bk_reschedule($p['id'],$free[10]),'calendar_sync_pending');
  check(bk_get($p['id'])['status']==='rescheduling','Failed reschedule retains operation journal');
  $grid=book_grid($free[8],$free[10]+1);check($grid[$free[8]]===false&&$grid[$free[10]]===false,'Both old and proposed slots reserved while syncing');
  check(bk_reschedule($p['id'],$free[10])['status']==='approved','Retry finishes reschedule');
  // Reconnecting the same account is reconciled by the exact event's private booking/room IDs.
  $tokenState=g_tok();$tokenState['connectionId']='new-fixture-connection';g_save_tok($tokenState);
  $bound=bk_get($p['id']);check(bk_calendar_for_operation($bound),'Re-consent validates the existing event before rebinding');
  $tokenState['connectionId']='different-fixture-account';g_save_tok($tokenState);$savedEvents=$events;$events=[];
  $bound=bk_get($p['id']);rejects(fn()=>bk_calendar_for_operation($bound),'calendar_changed');
  $events=$savedEvents;$tokenState['connectionId']='new-fixture-connection';g_save_tok($tokenState);
  $failure='delete';rejects(fn()=>bk_cancel($p['id']),'calendar_sync_pending');check(bk_get($p['id'])['status']==='cancelling','Failed cancellation stays visible');
  check(bk_cancel($p['id'])['status']==='cancelled','Retry finishes calendar cancellation');
 } else {
  // Multiple PHP workers attempting the same free slot must not double-book.
  $children=[];$raceSlot=$free[12];
  for($i=0;$i<3;$i++){
   $pid=pcntl_fork();if($pid===0){try{$result=bk_request($make($raceSlot,'race'.$i));$out='accepted';}catch(MeetHttpError $e){$out=$e->error;}
    file_put_contents(PRIV.'/race-'.$i,$out);exit(0);} $children[]=$pid;
  }
  foreach($children as $pid)pcntl_waitpid($pid,$status);
  $out=[];for($i=0;$i<3;$i++)$out[]=file_get_contents(PRIV.'/race-'.$i);
  check(count(array_filter($out,static fn($v)=>$v==='accepted'))===1,'Only one concurrent booking wins');
  check(count(array_filter($out,static fn($v)=>$v==='slot_taken'))===2,'Other concurrent requests see conflict');
 }
 // A long-idle pending request must expire even before scheduled cleanup.
 $stale=bk_get($pending['id']);$stale['status']='pending';$stale['created']=time()-49*3600;bk_put($stale);
 rejects(fn()=>bk_decide($stale['id'],'approve'),'booking_state');
 check(bk_get($stale['id'])['status']==='expired','Late approval cannot resurrect expired pending request');
 $stale['status']='pending';bk_put($stale);rejects(fn()=>bk_reschedule($stale['id'],$free[11]),'booking_state');
 check(array_key_exists('mediaClosePending',bk_view(bk_get($first['id']))),'Media-close retry state remains visible on reload');
 if($mode==='google'){
  $savedTransport=$GLOBALS['meet_http_transport'];
  $GLOBALS['meet_http_transport']=static fn()=>[200,['timeZone'=>'America/New_York','items'=>[['id'=>'all-day-timezone','start'=>['date'=>'2026-11-15'],'end'=>['date'=>'2026-11-16']]]]];
  $dayStart=(new DateTimeImmutable('2026-11-15 00:00:00',new DateTimeZone('America/New_York')))->getTimestamp();
  $intervals=book_busy($dayStart-3600,$dayStart+90000);
  check(in_array([$dayStart,$dayStart+86400],$intervals,true),'All-day dates use calendar timezone, not booking display timezone');
  $GLOBALS['meet_http_transport']=$savedTransport;
 }
 $unbound=bk_get($first['id']);unset($unbound['calendar']);rejects(fn()=>bk_calendar_for_operation($unbound),'calendar_binding_required');
 // A new OAuth grant must provide its own offline token and the required calendar scope.
 $oldCredentials=g_tok();
 rejects(fn()=>g_store_authorization(['access_token'=>'new-account-token','expires_in'=>3600,'scope'=>'https://www.googleapis.com/auth/calendar.events']),'oauth_exchange');
 check(g_tok()===$oldCredentials,'Missing new refresh token never reuses previous account credentials');
 rejects(fn()=>g_store_authorization(['access_token'=>'new-access','refresh_token'=>'new-refresh','scope'=>'openid email']),'oauth_scope');
 g_store_authorization(['access_token'=>'new-access','refresh_token'=>'new-refresh','expires_in'=>3600,'scope'=>'https://www.googleapis.com/auth/calendar.events']);
 check(strlen(g_tok()['connectionId'])===32&&g_tok()['refresh_token']==='new-refresh','Complete authorization atomically replaces credential generation');
 echo 'PASS '.$count.' booking checks ('.$mode.")\n";
} finally {rm_tree(PRIV);}
