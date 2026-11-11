<?php
declare(strict_types=1);
/* Local PHP development server only; production uses Apache/Nginx policies. */
$path = rawurldecode((string)(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/'));
$denied = str_contains($path, "\0") || str_contains($path, '\\')
    || preg_match('#(?:^|/)\.#', $path)
    || preg_match('#^/(?:vendor|node_modules|bin|tests|docs|deploy|integrations|design|LICENSES)(?:/|$)#', $path)
    || str_starts_with($path, '/api/_')
    || preg_match('#^/(?:composer\.(?:json|lock)|package(?:-lock)?\.json|env\.template|Dockerfile|compose\.yaml|LICENSE|NOTICE)$#', $path)
    || preg_match('/\.(?:md|ya?ml)$/i', $path);
if ($denied) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Forbidden\n";
    return true;
}
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
return false;
