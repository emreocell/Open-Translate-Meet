<?php
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_http.php';

function usage_path(string $room): string { if (!room_id_ok($room)) fail('bad_room'); return PRIV . '/usage/' . $room . '.json'; }
function usage_defaults(): array {
  return ['createdAt' => time(), 'expiresAt' => time() + config_int('USAGE_RETENTION_DAYS', 30, 1, 365) * 86400,
    'issuedLiveTokens' => 0, 'textRequests' => 0, 'failedRequests' => 0,
    'providerInputTokens' => 0, 'providerOutputTokens' => 0, 'clientInputSeconds' => 0.0, 'clientSessionSeconds' => 0.0, 'clients' => []];
}
function usage_retain_room(?array $reg): bool {
  return $reg !== null && empty($reg['deleted']) && !in_array($reg['status'] ?? '', ['deleted', 'cancelled'], true);
}
function usage_prune_clients(array &$d, ?array $reg): void {
  if ($reg === null || !room_is_open($reg)) { $d['clients'] = []; return; }
  foreach ($d['clients'] as $who => $c) {
    $session = $reg['sessions'][$who] ?? null;
    if ((int)($c['lastAt'] ?? 0) + 90 <= time() || !is_array($session) || !empty($session['revoked'])
      || (int)($session['expires'] ?? 0) <= time()) unset($d['clients'][$who]);
  }
}
/** Called under room -> usage locks. Reads never extend the fixed retention deadline. */
function usage_read(string $room, ?array $reg): array {
  $path = usage_path($room); $d = private_json_read($path);
  if ($d === null) return usage_defaults();
  $before = $d;
  $d['expiresAt'] = min((int)($d['expiresAt'] ?? PHP_INT_MAX),
    (int)($d['createdAt'] ?? filemtime($path)) + config_int('USAGE_RETENTION_DAYS', 30, 1, 365) * 86400);
  if (!usage_retain_room($reg) || $d['expiresAt'] <= time()) { rm_tree($path); return usage_defaults(); }
  $d += usage_defaults(); usage_prune_clients($d, $reg);
  if ($d !== $before) private_json_write($path, $d);
  return $d;
}
function usage_edit(string $room, callable $fn): mixed {
  return storage_lock('room:' . $room, static function () use ($room, $fn): mixed {
    return storage_lock('usage:' . $room, static function () use ($room, $fn): mixed {
      $reg = room_reg_get($room); $d = usage_read($room, $reg);
      $result = $fn($d); usage_prune_clients($d, $reg);
      // A provider completion after deletion/cancellation must not recreate a record.
      if (usage_retain_room($reg)) { $d['updatedAt'] = time(); private_json_write(usage_path($room), $d); }
      return $result;
    });
  });
}
function usage_view(string $room): array {
  return storage_lock('room:' . $room, static function () use ($room): array {
    return storage_lock('usage:' . $room, static function () use ($room): array {
    $d = usage_read($room, room_reg_get($room));
    $active = 0;
    foreach ($d['clients'] as $who => $c) {
      if ((int)($c['lastAt'] ?? 0) + 90 < time()) { unset($d['clients'][$who]); continue; }
      $active += (int)($c['activeSessions'] ?? 0);
    }
    $rate = (float)config_string('ESTIMATED_AUDIO_COST_PER_MINUTE', '0');
    return ['issuedLiveTokens' => (int)$d['issuedLiveTokens'], 'textRequests' => (int)$d['textRequests'],
      'failedRequests' => (int)$d['failedRequests'], 'providerInputTokens' => (int)$d['providerInputTokens'],
      'providerOutputTokens' => (int)$d['providerOutputTokens'], 'clientInputSeconds' => round((float)$d['clientInputSeconds'], 2),
      'clientSessionSeconds' => round((float)$d['clientSessionSeconds'], 2), 'activeSessionsReported' => $active,
      'estimatedCost' => $rate > 0 ? round((float)$d['clientInputSeconds'] / 60 * $rate, 4) : null,
      'estimatedCostCurrency' => config_string('ESTIMATED_COST_CURRENCY', 'USD'),
      'costBasis' => 'operator-supplied rate multiplied by client-reported input audio; excludes output audio and text',
      'billingVerified' => false, 'providerQuotaAvailable' => false,
      'audioProvider' => config_string('TRANSLATION_PROVIDER', 'none'), 'textProvider' => config_string('TEXT_PROVIDER', 'none')];
    });
  });
}
function sweep_usage(): void {
  foreach (glob(PRIV . '/usage/*.json') ?: [] as $path) {
    $room = basename($path, '.json'); if (!room_id_ok($room)) continue;
    storage_lock('room:' . $room, static function () use ($room): void {
      storage_lock('usage:' . $room, static function () use ($room): void { usage_read($room, room_reg_get($room)); });
    });
  }
}
function text_provider_ready(): bool {
  return in_array(config_string('TEXT_PROVIDER', 'none'), ['gemini', 'openai-compatible'], true)
    && config_string('TEXT_MODEL') !== '' && config_string('TEXT_API_KEY') !== '';
}
function text_generate(string $room, string $instruction, string $input, bool $structured = false): string {
  if (!text_provider_ready()) fail('feature_disabled', 503);
  if (!rate('text-room:' . $room, config_int('AI_REQUESTS_PER_ROOM_HOUR', 180, 1, 10000), 3600)
    || !rate('text-global', config_int('AI_REQUESTS_PER_HOUR', 1000, 1, 100000), 3600)) fail('ai_limit', 429);
  $provider = config_string('TEXT_PROVIDER'); $model = config_string('TEXT_MODEL'); $key = config_string('TEXT_API_KEY'); $max = $structured ? 4000 : 1400;
  usage_edit($room, static function (array &$d): void { $d['textRequests']++; });
  if ($provider === 'gemini') {
    if (!preg_match('/^(?:models\/)?[A-Za-z0-9._-]{1,160}$/D', $model)) fail('provider_config', 503);
    $model = preg_replace('#^models/#', '', $model); $config = ['temperature' => 0.1, 'maxOutputTokens' => $max];
    if ($structured) $config['responseMimeType'] = 'application/json';
    [$status, $j] = http_json('POST', 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent',
      ['systemInstruction' => ['parts' => [['text' => $instruction]]], 'contents' => [['role' => 'user', 'parts' => [['text' => $input]]]], 'generationConfig' => $config], ['x-goog-api-key: ' . $key]);
    $output = ''; foreach ($j['candidates'][0]['content']['parts'] ?? [] as $p) if (isset($p['text']) && empty($p['thought'])) $output .= (string)$p['text'];
    $inTokens = (int)($j['usageMetadata']['promptTokenCount'] ?? 0); $outTokens = (int)($j['usageMetadata']['candidatesTokenCount'] ?? 0);
  } else {
    $base = rtrim(config_string('TEXT_BASE_URL'), '/'); if ($base === '') fail('provider_config', 503);
    $request = ['model' => $model, 'messages' => [['role' => 'system', 'content' => $instruction], ['role' => 'user', 'content' => $input]], 'temperature' => 0.1, 'max_tokens' => $max, 'stream' => false];
    if ($structured && config_bool('TEXT_JSON_MODE', true)) $request['response_format'] = ['type' => 'json_object'];
    [$status, $j] = http_json('POST', $base . '/chat/completions', $request, ['Authorization: Bearer ' . $key]);
    $output = (string)($j['choices'][0]['message']['content'] ?? ''); $inTokens = (int)($j['usage']['prompt_tokens'] ?? 0); $outTokens = (int)($j['usage']['completion_tokens'] ?? 0);
  }
  usage_edit($room, static function (array &$d) use ($status, $inTokens, $outTokens, $output): void {
    $d['providerInputTokens'] += max(0, $inTokens); $d['providerOutputTokens'] += max(0, $outTokens);
    if ($status !== 200 || $output === '') $d['failedRequests']++;
  });
  if ($status !== 200 || $output === '') fail($status === 429 ? 'provider_quota' : 'provider_unavailable', $status === 429 ? 429 : 502);
  if (strlen($output) > 40000) fail('provider_response', 502);
  return trim($output);
}
