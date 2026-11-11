#!/usr/bin/env python3
"""Isolated HTTP integration tests against PHP + a protocol stub, never real LiveKit.

Set PHP_BIN to a PHP >=8.2 executable with curl, mbstring, fileinfo and GD.
This exercises application authorization/lifecycle/concurrency, not WebRTC itself.
"""
import base64
import concurrent.futures
import hashlib
import hmac
import http.cookiejar
import http.server
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PHP = os.environ.get('PHP_BIN') or shutil.which('php')
if not PHP:
    raise SystemExit('PHP >=8.2 required; set PHP_BIN.')
APP_SECRET = 'local-tests-only-app-secret-' * 3
MEDIA_SECRET = 'local-tests-only-media-secret-' * 3
INTEGRATION_SECRET = 'local-tests-only-integration-secret-' * 3
rooms = {}
media_lock = threading.RLock()
media_fail = False
checks = 0

def decode(token):
    return json.loads(base64.urlsafe_b64decode(token.split('.')[1] + '==='))

def verified_media(token):
    parts = token.split('.')
    expected = base64.urlsafe_b64encode(hmac.new(MEDIA_SECRET.encode(), '.'.join(parts[:2]).encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
    assert hmac.compare_digest(expected, parts[2])
    claims = decode(token)
    assert claims['iss'] == 'local-test-key' and claims['exp'] > time.time()
    return claims

class Media(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_POST(self):
        global media_fail
        try:
            verified_media(self.headers.get('Authorization', '').removeprefix('Bearer '))
            data = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))) or '{}')
            method = self.path.rsplit('/', 1)[-1]
            status, result = 200, {}
            with media_lock:
                if media_fail:
                    status, result = 503, {'code': 'unavailable'}
                elif method == 'ListRooms':
                    names = data.get('names')
                    result = {'rooms': [dict(name=k, metadata=v['metadata'], numParticipants=len(v['participants'])) for k, v in rooms.items() if not names or k in names]}
                elif method == 'CreateRoom':
                    name = data['name']
                    rooms.setdefault(name, {'metadata': data.get('metadata', '{}'), 'participants': {}})
                    result = {'name': name}
                elif method == 'ListParticipants':
                    result = {'participants': list(rooms.get(data['room'], {}).get('participants', {}).values())}
                elif method == 'UpdateRoomMetadata':
                    if data['room'] not in rooms:
                        status = 404
                    else:
                        rooms[data['room']]['metadata'] = data['metadata']
                elif method == 'UpdateParticipant':
                    participant = rooms.get(data['room'], {}).get('participants', {}).get(data['identity'])
                    if participant is None:
                        status = 404
                    else:
                        participant.update({k: data[k] for k in ['metadata', 'permission', 'name'] if k in data})
                        result = participant
                elif method == 'RemoveParticipant':
                    participant = rooms.get(data['room'], {}).get('participants', {}).pop(data['identity'], None)
                    if participant is None:
                        status = 404
                elif method == 'DeleteRoom':
                    if rooms.pop(data['room'], None) is None:
                        status = 404
                elif method == 'GetParticipant':
                    result = rooms.get(data['room'], {}).get('participants', {}).get(data['identity'], {})
                    if not result:
                        status = 404
                elif method not in ['SendData', 'MutePublishedTrack']:
                    status = 404
        except Exception as error:
            print('Mock media rejected:', type(error).__name__, str(error))
            status, result = 400, {'code': 'bad_request'}
        raw = json.dumps(result).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

def check(condition, label):
    global checks
    if not condition:
        raise AssertionError(label)
    checks += 1

class Client:
    def __init__(self):
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
    def request(self, path, data=None, ticket=None, raw=None, method='POST', headers=None):
        hd = dict(headers or {})
        if ticket:
            hd['X-Meet-Token'] = ticket
        if data is not None:
            raw = json.dumps(data, separators=(',', ':')).encode()
            hd['Content-Type'] = 'application/json'
        elif raw is not None:
            hd.setdefault('Content-Type', 'application/octet-stream')
        req = urllib.request.Request(BASE + '/' + path.lstrip('/'), data=raw if method != 'GET' else None, headers=hd, method=method)
        try:
            response = self.opener.open(req, timeout=15)
        except urllib.error.HTTPError as e:
            response = e
        content = response.read()
        try:
            payload = json.loads(content)
        except (ValueError, UnicodeDecodeError):
            payload = content
        return response.status, payload

with tempfile.TemporaryDirectory(prefix='meet-integration-') as temp:
    private = Path(temp) / 'private'
    private.mkdir(mode=0o700)
    port = free_port()
    BASE = f'http://127.0.0.1:{port}'
    media = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Media)
    thread = threading.Thread(target=media.serve_forever, daemon=True)
    thread.start()
    env = dict(os.environ, MEET_PRIVATE_DIR=str(private), APP_URL=BASE, APP_SECRET=APP_SECRET,
               LIVEKIT_URL=f'ws://127.0.0.1:{media.server_port}', LIVEKIT_API_KEY='local-test-key',
               LIVEKIT_API_SECRET=MEDIA_SECRET, INTEGRATION_SECRET=INTEGRATION_SECRET,
               LIVEKIT_WEBHOOK_API_KEY='', LIVEKIT_WEBHOOK_API_SECRET='',
               PHP_CLI_SERVER_WORKERS='4', TRANSLATION_PROVIDER='gemini', TEXT_PROVIDER='none',
               GEMINI_API_KEY='local-fixture-key', GEMINI_MODEL='gemini-fixture-live', TRANSCRIPT_ENABLED='true',
               TRUSTED_PROXIES='', FILE_TTL='86400', MAX_PARTICIPANTS='8', MAX_IMAGE_PIXELS='16000000')
    # The prepend file exists only in this temporary fixture server. Production
    # has no route/header for replacing transports or performing these mutations.
    prepend = Path(temp) / 'fixture-prepend.php'
    prepend.write_text("""<?php
if (parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) !== '/api/gemini.php') return;
define('MEET_TEST_MODE', true);
require_once __LIB__;
set_exception_handler(static function(Throwable $e): never {
  if ($e instanceof MeetHttpError) out(['error' => $e->error], $e->status);
  out(['error' => 'fixture_error'], 500);
});
$GLOBALS['meet_http_transport'] = static function($method, $url, $json): array {
  if ($method !== 'POST' || $url !== 'https://generativelanguage.googleapis.com/v1beta/auth_tokens'
    || $json['uses'] !== 1 || !isset($json['liveConnectConstraints']['config']['translationConfig']))
    throw new RuntimeException('Unexpected provider request');
  $t = ticket(); $race = $_SERVER['HTTP_X_FIXTURE_RACE'] ?? 'none';
  if ($race === 'revoke') room_reg_edit($t['room'], static function(array &$r) use($t): void { $r['sessions'][$t['who']]['revoked'] = true; });
  if ($race === 'close') room_close($t['room']);
  if ($race === 'consent') transcript_set_consent($t, false, false);
  if ($race === 'disable') transcript_edit($t['room'], static function(array &$d): void { $d['active'] = false; $d['revision']++; });
  if ($race === 'language') room_reg_edit($t['room'], static function(array &$r) use($t): void { $r['sessions'][$t['who']]['speak'] = 'de'; });
  return [200, ['name' => 'fixture-live-token']];
};
""".replace('__LIB__', json.dumps(str(ROOT / 'api/_lib.php'))))
    logfile = open(Path(temp) / 'php.log', 'w+')
    server = subprocess.Popen([PHP, '-d', 'display_errors=0', '-d', 'memory_limit=256M', '-d', f'auto_prepend_file={prepend}', '-S', f'127.0.0.1:{port}', '-t', str(ROOT)],
                              env=env, stdout=logfile, stderr=logfile, start_new_session=True)
    def php(code):
        script = "define('MEET_TEST_MODE',true); require " + json.dumps(str(ROOT / 'api/_lib.php')) + '; ' + code
        completed = subprocess.run([PHP, '-r', script], env=env, capture_output=True, text=True, check=True)
        return json.loads(completed.stdout) if completed.stdout.strip() else None
    def make_room(**options):
        rec = php('echo json_encode(room_create(json_decode(' + repr(json.dumps(options)) + ',true)));')
        links = php('echo json_encode(room_links(' + repr(rec['id']) + '));')
        rec['r'] = urllib.parse.parse_qs(urllib.parse.urlsplit(links['link']).query)['r'][0]
        rec['h'] = urllib.parse.parse_qs(urllib.parse.urlsplit(links['hostLink']).fragment)['h'][0]
        return rec
    def join(client, room, **extra):
        payload = dict(r=room['r'], name='Guest', speak='en', hear='tr')
        payload.update(extra)
        return client.request('api/join.php', payload)
    def connect(joined):
        claims = verified_media(joined['token'])
        with media_lock:
            rooms[joined['room']]['participants'][joined['identity']] = dict(identity=joined['identity'], sid='PA_' + joined['identity'], joinedAtMs=int(time.time() * 1000), name=claims['name'], metadata=claims['metadata'], tracks=[])
    def webhook(event, wrong_secret=False, wrong_body=False, bare_header=False):
        raw = json.dumps(event, separators=(',', ':')).encode()
        digest = base64.b64encode(hashlib.sha256(raw).digest()).decode()
        claims = {'iss': 'local-test-key', 'nbf': int(time.time()) - 1, 'exp': int(time.time()) + 120, 'sha256': digest}
        head = base64.urlsafe_b64encode(json.dumps({'alg': 'HS256'}).encode()).rstrip(b'=').decode()
        payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b'=').decode()
        key = 'wrong-secret' if wrong_secret else MEDIA_SECRET
        signature = base64.urlsafe_b64encode(hmac.new(key.encode(), (head + '.' + payload).encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
        token = head + '.' + payload + '.' + signature
        if wrong_body:
            raw += b' '
        return Client().request('api/livekit-webhook.php', raw=raw, headers={'Content-Type': 'application/webhook+json', 'Authorization': token if bare_header else 'Bearer ' + token})
    def join_event(joined, suffix):
        return {'event': 'participant_joined', 'id': 'EV_' + suffix, 'createdAt': int(time.time()),
                'room': {'name': joined['room']}, 'participant': {'identity': joined['identity'], 'sid': 'PA_' + joined['identity']}}
    def signed(action, data, raw=None):
        raw = raw or json.dumps(data, separators=(',', ':')).encode()
        ts = str(int(time.time()))
        message = f'{ts}\nPOST\n{action}\n{hashlib.sha256(raw).hexdigest()}'
        signature = hmac.new(INTEGRATION_SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()
        return Client().request('api/v1.php?a=' + action, raw=raw, headers={'Content-Type': 'application/json', 'X-Meet-Timestamp': ts, 'X-Meet-Signature': signature}), raw, ts, signature
    try:
        for missing in ['LIVEKIT_WEBHOOK_API_KEY', 'LIVEKIT_WEBHOOK_API_SECRET']:
            partial = dict(env)
            partial[missing] = 'partial-dedicated-setting'
            code = ("define('MEET_TEST_MODE',true); require " + json.dumps(str(ROOT / 'api/_webhook.php'))
                    + "; try { webhook_event('{}',''); exit(2); } catch(MeetHttpError $e) { echo json_encode([$e->status,$e->error]); }")
            result = subprocess.run([PHP, '-r', code], env=partial, capture_output=True, text=True, check=True)
            check(json.loads(result.stdout) == [503, 'not_configured'], 'partial dedicated webhook credentials fail closed: ' + missing)
        deadline = time.monotonic() + 10
        while True:
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=.2):
                    break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('PHP server did not start')
                time.sleep(.05)
        host, guest, stranger = Client(), Client(), Client()
        room = make_room(title='Protocol tests', max=2)
        status, h = join(host, room, h=room['h'], name='Host')
        check(status == 200, f'host admission: {status} {h}')
        connect(h)
        mc = verified_media(h['token'])
        check('roomAdmin' not in mc['video'] and mc['video']['canUpdateOwnMetadata'] is False, 'media token has no application admin or metadata powers')
        check(mc['exp'] - mc['nbf'] <= 602 and decode(h['ticket'])['aud'] == 'meet-api', 'short media token and distinct application ticket')
        status, g = join(guest, room, name='Alice', did='f' * 32)
        check(status == 200, f'guest admission: {status} {g}')
        connect(g)
        check(stranger.request('api/host.php', {'action': 'state'}, g['token'])[0] == 401, 'media JWT rejected by app host endpoint')
        check(guest.request('api/host.php', {'action': 'end'}, g['ticket'])[0] == 403, 'guest cannot end room')
        check(join(stranger, room)[0] == 409, 'live room capacity enforced')
        status, state = host.request('api/host.php', {'action': 'state'}, h['ticket'])
        check(status == 200 and state['count'] == 2, 'host sees live participant count')
        status, own = guest.request('api/participant.php', {'action': 'languages', 'speak': 'de', 'hear': 'fr', 'identity': h['identity'], 'role': 'host'}, g['ticket'])
        check(status == 200 and own['speak'] == 'de', 'in-meeting language update')
        check(json.loads(rooms[room['id']]['participants'][g['identity']]['metadata']) == {'speak': 'de', 'hear': 'fr'}, 'speaker cannot forge identity/role through language update')
        check(guest.request('api/participant.php', {'speak': 'invented', 'hear': 'en'}, g['ticket'])[0] == 400, 'unsupported language rejected')
        check(host.request('api/host.php', {'action': 'limit', 'max': 4}, h['ticket'])[0] == 200, 'host capacity mutation')
        result, _, _, _ = signed('get', {'room': room['id']})
        check(result[0] == 200 and result[1]['live'] == 2, 'integration API count without participants list')
        result, raw, ts, sig = signed('update', {'room': room['id'], 'max': 3})
        check(result[0] == 200 and json.loads(rooms[room['id']]['metadata'])['max'] == 3, 'integration capacity persists and synchronizes live room')
        check(Client().request('api/v1.php?a=update', raw=raw, headers={'Content-Type': 'application/json', 'X-Meet-Timestamp': ts, 'X-Meet-Signature': sig})[0] == 401, 'signed API replay rejected')
        check(Client().request('api/v1.php?a=list', method='GET')[0] == 405, 'management mutations require POST')
        media_fail = True
        check(join(Client(), room)[0] == 503, 'admission fails closed on unknown media state')
        media_fail = False
        # Upload a real tiny PNG; decode/re-encode happens in PHP GD.
        png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=')
        # Generate known-valid PNG with the same GD runtime (some stock one-pixel fixtures have bad CRCs).
        generated = subprocess.run([PHP, '-r', '$i=imagecreatetruecolor(2,2); imagefill($i,0,0,imagecolorallocate($i,255,0,0)); imagepng($i);'], capture_output=True, check=True)
        png = generated.stdout
        status, up = guest.request('api/upload.php?a=init', {'name': 'photo.png', 'size': len(png), 'type': 'image/png'}, g['ticket'])
        check(status == 200, f'upload reserve: {status} {up}')
        url = 'api/upload.php?a=chunk&id=' + up['id'] + '&i=0'
        check(guest.request(url, ticket=g['ticket'], raw=png)[0] == 200, 'upload chunk')
        check(guest.request(url, ticket=g['ticket'], raw=png)[1].get('duplicate') is True, 'chunk retry idempotence')
        check(guest.request(url, ticket=g['ticket'], raw=b'x' * len(png))[0] == 409, 'conflicting chunk retry rejected')
        status, finished = guest.request('api/upload.php?a=finish', {'id': up['id']}, g['ticket'])
        check(status == 200, f'upload finalize: {status} {finished}')
        fileurl = finished['file']['url']
        check(guest.request(fileurl, method='GET')[0] == 200, 'same-room attachment cookie works')
        check(stranger.request(fileurl, method='GET')[0] == 404, 'copied attachment URL grants no outsider access')
        check(guest.request(fileurl, method='GET', headers={'Range': 'bytes=0-7'})[0] == 206, 'video/image byte range')
        check(guest.request(fileurl, method='GET', headers={'Range': 'bytes=-0'})[0] == 416, 'invalid suffix range')
        check(guest.request('api/upload.php?a=init', {'name': 'x.svg', 'size': 10, 'type': 'image/svg+xml'}, g['ticket'])[0] == 415, 'executable image format refused')
        check(guest.request('api/upload.php?a=init', {'name': 'x.png', 'size': 64 * 1024 * 1024, 'type': 'image/png'}, g['ticket'])[0] == 413, 'upload size limit')
        status, fake = guest.request('api/upload.php?a=init', {'name': 'x.png', 'size': 5, 'type': 'image/png'}, g['ticket'])
        guest.request('api/upload.php?a=chunk&id=' + fake['id'] + '&i=0', ticket=g['ticket'], raw=b'hello')
        check(guest.request('api/upload.php?a=finish', {'id': fake['id']}, g['ticket'])[0] == 422, 'claimed image MIME must match real bytes')
        if shutil.which('ffmpeg') and shutil.which('ffprobe'):
            video_path = Path(temp) / 'fixture.mp4'
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:d=1', '-an', '-c:v', 'mpeg4', '-q:v', '5', '-movflags', '+faststart', str(video_path)], check=True, timeout=10)
            video = video_path.read_bytes()
            status, video_upload = guest.request('api/upload.php?a=init', {'name': 'fixture.mp4', 'size': len(video), 'type': 'video/mp4'}, g['ticket'])
            check(status == 200, 'video upload initialized')
            check(guest.request('api/upload.php?a=chunk&id=' + video_upload['id'] + '&i=0', ticket=g['ticket'], raw=video)[0] == 200, 'video chunk stored')
            status, video_done = guest.request('api/upload.php?a=finish', {'id': video_upload['id']}, g['ticket'])
            check(status == 200, f'real ffprobe/ffmpeg sanitize: {status} {video_done}')
            check(video_done['file']['w'] == 32 and video_done['file']['h'] == 32 and video_done['file']['duration'] > 0, 'video metadata measured from actual stream')
            check(guest.request(video_done['file']['url'], method='GET', headers={'Range': 'bytes=0-31'})[0] == 206, 'sanitized video supports seeking')
        else:
            print('SKIP: real video sanitization (ffmpeg/ffprobe are not installed)')
        # Ban is authoritative for API and cookie access; unrelated people on localhost remain allowed.
        check(host.request('api/host.php', {'action': 'kick', 'identity': g['identity'], 'ban': 'room'}, h['ticket'])[0] == 200, 'host removes and bans guest')
        check(guest.request('api/participant.php', {'action': 'state'}, g['ticket'])[0] == 401, 'ban immediately revokes app access')
        check(guest.request(fileurl, method='GET')[0] == 404, 'ban revokes attachment cookie access')
        check(join(guest, room, did='0' * 32)[0] == 403, 'client supplied device ID cannot bypass signed device ban')
        status, other = join(stranger, room)
        check(status == 200, 'same NAT does not inherit another person ban')
        connect(other)
        check(host.request('api/host.php', {'action': 'mute', 'identity': other['identity'], 'source': 'microphone'}, h['ticket'])[0] == 200, 'server source lock')
        permission = rooms[room['id']]['participants'][other['identity']]['permission']
        check('MICROPHONE' not in permission['canPublishSources'] and 'UNKNOWN' not in permission['canPublishSources'] and 'SCREEN_SHARE_AUDIO' not in permission['canPublishSources'], 'mic lock covers translated and screen audio tracks')
        status, resumed = join(stranger, room, resumeToken=other['ticket'])
        check(status == 200 and resumed['identity'] == other['identity'] and 'microphone' not in verified_media(resumed['token'])['video']['canPublishSources'], 'rejoin preserves identity and source locks')
        check(host.request('api/host.php', {'action': 'end'}, h['ticket'])[0] == 200, 'end persists lifecycle then closes media')
        check(join(host, room, h=room['h'])[0] == 410, 'ended meeting cannot restart with host link')
        check(stranger.request('api/participant.php', {'action': 'state'}, other['ticket'])[0] == 401, 'end revokes existing application tickets')
        check(not (private / 'uploads' / room['id']).exists(), 'end removes attachments')
        # Waiting room tickets are a separate capability and require approval before media credentials exist.
        waiting = make_room(title='Waiting', waitingRoom=True, password='door code', max=2)
        whost, waiter = Client(), Client()
        status, wh = join(whost, waiting, h=waiting['h'])
        check(status == 200, 'waiting room host admitted')
        connect(wh)
        check(join(waiter, waiting)[0] == 401, 'waiting room honors password')
        status, wait = join(waiter, waiting, pw='door code', name='Waiting Alice')
        check(status == 202 and 'token' not in wait and 'ticket' not in wait, 'waiting request exposes no media/application ticket')
        check(waiter.request('api/participant.php', {'action': 'state'}, wait['waitingToken'])[0] == 401, 'waiting JWT cannot access protected data')
        check(join(Client(), waiting, waitingToken=wait['waitingToken'])[0] == 410, 'stolen waiting token rejected on another device')
        status, ws = whost.request('api/host.php', {'action': 'state'}, wh['ticket'])
        check(status == 200 and len(ws['waiting']) == 1, 'host can review pending guest')
        check(whost.request('api/host.php', {'action': 'admit', 'waitingId': ws['waiting'][0]['id']}, wh['ticket'])[0] == 200, 'host admission decision')
        status, admitted = join(waiter, waiting, waitingToken=wait['waitingToken'])
        check(status == 200 and 'token' in admitted, 'approved waiter receives media token')
        check(join(waiter, waiting, waitingToken=wait['waitingToken'])[1]['identity'] == admitted['identity'], 'waiting completion retries do not create new identities')
        check(whost.request('api/host.php', {'action': 'waiting', 'enabled': False}, wh['ticket'])[0] == 200, 'waiting mode toggles')
        # Serialize simultaneous token minting; reservations count before WebRTC has connected.
        concurrent_room = make_room(title='Race', max=2)
        chost = Client()
        check(join(chost, concurrent_room, h=concurrent_room['h'])[0] == 200, 'host token reserves capacity')
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            responses = list(pool.map(lambda n: join(Client(), concurrent_room, name=f'Guest {n}'), range(6)))
        check(sum(status == 200 for status, _ in responses) == 1 and sum(status == 409 for status, _ in responses) == 5, 'concurrent joins cannot exceed remaining capacity')
        # Signed provider events enforce current server policies even on cached media-token reconnects.
        wroom = make_room(title='Webhook', max=3)
        wa, wb = Client(), Client()
        _, waha = join(wa, wroom, h=wroom['h'])
        _, wbha = join(wb, wroom)
        connect(waha); connect(wbha)
        event = join_event(wbha, 'valid')
        check(webhook(event, wrong_secret=True)[0] == 401, 'webhook rejects invalid signature')
        check(webhook(event, wrong_body=True)[0] == 401, 'webhook hashes exact raw body')
        status, enforced = webhook(event, bare_header=True)
        check(status == 200 and enforced.get('enforced') is True, 'official webhook auth without typ or Bearer accepted')
        check(webhook(event)[1].get('duplicate') is True, 'webhook delivery deduplicated')
        changed_event = dict(event, event='participant_left')
        check(webhook(changed_event)[0] == 409, 'event ID cannot be reused for a different payload')
        old_event = dict(event, id='EV_old', createdAt=int(time.time()) - 90000)
        check(webhook(old_event)[0] == 400, 'stale signed event rejected')
        media_fail = True
        check(webhook(join_event(waha, 'retry'))[0] == 503, 'webhook upstream failure asks provider to retry')
        media_fail = False
        check(webhook(join_event(waha, 'retry'))[0] == 200, 'failed webhook is not prematurely deduplicated')
        # Simulate a cached media token from a revoked guest on self-hosted LiveKit.
        php("room_reg_edit('" + wroom['id'] + "',function(&$r){$r['sessions']['" + wbha['identity'] + "']['revoked']=true;});")
        status, removed = webhook(join_event(wbha, 'revoked'))
        check(status == 200 and removed.get('removed') is True and wbha['identity'] not in rooms[wroom['id']]['participants'], 'cached unauthorized reconnect removed')
        # A room_finished event does not close an otherwise valid application meeting.
        finish_event = {'event': 'room_finished', 'id': 'EV_natural_finish', 'createdAt': int(time.time()), 'room': {'name': wroom['id']}}
        check(webhook(finish_event)[0] == 200 and php("echo json_encode(room_is_open(room_reg_get('" + wroom['id'] + "')));") is True, 'natural media finish preserves meeting lifecycle')
        # Current room limit lowered after media tokens were issued: latest event participant is removed.
        caproom = make_room(title='Webhook cap', max=3)
        ca, cb, cc = Client(), Client(), Client()
        _, cah = join(ca, caproom, h=caproom['h']); _, cbh = join(cb, caproom); _, cch = join(cc, caproom)
        connect(cah); connect(cbh); connect(cch)
        rooms[caproom['id']]['participants'][cch['identity']]['joinedAtMs'] += 1000
        php("room_reg_edit('" + caproom['id'] + "',function(&$r){$r['max']=2;});")
        status, limited = webhook(join_event(cch, 'capacity'))
        check(status == 200 and limited.get('reason') == 'room_full' and cah['identity'] in rooms[caproom['id']]['participants'], 'webhook enforces reduced capacity without removing unrelated host')
        retry_room = make_room(title='Durable media policies', max=2)
        rh, rg = Client(), Client()
        _, rhj = join(rh, retry_room, h=retry_room['h']); _, rgj = join(rg, retry_room)
        # This is a valid randomly-generated identity shape; PHP coerces its
        # JSON object key to int. Admission and moderation must keep string identity semantics.
        numeric = php("room_reg_edit('" + retry_room['id'] + "',function(&$r){$r['sessions']['123456789012']=$r['sessions']['"
                      + rgj['identity'] + "'];unset($r['sessions']['" + rgj['identity'] + "']);});"
                      + "$c=jwt_verify('" + rgj['token'] + "',config_string('LIVEKIT_API_SECRET'));$c['sub']='123456789012';"
                      + "echo json_encode(['ticket'=>issue_ticket(room_reg_get('" + retry_room['id'] + "'),'123456789012'),"
                      + "'token'=>jwt_sign($c,config_string('LIVEKIT_API_SECRET'))]);")
        rgj.update(numeric); rgj['identity'] = '123456789012'
        connect(rhj); connect(rgj)
        status, resumed_numeric = join(rg, retry_room, resumeToken=rgj['ticket'])
        check(status == 200 and resumed_numeric['identity'] == '123456789012', 'all-digit hexadecimal participant identity resumes in full room')
        rgj = resumed_numeric
        media_fail = True
        status, muted = rh.request('api/host.php', {'action': 'mute', 'identity': rgj['identity'], 'source': 'microphone'}, rhj['ticket'])
        check(status == 502 and muted.get('policySaved') and php("echo json_encode(room_reg_get('" + retry_room['id'] + "')['mediaSyncPending']);"), 'failed moderation remains durably pending')
        media_fail = False
        php('sweep_rooms(true);')
        sources = rooms[retry_room['id']]['participants'][rgj['identity']]['permission']['canPublishSources']
        check('MICROPHONE' not in sources and 'UNKNOWN' not in sources and php("echo json_encode(room_reg_get('" + retry_room['id'] + "')['mediaSyncPending']);") is False, 'maintenance reapplies saved moderation after provider recovery')
        media_fail = True
        status, locked = rh.request('api/host.php', {'action': 'lock', 'locked': True}, rhj['ticket'])
        check(status == 502 and locked.get('policySaved'), 'metadata failure preserves authoritative admission policy')
        media_fail = False
        php('sweep_rooms(true);')
        check(json.loads(rooms[retry_room['id']]['metadata'])['locked'] is True, 'maintenance retries room metadata updates')
        media_fail = True
        (status, saved), _, _, _ = signed('update', {'room': retry_room['id'], 'title': 'Saved during outage'})
        check(status == 502 and saved.get('policySaved') and saved.get('mediaSyncPending') and saved.get('live') is None, 'signed management API reports committed policy and unknown media count during outage')
        media_fail = False
        php('sweep_rooms(true);')
        media_fail = True
        status, kicked = rh.request('api/host.php', {'action': 'kick', 'identity': rgj['identity']}, rhj['ticket'])
        check(status == 502 and kicked.get('revoked') and rgj['identity'] in rooms[retry_room['id']]['participants'], 'failed kick revokes application access and retains provider retry')
        media_fail = False
        php('sweep_rooms(true);')
        check(rgj['identity'] not in rooms[retry_room['id']]['participants'] and rhj['identity'] in rooms[retry_room['id']]['participants'], 'maintenance removes revoked media participant and preserves current host')
        media_fail = True
        status, ended = rh.request('api/host.php', {'action': 'end'}, rhj['ticket'])
        ended_at = php("echo json_encode(room_reg_get('" + retry_room['id'] + "')['endedAt']);")
        check(status == 502 and ended.get('mediaClosePending'), 'failed room close remains durably pending')
        media_fail = False
        php('sweep_rooms(true);')
        after_close = php("echo json_encode(room_reg_get('" + retry_room['id'] + "'));")
        check(retry_room['id'] not in rooms and not after_close['mediaClosePending'] and after_close['endedAt'] == ended_at, 'maintenance retries media closure without extending retention')
        expired = make_room(title='Expiry')
        php("room_reg_edit('" + expired['id'] + "',function(&$r){$r['expiresAt']=time()-1;});")
        check(Client().request('api/room-info.php', {'r': expired['r']})[0] == 410, 'expired room info denied')
        check(join(Client(), expired)[0] == 410, 'expired room admission denied')
        php("unlink(ROOMS_DIR.'/" + expired['id'] + ".json');")
        check(join(Client(), expired)[0] == 403, 'deleting tombstone cannot restore signed link')
        check(Client().request('api/room-info.php', {'r': waiting['r']}, headers={'Origin': 'https://attacker.invalid'})[0] == 403, 'cross-origin state request rejected')
        # Simulate authorization changes while Gemini is issuing a credential.
        # The actual HTTP endpoint must withhold the successful provider result.
        issued = []
        for race, expected, error in [('none', 200, None), ('revoke', 401, 'unauthorized'), ('close', 401, 'unauthorized'),
                                      ('consent', 403, 'consent_required'), ('disable', 403, 'consent_required'),
                                      ('language', 409, 'participant_changed')]:
            live_room = make_room(title='Live token race')
            speaker = Client()
            _, joined = join(speaker, live_room, h=live_room['h'])
            connect(joined)
            php('require_once ' + json.dumps(str(ROOT / 'api/_transcript.php')) + '; $t=ticket_claims(' + repr(joined['ticket']) + ');'
                + 'transcript_edit($t["room"],function(&$d){$d["active"]=true;$d["revision"]++;}); transcript_set_consent($t,true,false);')
            status, result = speaker.request('api/gemini.php', {'lang': 'en', 'mode': 'transcript'}, joined['ticket'],
                                             headers={'X-Fixture-Race': race})
            check(status == expected and (result.get('token') == 'fixture-live-token' if expected == 200
                  else result.get('error') == error and 'token' not in result), f'live credential authorization after provider response: {race}')
            issued.append(json.loads((private / 'usage' / (joined['room'] + '.json')).read_text())['issuedLiveTokens'])
        check(issued == [1] * 6, 'issued provider tokens counted even when their disclosure is blocked')
        print(f'Backend HTTP integration checks passed: {checks} (mock LiveKit; no WebRTC/provider calls)')
    except Exception:
        logfile.flush()
        print('Integration failure; recent PHP diagnostics:')
        logfile.seek(0)
        print(''.join(logfile.readlines()[-35:]))
        raise
    finally:
        os.killpg(server.pid, signal.SIGTERM)
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(server.pid, signal.SIGKILL)
            server.wait(timeout=5)
        logfile.close()
        media.shutdown()
        media.server_close()
