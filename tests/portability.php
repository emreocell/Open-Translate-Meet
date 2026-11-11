<?php
declare(strict_types=1);
/** Security-sensitive configuration boundaries; no provider calls or real state. */
$temporary = sys_get_temp_dir() . '/meet-config-test-' . bin2hex(random_bytes(8));
mkdir($temporary, 0700);
file_put_contents($temporary . '/.env', "APP_URL=https://meet.example.test\nAPP_NAME='Private deployment'\nAPP_SECRET=never-expose-this-test-value-1234567890\nGEMINI_API_KEY=never-expose-this-provider-value\nTEST_INTEGER=9\nTEST_BAD_INTEGER=9oops\nTEST_TRUE=yes\nTEST_BAD_BOOL=perhaps\n");
putenv('MEET_PRIVATE_DIR=' . $temporary);
putenv('APP_NAME=Environment deployment');
$checks = 0;
function verify(bool $condition, string $message): void { global $checks; if (!$condition) throw new RuntimeException($message); $checks++; }
function denied(callable $function, string $message): void { try { $function(); } catch (RuntimeException) { verify(true, $message); return; } verify(false, $message); }
try {
    require dirname(__DIR__) . '/api/_config.php';
    verify(PRIV === $temporary, 'Explicit private storage');
    denied(static fn() => config_path('/'), 'Filesystem root cannot be private storage');
    verify(PUBLIC_ORIGIN === 'https://meet.example.test', 'Origin is configured, not derived from Host');
    verify(app_name() === 'Environment deployment', 'Environment override');
    verify(config_int('TEST_INTEGER', 0, 1, 10) === 9, 'Bounded integer accepted');
    denied(static fn() => config_int('TEST_BAD_INTEGER', 0, 1, 10), 'Malformed integer denied');
    denied(static fn() => config_int('TEST_INTEGER', 0, 1, 8), 'Out of range integer denied');
    verify(config_bool('TEST_TRUE'), 'Boolean parsed');
    denied(static fn() => config_bool('TEST_BAD_BOOL'), 'Ambiguous boolean denied');
    foreach (['http://meet.example.test', 'https://user:pass@meet.example.test', 'https://meet.example.test/path', 'https://meet.example.test?x=y', 'javascript:alert(1)', 'https://meet.example.test/#secret'] as $bad) denied(static fn() => config_origin($bad), 'Unsafe origin rejected');
    verify(config_origin('http://localhost:8080/') === 'http://localhost:8080', 'Local development origin');
    verify(config_parse_env("# a comment\nVALUE='literal $(echo nope)'\nCOLOR=#123456\n") === ['VALUE' => 'literal $(echo nope)', 'COLOR' => '#123456'], 'No shell evaluation or hex-color comment truncation');
    denied(static fn() => config_parse_env("BROKEN\n"), 'Broken env line rejected');
    denied(static fn() => config_parse_env("BROKEN='unclosed\n"), 'Unclosed env quote rejected');
    $public = json_encode(public_config(), JSON_THROW_ON_ERROR);
    verify(!str_contains($public, 'never-expose-') && !str_contains($public, $temporary), 'Public allowlist excludes secrets and private paths');
    verify(!public_config()['features']['translation'] && !public_config()['features']['transcripts'] && !public_config()['features']['booking'], 'Optional features default off');
    verify(count(UI_LANGS) === 12, 'All interface catalogs supported');
    $source = json_decode((string)file_get_contents(APP_ROOT . '/assets/i18n/en.json'), true);
    foreach (UI_LANGS as $language) {
        $catalog = json_decode((string)file_get_contents(APP_ROOT . '/assets/i18n/' . $language . '.json'), true);
        verify(is_array($catalog) && !array_diff_key($catalog, $source) && !array_diff_key($source, $catalog), 'Base catalog parity: ' . $language);
    }
    foreach (['meeting', 'admin', 'privacy'] as $section) {
        $source = json_decode((string)file_get_contents(APP_ROOT . '/assets/i18n/' . $section . '/en.json'), true, 512, JSON_THROW_ON_ERROR);
        foreach (UI_LANGS as $language) {
            $catalog = json_decode((string)file_get_contents(APP_ROOT . '/assets/i18n/' . $section . '/' . $language . '.json'), true, 512, JSON_THROW_ON_ERROR);
            verify(is_array($catalog) && !array_diff_key($catalog, $source) && !array_diff_key($source, $catalog), ucfirst($section) . ' catalog parity: ' . $language);
            foreach ($source as $key => $text) {
                preg_match_all('/\{[A-Za-z_][A-Za-z_0-9]*\}/', $text, $expected);
                preg_match_all('/\{[A-Za-z_][A-Za-z_0-9]*\}/', $catalog[$key], $actual);
                sort($expected[0]); sort($actual[0]);
                if ($expected[0] !== $actual[0]) throw new RuntimeException('Locale placeholders differ: ' . $section . '/' . $language . '/' . $key);
            }
        }
    }
    echo "Portability: $checks checks passed.\n";
} finally {
    unlink($temporary . '/.env'); rmdir($temporary);
}
