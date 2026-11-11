<?php
declare(strict_types=1);

/* Configuration has no dependency on a web server, provider SDK or database. */
define('APP_ROOT', dirname(__DIR__));
define('UI_LANGS', ['tr', 'en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'ru', 'ar', 'ja']);

function config_path(string $path): string {
    $path = str_replace('\\', '/', $path);
    if (!str_starts_with($path, '/') && !preg_match('/^[A-Za-z]:\//', $path)) {
        throw new RuntimeException('MEET_PRIVATE_DIR must be an absolute path.');
    }
    $prefix = str_starts_with($path, '/') ? '/' : substr($path, 0, 3);
    $parts = [];
    foreach (explode('/', substr($path, strlen($prefix))) as $part) {
        if ($part === '' || $part === '.') continue;
        if ($part === '..') { array_pop($parts); continue; }
        if (str_contains($part, "\0")) throw new RuntimeException('Invalid private directory.');
        $parts[] = $part;
    }
    $normalized = $prefix . implode('/', $parts);
    $existing = $normalized;
    $suffix = [];
    while (!is_dir($existing) && dirname($existing) !== $existing) {
        array_unshift($suffix, basename($existing));
        $existing = dirname($existing);
    }
    $canonical = realpath($existing);
    $resolved = $canonical === false ? $normalized : rtrim(str_replace('\\', '/', $canonical), '/') . ($suffix ? '/' . implode('/', $suffix) : '');
    if ($resolved === '' || $resolved === '/' || preg_match('/^[A-Za-z]:\/?$/', $resolved)) {
        throw new RuntimeException('MEET_PRIVATE_DIR must be a dedicated directory, not a filesystem root.');
    }
    return $resolved;
}

$privateDir = config_path((string)(getenv('MEET_PRIVATE_DIR') ?: dirname(APP_ROOT) . '/meet-private'));
$appRoot = rtrim(str_replace('\\', '/', (string)(realpath(APP_ROOT) ?: APP_ROOT)), '/');
$documentRoot = empty($_SERVER['DOCUMENT_ROOT']) ? '' : rtrim(str_replace('\\', '/', (string)(realpath($_SERVER['DOCUMENT_ROOT']) ?: '')), '/');
foreach (array_filter([$appRoot, $documentRoot]) as $publicDir) {
    if ($privateDir === $publicDir || str_starts_with($privateDir . '/', $publicDir . '/')) {
        throw new RuntimeException('MEET_PRIVATE_DIR must be outside the public document root.');
    }
}
define('PRIV', $privateDir);
unset($privateDir, $appRoot, $documentRoot, $publicDir);

/** Literal KEY=value parsing only: no shell expansion, includes or interpolation. */
function config_parse_env(string $text): array {
    $result = [];
    foreach (preg_split('/\r?\n/', ltrim($text, "\xEF\xBB\xBF")) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) continue;
        if (!preg_match('/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/', $line, $match)) {
            throw new RuntimeException('Invalid .env line; expected KEY=value.');
        }
        $value = trim($match[2]);
        if ($value !== '' && ($value[0] === '"' || $value[0] === "'")) {
            $quote = $value[0];
            if (strlen($value) < 2 || substr($value, -1) !== $quote) {
                throw new RuntimeException('Unclosed quoted value in .env.');
            }
            $value = substr($value, 1, -1);
        }
        $result[$match[1]] = $value;
    }
    return $result;
}

function env(): array {
    static $values = null;
    if ($values !== null) return $values;
    $path = PRIV . '/.env';
    if (is_file($path) && !is_readable($path)) throw new RuntimeException('Private configuration is not readable.');
    $values = is_file($path) ? config_parse_env((string)file_get_contents($path)) : [];
    // Deployment environment wins over the optional private file, including an empty value.
    foreach (getenv() ?: [] as $name => $value) {
        if (preg_match('/^[A-Z][A-Z0-9_]*$/', (string)$name)) $values[$name] = (string)$value;
    }
    return $values;
}

function cfg(): array {
    static $values = null;
    if ($values !== null) return $values;
    $path = PRIV . '/config.json';
    if (!is_file($path)) return $values = [];
    $json = file_get_contents($path);
    $values = $json === false ? null : json_decode($json, true);
    if (!is_array($values) || array_is_list($values) && $values !== []) {
        throw new RuntimeException('Private config.json must contain a JSON object.');
    }
    return $values;
}

function config_string(string $key, string $default = ''): string {
    return (string)(env()[$key] ?? $default);
}

function config_int(string $key, int $default, int $min, int $max): int {
    $raw = config_string($key);
    if ($raw === '') return $default;
    $value = filter_var($raw, FILTER_VALIDATE_INT);
    if ($value === false || $value < $min || $value > $max) {
        throw new RuntimeException('Invalid numeric configuration: ' . $key);
    }
    return $value;
}

function config_bool(string $key, bool $default = false): bool {
    $raw = config_string($key);
    if ($raw === '') return $default;
    $value = filter_var($raw, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
    if ($value === null) throw new RuntimeException('Invalid boolean configuration: ' . $key);
    return $value;
}

function config_origin(string $url): string {
    $parts = parse_url($url);
    if (!is_array($parts) || empty($parts['host']) || isset($parts['user'], $parts['pass']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment']) || !in_array($parts['path'] ?? '', ['', '/'], true)) {
        throw new RuntimeException('APP_URL must be an absolute origin without a path or credentials.');
    }
    $scheme = strtolower((string)($parts['scheme'] ?? ''));
    $host = strtolower((string)$parts['host']);
    $local = in_array($host, ['localhost', '127.0.0.1', '[::1]'], true);
    if ($scheme !== 'https' && !($scheme === 'http' && $local)) {
        throw new RuntimeException('APP_URL requires HTTPS except on localhost.');
    }
    if (!preg_match('/^(?:[a-z0-9.-]+|\[::1\])$/', $host)) throw new RuntimeException('Invalid APP_URL host.');
    return $scheme . '://' . $host . (isset($parts['port']) ? ':' . $parts['port'] : '');
}

define('PUBLIC_ORIGIN', config_origin(config_string('APP_URL', 'http://localhost:8080')));
define('MAX_PARTICIPANTS', config_int('MAX_PARTICIPANTS', 8, 2, 64));
$languages = array_values(array_unique(array_filter(array_map('trim', explode(',', config_string('TRANSLATION_LANGUAGES', implode(',', UI_LANGS)))))));
if (!$languages || count($languages) > 100) throw new RuntimeException('Invalid TRANSLATION_LANGUAGES.');
foreach ($languages as $language) {
    if (!preg_match('/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/', $language)) throw new RuntimeException('Invalid translation language code.');
}
define('LANGS', $languages);
unset($languages, $language);

function app_name(): string {
    $name = trim(config_string('APP_NAME', 'Auto Translate Meeting'));
    return $name !== '' ? mb_substr($name, 0, 80) : 'Auto Translate Meeting';
}

function config_public_url(string $key, string $default = ''): string {
    $value = trim(config_string($key, $default));
    if ($value === '') return '';
    if (preg_match('#^(?:\./)?assets/[A-Za-z0-9_./-]+$#', $value) && !str_contains($value, '..')) return $value;
    if (str_starts_with($value, '/') && !str_starts_with($value, '//') && !str_contains($value, '\\') && !str_contains($value, '..') && !preg_match('/[\x00-\x20]/', $value)) return $value;
    $parts = parse_url($value);
    if (is_array($parts) && ($parts['scheme'] ?? '') === 'https' && !empty($parts['host']) && !isset($parts['user']) && !isset($parts['pass']) && !preg_match('/[\x00-\x20]/', $value)) return $value;
    throw new RuntimeException('Invalid public URL configuration: ' . $key);
}

function translation_configured(): bool {
    if (config_string('TRANSLATION_PROVIDER', 'none') !== 'gemini' || config_string('GEMINI_MODEL') === '') return false;
    if (config_string('GEMINI_API_KEY') !== '') return true;
    for ($i = 1; $i <= 8; $i++) if (config_string('GEMINI_KEY_' . $i) !== '') return true;
    return false;
}

/** An explicit allowlist. Never return env(), cfg(), credentials or private paths. */
function public_config(): array {
    $locale = config_string('DEFAULT_LOCALE', 'en');
    if (!in_array($locale, UI_LANGS, true)) $locale = 'en';
    $accent = config_string('BRAND_ACCENT', '#7ea6ff');
    if (!preg_match('/^#[a-fA-F0-9]{6}$/', $accent)) throw new RuntimeException('BRAND_ACCENT must be a six-digit hex color.');
    $theme = config_string('DEFAULT_THEME', 'auto');
    if (!in_array($theme, ['auto', 'dark', 'light'], true)) throw new RuntimeException('Invalid DEFAULT_THEME.');
    $text = config_string('TEXT_PROVIDER', 'none');
    $textReady = in_array($text, ['gemini', 'openai-compatible'], true) && config_string('TEXT_MODEL') !== '' && config_string('TEXT_API_KEY') !== '';
    return [
        'app' => ['name' => app_name(), 'url' => PUBLIC_ORIGIN, 'defaultLocale' => $locale, 'defaultTheme' => $theme,
            'logo' => config_public_url('BRAND_LOGO', 'assets/brand/mark.svg'),
            'favicon' => config_public_url('BRAND_FAVICON', 'assets/brand/mark.svg'), 'accent' => $accent,
            'contactEmail' => filter_var(config_string('CONTACT_EMAIL'), FILTER_VALIDATE_EMAIL) ?: '',
            'contactPhone' => preg_match('/^[+0-9 ().-]{3,40}$/', config_string('CONTACT_PHONE')) ? config_string('CONTACT_PHONE') : '',
            'website' => config_public_url('CONTACT_WEBSITE'), 'sourceUrl' => config_public_url('SOURCE_URL', 'https://github.com/emreocell/Open-Translate-Meet')],
        'features' => ['booking' => config_bool('BOOKING_ENABLED'), 'translation' => translation_configured(),
            'chatTranslation' => $textReady, 'transcripts' => config_bool('TRANSCRIPT_ENABLED'), 'summary' => config_bool('TRANSCRIPT_ENABLED') && $textReady],
        'translation' => ['enabled' => translation_configured(), 'provider' => config_string('TRANSLATION_PROVIDER', 'none'),
            'model' => config_string('GEMINI_MODEL'), 'languages' => LANGS,
            'maxSessions' => config_int('TRANSLATION_MAX_SESSIONS', 3, 1, 8)],
        'uiLanguages' => UI_LANGS,
        'limits' => ['maxParticipants' => MAX_PARTICIPANTS, 'fileRetentionHours' => config_int('FILE_TTL', 86400, 300, 604800) / 3600,
            'transcriptRetentionHours' => config_int('TRANSCRIPT_RETENTION_HOURS', 24, 1, 720),
            'usageRetentionDays' => config_int('USAGE_RETENTION_DAYS', 30, 1, 365),
            'bookingPendingHours' => config_int('BOOKING_PENDING_HOURS', 48, 1, 720),
            'bookingRetentionDays' => config_int('BOOKING_RETENTION_DAYS', 120, 7, 365)],
        'privacyUrl' => 'privacy/',
    ];
}
