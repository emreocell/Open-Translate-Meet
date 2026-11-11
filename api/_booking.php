<?php
declare(strict_types=1);

function bk_get(string $id): ?array {
  if (!preg_match('/^[a-f0-9]{12}$/D', $id)) return null;
  return private_json_read(BOOK_DIR . '/' . $id . '.json');
}
function bk_put(array $b): void {
  if (!preg_match('/^[a-f0-9]{12}$/D', (string)($b['id'] ?? ''))) fail('bad_booking');
  private_json_write(BOOK_DIR . '/' . $b['id'] . '.json', $b);
}
function bk_all(): array {
  $out = [];
  foreach (glob(BOOK_DIR . '/*.json') ?: [] as $path) {
    $b = bk_get(basename($path, '.json')); if ($b !== null) $out[] = $b;
  }
  return $out;
}
function bk_sweep(): void {
  storage_lock('bookings', static function (): void {
    $retention = config_int('BOOKING_RETENTION_DAYS', 120, 7, 365) * 86400;
    foreach (bk_all() as $b) {
      if ($b['status'] === 'pending' && (int)$b['created'] + config_int('BOOKING_PENDING_HOURS', 48, 1, 720) * 3600 < time()) {
        $b['status'] = 'expired'; bk_put($b);
      }
      // Unresolved provider operations remain visible for an operator to reconcile.
      if (in_array($b['status'], ['approving', 'cancelling', 'rescheduling'], true)) continue;
      if (max((int)$b['created'], (int)$b['slot']) + $retention < time()) rm_tree(BOOK_DIR . '/' . $b['id'] . '.json');
    }
  });
}
function bk_manage_token(array $b): string {
  $expires = (int)$b['created'] + config_int('BOOKING_RETENTION_DAYS', 120, 7, 365) * 86400;
  return $expires . '.' . hash_hmac('sha256', 'booking-manage:' . $b['id'] . ':' . ($b['manageNonce'] ?? '') . ':' . $expires, app_secret());
}
function bk_authorize(string $id, string $token): array {
  $b = bk_get($id);
  if (!$b || empty($b['manageNonce']) || !preg_match('/^(\d{9,11})\.[a-f0-9]{64}$/D', $token, $m) || (int)$m[1] <= time() || !hash_equals(bk_manage_token($b), $token)) fail('unauthorized', 401);
  return $b;
}
function bk_manage_url(array $b): string { return PUBLIC_ORIGIN . '/randevu/manage/?b=' . $b['id'] . '#m=' . bk_manage_token($b); }
function bk_view(array $b): array {
  $view = ['id' => $b['id'], 'status' => $b['status'], 'slot' => $b['slot'], 'slotMin' => BOOK_SLOT_MIN,
    'tz' => $b['tz'], 'name' => $b['name'], 'language' => $b['lang'], 'revision' => (int)($b['revision'] ?? 0),
    'notifications' => $b['notifications'] ?? [], 'pendingSlot' => $b['operation']['slot'] ?? null,
    'mediaClosePending' => !empty($b['mediaClosePending'])];
  if ($b['status'] === 'approved' && !empty($b['room'])) {
    $r = room_reg_get($b['room']); if ($r && room_is_open($r)) $view['link'] = room_links($b['room'], $r['title'])['link'];
  }
  return $view;
}
function bk_admin_view(array $b): array {
  return bk_view($b) + ['email' => $b['email'], 'company' => $b['company'], 'note' => $b['note'], 'created' => $b['created'],
    'room' => $b['room'] ?? null, 'calendarEvent' => $b['event'] ?? null, 'mediaClosePending' => !empty($b['mediaClosePending'])];
}

/** All occupied intervals, with pagination and local reservations. Calendar errors fail closed. */
function book_busy(int $fromTs, int $toTs, string $ignoreId = ''): ?array {
  $busy = []; $ignored = $ignoreId !== '' ? bk_get($ignoreId) : null;
  if (bk_uses_google()) {
    $query = ['timeMin' => gmdate('c', $fromTs), 'timeMax' => gmdate('c', $toTs), 'singleEvents' => 'true', 'orderBy' => 'startTime', 'maxResults' => 250];
    $pages = 0;
    do {
      [$code, $j] = g_cal('GET', g_calendar_path(), null, $query); if ($code !== 200) return null;
      foreach ($j['items'] ?? [] as $event) {
        if (($event['status'] ?? '') === 'cancelled' || ($event['transparency'] ?? '') === 'transparent' || ($ignored && ($event['id'] ?? '') === ($ignored['event'] ?? null))) continue;
        $declined = false;
        foreach ($event['attendees'] ?? [] as $a) if (!empty($a['self']) && ($a['responseStatus'] ?? '') === 'declined') $declined = true;
        if ($declined) continue;
        try {
          if (!empty($event['start']['dateTime'])) $busy[] = [(new DateTimeImmutable($event['start']['dateTime']))->getTimestamp(), (new DateTimeImmutable($event['end']['dateTime']))->getTimestamp()];
          elseif (!empty($event['start']['date'])) {
            $calendarTz = new DateTimeZone((string)($event['start']['timeZone'] ?? $j['timeZone'] ?? BOOK_TZ));
            $busy[] = [(new DateTimeImmutable($event['start']['date'], $calendarTz))->getTimestamp(), (new DateTimeImmutable($event['end']['date'], $calendarTz))->getTimestamp()];
          }
        } catch (Throwable) { return null; }
      }
      $next = (string)($j['nextPageToken'] ?? ''); if ($next !== '') $query['pageToken'] = $next;
      if (++$pages >= 20 && $next !== '') return null;
    } while ($next !== '');
  }
  foreach (bk_all() as $b) {
    if ($b['id'] === $ignoreId || !in_array($b['status'], ['pending', 'approved', 'approving', 'cancelling', 'rescheduling'], true)) continue;
    if ($b['status'] === 'pending' && $b['created'] + config_int('BOOKING_PENDING_HOURS', 48, 1, 720) * 3600 <= time()) continue;
    $busy[] = [(int)$b['slot'], (int)$b['slot'] + BOOK_SLOT_MIN * 60];
    if (!empty($b['operation']['slot'])) $busy[] = [(int)$b['operation']['slot'], (int)$b['operation']['slot'] + BOOK_SLOT_MIN * 60];
  }
  return $busy;
}
function book_grid(int $fromTs, int $toTs, string $ignoreId = '', ?int $now = null): ?array {
  $now ??= time();
  $fromTs = max($fromTs, $now + BOOK_NOTICE_H * 3600); $toTs = min($toTs, $now + BOOK_DAYS * 86400);
  if ($fromTs >= $toTs) return [];
  $busy = book_busy($fromTs - 86400, $toTs + 86400, $ignoreId); if ($busy === null) return null;
  $tz = new DateTimeZone(BOOK_TZ); $day = (new DateTimeImmutable('@' . $fromTs))->setTimezone($tz)->setTime(0,0); $out = [];
  for ($i = 0; $i < BOOK_DAYS + 2 && $day->getTimestamp() <= $toTs; $i++, $day = $day->modify('+1 day')) {
    $hours = BOOK_HOURS[(int)$day->format('N')] ?? null; if (!$hours) continue;
    $start = $day->setTime($hours[0], 0)->getTimestamp(); $end = $day->setTime($hours[1], 0)->getTimestamp();
    // Iterate actual instants: DST repeats are distinct timestamps; gaps are never offered.
    for ($at = $start; $at + BOOK_SLOT_MIN * 60 <= $end; $at += BOOK_SLOT_MIN * 60) {
      if ($at < $fromTs || $at >= $toTs) continue;
      $free = true; foreach ($busy as [$bs,$be]) if ($at < $be && $at + BOOK_SLOT_MIN * 60 > $bs) { $free = false; break; }
      $out[$at] = $free;
    }
  }
  return $out;
}
function book_slots(int $fromTs, int $toTs, string $ignoreId = ''): ?array {
  $grid = book_grid($fromTs, $toTs, $ignoreId); return $grid === null ? null : array_keys(array_filter($grid));
}
function bk_assert_free(int $slot, string $ignoreId = '', bool $newSelection = true): void {
  if ($slot <= time()) fail('slot_past', 409);
  if ($newSelection) {
    $free = book_slots($slot, $slot + 1, $ignoreId); if ($free === null) fail('calendar_unavailable', 503);
    if (!in_array($slot, $free, true)) fail('slot_taken', 409);
  } else {
    $busy = book_busy($slot - 1, $slot + BOOK_SLOT_MIN * 60 + 1, $ignoreId); if ($busy === null) fail('calendar_unavailable', 503);
    foreach ($busy as [$a,$b]) if ($slot < $b && $slot + BOOK_SLOT_MIN * 60 > $a) fail('slot_taken', 409);
  }
}
function bk_event(array $b, string $room, int $slot): array {
  $link = room_links($room, (string)(room_reg_get($room)['title'] ?? ''))['link'];
  return ['summary' => app_name() . ' · ' . $b['name'], 'description' => $link, 'location' => $link,
    'start' => ['dateTime' => gmdate('c', $slot), 'timeZone' => BOOK_TZ], 'end' => ['dateTime' => gmdate('c', $slot + BOOK_SLOT_MIN * 60), 'timeZone' => BOOK_TZ],
    'attendees' => [['email' => $b['email'], 'displayName' => $b['name']]], 'guestsCanSeeOtherGuests' => false, 'guestsCanModify' => false, 'guestsCanInviteOthers' => false,
    'extendedProperties' => ['private' => ['atm_booking' => $b['id'], 'atm_room' => $room]]];
}
function bk_notify(array &$b, string $kind): void {
  $language = $b['lang']; $title = bk_text($language, 'b_' . $kind); $cfg = mail_cfg();
  $rows = [[bk_text($language, 'b_name'), h($b['name'])], [bk_text($language, 'b_selected'), h(when_fmt((int)$b['slot'], (string)$b['tz'], $language))]];
  $view = bk_view($b); if (!empty($view['link'])) $rows[] = [bk_text($language, 'b_join'), '<a href="' . h($view['link']) . '">' . h($view['link']) . '</a>'];
  $visitor = mail_send($b['email'], $title . ' · ' . app_name(), mail_html($title, h(bk_text($language, 'b_manage_help')), $rows,
    [bk_text($language, 'b_manage'), bk_manage_url($b)], bk_text($language, 'b_privacy')));
  $owner = false;
  if ($cfg) $owner = mail_send($cfg['owner'], $title . ' · ' . $b['name'], mail_html($title, h($b['email']), $rows,
    [bk_text($language, 'b_admin'), PUBLIC_ORIGIN . '/admin/'], ''), $b['email'], $b['name']);
  $b['notifications'] = ['visitor' => $visitor, 'owner' => $owner, 'attemptedAt' => time()]; bk_put($b);
}
function bk_request(array $in): array {
  if (!config_bool('BOOKING_ENABLED')) fail('feature_disabled', 503);
  $clean = static fn(string $v, int $n) => mb_substr(trim((string)preg_replace('/[\x00-\x1F\x7F]/u', ' ', $v)), 0, $n);
  $name = $clean((string)($in['name'] ?? ''), 80); $email = trim((string)($in['email'] ?? ''));
  if (mb_strlen($name) < 2 || strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $email)) fail('invalid');
  $language = (string)($in['lang'] ?? 'en'); if (!in_array($language, UI_LANGS, true)) $language = 'en';
  $tz = (string)($in['tz'] ?? BOOK_TZ); try { new DateTimeZone($tz); } catch (Throwable) { fail('invalid_timezone'); }
  $requestId = (string)($in['requestId'] ?? '');
  if (!preg_match('/^[A-Za-z0-9_-]{16,80}$/D', $requestId)) fail('request_id_required');
  $data = ['name' => $name, 'email' => $email, 'company' => $clean((string)($in['company'] ?? ''),100), 'note' => $clean((string)($in['note'] ?? ''),600),
    'lang' => $language, 'tz' => $tz, 'slot' => (int)($in['slot'] ?? 0)];
  $requestKey = hash_hmac('sha256', 'booking:' . $requestId, app_secret());
  $fingerprint = hash('sha256', json_encode($data, JSON_THROW_ON_ERROR));
  return storage_lock('bookings', static function () use ($data,$requestKey,$fingerprint): array {
    bk_sweep(); $all = bk_all();
    foreach ($all as $old) if (($old['requestKey'] ?? '') === $requestKey) {
      if (!hash_equals((string)$old['requestFingerprint'], $fingerprint)) fail('request_conflict',409);
      return ['ok' => true, 'when' => $old['slot'], 'manageUrl' => bk_manage_url($old)] + bk_view($old);
    }
    if (count($all) >= config_int('BOOKING_MAX_RECORDS', 5000, 10, 50000)) fail('booking_capacity',503);
    if (!rate('booking-request:' . client_ip(),6,3600) || !rate('booking-email:' . hash('sha256',strtolower($data['email'])),3,86400)
      || !rate('booking-global',60,3600)) fail('rate',429);
    bk_assert_free($data['slot']);
    $b = $data + ['id' => bin2hex(random_bytes(6)), 'status' => 'pending', 'created' => time(), 'revision' => 0,
      'manageNonce' => bin2hex(random_bytes(24)), 'requestKey' => $requestKey, 'requestFingerprint' => $fingerprint];
    bk_put($b); bk_notify($b,'pending');
    return ['ok' => true, 'when' => $b['slot'], 'manageUrl' => bk_manage_url($b)] + bk_view($b);
  });
}
function bk_calendar_binding(): array {
  return bk_uses_google() ? ['provider' => 'google', 'id' => config_string('GOOGLE_CALENDAR_ID', 'primary'), 'connection' => g_connection_id()] : ['provider' => 'none'];
}
/** Existing events stay bound to their original provider/calendar. Re-consent is safe only after verifying that exact event. */
function bk_calendar_for_operation(array &$b): bool {
  $binding = $b['calendar'] ?? null;
  if ($binding === null) {
    // Legacy records cannot prove which account/calendar created their event.
    // Keep the operation pending for an operator; never adopt the current account implicitly.
    fail('calendar_binding_required', 409);
  }
  if (($binding['provider'] ?? '') === 'none') return false;
  if (($binding['provider'] ?? '') !== 'google' || !bk_uses_google()) fail('calendar_changed', 409);
  $current = bk_calendar_binding();
  if (($binding['id'] ?? '') !== $current['id']) fail('calendar_changed', 409);
  if (($binding['connection'] ?? '') === $current['connection']) return true;
  if (empty($b['event'])) fail('calendar_changed', 409);
  [$code, $event] = g_cal('GET', g_calendar_path() . '/' . rawurlencode($b['event']));
  if (!in_array($code, [200, 404, 410], true)) fail('calendar_unavailable', 503);
  $expectedRooms = array_filter([$b['room'] ?? null, $b['operation']['room'] ?? null, $b['operation']['oldRoom'] ?? null]);
  if ($code !== 200 || ($event['extendedProperties']['private']['atm_booking'] ?? '') !== $b['id']
    || !in_array($event['extendedProperties']['private']['atm_room'] ?? null, $expectedRooms, true)) fail('calendar_changed', 409);
  $b['calendar'] = $current; bk_put($b); return true;
}
/** A pending request cannot be resurrected merely because cleanup has not run yet. */
function bk_expire_pending(array &$b): void {
  if (($b['status'] ?? '') === 'pending' && (int)$b['created'] + config_int('BOOKING_PENDING_HOURS', 48, 1, 720) * 3600 <= time()) {
    $b['status'] = 'expired'; bk_put($b);
  }
}
function bk_decide(string $id, string $decision): array {
  if (!in_array($decision,['approve','reject'],true)) fail('bad_action');
  return storage_lock('bookings',static function () use ($id,$decision): array {
    $b = bk_get($id); if (!$b) fail('not_found',404);
    bk_expire_pending($b);
    if ($b['status'] === ($decision === 'approve' ? 'approved' : 'rejected')) return ['ok'=>true] + bk_admin_view($b);
    if (!in_array($b['status'],['pending','approving'],true)) fail('booking_state',409);
    if ($decision === 'reject') {
      if ($b['status'] === 'approving') fail('booking_sync_pending',409);
      $b['status']='rejected'; $b['decided']=time(); bk_put($b); bk_notify($b,'rejected'); return ['ok'=>true] + bk_admin_view($b);
    }
    if ($b['status'] === 'pending') {
      bk_assert_free((int)$b['slot'],$id,false);
      $b['calendar'] = bk_calendar_binding();
      $room=room_create(['title'=>app_name().' · '.$b['name'],'startsAt'=>$b['slot'],'expiresAt'=>$b['slot']+8*3600,'waitingRoom'=>true]);
      $b['room']=$room['id']; $b['event']='atm'.$b['id']; $b['status']='approving'; bk_put($b);
    }
    if (bk_calendar_for_operation($b)) {
      $event=bk_event($b,$b['room'],(int)$b['slot']); $event['id']=$b['event'];
      [$code,$reply]=g_cal('POST',g_calendar_path(),$event,['sendUpdates'=>'all']);
      if ($code===409) [$code,$reply]=g_cal('GET',g_calendar_path().'/'.rawurlencode($b['event']));
      if (!in_array($code,[200,201],true) || ($reply['id']??'')!==$b['event']
        || ($reply['extendedProperties']['private']['atm_booking']??'')!==$id
        || ($reply['extendedProperties']['private']['atm_room']??'')!==$b['room']
        || strtotime((string)($reply['start']['dateTime']??''))!==(int)$b['slot']) fail('calendar_sync_pending',503,['pending'=>true]);
    }
    $b['status']='approved'; $b['decided']=time(); bk_put($b); bk_notify($b,'confirmed'); return ['ok'=>true]+bk_admin_view($b);
  });
}
function bk_cancel(string $id): array {
  return storage_lock('bookings',static function () use ($id): array {
    $b=bk_get($id); if (!$b) fail('not_found',404);
    bk_expire_pending($b);
    if ($b['status']==='cancelled' && empty($b['mediaClosePending'])) return ['ok'=>true]+bk_view($b);
    if (!in_array($b['status'],['pending','approved','approving','rescheduling','cancelling','cancelled'],true)) fail('booking_state',409);
    $b['status']='cancelling'; bk_put($b);
    $mediaPending=false;
    foreach (array_unique(array_filter([$b['room']??null,$b['operation']['room']??null])) as $room) {
      if (room_reg_get($room)) { $closed=room_close($room,'cancelled'); $mediaPending=$mediaPending || !empty($closed['mediaClosePending']); }
    }
    $b['mediaClosePending']=$mediaPending; bk_put($b);
    if (!empty($b['event']) && bk_calendar_for_operation($b)) {
      [$code]=g_cal('DELETE',g_calendar_path().'/'.rawurlencode($b['event']),null,['sendUpdates'=>'all']);
      if (!in_array($code,[200,204,404,410],true)) fail('calendar_sync_pending',503,['pending'=>true]);
    }
    $b['status']='cancelled'; $b['cancelledAt']=time(); unset($b['operation']); bk_put($b); bk_notify($b,'cancelled');
    return ['ok'=>true,'mediaClosePending'=>$mediaPending]+bk_view($b);
  });
}
function bk_reschedule(string $id, int $slot): array {
  return storage_lock('bookings',static function () use ($id,$slot): array {
    $b=bk_get($id); if (!$b) fail('not_found',404);
    bk_expire_pending($b);
    if (!in_array($b['status'],['pending','approved','rescheduling'],true)) fail('booking_state',409);
    if ($b['status']!=='rescheduling' && (int)$b['slot']===$slot) return ['ok'=>true]+bk_view($b);
    if ($b['status']==='rescheduling') {
      if ((int)$b['operation']['slot']!==$slot) fail('booking_sync_pending',409);
    } else {
      bk_assert_free($slot,$id);
      $newRoom=null;
      if ($b['status']==='approved') $newRoom=room_create(['title'=>app_name().' · '.$b['name'],'startsAt'=>$slot,'expiresAt'=>$slot+8*3600,'waitingRoom'=>true])['id'];
      $b['operation']=['statusBefore'=>$b['status'],'slot'=>$slot,'room'=>$newRoom,'oldRoom'=>$b['room']??null];
      $b['status']='rescheduling'; bk_put($b);
    }
    $operation=$b['operation'];
    if (!empty($operation['oldRoom']) && room_reg_get($operation['oldRoom'])) {
      $closed=room_close($operation['oldRoom'],'cancelled'); $b['mediaClosePending']=!empty($closed['mediaClosePending']); bk_put($b);
    }
    if ($operation['statusBefore']==='approved' && bk_calendar_for_operation($b)) {
      [$code,$reply]=g_cal('PATCH',g_calendar_path().'/'.rawurlencode($b['event']),bk_event($b,$operation['room'],$slot),['sendUpdates'=>'all']);
      if ($code!==200 || ($reply['id']??'')!==$b['event']) fail('calendar_sync_pending',503,['pending'=>true]);
    }
    $b['slot']=$slot; $b['status']=$operation['statusBefore']; if ($operation['room']!==null) $b['room']=$operation['room'];
    $b['revision']=(int)($b['revision']??0)+1; $b['rescheduledAt']=time(); unset($b['operation']); bk_put($b); bk_notify($b,'rescheduled');
    return ['ok'=>true]+bk_view($b);
  });
}
