<?php
declare(strict_types=1);
/** A waiting ticket cannot authenticate to media, uploads, AI, or host APIs. */
function waiting_token(string $room, string $id, string $did, int $expires): string {
  return jwt_sign(['iss' => 'auto-translate-meeting', 'aud' => 'meet-waiting', 'room' => $room, 'id' => $id, 'did' => $did,
    'nbf' => time() - 2, 'exp' => $expires], app_secret());
}
function waiting_claims(string $raw, string $room, string $did): ?array {
  $c = jwt_verify($raw, app_secret());
  if ($c === null || ($c['iss'] ?? '') !== 'auto-translate-meeting' || ($c['aud'] ?? '') !== 'meet-waiting'
    || ($c['room'] ?? '') !== $room || ($c['did'] ?? '') !== $did || !preg_match('/^[a-f0-9]{24}$/D', (string)($c['id'] ?? ''))) return null;
  return $c;
}
function waiting_public(array $reg): array {
  $result = [];
  foreach ((array)($reg['waiting'] ?? []) as $id => $w) {
    if (($w['status'] ?? '') !== 'pending' || (int)($w['expires'] ?? 0) <= time()) continue;
    $result[] = ['id' => $id, 'name' => $w['name'], 'speak' => $w['speak'], 'hear' => $w['hear'], 'requestedAt' => $w['requestedAt']];
  }
  return $result;
}
