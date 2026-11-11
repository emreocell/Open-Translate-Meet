const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../../assets/js/meeting-core.js');
const code = fs.readFileSync(path.join(__dirname, '../../assets/js/translate.js'), 'utf8');
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve() };
function harness({ microphone = true, target = 'tr', deferredCapture = false } = {}) {
  let now = 1000, nextTimer = 0, captureResolve, vadHandlers;
  const timers = new Map(), intervals = new Map(), sockets = [], nodes = [], contexts = [], events = [], requests = [], publications = [], stopped = [], captions = [];
  const output = { connect() { return this }, disconnect() {} };
  class Context {
    constructor(options = {}) { this.sampleRate = options.sampleRate || 48000; this.state = 'running'; this.currentTime = 0; this.destination = output; contexts.push(this); this.audioWorklet = { addModule: () => deferredCapture ? new Promise(resolve => { captureResolve = resolve }) : Promise.resolve() } }
    createMediaStreamSource() { return { ...output } }
    createGain() { return { ...output, gain: { value: 0 } } }
    createMediaStreamDestination() { return { ...output, stream: { getAudioTracks: () => [{ stop() {} }] } } }
    createBuffer(_channels, samples, rate) { return { duration: samples / rate, copyToChannel() {} } }
    createBufferSource() { const s = { ...output, start() {}, stop() { stopped.push(s) } }; return s }
    resume() { this.state = 'running'; return Promise.resolve() }
    close() { this.state = 'closed'; return Promise.resolve() }
  }
  class Worklet { constructor() { this.port = {}; nodes.push(this) } connect() { return output } disconnect() {} }
  class Socket {
    constructor(url) { this.url = url; this.readyState = 1; this.bufferedAmount = 0; this.sent = []; sockets.push(this) }
    send(value) { this.sent.push(JSON.parse(value)) }
    close() { this.readyState = 3 }
    message(value) { return this.onmessage?.({ data: JSON.stringify(value) }) }
  }
  const microphoneTrack = { readyState: 'live' };
  const originalAudio = { dataset: { pid: 'other', name: '', src: 'microphone' }, paused: false, muted: false, volume: 1 };
  const translatedAudio = { dataset: { pid: 'other', name: 'tr-tr', src: 'unknown' }, paused: false, muted: false, volume: 1 };
  const remote = { identity: 'other', name: 'Remote', metadata: JSON.stringify({ speak: 'en', hear: target }), trackPublications: new Map([['translation', { trackName: 'tr-tr', isSubscribed: true, isMuted: false, kind: 'audio', track: { streamState: 'active' }, setSubscribed(value) { this.isSubscribed = value } }]]) };
  const handlers = new Map();
  const room = {
    localParticipant: { identity: 'self', isMicrophoneEnabled: microphone, permissions: { canPublish: true, canPublishSources: [0, 1, 2, 3, 4] },
      getTrackPublication: () => microphone ? { isMuted: false, track: { mediaStreamTrack: microphoneTrack } } : null,
      publishData: (data, options) => { publications.push({ message: JSON.parse(new TextDecoder().decode(data)), ...options }); return Promise.resolve() },
      publishTrack: (_track, options) => Promise.resolve(options), unpublishTrack: () => Promise.resolve() },
    remoteParticipants: new Map([['other', remote]]),
    on(event, callback) { const list = handlers.get(event) || []; list.push(callback); handlers.set(event, list); return this },
    off(event, callback) { handlers.set(event, (handlers.get(event) || []).filter(item => item !== callback)) },
    emit(event, ...args) { for (const callback of handlers.get(event) || []) callback(...args) },
  };
  const elements = new Map();
  const element = () => ({ textContent: '', value: '90', classList: { toggle() {}, contains() { return true } }, setAttribute() {} });
  const document = { baseURI: 'https://meet.example/', getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id) }, dispatchEvent: event => events.push(event), createElement: () => ({ remove() {} }), head: { appendChild() {} } };
  class MockURL extends URL { static createObjectURL() { return 'blob:test' } static revokeObjectURL() {} }
  const context = { window: null, document, AudioContext: Context, AudioWorkletNode: Worklet, MediaStream: class {}, WebSocket: Socket, TextEncoder, TextDecoder, Uint8Array, Float32Array, Int16Array, Blob, URL: MockURL, AbortController, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail } },
    performance: { now: () => now }, crypto: { randomUUID: () => 'uuid-test' }, console,
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { const id = ++nextTimer; intervals.set(id, fn); return id }, clearInterval: id => intervals.delete(id),
    btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary'),
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, status: 200, json: async () => ({ token: 'ephemeral-test', model: 'models/configured-translation-model', expiresAt: Date.now() / 1000 + 600 }) } },
    WMCore: core, vad: { MicVAD: { new: async options => { vadHandlers = options; return { start: async () => {}, destroy: async () => {} } } } },
  };
  context.LivekitClient = { Track: { Source: { Microphone: 'microphone', Unknown: 'unknown' } }, RoomEvent: new Proxy({}, { get: (_o, key) => key }), LocalAudioTrack: class { stop() {} } };
  context.window = context; vm.createContext(context); vm.runInContext(code, context);
  const me = { identity: 'self', name: 'Me', speak: 'en', hear: 'tr', ticket: 'application-ticket' };
  context.WMT.init({ room, me, config: { enabled: true, provider: 'gemini', languages: ['en', 'tr', 'de'], maxSessions: 2 }, audio: { querySelectorAll: () => [originalAudio, translatedAudio] }, t: key => key, trvol: element(), muteorig: element(), trchip: element(), audioMode: () => 'headset', addTx: (...args) => captions.push(args) });
  return { context, room, me, remote, sockets, nodes, contexts, events, requests, publications, stopped, captions, speechStart: () => vadHandlers?.onSpeechRealStart(), originalAudio, translatedAudio, timers,
    advance(ms) { now += ms; for (const fn of intervals.values()) fn() }, captureResolve: () => captureResolve?.(),
    close() { context.WMT.shutdown() },
  };
}
test('server model and application ticket drive ephemeral translation setup', async () => {
  const h = harness(); h.context.WMT.afterConnect(); await flush();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].options.headers['X-Meet-Token'], 'application-ticket');
  h.sockets[0].onopen(); const setup = h.sockets[0].sent[0].setup;
  assert.equal(setup.model, 'models/configured-translation-model');
  assert.equal(setup.generationConfig.translationConfig.targetLanguageCode, 'tr');
  assert.deepEqual(Object.keys(setup.generationConfig.inputAudioTranscription), []);
  h.close();
});
test('unhealthy, missing and stale translation restores full original audio', () => {
  const h = harness({ microphone: false }); h.advance(600); assert.equal(h.originalAudio.volume, 1);
  const payload = new TextEncoder().encode(JSON.stringify({ lang: 'tr', active: true }));
  h.room.emit('DataReceived', payload, h.remote, null, 'tr-health'); assert.equal(h.originalAudio.volume, .12);
  h.advance(2000); assert.equal(h.originalAudio.volume, 1);
  h.room.emit('DataReceived', payload, null, null, 'tr-health'); assert.equal(h.originalAudio.volume, 1);
  h.close();
});
test('shutdown invalidates pending asynchronous microphone setup', async () => {
  const h = harness({ deferredCapture: true }); h.context.WMT.afterConnect(); h.close(); h.captureResolve(); await flush();
  assert.equal(h.nodes.length, 0); assert.equal(h.requests.length, 0); assert.ok(h.contexts.every(context => context.state === 'closed'));
});
test('language change tears down old sockets and creates only the newly needed target', async () => {
  const h = harness(); h.context.WMT.afterConnect(); await flush(); const old = h.sockets[0];
  h.remote.metadata = JSON.stringify({ speak: 'en', hear: 'de' }); h.context.WMT.changeLanguages(); await flush();
  assert.equal(old.readyState, 3); assert.equal(old.onmessage, null);
  assert.equal(JSON.parse(h.requests.at(-1).options.body).lang, 'de'); assert.equal(h.context.WMT.health().sessions.length, 1);
  h.close();
});
test('repeated metadata events retain a valid capture callback and microphone lock closes sessions', async () => {
  const h = harness(); h.context.WMT.afterConnect(); await flush(); const socket = h.sockets[0]; await socket.message({ setupComplete: {} });
  h.room.emit('ParticipantMetadataChanged'); await flush();
  h.speechStart();
  for (let i = 0; i < 4; i++) h.nodes[0].port.onmessage({ data: { pcm: new Int16Array(1600).buffer, rms: .1, peak: .2 } });
  assert.equal(socket.sent.filter(frame => frame.realtimeInput?.audio).length, 4);
  assert.equal(h.context.WMT.health().inputSeconds, .4);
  h.room.localParticipant.permissions.canPublishSources = [1, 3]; h.room.emit('ParticipantPermissionsChanged'); await flush();
  assert.equal(h.context.WMT.health().sessions.length, 0); assert.equal(socket.readyState, 3); h.close();
});
test('queued translation audio is stopped on provider failure and bounded during backlog', async () => {
  const h = harness(); h.context.WMT.afterConnect(); await flush(); const socket = h.sockets[0]; await socket.message({ setupComplete: {} });
  const pcm = Buffer.alloc(48000).toString('base64');
  for (let i = 0; i < 5; i++) await socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm, mimeType: 'audio/pcm;rate=24000' } }] } } });
  assert.ok(h.stopped.length >= 3); const before = h.stopped.length;
  await socket.message({ error: { code: 503 } }); assert.ok(h.stopped.length > before); assert.equal(socket.readyState, 3);
  h.advance(600); assert.equal(h.originalAudio.volume, 1); h.close();
});
test('same-language transcript session is strictly opt-in and closes on withdrawal', async () => {
  const h = harness({ target: 'en' }); h.context.WMT.afterConnect(); await flush(); assert.equal(h.requests.length, 0);
  h.context.WMT.setTranscriptionRequested(true); await flush(); assert.equal(h.requests.length, 1);
  assert.equal(JSON.parse(h.requests[0].options.body).mode, 'transcript');
  h.context.WMT.setTranscriptionRequested(false); await flush(); assert.equal(h.context.WMT.health().sessions.length, 0); h.close();
});

test('primary captions preserve provider translation separately from the speaker display',async()=>{
  const h=harness();h.context.WMT.afterConnect();await flush();const socket=h.sockets[0];await socket.message({setupComplete:{}});
  await socket.message({serverContent:{inputTranscription:{text:'Hello'},outputTranscription:{text:'Merhaba'},turnComplete:true}});
  const [display,participant,archive]=h.captions.at(-1);
  assert.equal(display.orig,'Hello');assert.equal(display.trn,'');assert.equal(participant,null);
  assert.equal(archive.translated,'Merhaba');assert.equal(archive.to,'tr');h.close();
});
