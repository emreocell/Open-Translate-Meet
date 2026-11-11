<?php
declare(strict_types=1);
require __DIR__ . '/_transcript.php';
require_post(); $t = ticket(); $in = body();
if (!translation_configured()) fail('feature_disabled', 503);
$lang = (string)($in['lang'] ?? '');
$transcribing = ($in['mode'] ?? '') === 'transcript';
if (!in_array($lang, LANGS, true) || (!$transcribing && $lang === $t['speak'])) fail('bad_lang');
$wanted = false;
if ($transcribing) {
  $capture = transcript_status($t);
  if ($lang !== $t['speak'] || !$capture['enabled'] || empty($capture['consent']['record'])) fail('consent_required', 403);
  $wanted = true;
}
$st = room_state($t['room']);
foreach ($st['participants'] as $p) {
  $meta = json_decode((string)($p['metadata'] ?? ''), true);
  if (($p['identity'] ?? '') !== $t['who'] && is_array($meta) && ($meta['hear'] ?? '') === $lang) $wanted = true;
}
if (!$wanted) fail('no_listener', 409);
if (!rate('gem-member:' . $t['room'] . ':' . $t['who'], config_int('LIVE_TOKENS_PER_PERSON_HOUR', 36, 1, 500), 3600)
  || !rate('gem-room:' . $t['room'], config_int('LIVE_TOKENS_PER_ROOM_HOUR', 180, 1, 5000), 3600)
  || !rate('gem-global', config_int('LIVE_TOKENS_PER_HOUR', 500, 1, 10000), 3600)) fail('ai_limit', 429);
$keys = [];
if (config_string('GEMINI_API_KEY') !== '') $keys[] = config_string('GEMINI_API_KEY');
$seats = cfg()['gemini_seats'] ?? range(1, 8);
foreach ($seats as $seat) if (is_int($seat) && $seat >= 1 && $seat <= 8 && config_string('GEMINI_KEY_' . $seat) !== '') $keys[] = config_string('GEMINI_KEY_' . $seat);
if (!$keys) fail('provider_config', 503);
$key = $keys[(int)sprintf('%u', crc32($t['who'] . ':' . $lang)) % count($keys)];
$model = config_string('GEMINI_MODEL');
if (!preg_match('/^(?:models\/)?[A-Za-z0-9._-]{1,160}$/D', $model)) fail('provider_config', 503);
$model = 'models/' . preg_replace('#^models/#', '', $model);
$generation = ['responseModalities' => ['AUDIO'], 'translationConfig' => ['targetLanguageCode' => $lang, 'echoTargetLanguage' => false],
  'inputAudioTranscription' => new stdClass(), 'outputAudioTranscription' => new stdClass()];
$duration = config_int('LIVE_SESSION_SECONDS', 600, 120, 1800); $expires = time() + $duration;
$constraints = ['responseModalities' => ['AUDIO'], 'translationConfig' => $generation['translationConfig'],
  'inputAudioTranscription' => new stdClass(), 'outputAudioTranscription' => new stdClass()];
[$code, $j] = http_json('POST', 'https://generativelanguage.googleapis.com/v1beta/auth_tokens',
  ['uses' => 1, 'expireTime' => gmdate('Y-m-d\TH:i:s\Z', $expires), 'newSessionExpireTime' => gmdate('Y-m-d\TH:i:s\Z', time() + 60),
    'liveConnectConstraints' => ['model' => $model, 'config' => $constraints]], ['x-goog-api-key: ' . $key]);
if ($code !== 200 || empty($j['name'])) {
  usage_edit($t['room'], static function (array &$d): void { $d['failedRequests']++; });
  fail($code === 429 ? 'provider_quota' : 'provider_unavailable', $code === 429 ? 429 : 502);
}
usage_edit($t['room'], static function (array &$d): void { $d['issuedLiveTokens']++; });
// Issuing a provider credential can take seconds. Recheck authorization after the
// response, and hold the room lock through disclosure so a completed revocation wins.
storage_lock('room:' . $t['room'], static function () use ($t, $lang, $transcribing, $j, $model, $expires, $generation): never {
  $current = ticket_refresh($t);
  if ($current['speak'] !== $t['speak']) fail('participant_changed', 409);
  if ($transcribing) {
    $capture = transcript_status($current);
    if ($lang !== $current['speak'] || !$capture['enabled'] || empty($capture['consent']['record'])) fail('consent_required', 403);
  }
  out(['token' => $j['name'], 'model' => $model, 'provider' => 'gemini', 'expiresAt' => $expires,
    'setup' => ['model' => $model, 'generationConfig' => $generation], 'sessionResumption' => false]);
});
