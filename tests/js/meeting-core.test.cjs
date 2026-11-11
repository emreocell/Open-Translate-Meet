const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../../assets/js/meeting-core.js');
const me = { identity: 'self123', name: 'Me', speak: 'tr', hear: 'en' };
const remote = { identity: 'speaker1', name: 'Verified speaker', metadata: JSON.stringify({ speak: 'tr', role: 'participant' }) };
const message = { from: 'speaker1', name: 'Forged host', id: 'same-id', speak: 'de', to: 'en', orig: 'Merhaba', trn: 'Hello' };

test('participant invitations only contain room code and bounded title, never host/session data', () => {
  const url = new URL(core.participantLink('https://meet.example/sub/?r=old&h=secret&token=private#h=secret', 'abcdef1234.abcdefabcdefabcdefabcdef', 'Meeting'));
  assert.equal(url.pathname, '/sub/'); assert.equal(url.hash, ''); assert.deepEqual([...url.searchParams.keys()], ['r', 't']);
});
test('new and legacy invitations parse while host capability remains a fragment-only concern', () => {
  assert.equal(core.parseInvite('https://meet.example/?r=abcdef1234.abcdefabcdefabcdefabcdef#h=' + 'a'.repeat(64)).h.length, 64);
  assert.equal(core.parseInvite('abcdef1234.abcdefabcdef').r, 'abcdef1234.abcdefabcdef');
  assert.equal(core.parseInvite('javascript:alert(1)'), null);
  assert.equal(core.parseInvite('anything abcdef1234.abcdefabcdef anything'), null);
});
test('captions derive speaker name and language from authenticated participant', () => {
  const result = core.normalizeCaption(message, remote, me);
  assert.equal(result.name, remote.name); assert.equal(result.speak, 'tr'); assert.equal(result.id, 'speaker1:same-id');
  assert.equal(core.normalizeCaption({ ...message, from: 'self123' }, remote, me), null);
});
test('captions reject malformed, oversized and identifier-injection payloads', () => {
  for (const value of [null, [], { ...message, id: '\"]<script>' }, { ...message, orig: 'x'.repeat(2001) }, { ...message, trn: {} }, { ...message, to: '../../admin' }]) assert.equal(core.normalizeCaption(value, remote, me), null);
});
test('local captions require the local identity and namespace remote collisions', () => {
  const local = core.normalizeCaption({ ...message, from: me.identity }, null, me);
  assert.equal(local.name, me.name); assert.notEqual(local.id, core.normalizeCaption(message, remote, me).id);
});
test('caption gate deduplicates revisions, limits floods, and bounds retained state', () => {
  const gate = new core.CaptionGate({ burst: 2, perSecond: 1, maxEntries: 2 });
  const one = core.normalizeCaption(message, remote, me);
  assert.equal(gate.accept(one, 1000), true); assert.equal(gate.accept(one, 1001), false);
  assert.equal(gate.accept({ ...one, trn: 'Hi' }, 1001), true);
  assert.equal(gate.accept({ ...one, id: 'speaker1:2' }, 1002), false);
  assert.equal(gate.accept({ ...one, id: 'speaker1:2' }, 2002), true);
  assert.equal(gate.accept({ ...one, id: 'speaker1:3' }, 3002), true);
  assert.equal(gate.messages.size, 2); gate.forget('speaker1'); assert.equal(gate.messages.size, 0);
});
test('audio publication without a recent heartbeat never suppresses original audio', () => {
  const publication = { isSubscribed: true, isMuted: false, track: { streamState: 'active' } }, element = { paused: false, muted: false };
  const args = { now: 1000, until: 2000, publication, element, level: .9 };
  assert.equal(core.translationIsPlaying(args), true);
  for (const update of [{ until: 0 }, { now: 3000 }, { level: 0 }, { element: { paused: true } }, { publication: { ...publication, track: { streamState: 'paused' } } }]) assert.equal(core.translationIsPlaying({ ...args, ...update }), false);
  assert.equal(core.originalVolume({ translated: false, duck: true }), 1);
  assert.equal(core.originalVolume({ translated: true, duck: true }), .12);
});
test('all twelve meeting catalogs contain the same complete nonempty translated keys', () => {
  const dir = path.join(__dirname, '../../assets/i18n/meeting');
  const files = fs.readdirSync(dir).filter(file => file.endsWith('.json'));
  assert.equal(files.length, 12);
  const english = JSON.parse(fs.readFileSync(path.join(dir, 'en.json')));
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file)));
    assert.deepEqual(Object.keys(data).sort(), Object.keys(english).sort(), file);
    for (const [key, value] of Object.entries(data)) assert.ok(typeof value === 'string' && value.trim(), file + ':' + key);
  }
});

test('chat requires an authenticated sender and namespaces message ids', () => {
  const input = { id: 'message1', from: remote.identity, text: 'Hello', ts: 1, name: 'Forged host' };
  assert.equal(core.normalizeChat(input, null, 'abcdef1234', 1000), null);
  assert.equal(core.normalizeChat({ ...input, from: 'someoneelse' }, remote, 'abcdef1234', 1000), null);
  const valid = core.normalizeChat(input, remote, 'abcdef1234', 1000);
  assert.equal(valid.name, remote.name); assert.equal(valid.ts, 1000); assert.equal(valid.speak, 'tr'); assert.equal(valid.id, remote.identity + ':message1');
});
test('chat file links reject other rooms, external URLs, infinities and unsupported types', () => {
  const file = { url: 'api/file.php?r=abcdef1234&f=' + 'a'.repeat(16) + '&e=1794400000&s=' + 'b'.repeat(64), type: 'image/png', kind: 'image', name: 'image.png', size: 1024 };
  const input = { id: 'm', file };
  assert.ok(core.normalizeChat(input, remote, 'abcdef1234', 1000));
  for (const update of [{ url: 'https://evil.example/image.png' }, { url: file.url.replace('abcdef1234', '1111111111') }, { size: Infinity }, { type: 'image/svg+xml' }, { name: {} }]) assert.equal(core.normalizeChat({ ...input, file: { ...file, ...update } }, remote, 'abcdef1234', 1000), null);
  assert.equal(core.normalizeChat({ id: 'm', text: 'x'.repeat(2001) }, remote, 'abcdef1234', 1000), null);
});
test('chat replay prevention is per sender and bounded against floods', () => {
  const gate = new core.MessageGate({ burst: 2, perSecond: 1, maxEntries: 2 });
  const message = core.normalizeChat({ id: 'm', text: 'Hello' }, remote, 'abcdef1234', 1000);
  assert.equal(gate.accept(message, 1000), true); assert.equal(gate.accept({ ...message, text: 'Changed replay' }, 1001), false);
  assert.equal(gate.accept({ ...message, id: 'speaker1:m2' }, 1001), true);
  assert.equal(gate.accept({ ...message, id: 'speaker1:m3' }, 1002), false);
  assert.equal(gate.accept({ ...message, id: 'speaker1:m3' }, 2001), true); assert.equal(gate.seen.size, 2);
});

test('attachments require explicit supported MIME and string URLs',()=>{
  const peer={identity:'peer',name:'Person',metadata:'{"speak":"en"}'};
  const url='api/file.php?r=abcdef1234&f=1234567890abcdef&e=2000000000&s='+'a'.repeat(64);
  assert.equal(core.normalizeChat({id:'file',file:{url,size:1,name:'a'}},peer,'abcdef1234',0),null);
  assert.equal(core.normalizeChat({id:'file',file:{url:[url],type:'image/jpeg',kind:'image',size:1,name:'a'}},peer,'abcdef1234',0),null);
});
