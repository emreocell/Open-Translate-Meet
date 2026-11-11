<?php
declare(strict_types=1);

/** Bounded, non-redirecting JSON transport. Callers own authentication and provider-specific validation. */
function http_json(string $method, string $url, ?array $json = null, array $headers = [], ?array $form = null, int $timeout = 25): array {
  if (defined('MEET_TEST_MODE') && isset($GLOBALS['meet_http_transport'])) return ($GLOBALS['meet_http_transport'])($method, $url, $json, $headers, $form);
  $parts = parse_url($url); $local = in_array($parts['host'] ?? '', ['localhost', '127.0.0.1', '[::1]'], true);
  if (!is_array($parts) || !empty($parts['user']) || !empty($parts['pass']) || isset($parts['fragment'])
    || (($parts['scheme'] ?? '') !== 'https' && !(($parts['scheme'] ?? '') === 'http' && $local))) fail('provider_config', 503);
  if (!function_exists('curl_init')) fail('provider_config', 503);
  $ch = curl_init($url); $raw = ''; $large = false;
  $options = [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => $timeout, CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS, CURLOPT_HTTPHEADER => $headers,
    CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$raw, &$large): int {
      if (strlen($raw) + strlen($chunk) > 2 * 1024 * 1024) { $large = true; return 0; }
      $raw .= $chunk; return strlen($chunk);
    }];
  if ($json !== null) { $options[CURLOPT_POSTFIELDS] = json_encode($json, JSON_THROW_ON_ERROR); $options[CURLOPT_HTTPHEADER][] = 'Content-Type: application/json'; }
  if ($form !== null) { $options[CURLOPT_POSTFIELDS] = http_build_query($form); $options[CURLOPT_HTTPHEADER][] = 'Content-Type: application/x-www-form-urlencoded'; }
  curl_setopt_array($ch, $options); $ok = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  $decoded = json_decode($raw, true);
  return [$ok === false || $large ? 0 : $status, is_array($decoded) ? $decoded : []];
}
