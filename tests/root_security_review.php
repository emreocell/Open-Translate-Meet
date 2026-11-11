<?php
declare(strict_types=1);
$testRoot = sys_get_temp_dir() . '/meet-privacy-' . bin2hex(random_bytes(8)); mkdir($testRoot, 0700);
putenv('MEET_PRIVATE_DIR=' . $testRoot); putenv('APP_URL=http://localhost:8080');
putenv('APP_SECRET=' . str_repeat('test-privacy-secret-', 3)); putenv('TRANSCRIPT_ENABLED=true');
putenv('TEXT_PROVIDER=openai-compatible'); putenv('TEXT_MODEL=fixture-model'); putenv('TEXT_API_KEY=fixture-key'); putenv('TEXT_BASE_URL=http://localhost:9999/v1');
putenv('ADMIN_PASSWORD_HASH=' . password_hash('correct horse battery staple', PASSWORD_DEFAULT));
define('MEET_TEST_MODE', true);
require dirname(__DIR__) . '/api/_transcript.php'; require dirname(__DIR__) . '/api/_admin.php';
$passed = 0; $calls = 0;
function verify(bool $ok, string $label): void { global $passed; if (!$ok) throw new RuntimeException('FAIL: ' . $label); $passed++; }
function blocked(callable $fn, string $error, string $label): void { try { $fn(); } catch (MeetHttpError $e) { verify($e->error === $error, $label); return; } verify(false, $label); }
function member(array $r, string $name, string $char, bool $host = false): array {
  $who = str_repeat($char, 12);
  room_reg_edit($r['id'], static function (array &$r) use ($who, $name, $host, $char): void {
    $r['sessions'][$who] = ['sid' => bin2hex(random_bytes(16)), 'name' => $name, 'host' => $host, 'speak' => 'en', 'hear' => 'tr', 'did' => str_repeat($char, 32), 'expires' => time() + 3600];
  });
  return ticket_claims(issue_ticket(room_reg_get($r['id']), $who));
}
try {
  $room = room_create(['title' => 'Privacy']); $id = $room['id']; $alice = member($room, 'Alice', 'a', true); $bob = member($room, 'Bob', 'b');
  $status = transcript_status($alice);
  verify(!$status['enabled'] && !$status['consent']['record'] && !is_file(transcript_path($id)), 'transcript off and no persistent record by default');
  blocked(static fn() => transcript_append($alice, ['id' => '1', 'to' => 'tr', 'original' => 'Unconsented']), 'consent_required', 'no capture before consent');
  transcript_edit($id, static function (array &$d): void { $d['active'] = true; $d['revision']++; });
  blocked(static fn() => transcript_append($alice, ['id' => '1', 'to' => 'tr', 'original' => 'Unconsented']), 'consent_required', 'host enabling capture is not participant consent');
  transcript_set_consent($alice, true, false);
  transcript_append($alice, ['id' => 'a1', 'to' => 'tr', 'original' => 'Private speech.', 'speaker' => $bob['who'], 'name' => 'Forged Bob']);
  $data = transcript_export($id); $first = $data['entries'][0];
  verify($first['speaker'] === $alice['who'] && $first['name'] === 'Alice', 'stored transcript identity cannot be forged');
  $GLOBALS['meet_http_transport'] = static function () use (&$calls): array { $calls++; return [500, []]; };
  blocked(static fn() => transcript_summary($id), 'summary_empty', 'recording consent is not provider-summary consent');
  verify($calls === 0, 'no AI call without summary consent');
  room_reg_edit($id, static function (array &$r) use ($alice): void { $r['sessions'][$alice['who']]['speak'] = 'de'; });
  transcript_append($alice, ['id' => 'a2', 'to' => 'tr', 'original' => 'Hallo.']);
  verify(transcript_export($id)['entries'][1]['language'] === 'de', 'append refreshes canonical language under room lock');
  transcript_set_consent($bob, true, true);
  transcript_append($bob, ['id' => 'b1', 'to' => 'tr', 'original' => 'I will send the draft tomorrow.']);
  $bobEntry = transcript_export($id)['entries'][2]; $sent = null;
  $GLOBALS['meet_http_transport'] = static function ($method, $url, $json) use (&$calls, &$sent, $bobEntry, $first): array {
    $calls++; $sent = json_decode($json['messages'][1]['content'], true);
    return [200, ['choices' => [['message' => ['content' => json_encode([
      'brief' => [['text' => 'A draft will be sent.', 'evidence' => [$bobEntry['id']]]],
      'actions' => [['text' => 'Send draft.', 'evidence' => [$bobEntry['id']], 'assignee' => 'Mallory']],
      'decisions' => [['text' => 'Invented private decision.', 'evidence' => [$first['id']]]],
    ])]]], 'usage' => ['prompt_tokens' => 9, 'completion_tokens' => 7]]];
  };
  $summary = transcript_summary($id);
  verify(count($sent['transcript']) === 1 && $sent['transcript'][0]['speaker'] === $bob['who'], 'only expressly summary-consenting speaker sent to AI');
  verify($summary['draft'] && $summary['report']['decisions'] === [], 'unsupported evidence cannot fabricate verified decision');
  verify($summary['report']['actions'][0]['assignee'] === null, 'unknown task owner removed');
  $usage = usage_view($id);
  verify(!$usage['billingVerified'] && $usage['providerInputTokens'] === 9 && $usage['clientInputSeconds'] === 0.0, 'provider token reports and client duration remain distinct');
  transcript_set_consent($alice, false, false);
  $data = transcript_export($id);
  verify(count($data['entries']) === 1 && $data['entries'][0]['speaker'] === $bob['who'] && $data['summary'] === null, 'withdrawal erases own speech and invalidates summaries');
  $GLOBALS['meet_http_transport'] = static function () use ($bob, $bobEntry): array {
    transcript_set_consent($bob, false, false);
    return [200, ['choices' => [['message' => ['content' => json_encode(['brief' => [['text' => 'Draft.', 'evidence' => [$bobEntry['id']]]]])]]]]];
  };
  blocked(static fn() => transcript_summary($id), 'transcript_changed', 'consent withdrawal during AI request prevents stale summary save');
  verify(transcript_export($id)['entries'] === [] && transcript_export($id)['summary'] === null, 'withdrawal remains effective after in-flight provider response');
  room_reg_edit($id, static function (array &$r) use ($bob): void { $r['sessions'][$bob['who']]['revoked'] = true; });
  blocked(static fn() => transcript_set_consent($bob, true, true), 'unauthorized', 'revoked participant cannot change consent through stale in-request auth');
  blocked(static fn() => transcript_append($bob, ['id' => 'b2', 'to' => 'en', 'original' => 'Stale']), 'unauthorized', 'revoked participant cannot append through stale in-request auth');
  transcript_edit($id, static function (array &$d): void { $d['expiresAt'] = time() - 1; });
  verify(transcript_export($id)['entries'] === [] && !is_file(transcript_path($id)), 'expired transcript deleted on read');
  // Usage aggregates have a fixed deadline; observing them cannot prolong it.
  $retention = room_create(['title' => 'Retention', 'password' => 'private-password']); $rid = $retention['id'];
  $current = member($retention, 'Current', 'c');
  usage_view($rid);
  verify(!is_file(usage_path($rid)), 'viewing unused metrics creates no retained record');
  usage_edit($rid, static function (array &$d) use ($current): void {
    $d['textRequests']++;
    $d['clients'] = [$current['who'] => ['lastAt' => time(), 'activeSessions' => 1], 'obsolete' => ['lastAt' => time() - 91, 'activeSessions' => 1]];
  });
  $record = private_json_read(usage_path($rid)); $record['updatedAt'] = time() - 60; private_json_write(usage_path($rid), $record);
  verify(array_keys($record['clients']) === [$current['who']], 'usage writes erase obsolete participant identities');
  usage_view($rid);
  verify(private_json_read(usage_path($rid))['updatedAt'] === $record['updatedAt']
    && private_json_read(usage_path($rid))['expiresAt'] === $record['expiresAt'], 'metrics reads extend neither activity nor retention');
  $record['createdAt'] = time() - 31 * 86400; private_json_write(usage_path($rid), $record);
  verify(usage_view($rid)['textRequests'] === 0 && !is_file(usage_path($rid)), 'legacy and current usage expire from first measurement');
  usage_edit($rid, static function (array &$d) use ($current): void { $d['textRequests']++; $d['clients'][$current['who']] = ['lastAt' => time(), 'activeSessions' => 1]; });
  mod_edit($rid, static function (array &$m): void { $m['seen']['old'] = ['name' => 'Old']; $m['bans'][] = ['did' => str_repeat('d',32), 'until' => time()-1]; });
  room_close($rid);
  $firstEnd = room_reg_get($rid)['endedAt']; room_close($rid);
  verify(room_reg_get($rid)['mediaClosePending'] && room_reg_get($rid)['endedAt'] === $firstEnd, 'failed media close is journaled without restarting retention');
  verify(!isset(room_reg_get($rid)['passHash']) && !is_file(mod_path($rid)) && private_json_read(usage_path($rid))['clients'] === [], 'ending erases credentials and device/name traces while keeping aggregates');
  usage_edit($rid, static function (array &$d) use ($current): void { $d['clients'][$current['who']] = ['lastAt' => time()]; });
  verify(private_json_read(usage_path($rid))['clients'] === [], 'late usage completion cannot restore a closed-room identity');
  room_close($rid, 'deleted');
  usage_edit($rid, static function (array &$d): void { $d['textRequests']++; });
  verify(!is_file(usage_path($rid)), 'deletion and in-flight completion cannot recreate usage');
  $prune = room_create(['title' => 'Pruning']); $pid = $prune['id']; $validMember = member($prune, 'Valid', 'd');
  room_reg_edit($pid, static function (array &$r): void {
    $r['sessions']['expired'] = ['expires' => time()-1, 'name' => 'Expired'];
    $r['sessions']['revoked'] = ['expires' => time()+100, 'revoked' => true, 'name' => 'Revoked'];
    $r['waiting'] = ['old' => ['expires' => time()-1, 'name' => 'Old'], 'current' => ['expires' => time()+100, 'name' => 'Waiting']];
  });
  mod_edit($pid, static function (array &$m): void {
    $m['seen'] = ['old' => ['name' => 'Old']];
    $m['locks'] = [['did' => str_repeat('e',32), 'mic' => true, 'name' => 'Unneeded']];
    $m['bans'] = [['did' => str_repeat('f',32), 'until' => time()-1], ['did' => str_repeat('a',32), 'until' => 0, 'name' => 'Banned']];
  });
  sweep_rooms(true); sweep_moderation();
  $pruned = room_reg_get($pid); $moderation = private_json_read(mod_path($pid));
  verify(array_keys($pruned['sessions']) === [$validMember['who']] && array_keys($pruned['waiting']) === ['current'], 'maintenance removes expired waiting and invalid sessions without removing live ones');
  verify(!isset($moderation['seen']) && !isset($moderation['locks'][0]['name']) && count($moderation['bans']) === 1, 'maintenance erases unused history and expired bans while preserving active controls');
  room_reg_edit($rid, static function (array &$r): void { $r['endedAt'] = time()-32*86400; $r['expiresAt'] = time()+300*86400; $r['mediaClosePending'] = false; });
  $lockPath = PRIV . '/locks/' . hash('sha256', 'room:' . $rid) . '.lock'; $oldLink = $rid . '.' . room_sig($rid);
  sweep_rooms(true);
  verify(room_reg_get($rid) === null && room_from_link($oldLink) === null, 'terminal retention uses closure rather than a future schedule and purged links remain denied');
  verify(is_file($lockPath), 'maintenance never unlinks stable synchronization locks');
  $orphan = str_repeat('f',10); private_json_write(usage_path($orphan), usage_defaults()); sweep_usage();
  verify(!is_file(usage_path($orphan)), 'orphaned usage is removed');
  // Admin authentication uses independent strict cookie sessions and a CSRF token for mutations.
  $_SERVER['REMOTE_ADDR'] = '127.0.0.1'; $_SERVER['REQUEST_METHOD'] = 'POST'; $_SERVER['HTTP_ORIGIN'] = PUBLIC_ORIGIN;
  blocked(static fn() => admin_login('wrong'), 'forbidden', 'wrong admin password');
  $logged = admin_login('correct horse battery staple');
  verify($logged['authenticated'] && strlen($logged['csrf']) === 64, 'independent admin login');
  blocked(static fn() => admin_require(true), 'csrf', 'admin mutation requires CSRF token');
  $_SERVER['HTTP_X_CSRF_TOKEN'] = $logged['csrf'];
  verify(admin_require(true)['admin'] === true, 'valid admin CSRF token');
  $_SERVER['HTTP_SEC_FETCH_SITE'] = 'cross-site';
  blocked(static fn() => admin_require(true), 'origin', 'cross-site admin mutation denied');
  unset($_SERVER['HTTP_SEC_FETCH_SITE']);
  admin_session(); $_SESSION['credentialVersion'] = 'old-password-version'; session_write_close();
  blocked(static fn() => admin_require(), 'unauthorized', 'password version revokes existing admin session');
  if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
  echo "Cross-boundary privacy and admin checks passed: $passed\n";
} finally {
  if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
  rm_tree($testRoot);
}
