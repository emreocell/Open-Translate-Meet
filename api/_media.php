<?php
declare(strict_types=1);
/** Run an argument vector without a shell, with a hard wall deadline and bounded output. */
function media_process(array $args, int $timeout): array {
  if (!function_exists('proc_open')) fail('media_processing_unavailable', 503);
  $pipes = [];
  $proc = @proc_open($args, [['pipe', 'r'], ['pipe', 'w'], ['pipe', 'w']], $pipes, PRIV, []);
  if (!is_resource($proc)) fail('media_processing_unavailable', 503);
  fclose($pipes[0]); stream_set_blocking($pipes[1], false); stream_set_blocking($pipes[2], false);
  $start = microtime(true); $output = ''; $exit = -1;
  try {
    while (true) {
      $output .= (string)stream_get_contents($pipes[1]);
      // Errors can contain filenames or media metadata. Drain without logging or returning them.
      stream_get_contents($pipes[2]);
      if (strlen($output) > 1024 * 1024 || microtime(true) - $start > $timeout) { proc_terminate($proc, 9); fail('media_timeout', 422); }
      $status = proc_get_status($proc);
      if (!$status['running']) { $exit = (int)$status['exitcode']; $output .= (string)stream_get_contents($pipes[1]); break; }
      $read = [$pipes[1], $pipes[2]]; $write = null; $except = null;
      @stream_select($read, $write, $except, 0, 200000);
    }
  } finally {
    foreach ($pipes as $pipe) if (is_resource($pipe)) fclose($pipe);
    $closed = proc_close($proc); if ($exit === -1) $exit = $closed;
  }
  return ['code' => $exit, 'output' => $output];
}
/** Bound expensive decoders globally; don't queue workers while all slots are busy. */
function media_slot(callable $fn): mixed {
  private_dir(PRIV . '/locks');
  $slots = meet_int_env('MEDIA_PROCESS_SLOTS', 2, 1, 4);
  for ($i = 0; $i < $slots; $i++) {
    $h = @fopen(PRIV . '/locks/media-' . $i . '.lock', 'c');
    if (!$h) fail('storage', 503);
    @chmod(PRIV . '/locks/media-' . $i . '.lock', 0600);
    if (!flock($h, LOCK_EX | LOCK_NB)) { fclose($h); continue; }
    try { return $fn(); } finally { flock($h, LOCK_UN); fclose($h); }
  }
  fail('media_busy', 429);
}
