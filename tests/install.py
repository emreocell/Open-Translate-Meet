#!/usr/bin/env python3
"""Offline first-install regression. No real accounts, provider calls or shared state."""
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
PHP = os.environ.get("PHP_BIN", "php")
checks = 0


def check(condition, description):
    global checks
    if not condition:
        raise AssertionError(description)
    checks += 1


def run(arguments, environment, input_text=None):
    return subprocess.run(
        [PHP, *arguments], cwd=ROOT, env=environment, input=input_text,
        text=True, capture_output=True, timeout=30, check=False,
    )


with tempfile.TemporaryDirectory(prefix="meeting-install-test-") as temporary:
    # Deliberately exclude every inherited application/provider configuration value.
    environment = {key: value for key, value in os.environ.items()
                   if key in {"PATH", "SYSTEMROOT", "WINDIR", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"}}
    private = Path(temporary) / "first"
    environment["MEET_PRIVATE_DIR"] = str(private)
    result = run(["bin/init-config.php"], environment)
    check(result.returncode == 0, "first setup succeeds")
    config = private / ".env"
    original = config.read_bytes()
    match = re.search(rb"^APP_SECRET=([a-f0-9]{64})$", original, re.MULTILINE)
    check(match is not None, "setup creates a 256-bit random signing value")
    signing_value = match.group(1).decode()
    check(signing_value not in result.stdout + result.stderr, "setup does not print the signing value")
    check(stat.S_IMODE(private.stat().st_mode) == 0o700, "private directory is owner-only")
    check(stat.S_IMODE(config.stat().st_mode) == 0o600, "configuration is owner-only")

    repeated = run(["bin/init-config.php"], environment)
    check(repeated.returncode != 0, "setup refuses an existing configuration")
    check(config.read_bytes() == original, "refused setup preserves the exact original configuration")

    second = Path(temporary) / "second"
    second_environment = {**environment, "MEET_PRIVATE_DIR": str(second)}
    result = run(["bin/init-config.php"], second_environment)
    check(result.returncode == 0, "independent setup succeeds")
    second_match = re.search(rb"^APP_SECRET=([a-f0-9]{64})$", (second / ".env").read_bytes(), re.MULTILINE)
    check(second_match is not None and second_match.group(1) != match.group(1), "independent installations have different secrets")

    # Generate a one-use fixture password; never put it in a command argument or log.
    password = secrets.token_urlsafe(30)
    result = run(["bin/set-admin.php"], environment, password + "\n")
    check(result.returncode == 0, "administrator setup accepts stdin")
    check(password not in result.stdout + result.stderr, "administrator setup does not echo the password")
    admin_file = private / "admin.json"
    record = json.loads(admin_file.read_text())
    check(isinstance(record.get("passwordHash"), str) and record["passwordHash"] != password, "only a password hash is stored")
    check(stat.S_IMODE(admin_file.stat().st_mode) == 0o600, "administrator credential file is owner-only")
    verifier = '''$record = json_decode(file_get_contents(getenv('MEET_PRIVATE_DIR') . '/admin.json'), true);
$password = rtrim(stream_get_contents(STDIN), "\\r\\n");
exit(password_verify($password, $record['passwordHash']) ? 0 : 1);'''
    check(run(["-r", verifier], environment, password + "\n").returncode == 0, "stored hash verifies the supplied password")
    check(all(password.encode() not in path.read_bytes() for path in private.rglob("*") if path.is_file()), "private setup files contain no plaintext administrator password")

    # These values only satisfy local configuration shape checks. The .invalid
    # host is intentionally unusable; check-config does not connect to it.
    configured = {
        **environment, "APP_URL": "http://localhost:8080",
        "LIVEKIT_URL": "wss://media.example.invalid", "LIVEKIT_API_KEY": "fixture-key",
        "LIVEKIT_API_SECRET": secrets.token_hex(32),
    }
    result = run(["bin/check-config.php"], configured)
    check(result.returncode == 0 and "[FAIL]" not in result.stdout, "offline configuration check accepts a complete local setup")
    check("does not connect to providers" in result.stdout, "configuration check states its local-only scope")
    check(all(value not in result.stdout + result.stderr for value in [password, signing_value, configured["LIVEKIT_API_SECRET"]]), "configuration checks do not disclose credentials")

print(f"Offline installation: {checks} checks passed.")
