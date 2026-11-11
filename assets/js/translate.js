/* Speaker-side translation: a microphone is sent once per requested target language.
   Original audio remains audible unless fresh translated output is actually playing.
   Provider credentials are short-lived and the model is supplied by the server. */
(() => {
'use strict';
const WSURL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=';
const GAP_MS = 2500, TAIL_MS = 2500, PRE_MAX = 8, MAX_QUEUE_SECONDS = 3, HEALTH_TTL = 1800;
const WORKLET = `class P extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(1600);this.n=0}
process(i){const x=i[0]&&i[0][0];if(!x)return true;for(let k=0;k<x.length;k++){this.b[this.n++]=x[k];if(this.n===1600){const o=new Int16Array(1600);let e=0,pk=0;for(let j=0;j<1600;j++){const s=Math.max(-1,Math.min(1,this.b[j]));o[j]=s<0?s*32768:s*32767;e+=s*s;pk=Math.max(pk,Math.abs(s))}this.port.postMessage({pcm:o.buffer,rms:Math.sqrt(e/1600),peak:pk},[o.buffer]);this.n=0}}return true}}registerProcessor('wm-cap',P);`;
const enc = new TextEncoder(), dec = new TextDecoder();
const meta = p => window.WMCore.metadata(p);
const b64 = buf => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s) };
const sessions = new Map(), outs = new Map(), remoteHealth = new Map(), pers = new Map();
let room = null, env = null, me = null, Track = null, RoomEvent = null, config = {};
let capCtx = null, capReady = null, cap = null, outCtx = null, epoch = 0, wireEpoch = 0;
let vol = { tr: .9, muteOrig: true }, master = 1, remoteActive = false, tickTimer = null, handlers = [];
let floor = .004, speaking = false, lastSpeech = -1e9, sendUntil = 0, pre = [], recent = [], conf = [];
let vadInst = null, vadOk = false, speechOn = false, vadLib = null, vadLoading = null, vadEpoch = 0;
let sentSeconds = 0, failures = 0, limited = false, lastUsage = 0, transcriptionRequested = false, captureError = false;
const VAD_BASE = new URL('assets/vad/', document.baseURI).href;
const enabled = () => config.enabled !== false && config.provider !== 'none';
const allowedLanguage = lang => window.WMCore.validLanguage(lang) && (!Array.isArray(config.languages) || config.languages.includes(lang));
const factor = pid => { const x = pers.get(pid); return master * (x ? (x.muted ? 0 : x.vol) : 1) };
const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
function safePromise(value) { if (value && value.catch) value.catch(() => {}) }
function publish(msg, topic = 'tx') {
  if (!room) return;
  try { safePromise(room.localParticipant.publishData(enc.encode(JSON.stringify(msg)), { reliable: true, topic })) } catch (_) {}
}

/* A publication alone is not evidence of translation health. A bounded heartbeat is
   sent only while real PCM is queued. Missing heartbeats, paused tracks, muted output,
   disconnection or a provider failure immediately restore the original voice. */
function manage(pub) {
  if (!pub || pub.kind === undefined || !me) return;
  let want = true;
  if (pub.kind === 'audio' && (pub.trackName || '').startsWith('tr-')) want = enabled() && pub.trackName === 'tr-' + me.hear;
  // A presenter's shared audio is part of the meeting, not a translation source.
  if (pub.isSubscribed !== want) { try { pub.setSubscribed(want) } catch (_) {} }
}
function manageAll() { if (room) room.remoteParticipants.forEach(p => p.trackPublications.forEach(manage)) }
function setVol(el, value) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  try { if (el._lk?.setVolume) el._lk.setVolume(v); else el.volume = v } catch (_) {}
}
function applyVolumes() {
  if (!room || !env) return;
  const now = performance.now(), elements = [...env.audio.querySelectorAll('audio')];
  let playing = false;
  for (const el of elements) {
    const p = room.remoteParticipants.get(el.dataset.pid); if (!p) continue;
    const name = el.dataset.name || '', f = factor(p.identity);
    if (name.startsWith('tr-')) { setVol(el, name === 'tr-' + me.hear && enabled() ? vol.tr * f : 0); continue }
    if (el.dataset.src !== 'microphone') { setVol(el, f); continue }
    let translated = false;
    if (meta(p).speak !== me.hear) {
      const candidate = elements.find(x => x.dataset.pid === p.identity && x.dataset.name === 'tr-' + me.hear);
      let publication = null;
      p.trackPublications.forEach(x => { if (x.trackName === 'tr-' + me.hear) publication = x });
      translated = enabled() && window.WMCore.translationIsPlaying({ now, until: remoteHealth.get(p.identity + ':' + me.hear)?.until || 0, publication, element: candidate, level: vol.tr });
    }
    playing = playing || translated;
    setVol(el, window.WMCore.originalVolume({ translated, duck: vol.muteOrig, factor: f }));
  }
  const row = document.getElementById('trrow'); if (row) row.classList.toggle('notr', !playing);
  const note = document.getElementById('trnote'); if (note) note.textContent = playing ? '' : env.t('translation_fallback');
}
function receiveHealth(payload, participant, _kind, topic) {
  if (topic !== 'tr-health' || !participant || !room?.remoteParticipants.has(participant.identity) || payload.byteLength > 512) return;
  let data; try { data = JSON.parse(dec.decode(payload)) } catch (_) { return }
  if (!data || data.lang !== me.hear || !allowedLanguage(data.lang) || typeof data.active !== 'boolean') return;
  const key = participant.identity + ':' + data.lang, now = performance.now(), previous = remoteHealth.get(key);
  // An inactive event is never throttled; it must restore original audio promptly.
  if (data.active && previous && now - previous.received < 300) return;
  if (!data.active && (!previous || previous.until <= now)) return;
  remoteHealth.set(key, { received: now, until: data.active ? now + HEALTH_TTL : 0 });
  applyVolumes();
}
function outputHealth() {
  for (const [lang, s] of sessions) {
    const o = outs.get(lang);
    const active = !!(s.ready && o?.pub && outCtx?.state === 'running' && o.next > outCtx.currentTime);
    if (active || s.outputActive) publish({ lang, active }, 'tr-health');
    s.outputActive = active;
  }
}

/* Microphone capture. Generation guards prevent an async permission/VAD request from
   reviving a previous meeting after leave, mute, language changes or a device switch. */
async function ensureCtx() {
  if (capReady) return capReady;
  const context = new AudioContext({ sampleRate: 16000 }); capCtx = context;
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  capReady = context.audioWorklet.addModule(url).then(() => {
    if (context.sampleRate !== 16000) throw new Error('unsupported_capture_rate');
    return context;
  }).catch(error => { if (capCtx === context) { capCtx = null; capReady = null } safePromise(context.close()); throw error }).finally(() => URL.revokeObjectURL(url));
  return capReady;
}
function stopVad() {
  vadEpoch++; const v = vadInst; vadInst = null; vadOk = false; speechOn = false;
  if (v) { try { safePromise(v.destroy()) } catch (_) {} }
}
function teardownCapture() {
  stopVad();
  if (cap) { try { cap.node.port.onmessage = null; cap.src.disconnect(); cap.node.disconnect(); cap.mute.disconnect() } catch (_) {} cap = null }
  pre = []; recent = []; conf = []; speaking = false; sendUntil = 0; lastSpeech = -1e9;
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = src;
    script.onload = resolve; script.onerror = () => { script.remove(); reject(new Error('vad_unavailable')) };
    document.head.appendChild(script);
  });
}
function loadVadLib() {
  if (vadLib) return Promise.resolve(vadLib);
  if (!vadLoading) vadLoading = (async () => {
    if (!window.ort) await loadScript(VAD_BASE + 'ort.wasm.min.js');
    if (!window.vad) await loadScript(VAD_BASE + 'bundle.min.js');
    if (!window.vad?.MicVAD) throw new Error('vad_unavailable');
    vadLib = window.vad; return vadLib;
  })().catch(error => { vadLoading = null; throw error });
  return vadLoading;
}
function flushPre() { for (const chunk of pre) fanout(chunk); pre = [] }
async function startVad(mst) {
  stopVad(); const generation = vadEpoch;
  try {
    const lib = await loadVadLib(); if (generation !== vadEpoch || cap?.mst !== mst) return;
    const stream = new MediaStream([mst]);
    const valid = () => generation === vadEpoch && cap?.mst === mst && !!room;
    const v = await lib.MicVAD.new({
      model: 'v5', baseAssetPath: VAD_BASE, onnxWASMBasePath: VAD_BASE,
      ortConfig: ort => { ort.env.wasm.numThreads = 1 },
      getStream: async () => stream, pauseStream: async () => {}, resumeStream: async value => value,
      positiveSpeechThreshold: .6, negativeSpeechThreshold: .4, redemptionMs: 700, minSpeechMs: 250, preSpeechPadMs: 300,
      onSpeechRealStart: () => {
        if (!valid()) return;
        if (env.audioMode() === 'speaker' && remoteActive && Math.max(0, ...recent) < Math.max(.03, floor * 8)) return;
        speechOn = true; speaking = true; flushPre();
      },
      onSpeechEnd: () => { if (!valid()) return; if (speechOn) sendUntil = performance.now() + 1800; speechOn = false; speaking = false },
      onVADMisfire: () => {},
      onFrameProcessed: p => { if (valid() && p.isSpeech > .5) lastSpeech = performance.now() },
    });
    if (!valid()) { safePromise(v.destroy()); return }
    vadInst = v; await v.start(); if (valid()) vadOk = true;
  } catch (_) { if (generation === vadEpoch) { vadOk = false; status() } }
}
function wanted() {
  const set = new Set(); limited = false;
  if (!room || !enabled() || !room.localParticipant.isMicrophoneEnabled) return set;
  const permissions = room.localParticipant.permissions, sources = permissions?.canPublishSources;
  if (permissions?.canPublish === false || (sources?.length && !sources.includes(2))) return set;
  room.remoteParticipants.forEach(p => { const h = meta(p).hear; if (allowedLanguage(h) && h !== me.speak) set.add(h) });
  if (!set.size && transcriptionRequested && allowedLanguage(me.speak)) set.add(me.speak);
  const maximum = Math.max(1, Math.min(12, Number(config.maxSessions) || 4));
  limited = set.size > maximum;
  return new Set([...set].sort().slice(0, maximum));
}
function reconcileSessions() {
  if (!room) return;
  const languages = wanted();
  for (const [lang, s] of sessions) if (!languages.has(lang) || !cap) { s.close(); sessions.delete(lang); dropOut(lang) }
  for (const lang of languages) if (cap && !sessions.has(lang)) { const s = new Sess(lang); sessions.set(lang, s); s.open() }
  status();
}
async function rewire() {
  const meeting = epoch;
  if (!room) return;
  const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
  const mst = pub?.track && !pub.isMuted ? pub.track.mediaStreamTrack : null;
  if (!wanted().size || !mst || mst.readyState !== 'live') { wireEpoch++; captureError = false; teardownCapture(); reconcileSessions(); return }
  if (cap?.mst === mst) { reconcileSessions(); return }
  const generation = ++wireEpoch;
  teardownCapture();
  try {
    const context = await ensureCtx();
    if (generation !== wireEpoch || meeting !== epoch || !room) return;
    if (context.state === 'suspended') await context.resume();
    if (generation !== wireEpoch || meeting !== epoch || !room || !wanted().size) return;
    const src = context.createMediaStreamSource(new MediaStream([mst]));
    const node = new AudioWorkletNode(context, 'wm-cap'), mute = context.createGain(); mute.gain.value = 0;
    src.connect(node); node.connect(mute).connect(context.destination);
    node.port.onmessage = e => { if (generation === wireEpoch && meeting === epoch) onChunk(e.data.pcm, e.data.rms, e.data.peak) };
    cap = { mst, src, node, mute }; captureError = false; startVad(mst);
  } catch (_) { if (meeting === epoch && generation === wireEpoch) { failures++; captureError = true } }
  if (meeting === epoch) reconcileSessions();
}
function onChunk(pcm, rms, peak) {
  if (!sessions.size || !room?.localParticipant.isMicrophoneEnabled) { pre = []; return }
  const now = performance.now();
  recent.push(rms); if (recent.length > 5) recent.shift();
  if (rms < .02) floor = floor * .985 + rms * .015;
  if (vadOk) {
    if (speechOn || now < sendUntil) fanout(pcm); else { pre.push(pcm); if (pre.length > PRE_MAX) pre.shift() }
    return;
  }
  let threshold = Math.max(.012, floor * 3.2);
  if (env.audioMode() === 'speaker' && remoteActive) threshold *= 2.6;
  conf.push(rms > threshold && peak / Math.max(rms, 1e-6) < 9); if (conf.length > 5) conf.shift();
  if (conf.filter(Boolean).length >= 3) {
    if (!speaking) { speaking = true; if (now > sendUntil) flushPre() }
    lastSpeech = now; sendUntil = now + TAIL_MS;
  }
  if (speaking && now - lastSpeech > 800) speaking = false;
  if (now < sendUntil) fanout(pcm); else { pre.push(pcm); if (pre.length > PRE_MAX) pre.shift() }
}
function fanout(pcm) {
  const value = b64(pcm); let sent = false;
  for (const s of sessions.values()) if (s.send(value)) sent = true;
  if (sent) sentSeconds += pcm.byteLength / 2 / 16000;
}

/* Bounded output queue. Sources are stopped on reconnect/language change/mute; old
   translated sentences can never continue in a newer provider session. */
function clearOutput(lang) {
  const o = outs.get(lang); if (!o) return;
  for (const source of o.sources) { try { source.onended = null; source.stop(); source.disconnect() } catch (_) {} }
  o.sources.clear(); o.next = 0;
  publish({ lang, active: false }, 'tr-health');
}
function getOut(lang) {
  let o = outs.get(lang); if (o) return o;
  if (!outCtx) outCtx = new AudioContext();
  if (outCtx.state === 'suspended') safePromise(outCtx.resume());
  const dest = outCtx.createMediaStreamDestination(), owner = room;
  const lt = new LivekitClient.LocalAudioTrack(dest.stream.getAudioTracks()[0], undefined, true);
  o = { dest, next: 0, lt, pub: null, sources: new Set() }; outs.set(lang, o);
  owner.localParticipant.publishTrack(lt, { name: 'tr-' + lang, source: Track.Source.Unknown, dtx: true }).then(pub => {
    if (room !== owner || outs.get(lang) !== o) { safePromise(owner.localParticipant.unpublishTrack(lt)); lt.stop(); return }
    o.pub = pub;
  }).catch(() => { if (outs.get(lang) === o) { dropOut(lang); sessions.get(lang)?.retry('output') } });
  return o;
}
function dropOut(lang) {
  const o = outs.get(lang); if (!o) return;
  clearOutput(lang); outs.delete(lang);
  try { if (room) safePromise(room.localParticipant.unpublishTrack(o.lt)); o.lt.stop(); o.dest.disconnect() } catch (_) {}
}
function playPcm(lang, data, mimeType = '') {
  if (!room || !sessions.get(lang)?.ready || typeof data !== 'string' || data.length > 768000) return;
  const rateMatch = /(?:^|;)rate=(\d+)/.exec(mimeType), sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
  if (sampleRate < 8000 || sampleRate > 48000 || (mimeType && !mimeType.startsWith('audio/pcm'))) return;
  let bin; try { bin = atob(data) } catch (_) { return }
  if (bin.length % 2 || !bin.length) return;
  const n = bin.length / 2, duration = n / sampleRate;
  // Never create an output publication for an oversized provider frame.
  if (duration > MAX_QUEUE_SECONDS) return;
  const o = getOut(lang);
  if (Math.max(0, o.next - outCtx.currentTime) + duration > MAX_QUEUE_SECONDS) clearOutput(lang);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) { let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8); if (v >= 32768) v -= 65536; samples[i] = v / 32768 }
  const buffer = outCtx.createBuffer(1, n, sampleRate); buffer.copyToChannel(samples, 0);
  const source = outCtx.createBufferSource(); source.buffer = buffer; source.connect(o.dest); o.sources.add(source);
  source.onended = () => { o.sources.delete(source); try { source.disconnect() } catch (_) {} };
  const at = Math.max(outCtx.currentTime + .04, o.next); source.start(at); o.next = at + buffer.duration;
}

class Sess {
  constructor(lang) {
    this.lang = lang; this.mode = transcriptionRequested && lang === me.speak ? 'transcript' : 'translation'; this.ws = null; this.ready = false; this.closing = false; this.backoff = 1000;
    this.attempt = 0; this.timer = null; this.setupTimer = null; this.expiryTimer = null; this.controller = null;
    this.state = 'connecting'; this.n = 0; this.id = null; this.orig = ''; this.trn = ''; this.lastFrag = 0; this.flushT = null;
    this.instance = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    this.inputSeconds = 0; this.connectedSeconds = 0; this.readyAt = 0; this.failureCount = 0; this.outputActive = false;
  }
  async open() {
    if (this.closing || !room || sessions.get(this.lang) !== this) return;
    const generation = ++this.attempt, owner = epoch; this.state = 'connecting'; status();
    const current = () => !this.closing && generation === this.attempt && owner === epoch && sessions.get(this.lang) === this;
    this.controller = new AbortController(); const timeout = setTimeout(() => this.controller?.abort(), 12000);
    let response, data;
    try {
      response = await fetch('api/gemini.php', { method: 'POST', signal: this.controller.signal, headers: { 'Content-Type': 'application/json', 'X-Meet-Token': me.ticket }, body: JSON.stringify({ lang: this.lang, mode: this.mode }) });
      data = await response.json();
      if (!response.ok || !data.token || !data.model) throw new Error('token_failed');
    } catch (_) {
      if (!current()) return;
      const permanent = response && ([401, 403, 410, 422].includes(response.status) || ['no_keys', 'no_key', 'translation_disabled', 'provider_disabled', 'feature_disabled', 'provider_config'].includes(data?.error));
      if (permanent) { this.state = 'unavailable'; this.failureCount++; failures++; status(); return }
      return this.retry(response?.status === 429 ? 'quota' : 'provider');
    } finally { clearTimeout(timeout); if (current()) this.controller = null }
    if (!current()) return;
    let ws;
    try { ws = new WebSocket(WSURL + encodeURIComponent(data.token)) } catch (_) { this.retry('provider'); return }
    this.ws = ws;
    this.setupTimer = setTimeout(() => { if (current()) this.retry('timeout') }, 15000);
    const expiresAt = Number(data.expiresAt) * (Number(data.expiresAt) < 1e12 ? 1000 : 1);
    if (Number.isFinite(expiresAt) && expiresAt > Date.now()) this.expiryTimer = setTimeout(() => { if (current()) this.retry('renewing', true) }, Math.max(1000, expiresAt - Date.now() - 15000));
    ws.onopen = () => {
      if (!current()) { ws.close(); return }
      ws.send(JSON.stringify({ setup: data.setup || { model: data.model,
        generationConfig: { responseModalities: ['AUDIO'], inputAudioTranscription: {}, outputAudioTranscription: {},
          translationConfig: { targetLanguageCode: this.lang, echoTargetLanguage: false } } } }));
    };
    ws.onmessage = async event => {
      if (!current()) return;
      try {
        if (typeof event.data === 'string' && event.data.length > 1024 * 1024) return;
        if (event.data?.size > 1024 * 1024) return;
        const text = typeof event.data === 'string' ? event.data : await event.data.text();
        if (current()) this.handle(JSON.parse(text));
      } catch (_) { /* A malformed upstream frame must not stop the meeting. */ }
    };
    ws.onclose = event => { if (current()) this.retry(event.code === 1008 ? 'quota' : 'provider') };
    ws.onerror = () => { if (current()) this.retry('provider') };
  }
  detach() {
    this.attempt++; this.ready = false;
    if (this.readyAt) { this.connectedSeconds += (performance.now() - this.readyAt) / 1000; this.readyAt = 0 }
    clearTimeout(this.setupTimer); clearTimeout(this.expiryTimer); clearTimeout(this.flushT); this.flushT = null;
    this.controller?.abort(); this.controller = null;
    const ws = this.ws; this.ws = null;
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close() } catch (_) {} }
    clearOutput(this.lang); this.outputActive = false; this.id = null; this.orig = ''; this.trn = '';
  }
  retry(reason, planned = false) {
    if (this.closing) return;
    this.detach(); clearTimeout(this.timer); this.state = reason;
    if (!planned) { failures++; this.failureCount++ }
    const delay = planned ? 250 : (reason === 'quota' ? Math.max(15000, this.backoff) : this.backoff) + Math.floor(Math.random() * 350);
    this.timer = setTimeout(() => this.open(), delay); this.backoff = Math.min(this.backoff * 2, 30000); status();
  }
  send(value) {
    if (!this.ready || this.ws?.readyState !== 1) return false;
    // Backpressure drops stale capture rather than queuing seconds of private audio.
    if (this.ws.bufferedAmount > 128000) { this.retry('network'); return false }
    try { this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: value, mimeType: 'audio/pcm;rate=16000' } } })); this.inputSeconds += .1; return true }
    catch (_) { this.retry('network'); return false }
  }
  handle(message) {
    if (!message || typeof message !== 'object') return;
    if (message.setupComplete !== undefined) { clearTimeout(this.setupTimer); this.ready = true; this.state = 'ready'; this.backoff = 1000; this.readyAt = performance.now(); status(); return }
    if (message.error) { this.retry('provider'); return }
    if (message.goAway) { this.retry('renewing', true); return }
    const content = message.serverContent; if (!content || !this.ready) return;
    if (content.interrupted) clearOutput(this.lang);
    if (typeof content.inputTranscription?.text === 'string') this.frag('orig', content.inputTranscription.text);
    if (typeof content.outputTranscription?.text === 'string') this.frag('trn', content.outputTranscription.text);
    for (const part of content.modelTurn?.parts || []) if (this.mode !== 'transcript' && part.inlineData?.data) playPcm(this.lang, part.inlineData.data, part.inlineData.mimeType);
    if (content.turnComplete) { clearTimeout(this.flushT); this.flushT = null; this.emit(); this.id = null; this.orig = ''; this.trn = '' }
  }
  frag(kind, text) {
    const now = performance.now(); if (!text || text.length > 2000) return;
    if (!this.id || now - this.lastFrag > GAP_MS || this.orig.length > 600 || this.trn.length > 800) {
      if (this.id) this.emit();
      this.id = this.instance + '-' + this.lang + '-' + (++this.n); this.orig = ''; this.trn = '';
    }
    this.lastFrag = now; this[kind] = (this[kind] + text).slice(0, 2000);
    if (!this.flushT) this.flushT = setTimeout(() => { this.flushT = null; this.emit() }, 250);
  }
  emit() {
    if (!this.id || (!this.orig && !this.trn) || !me || this.closing) return;
    const base = { from: me.identity, name: me.name, speak: me.speak };
    if (this.mode !== 'transcript') publish({ ...base, id: this.id, to: this.lang, orig: this.orig, trn: this.trn });
    if (this === primary()) {
      publish({ ...base, id: this.id + '-o', to: me.speak, orig: this.orig, trn: '' });
      env.addTx({ ...base, id: this.id + '-self', to: me.hear, orig: this.orig, trn: '' }, null, { to: this.lang, translated: this.mode === 'transcript' ? '' : this.trn });
    }
  }
  close() { if (this.closing) return; this.closing = true; clearTimeout(this.timer); this.detach(); reportUsage(this) }
}
const primary = () => sessions.get([...sessions.keys()].sort()[0]);
function reportUsage(session) {
  emit('wm:translation-usage', { provider: config.provider || 'gemini', lang: session.lang, inputSeconds: +session.inputSeconds.toFixed(1), sessionSeconds: +(session.connectedSeconds + (session.readyAt ? (performance.now() - session.readyAt) / 1000 : 0)).toFixed(1), failures: session.failureCount, sessionId: session.instance, clientReported: true });
}
function health() {
  return { provider: config.provider || 'gemini', enabled: enabled(), limited, captureError, activeSessions: [...sessions.values()].filter(s => s.ready).length, inputSeconds: +sentSeconds.toFixed(1), failures,
    vad: cap ? (vadOk ? 'speech-model' : 'loudness-fallback') : 'idle',
    sessions: [...sessions.values()].map(s => ({ lang: s.lang, ready: s.ready, state: s.state })) };
}
function status() {
  if (!env || !me) return;
  const langs = [...sessions.entries()].map(([lang, s]) => lang.toUpperCase() + (s.ready ? '' : '…'));
  env.trchip.textContent = !enabled() ? env.t('translation_disabled') : langs.length ? me.speak.toUpperCase() + ' → ' + langs.join(', ') : '—';
  emit('wm:translation-status', health());
}
function listen(event, callback) { room.on(event, callback); handlers.push([event, callback]) }
function tick() {
  outputHealth(); applyVolumes();
  const now = performance.now();
  for (const [key, value] of remoteHealth) if (now - value.received > 10000) remoteHealth.delete(key);
  if (now - lastUsage > 15000) { lastUsage = now; for (const s of sessions.values()) reportUsage(s); status() }
}
window.WMT = {
  init(e) {
    if (room) this.shutdown();
    epoch++; env = e; room = e.room; me = e.me; config = e.config || {};
    Track = LivekitClient.Track; RoomEvent = LivekitClient.RoomEvent;
    sentSeconds = 0; failures = 0; limited = false; captureError = false; transcriptionRequested = false; floor = .004; lastUsage = performance.now();
    listen(RoomEvent.TrackPublished, pub => manage(pub));
    listen(RoomEvent.TrackUnpublished, () => applyVolumes());
    listen(RoomEvent.TrackSubscribed, () => applyVolumes());
    listen(RoomEvent.TrackUnsubscribed, () => applyVolumes());
    listen(RoomEvent.ParticipantConnected, () => { manageAll(); rewire() });
    listen(RoomEvent.ParticipantDisconnected, p => { pers.delete(p.identity); for (const key of remoteHealth.keys()) if (key.startsWith(p.identity + ':')) remoteHealth.delete(key); rewire(); applyVolumes() });
    listen(RoomEvent.ParticipantMetadataChanged, () => { manageAll(); rewire(); applyVolumes() });
    for (const event of [RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished]) listen(event, pub => { if (pub.source === 'microphone') rewire() });
    for (const event of [RoomEvent.TrackMuted, RoomEvent.TrackUnmuted]) listen(event, (pub, p) => { if (p === room?.localParticipant && pub.source === 'microphone') rewire(); applyVolumes() });
    listen(RoomEvent.ParticipantPermissionsChanged, () => rewire());
    listen(RoomEvent.ActiveSpeakersChanged, participants => { remoteActive = participants.some(p => p !== room?.localParticipant) });
    listen(RoomEvent.DataReceived, receiveHealth);
    listen(RoomEvent.Reconnecting, () => { wireEpoch++; teardownCapture(); for (const s of sessions.values()) s.close(); sessions.clear(); for (const lang of [...outs.keys()]) dropOut(lang); remoteHealth.clear(); applyVolumes(); status() });
    listen(RoomEvent.Reconnected, () => { manageAll(); rewire() });
    env.trvol.oninput = () => { vol.tr = Number(env.trvol.value) / 100; const output = document.getElementById('trval'); if (output) output.textContent = env.trvol.value + '%'; applyVolumes() };
    env.muteorig.onclick = () => { env.muteorig.classList.toggle('on'); vol.muteOrig = env.muteorig.classList.contains('on'); env.muteorig.setAttribute('aria-pressed', String(vol.muteOrig)); applyVolumes() };
    vol.tr = Number(env.trvol.value) / 100; vol.muteOrig = env.muteorig.classList.contains('on');
    tickTimer = setInterval(tick, 600); status();
  },
  shutdown() {
    epoch++; wireEpoch++;
    for (const s of sessions.values()) s.close(); sessions.clear();
    for (const lang of [...outs.keys()]) dropOut(lang);
    for (const [event, callback] of handlers) { try { room?.off(event, callback) } catch (_) {} } handlers = [];
    teardownCapture(); clearInterval(tickTimer); tickTimer = null;
    for (const context of [capCtx, outCtx]) if (context) { try { safePromise(context.close()) } catch (_) {} }
    capCtx = capReady = outCtx = null; transcriptionRequested = false; remoteActive = false; remoteHealth.clear(); pers.clear(); room = null; env = null; me = null;
  },
  afterConnect() { manageAll(); rewire() },
  rewire,
  changeLanguages() {
    wireEpoch++; for (const s of sessions.values()) s.close(); sessions.clear();
    for (const lang of [...outs.keys()]) dropOut(lang);
    remoteHealth.clear(); teardownCapture(); manageAll(); applyVolumes(); rewire();
  },
  setTranscriptionRequested(value) {
    const next = value === true; if (next === transcriptionRequested) return;
    transcriptionRequested = next; rewire();
  },
  retry() { for (const s of sessions.values()) { s.detach(); clearTimeout(s.timer); s.backoff = 1000; s.open() } rewire() },
  setMaster(value) { master = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1; applyVolumes() },
  getPerson(pid) { const x = pers.get(pid); return { vol: x ? x.vol : 1, muted: !!x?.muted } },
  setPerson(pid, value) { const x = pers.get(pid) || { vol: 1, muted: false }; if (Number.isFinite(value.vol)) x.vol = Math.max(0, Math.min(1, value.vol)); if (value.muted !== undefined) x.muted = !!value.muted; pers.set(pid, x); applyVolumes() },
  // Heavy VAD/WASM/model downloads start only when an actual translation target exists.
  preload() {},
  health,
  debug: health,
};
})();
