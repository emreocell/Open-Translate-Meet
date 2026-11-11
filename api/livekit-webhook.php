<?php
declare(strict_types=1);
require __DIR__ . '/_webhook.php';
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { header('Allow: POST'); fail('method', 405); }
$type = strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
if ($type !== 'application/webhook+json') fail('content_type', 415);
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 131072) fail('too_large', 413);
$raw = (string)file_get_contents('php://input', false, null, 0, 131073);
if (strlen($raw) > 131072) fail('too_large', 413);
$event = webhook_event($raw, (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? ''));
if (!rate('webhooks', config_int('WEBHOOK_REQUESTS_PER_HOUR', 10000, 100, 100000), 3600)) fail('rate', 429);
out(webhook_handle($event, hash('sha256', $raw)));
