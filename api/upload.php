<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';
require __DIR__ . '/_media.php';
require_post();
$tk = ticket(); $room = $tk['room']; $who = $tk['who']; $act = (string)($_GET['a'] ?? '');
if (!in_array($act, ['init', 'chunk', 'finish', 'cancel'], true)) fail('bad_action');
if (!rate('upload-request:' . $who, 600, 3600)) fail('rate', 429);
sweep_uploads();
if ($act === 'init') {
  if (!rate('up:' . $who, 40, 3600) || !rate('uproom:' . $room, 300, 3600)) fail('rate', 429);
  $in = body(); $type = (string)($in['type'] ?? ''); $size = (int)($in['size'] ?? 0);
  if (!isset(ALLOWED_TYPES[$type])) fail('bad_type', 415);
  $kind = ALLOWED_TYPES[$type];
  if ($size < 1) fail('empty');
  if ($size > ($kind === 'image' ? MAX_IMAGE : MAX_VIDEO)) fail('too_large', 413, ['kind' => $kind]);
  if ($kind === 'image' && !function_exists('imagecreatefromjpeg')) fail('media_processing_unavailable', 503);
  if ($kind === 'video' && !function_exists('proc_open')) fail('media_processing_unavailable', 503);
  $result = storage_lock('room:' . $room, static function () use ($room, $who, $type, $size, $kind, $in): array {
    ticket(); room_require_open($room);
    return storage_lock('uploads', static function () use ($room, $who, $type, $size, $kind, $in): array {
      private_dir(UPLOAD_DIR); private_dir(UPLOAD_DIR . '/' . $room);
      $reserved = $size * 2 + 262144; // Input + sanitized output + bounded metadata.
      $free = disk_free_space(PRIV);
      if ($free === false || $free < $reserved + meet_int_env('UPLOAD_MIN_FREE_BYTES', 256 * 1024 * 1024, 0, 10 * 1024 * 1024 * 1024)) fail('disk', 507);
      if (upload_reserved(UPLOAD_DIR . '/' . $room) + $reserved > ROOM_QUOTA || upload_reserved(UPLOAD_DIR) + $reserved > UPLOAD_TOTAL_QUOTA) fail('quota', 507);
      $id = bin2hex(random_bytes(8)); $dir = UPLOAD_DIR . "/$room/$id.part"; private_dir($dir);
      $chunks = (int)ceil($size / CHUNK_SIZE);
      private_json_write($dir . '/meta.json', ['owner' => $who, 'name' => safe_name((string)($in['name'] ?? '')), 'type' => $type,
        'kind' => $kind, 'size' => $size, 'reservedBytes' => $reserved, 'chunks' => $chunks, 'got' => 0, 'hashes' => [], 'created' => time()]);
      return ['id' => $id, 'chunk' => CHUNK_SIZE, 'chunks' => $chunks];
    });
  });
  out($result);
}
$in = $act === 'chunk' ? [] : body();
$id = (string)($_GET['id'] ?? $in['id'] ?? '');
if (!preg_match('/^[a-f0-9]{16}$/D', $id)) fail('bad_id');
$result = storage_lock('upload:' . $room . ':' . $id, static function () use ($room, $who, $act, $id): array {
  $dir = UPLOAD_DIR . "/$room/$id.part";
  $m = private_json_read($dir . '/meta.json');
  if (!is_array($m) || ($m['owner'] ?? '') !== $who) fail('not_found', 404);
  if (time() - (int)($m['created'] ?? 0) > 3600) { rm_tree($dir); fail('upload_expired', 410); }
  @touch($dir);
  if ($act === 'cancel') { rm_tree($dir); return ['ok' => true]; }
  if ($act === 'chunk') {
    $index = filter_var($_GET['i'] ?? null, FILTER_VALIDATE_INT);
    if ($index === false || $index < 0 || $index >= (int)$m['chunks'] || $index > (int)$m['got']) fail('bad_chunk', 409, ['expected' => (int)$m['got']]);
    $expected = min(CHUNK_SIZE, (int)$m['size'] - $index * CHUNK_SIZE);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > $expected) fail('bad_chunk');
    $raw = (string)file_get_contents('php://input', false, null, 0, $expected + 1);
    if (strlen($raw) !== $expected) fail('bad_chunk');
    $hash = hash('sha256', $raw);
    if ($index < (int)$m['got']) {
      if (!hash_equals((string)($m['hashes'][$index] ?? ''), $hash)) fail('bad_chunk', 409);
      return ['ok' => true, 'got' => $m['got'], 'duplicate' => true];
    }
    $path = $dir . '/data.part';
    if ((int)@filesize($path) !== $index * CHUNK_SIZE) { rm_tree($dir); fail('upload_corrupt', 409); }
    $fh = @fopen($path, 'ab'); if ($fh === false) fail('storage', 503);
    @chmod($path, 0600);
    try {
      $offset = 0;
      while ($offset < strlen($raw)) { $n = fwrite($fh, substr($raw, $offset)); if ($n === false || $n === 0) fail('storage', 503); $offset += $n; }
      if (!fflush($fh)) fail('storage', 503);
    } finally { fclose($fh); }
    $m['got'] = $index + 1; $m['hashes'][$index] = $hash; private_json_write($dir . '/meta.json', $m);
    return ['ok' => true, 'got' => $m['got']];
  }
  if ((int)$m['got'] !== (int)$m['chunks'] || (int)@filesize($dir . '/data.part') !== (int)$m['size']) fail('incomplete');
  $src = $dir . '/data.part'; $outPath = $dir . '/data';
  try {
    $dimensions = media_slot(static function () use ($m, $src, $outPath): array {
      $fi = new finfo(FILEINFO_MIME_TYPE); $real = (string)$fi->file($src);
      $head = (string)file_get_contents($src, false, null, 0, 16);
      if ($m['kind'] === 'image') {
        if ($real !== $m['type']) fail('content_mismatch', 422);
        $info = @getimagesize($src); if (!$info) fail('media_invalid', 422);
        [$w, $h] = $info;
        $pixels = meet_int_env('MAX_IMAGE_PIXELS', 16000000, 10000, 24000000);
        if ($w < 1 || $h < 1 || $w > 16000 || $h > 16000 || $w * $h > $pixels) fail('image_dimensions', 422);
        $im = match ($m['type']) { 'image/jpeg' => @imagecreatefromjpeg($src), 'image/png' => @imagecreatefrompng($src), 'image/webp' => @imagecreatefromwebp($src), default => false };
        if (!$im) fail('media_invalid', 422);
        try {
          if ($m['type'] === 'image/jpeg' && function_exists('exif_read_data')) {
            $ex = @exif_read_data($src); $rot = [3 => 180, 6 => -90, 8 => 90][(int)($ex['Orientation'] ?? 1)] ?? 0;
            if ($rot) { $r = imagerotate($im, $rot, 0); if ($r) { imagedestroy($im); $im = $r; } }
            $w = imagesx($im); $h = imagesy($im);
          }
          $ok = match ($m['type']) {
            'image/jpeg' => imagejpeg($im, $outPath, 90),
            'image/png' => (static function () use ($im, $outPath): bool { imagesavealpha($im, true); return imagepng($im, $outPath, 6); })(),
            'image/webp' => imagewebp($im, $outPath, 90),
          };
          if (!$ok) fail('media_invalid', 422);
        } finally { imagedestroy($im); }
        return ['w' => $w, 'h' => $h, 'duration' => 0];
      }
      $mp4 = $m['type'] === 'video/mp4';
      if (($mp4 && substr($head, 4, 4) !== 'ftyp') || (!$mp4 && substr($head, 0, 4) !== "\x1A\x45\xDF\xA3")) fail('content_mismatch', 422);
      $demux = $mp4 ? 'mov' : 'matroska';
      $args = [config_string('FFPROBE_BIN', 'ffprobe'), '-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file', '-f', $demux];
      if ($mp4) array_push($args, '-enable_drefs', '0', '-use_absolute_path', '0');
      array_push($args, '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', $src);
      $pr = media_process($args, 30); $probe = json_decode($pr['output'], true);
      if ($pr['code'] !== 0 || !is_array($probe)) fail('media_invalid', 422);
      $vs = null; foreach ($probe['streams'] ?? [] as $stream) if (($stream['codec_type'] ?? '') === 'video') { $vs = $stream; break; }
      $duration = (float)($probe['format']['duration'] ?? 0); $w = (int)($vs['width'] ?? 0); $h = (int)($vs['height'] ?? 0);
      if (!$vs || !is_finite($duration) || $duration <= 0 || $duration > 7200 || $w < 1 || $h < 1 || $w > 7680 || $h > 7680 || $w * $h > 34000000) fail('media_invalid', 422);
      $args = [config_string('FFMPEG_BIN', 'ffmpeg'), '-v', 'error', '-nostdin', '-y', '-max_alloc', '67108864', '-protocol_whitelist', 'file', '-f', $demux];
      if ($mp4) array_push($args, '-enable_drefs', '0', '-use_absolute_path', '0');
      array_push($args, '-i', $src, '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy', '-threads', '1', '-t', '7200', '-fs', (string)MAX_VIDEO, '-f', $mp4 ? 'mp4' : 'webm');
      if ($mp4) array_push($args, '-movflags', '+faststart');
      $args[] = $outPath;
      $pr = media_process($args, 90);
      if ($pr['code'] !== 0 || !is_file($outPath) || filesize($outPath) < 128) fail('media_invalid', 422);
      return ['w' => $w, 'h' => $h, 'duration' => round($duration, 1)];
    });
    clearstatcache(true, $outPath); $size = (int)@filesize($outPath);
    if ($size < 1 || $size > ($m['kind'] === 'image' ? MAX_IMAGE : MAX_VIDEO)) fail('too_large', 413);
    return storage_lock('room:' . $room, static function () use ($room, $who, $dir, $src, $outPath, $m, $size, $dimensions): array {
      ticket(); room_require_open($room);
      return storage_lock('uploads', static function () use ($room, $who, $dir, $src, $outPath, $m, $size, $dimensions): array {
        $fid = bin2hex(random_bytes(8)); $created = time(); $exp = $created + FILE_TTL;
        @chmod($outPath, 0600);
        $meta = ['name' => $m['name'], 'type' => $m['type'], 'kind' => $m['kind'], 'size' => $size,
          'owner' => $who, 'created' => $created, 'expiresAt' => $exp] + $dimensions;
        private_json_write($dir . '/meta.json', $meta);
        if (!@unlink($src) || !@rename($dir, UPLOAD_DIR . "/$room/$fid")) fail('storage', 503);
        return ['ok' => true, 'file' => ['id' => $fid, 'name' => $m['name'], 'type' => $m['type'], 'kind' => $m['kind'],
          'size' => $size, 'url' => file_url($room, $fid, $exp), 'exp' => $exp] + $dimensions];
      });
    });
  } catch (Throwable $e) {
    // Busy slots are retriable; malformed media and partial processing output are erased.
    if ($e instanceof MeetHttpError && $e->error === 'media_busy') throw $e;
    rm_tree($dir); throw $e;
  }
});
out($result);
