#!/usr/bin/env php
<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/api/_lib.php';
if (config_string('ADMIN_PASSWORD_HASH') !== '') { fwrite(STDERR, "ADMIN_PASSWORD_HASH is set in the deployment environment. Update that hash or remove it before using this command.\n"); exit(1); }
fwrite(STDERR, "New administrator password (12+ characters; read from standard input): ");
$terminal = function_exists('stream_isatty') && stream_isatty(STDIN) && PHP_OS_FAMILY !== 'Windows';
if ($terminal) shell_exec('stty -echo');
try { $password = rtrim((string)fgets(STDIN, 4096), "\r\n"); } finally { if ($terminal) shell_exec('stty echo'); fwrite(STDERR, "\n"); }
if (strlen($password) < 12 || strlen($password) > 1024) { fwrite(STDERR, "Password must contain 12–1024 bytes.\n"); exit(1); }
storage_lock('admin-credentials', static function () use ($password): void {
  private_json_write(PRIV . '/admin.json', ['passwordHash' => password_hash($password, PASSWORD_DEFAULT), 'updatedAt' => time()]);
});
fwrite(STDOUT, "Administrator password saved. Existing administrator sessions will be invalidated.\n");
