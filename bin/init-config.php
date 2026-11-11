#!/usr/bin/env php
<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
if (isset($argv[1])) putenv('MEET_PRIVATE_DIR=' . $argv[1]);
$previousMask = umask(0077);
try {
    require_once dirname(__DIR__) . '/api/_config.php';
    if (!is_dir(PRIV) && !mkdir(PRIV, 0700, true)) throw new RuntimeException('Cannot create private directory.');
    if (!is_writable(PRIV)) throw new RuntimeException('Private directory is not writable.');
    $file = PRIV . '/.env';
    $handle = @fopen($file, 'x');
    if (!$handle) throw new RuntimeException('Configuration already exists or cannot be created; no file was overwritten.');
    $template = (string)file_get_contents(dirname(__DIR__) . '/env.template');
    $contents = str_replace("APP_SECRET=\n", 'APP_SECRET=' . bin2hex(random_bytes(32)) . "\n", $template);
    if (fwrite($handle, $contents) !== strlen($contents)) { fclose($handle); unlink($file); throw new RuntimeException('Cannot write configuration.'); }
    fclose($handle);
    chmod($file, 0600);
    echo "Created a private configuration with a random signing key.\n";
    echo "Set APP_URL and LiveKit credentials in the private .env, then run bin/set-admin.php and bin/check-config.php.\n";
    echo "Set MEET_PRIVATE_DIR to the same absolute directory in your web server environment.\n";
} catch (Throwable $error) {
    fwrite(STDERR, 'Setup failed: ' . $error->getMessage() . "\n");
    exit(1);
} finally {
    umask($previousMask);
}
