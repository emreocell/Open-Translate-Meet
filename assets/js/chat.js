/* Auto Translate Meeting - room chat with image/video attachments.
   Text travels over the LiveKit data channel (topic "chat") and is never stored. Files go through api/upload.php (validated,
   re-encoded, private, deleted after 24 h) and are shown through signed links. Everything a participant sends is treated as
   untrusted: text is rendered with textContent, file links must match our own signed-link pattern, names come from LiveKit. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const MAX = { image: 32 * 1024 * 1024, video: 100 * 1024 * 1024 };
const KIND = { 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'video/mp4': 'video', 'video/webm': 'video' };
const EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm' };
const enc = new TextEncoder(), dec = new TextDecoder();
let env = null, room = null, me = null, unread = 0, ups = new Set(), lastSend = 0, wired = false, generation = 0, dataHandler = null, sending = false;
const messageGate = new window.WMCore.MessageGate();
let autoTranslate = false, translationEpoch = 0, translationQueue = [];
const translationControllers = new Set(), translationCache = new Map();
const currentMe = () => window.WM?.me || me;

const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t = (k, v) => env ? env.t(k, v) : (window.WMI?.t ? window.WMI.t(k, v) : k);

function typeOf(file) { let ty = (file.type || '').toLowerCase(); if (!KIND[ty]) { const m = /\.([a-z0-9]+)$/i.exec(file.name || ''); ty = m ? (EXT[m[1].toLowerCase()] || ty) : ty } return ty }

/* ---------- visibility, tabs, unread ---------- */
const side = () => $('side');
const chatVisible = () => !!room && getComputedStyle(side()).display !== 'none' && $('pane-chat').classList.contains('on') && !document.hidden;   // computed style: the mobile drawer is position:fixed
function setTab(name) {
  $('tab-tx').classList.toggle('on', name === 'tx'); $('tab-chat').classList.toggle('on', name === 'chat');
  $('tab-tx').setAttribute('aria-selected', String(name === 'tx')); $('tab-chat').setAttribute('aria-selected', String(name === 'chat'));
  $('pane-tx').classList.toggle('on', name === 'tx'); $('pane-chat').classList.toggle('on', name === 'chat');
  if (name === 'chat') { clearUnread(); scrollDown() }
}
function bump() { unread++; $('unread').textContent = unread > 99 ? '99+' : String(unread); $('unread').hidden = false; $('chatdot').hidden = false }
function clearUnread() { unread = 0; $('unread').hidden = true; $('chatdot').hidden = true }
const scrollDown = () => { const l = $('chatlist'); l.scrollTop = l.scrollHeight };
function openChat() {
  const r = $('room');
  if (matchMedia('(max-width:1100px)').matches) r.classList.add('sideopen'); else { r.classList.remove('noside'); $('cap').classList.add('on') }
  setTab('chat'); setTimeout(() => $('chatin').focus(), 50);
}

/* ---------- rendering ---------- */
function linkify(el, text) {
  const re = /https?:\/\/[^\s<>"']+/g; let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement('a'); a.textContent = m[0]; a.href = m[0]; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; el.appendChild(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}
function render(m, name, mine) {
  const list = $('chatlist'); const empty = list.querySelector('.chatnote'); if (empty) empty.remove();
  const el = document.createElement('div'); el.className = 'cm' + (mine ? ' me' : ''); el._message = m; el._mine = mine;
  const h = document.createElement('div'); h.className = 'cm-h';
  const n = document.createElement('span'); n.className = 'cm-n'; n.textContent = mine ? t('you') : name; n.title = name;
  const tm = document.createElement('time'); tm.textContent = fmtTime(m.ts); h.append(n, tm); el.appendChild(h);
  if (m.text) { const b = document.createElement('div'); b.className = 'cm-b'; linkify(b, m.text); el.appendChild(b) }
  if (m.file) {
    const f = m.file, fig = document.createElement('figure'); fig.className = 'cm-f';
    if (f.kind === 'image') {
      const img = document.createElement('img'); img.loading = 'lazy'; img.decoding = 'async'; img.alt = f.name; img.referrerPolicy = 'no-referrer'; img.src = f.url;
      img.onclick = () => openLightbox(f.url, f.name); img.onerror = () => { fig.replaceChildren(expired()) }; fig.appendChild(img);
    } else {
      const v = document.createElement('video'); v.controls = true; v.preload = 'metadata'; v.playsInline = true; v.src = f.url; v.onerror = () => { fig.replaceChildren(expired()) }; fig.appendChild(v);
    }
    const cap = document.createElement('figcaption'); cap.textContent = f.name + ' · ' + fmtSize(f.size); fig.appendChild(cap); el.appendChild(fig);
  }
  const near = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.appendChild(el); while (list.children.length > 300) list.firstElementChild.remove(); if (near || mine) scrollDown();
  if (!mine && m.text && autoTranslate) queueTranslation(el);
  return el;
}
const expired = () => { const d = document.createElement('div'); d.className = 'cm-x'; d.textContent = t('file_expired'); return d };
function openLightbox(url, name) { $('lbx-img').src = url; $('lbx-img').alt = name; $('lightbox').hidden = false }
function closeLightbox() { $('lightbox').hidden = true; $('lbx-img').removeAttribute('src') }

/* ---------- receiving (every field is validated) ---------- */
function onData(payload, participant) {
  if (!room || !participant || !room.remoteParticipants.has(participant.identity) || payload.byteLength > 12000) return;
  let value; try { value = JSON.parse(dec.decode(payload)) } catch (_) { return }
  const message = window.WMCore.normalizeChat(value, participant, me.room, Date.now());
  if (!message || !messageGate.accept(message, performance.now())) return;
  render(message, message.name || t('guest'), false);
  if (!chatVisible()) bump();
}

/* ---------- sending ---------- */
async function sendMessage({ text, file }) {
  if (!room || !me) return false;
  const owner = generation, msg = { id: crypto.randomUUID(), from: me.identity, ts: Date.now() };
  if (text) msg.text = text; if (file) msg.file = { url: file.url, kind: file.kind, type: file.type, size: file.size, name: file.name };
  try {
    await room.localParticipant.publishData(enc.encode(JSON.stringify(msg)), { reliable: true, topic: 'chat' });
    if (owner !== generation || !room) return false;
    render(msg, me.name, true); return true;
  } catch (_) { if (owner === generation) env.toast(t(file ? 'upload_failed' : 'chat_send_failed')); return false }
}
async function sendText() {
  const textarea = $('chatin'), text = textarea.value.trim(); if (!text || sending || !room) return;
  const now = Date.now(), owner = generation; if (now - lastSend < 300) return; lastSend = now; sending = true; $('chatsend').disabled = true;
  try { if (await sendMessage({ text: text.slice(0, 2000) })) { if (textarea.value.trim() === text) textarea.value = ''; autoGrow() } }
  finally { if (owner === generation) { sending = false; $('chatsend').disabled = false } }
}

const autoGrow = () => { const ta = $('chatin'); ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px' };

/* ---------- uploads ---------- */
async function api(action, query, body, raw, job) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (job.signal?.aborted) throw new Error('cancel');
  job.signal?.addEventListener('abort', cancel, { once: true });
  const deadline = setTimeout(cancel, action === 'finish' ? 65000 : 30000);
  try {
    const response = await fetch('api/upload.php?a=' + action + (query || ''), { method: 'POST', signal: controller.signal,
      headers: { 'X-Meet-Token': job.ticket, 'Content-Type': raw ? 'application/octet-stream' : 'application/json' }, body: raw ? body : JSON.stringify(body || {}) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(result.error || String(response.status)); error.status = response.status; error.kind = result.kind; throw error }
    return result;
  } catch (error) { if (job.signal?.aborted) throw new Error('cancel'); throw error }
  finally { clearTimeout(deadline); job.signal?.removeEventListener('abort', cancel) }
}
function cancelUpload(job) {
  job.controller.abort();
  if (job.id && !job.finished) {
    fetch('api/upload.php?a=cancel&id=' + encodeURIComponent(job.id), { method: 'POST', keepalive: true, headers: { 'X-Meet-Token': job.ticket, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  }
}

function errText(e) {
  const k = e && e.message;
  if (k === 'bad_type') return t('file_type');
  if (k === 'too_large') return t(e.kind === 'image' ? 'file_big_img' : 'file_big_vid');
  if (k === 'content_mismatch' || k === 'media_invalid' || k === 'image_dimensions' || k === 'empty') return t('file_invalid');
  if (k === 'quota') return t('file_quota');
  if (k === 'rate') return t('file_rate');
  if (k === 'cancel') return t('upload_cancelled');
  return t('upload_failed');
}
function uploadRow(file) {
  const row = document.createElement('div'); row.className = 'up';
  row.innerHTML = '<span class="un"></span><button type="button"></button><span class="us"></span><div class="bar"><i></i></div>';
  row.querySelector('.un').textContent = file.name; row.querySelector('button').textContent = t('cancel_up');
  const us = row.querySelector('.us'), bar = row.querySelector('.bar i'); us.textContent = fmtSize(file.size) + ' · ' + t('uploading');
  $('uploads').appendChild(row);
  return {
    cancel: row.querySelector('button'),
    set(p, label) { bar.style.width = Math.round(p * 100) + '%'; us.textContent = fmtSize(file.size) + ' · ' + (label || Math.round(p * 100) + '%') },
    done() { row.remove() },
    fail(msg) { row.classList.add('err'); us.textContent = msg; row.querySelector('.bar').remove(); const b = row.querySelector('button'); b.textContent = '✕'; b.onclick = () => row.remove(); setTimeout(() => row.remove(), 9000) },
  };
}
async function uploadFile(file) {
  if (!room || !me) return;
  if (ups.size >= 2) return env.toast(t('upload_concurrency'));
  const type = typeOf(file), kind = KIND[type];
  if (!kind) return env.toast(t('file_type'));
  if (file.size < 1) return env.toast(t('file_invalid'));
  if (file.size > MAX[kind]) return env.toast(t(kind === 'image' ? 'file_big_img' : 'file_big_vid'));
  const ui = uploadRow(file), controller = new AbortController();
  const job = { controller, signal: controller.signal, ticket: me.ticket, generation, id: null, finished: false };
  ui.cancel.onclick = () => cancelUpload(job); ups.add(job);
  const check = () => { if (job.signal.aborted || job.generation !== generation || !room) throw new Error('cancel') };
  try {
    const init = await api('init', '', { name: file.name, type, size: file.size }, false, job);
    if (!/^[a-f0-9]{16}$/.test(init.id || '') || !Number.isSafeInteger(init.chunk) || init.chunk < 65536 || init.chunk > 8 * 1024 * 1024) throw new Error('upload_failed');
    job.id = init.id; check(); let index = 0;
    for (let offset = 0; offset < file.size; offset += init.chunk) {
      check(); const blob = file.slice(offset, offset + init.chunk); let tries = 0;
      for (;;) {
        check();
        try { await api('chunk', '&id=' + job.id + '&i=' + index, blob, true, job); break }
        catch (error) { if (job.signal.aborted || ++tries >= 3 || (error.status >= 400 && error.status < 500 && error.status !== 429)) throw error; await sleep(700 * tries) }
      }
      index++; if (job.generation === generation) ui.set(Math.min(.9, (offset + blob.size) / file.size * .9));
    }
    check(); ui.set(.95, t('processing'));
    const result = await api('finish', '&id=' + job.id, {}, false, job); job.finished = true; check();
    if (!result.file) throw new Error('upload_failed');
    ui.done(); await sendMessage({ file: result.file });
  } catch (error) {
    const cancelled = job.signal.aborted || job.generation !== generation;
    if (job.id && !job.finished) cancelUpload(job);
    if (job.generation === generation) ui.fail(errText(cancelled ? new Error('cancel') : error)); else ui.done();
  } finally { ups.delete(job) }
}

/* ---------- optional text translation (explicit per-meeting opt-in) ---------- */
function ensureTranslationControl() {
  let control = $('chat-translation-control');
  if (!control) {
    control = document.createElement('div'); control.id = 'chat-translation-control'; control.className = 'chat-translation-control';
    control.innerHTML = '<label><input type="checkbox" id="chat-translate"><span id="chat-translate-label"></span></label><small id="chat-translate-notice"></small>';
    $('pane-chat').prepend(control);
    $('chat-translate').onchange = () => {
      autoTranslate = $('chat-translate').checked;
      if (!autoTranslate) { abortTranslations(); restoreTranslations() }
      refreshTranslationLabels();
    };
  }
  control.hidden = !window.WM?.features?.chatTranslation;
  autoTranslate = false; $('chat-translate').checked = false; refreshTranslationLabels();
}
function refreshTranslationLabels() {
  if (!$('chat-translate-label')) return;
  $('chat-translate-label').textContent = t('chat_auto_translate');
  $('chat-translate-notice').textContent = t('chat_translation_notice');
  document.querySelectorAll('.cm-original summary').forEach(element => { element.textContent = t('chat_original') });
}
function abortTranslations() {
  translationEpoch++; translationQueue = [];
  for (const controller of translationControllers) controller.abort(); translationControllers.clear();
}
function restoreTranslation(element) {
  const details = element.querySelector('.cm-original');
  if (details) { const original = details.querySelector('.cm-b'); if (original) element.insertBefore(original, details); details.remove() }
  element.querySelector('.cm-translated')?.remove(); element.querySelector('.cm-translation-state')?.remove();
  element._translationPending = false;
}
function restoreTranslations() { $('chatlist').querySelectorAll('.cm').forEach(restoreTranslation) }
function queueTranslation(element) {
  const message = element._message, to = currentMe()?.hear, from = message?.speak;
  if (!room || !autoTranslate || element._mine || !message?.text || !window.WMCore.validLanguage(from) || !window.WMCore.validLanguage(to) || from === to || element._translationPending) return;
  element._translationPending = true;
  const state = document.createElement('small'); state.className = 'cm-translation-state'; state.textContent = t('translating'); element.appendChild(state);
  const item = { element, state, from, to, text: message.text, generation, epoch: translationEpoch, key: from + '\u0000' + to + '\u0000' + message.text };
  if (translationCache.has(item.key)) { displayTranslation(item, translationCache.get(item.key)); return }
  if (translationQueue.length >= 30) { state.textContent = t('chat_translation_failed'); element._translationPending = false; return }
  translationQueue.push(item); pumpTranslation();
}
function displayTranslation(item, text) {
  const { element, state } = item;
  if (!element.isConnected || item.generation !== generation || item.epoch !== translationEpoch || !autoTranslate || currentMe()?.hear !== item.to) return;
  const original = element.querySelector('.cm-b'); if (!original) return;
  state.remove(); element._translationPending = false;
  const translated = document.createElement('div'); translated.className = 'cm-b cm-translated'; translated.lang = item.to; linkify(translated, text);
  const details = document.createElement('details'); details.className = 'cm-original';
  const summary = document.createElement('summary'); summary.textContent = t('chat_original'); details.append(summary, original);
  element.append(translated, details); if (chatVisible()) scrollDown();
}
function pumpTranslation() {
  while (room && autoTranslate && translationControllers.size < 2 && translationQueue.length) {
    const item = translationQueue.shift(); if (!item.element.isConnected || item.generation !== generation || item.epoch !== translationEpoch) continue;
    const controller = new AbortController(); translationControllers.add(controller);
    const deadline = setTimeout(() => controller.abort(), 20000);
    (async () => {
      try {
        const response = await fetch('api/text-translate.php', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-Meet-Token': currentMe().ticket }, body: JSON.stringify({ text: item.text, from: item.from, to: item.to }) });
        const result = await response.json();
        if (!response.ok || typeof result.text !== 'string' || result.text.length > 6000) throw new Error('translation_failed');
        if (item.generation !== generation || item.epoch !== translationEpoch) return;
        translationCache.delete(item.key); translationCache.set(item.key, result.text);
        if (translationCache.size > 256) translationCache.delete(translationCache.keys().next().value);
        displayTranslation(item, result.text);
      } catch (_) {
        if (item.generation === generation && item.epoch === translationEpoch && item.element.isConnected) { item.state.textContent = t('chat_translation_failed'); item.element._translationPending = false }
      } finally { clearTimeout(deadline); translationControllers.delete(controller); pumpTranslation() }
    })();
  }
}
document.addEventListener('wm:languages', () => {
  abortTranslations(); restoreTranslations();
  if (autoTranslate) [...$('chatlist').querySelectorAll('.cm')].slice(-20).forEach(queueTranslation);
});

/* ---------- wiring ---------- */
function wire() {
  if (wired) return; wired = true;
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $('composer').onsubmit = e => { e.preventDefault(); sendText() };
  $('chatin').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendText() } });
  $('chatin').addEventListener('input', autoGrow);
  $('attach').onclick = () => $('filein').click();
  $('filein').onchange = e => { for (const f of e.target.files) uploadFile(f); e.target.value = '' };
  $('chatin').addEventListener('paste', e => { for (const it of (e.clipboardData && e.clipboardData.items) || []) { if (it.kind === 'file') { const f = it.getAsFile(); if (f && KIND[typeOf(f)]) { e.preventDefault(); uploadFile(f) } } } });
  const s = side();
  ['dragenter', 'dragover'].forEach(ev => s.addEventListener(ev, e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); s.classList.add('dropping') } }));
  ['dragleave', 'drop'].forEach(ev => s.addEventListener(ev, e => { e.preventDefault(); s.classList.remove('dropping') }));
  s.addEventListener('drop', e => { for (const f of (e.dataTransfer && e.dataTransfer.files) || []) { openChat(); uploadFile(f) } });
  $('chatbtn').onclick = () => { if (chatVisible() && matchMedia('(max-width:1100px)').matches) $('room').classList.remove('sideopen'); else openChat() };
  $('sclose').onclick = () => $('room').classList.remove('sideopen');
  $('lbx-close').onclick = closeLightbox; $('lightbox').onclick = e => { if (e.target.id === 'lightbox') closeLightbox() };
  addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox() });
  document.addEventListener('visibilitychange', () => { if (chatVisible()) clearUnread() });
}
function reset() {
  messageGate.clear(); clearUnread(); closeLightbox();
  const l = $('chatlist'); l.innerHTML = ''; const note = document.createElement('div'); note.className = 'chatnote'; note.textContent = t('chat_empty') + ' ' + t('chat_note'); l.appendChild(note);
  $('uploads').innerHTML = ''; $('chatin').value = ''; autoGrow(); setTab('tx');
}

window.WMC = {
  init(e) {
    if (room) this.shutdown(); generation++; env = e; room = e.room; me = e.me; wire(); reset(); ensureTranslationControl();
    dataHandler = (payload, p, kind, topic) => { if (topic === 'chat') onData(payload, p) };
    room.on(window.LivekitClient.RoomEvent.DataReceived, dataHandler);
  },
  shutdown() { generation++; for (const job of ups) cancelUpload(job); ups.clear(); if (room && dataHandler) room.off(window.LivekitClient.RoomEvent.DataReceived, dataHandler); dataHandler = null; abortTranslations(); translationCache.clear(); autoTranslate = false; sending = false; room = null; me = null; reset(); $('chatsend').disabled = false; $('room').classList.remove('sideopen') },
  refreshLang() { refreshTranslationLabels(); const n = $('chatlist').querySelector('.chatnote'); if (n && env) n.textContent = t('chat_empty') + ' ' + t('chat_note') },
};
})();
