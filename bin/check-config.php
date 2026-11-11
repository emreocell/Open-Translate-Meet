#!/usr/bin/env php
<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$failed = 0;
function check(bool $ok, string $label): void {
    global $failed;
    echo ($ok ? '[OK] ' : '[FAIL] ') . $label . "\n";
    if (!$ok) $failed++;
}
check(PHP_VERSION_ID >= 80200, 'PHP 8.2 or newer');
foreach (['curl', 'fileinfo', 'filter', 'gd', 'json', 'mbstring', 'openssl', 'session'] as $extension) check(extension_loaded($extension), 'Extension: ' . $extension);
if ($failed) exit(1);
try {
    require_once dirname(__DIR__) . '/api/_config.php';
    check(is_dir(PRIV) && is_writable(PRIV), 'Private storage exists and is writable');
    check(strlen(config_string('APP_SECRET')) >= 32, 'Application signing key is configured');
    $hash = config_string('ADMIN_PASSWORD_HASH');
    if ($hash === '' && is_readable(PRIV . '/admin.json')) $hash = (string)(json_decode((string)file_get_contents(PRIV . '/admin.json'), true)['passwordHash'] ?? '');
    check($hash !== '' && (password_get_info($hash)['algoName'] ?? 'unknown') !== 'unknown', 'Administrator password hash is configured');
    $parts = parse_url(config_string('LIVEKIT_URL'));
    $local = in_array(strtolower((string)($parts['host'] ?? '')), ['localhost', '127.0.0.1', '[::1]'], true);
    check(is_array($parts) && !empty($parts['host']) && (($parts['scheme'] ?? '') === 'wss' || $local && ($parts['scheme'] ?? '') === 'ws'), 'LiveKit WebSocket URL uses wss (or ws on localhost)');
    check(config_string('LIVEKIT_API_KEY') !== '' && strlen(config_string('LIVEKIT_API_SECRET')) >= 32, 'LiveKit credentials are configured');
    check(is_file(dirname(__DIR__) . '/vendor/autoload.php'), 'Composer dependencies are installed');
    $speech = config_string('TRANSLATION_PROVIDER', 'none');
    check(in_array($speech, ['none', 'gemini'], true), 'Speech provider adapter is supported');
    if ($speech !== 'none') check(translation_configured(), 'Live translation has an explicit model and API key');
    $text = config_string('TEXT_PROVIDER', 'none');
    check(in_array($text, ['none', 'gemini', 'openai-compatible'], true), 'Text provider adapter is supported');
    if ($text !== 'none') check(config_string('TEXT_MODEL') !== '' && config_string('TEXT_API_KEY') !== '', 'Text provider has an explicit model and API key');
    if ($text === 'openai-compatible') {
        $base = parse_url(config_string('TEXT_BASE_URL'));
        check(is_array($base) && ($base['scheme'] ?? '') === 'https' && !empty($base['host']) && !isset($base['user']) && !isset($base['pass']) && !isset($base['query']) && !isset($base['fragment']), 'Compatible text API has an HTTPS base URL without credentials or query');
    }
    if (config_bool('BOOKING_ENABLED')) {
        check(in_array(config_string('BOOKING_CALENDAR_PROVIDER', 'none'), ['none', 'google'], true), 'Booking calendar adapter is supported');
        try { new DateTimeZone(config_string('BOOKING_TIMEZONE', 'UTC')); $tzOk = true; } catch (Throwable $error) { $tzOk = false; }
        check($tzOk, 'Booking timezone is valid');
        if (config_string('BOOKING_CALENDAR_PROVIDER', 'none') === 'google') check((is_file(PRIV . '/google-oauth.json') || config_string('GOOGLE_CLIENT_ID') !== '' && config_string('GOOGLE_CLIENT_SECRET') !== '') && is_file(PRIV . '/google-token.json'), 'Google Calendar authorization is configured');
    }
    public_config();
    echo "This command checks local setup only; it does not connect to providers or verify credentials.\n";
    echo "Run a two-browser meeting and the deployment smoke checks before accepting real users.\n";
} catch (Throwable $error) { check(false, $error->getMessage()); }
exit($failed ? 1 : 0);
