/* Auto Translate Meeting - home page calendar. Visitors see the team's free / taken times and request a meeting in a dialog.
   Texts come from assets/i18n/book/<lang>.json (own language, then English, then Turkish). app.js tells us when the language changes. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
if (new URLSearchParams(location.search).get('r')) return;            // someone with a room link never needs the calendar
let requestMemo = null;
function bookingRequestId(payload) { const fingerprint=JSON.stringify(payload); if (!requestMemo || requestMemo.fingerprint!==fingerprint) requestMemo={fingerprint,id:crypto.randomUUID()}; return requestMemo.id; }
async function requestJson(url, options = {}, timeout = 30000) {
  const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), timeout);
  try { const response = await fetch(url, { ...options, signal: controller.signal }); const data = await response.json(); if (!response.ok) throw new Error(data.error || String(response.status)); return data; }
  finally { clearTimeout(deadline); }
}
function meetingLanguages() {
  const codes = window.MeetConfig?.translation?.languages || ['en'];
  const names = new Map(I().LANGS);
  return codes.map(code => { let name = names.get(code); try { name ||= new Intl.DisplayNames([I().lang()], { type: 'language' }).of(code) } catch (_) {} return [code, name || code] });
}
function safeManagementUrl(value) { try { const url = new URL(value, location.href); return url.origin === location.origin && url.pathname === '/randevu/manage/' ? url.href : ''; } catch (_) { return ''; } }

const API = 'api/book.php';
const I = () => window.WMI;                                           // helpers from app.js: lang(), paint(), toast(), LANGS
const cats = {};
const T = (k, v) => { const L = I().lang(); let s = (cats[L] && cats[L][k]) || (cats.en && cats.en[k]) || (cats.tr && cats.tr[k]) || k; if (v) for (const x in v) s = s.replace('{' + x + '}', v[x]); return s };
async function loadCats() {
  const L = I().lang();
  for (const c of new Set(['tr', 'en', L])) {
    if (cats[c]) continue;
    try { cats[c] = await requestJson('assets/i18n/book/' + c + '.json?v=3', { cache: 'force-cache' }, 10000) } catch (e) {}
  }
}

const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch (e) { return 'UTC' } })();
let free = new Set(), taken = new Set(), byDay = new Map(), loaded = false, failed = '';
let vy = 0, vm = 0, sel = '', chosen = 0;
const dayOf = ts => { const d = new Date(ts * 1000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') };                    // yyyy-mm-dd in the visitor's own time zone
const key = (y, m, d) => y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
const fmt = (ts, o) => new Intl.DateTimeFormat(I().lang(), o).format(new Date(ts * 1000));

async function load() {
  loaded = false; failed = ''; renderAll();
  try {
    const j = await requestJson(API, { cache: 'no-store' });
    free = new Set(j.slots || []); taken = new Set(j.taken || []);
  } catch (e) { failed = e.message === 'rate' ? 'b_rate' : 'b_load_err'; loaded = true; renderAll(); return }
  byDay = new Map();
  for (const t of [...free, ...taken].sort((a, b) => a - b)) { const k = dayOf(t); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(t) }
  loaded = true;
  const firstFree = [...free].sort((a, b) => a - b)[0];
  const first = firstFree ? dayOf(firstFree) : [...byDay.keys()][0];
  if (!sel || !byDay.has(sel)) sel = first || '';
  if (sel) { const [y, m] = sel.split('-'); vy = +y; vm = +m - 1 } else { const n = new Date(); vy = n.getFullYear(); vm = n.getMonth() }
  renderAll();
}

function applyTexts() {
  document.querySelectorAll('[data-bt]').forEach(e => e.textContent = T(e.dataset.bt));
  $('cprev').title = T('b_prev'); $('cprev').setAttribute('aria-label', T('b_prev')); $('cnext').title = T('b_next'); $('cnext').setAttribute('aria-label', T('b_next'));
  $('bkm-close').title = T('b_close'); $('bkm-close').setAttribute('aria-label', T('b_close'));
  $('bk-note').placeholder = T('b_note_ph');
}
function renderDow() {
  const box = $('cdow'); box.innerHTML = '';
  for (let i = 0; i < 7; i++) { const s = document.createElement('span'); s.textContent = fmt(Date.UTC(2024, 0, 1 + i, 12) / 1000, { weekday: 'short', timeZone: 'UTC' }); box.appendChild(s) }   // 1 Jan 2024 is a Monday
}
function renderGrid() {
  const g = $('cgrid'); g.innerHTML = '';
  const first = new Date(vy, vm, 1), lead = (first.getDay() + 6) % 7, days = new Date(vy, vm + 1, 0).getDate();
  $('cmonth').textContent = new Intl.DateTimeFormat(I().lang(), { month: 'long', year: 'numeric' }).format(first);
  const todayK = dayOf(Date.now() / 1000);
  for (let i = 0; i < 42; i++) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cday'; const d = i - lead + 1;
    if (d < 1 || d > days) { b.className += ' blank'; b.disabled = true; b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); g.appendChild(b); continue }
    const k = key(vy, vm, d), list = byDay.get(k), nFree = list ? list.filter(t => free.has(t)).length : 0;
    b.textContent = d; b.setAttribute('role', 'gridcell');
    if (k === todayK) b.classList.add('today');
    if (list) {
      b.classList.add(nFree ? 'avail' : 'full'); b.setAttribute('aria-selected', String(k === sel)); if (k === sel) b.classList.add('sel');
      b.title = nFree ? T('b_slots', { n: nFree }) : T('b_taken_lbl');
      b.onclick = () => { sel = k; renderGrid(); renderTimes() };
    } else { b.disabled = true; b.tabIndex = -1 }
    g.appendChild(b);
  }
  const mk = (y, m) => y * 12 + m, keys = [...byDay.keys()];
  const lo = keys.length ? keys[0].split('-') : null, hi = keys.length ? keys[keys.length - 1].split('-') : null;
  $('cprev').disabled = !lo || mk(vy, vm) <= mk(+lo[0], +lo[1] - 1); $('cnext').disabled = !hi || mk(vy, vm) >= mk(+hi[0], +hi[1] - 1);
}
function renderTimes() {
  const box = $('ctimes'), note = $('ct-note'); box.innerHTML = ''; note.textContent = ''; note.classList.remove('err');
  $('ct-tz').textContent = loaded && !failed ? T('b_tz', { tz: tz.replace('_', ' ') }) : '';
  if (!loaded) { $('ct-day').textContent = ''; note.textContent = T('b_loading'); return }
  if (failed) { $('ct-day').textContent = ''; note.textContent = T(failed); note.classList.add('err'); return }
  if (!byDay.size) { $('ct-day').textContent = ''; note.textContent = T('b_no_slots'); return }
  const list = sel ? byDay.get(sel) : null;
  if (!list) { $('ct-day').textContent = ''; note.textContent = T('b_pick_hint'); return }
  $('ct-day').textContent = fmt(list[0], { weekday: 'long', day: 'numeric', month: 'long' });
  for (const t of list) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ctm'; b.setAttribute('role', 'option');
    const ok = free.has(t); b.textContent = fmt(t, { hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset' });
    if (ok) b.onclick = () => openModal(t); else { b.classList.add('taken'); b.disabled = true; b.title = T('b_taken_lbl'); b.setAttribute('aria-label', b.textContent + ' · ' + T('b_taken_lbl')) }
    box.appendChild(b);
  }
}
function renderAll() { applyTexts(); renderDow(); renderGrid(); renderTimes(); if (I().paint) I().paint() }

/* ---------- request dialog ---------- */
const modal = $('bkmodal'); let lastFocus = null, langReady = false, sending = false;
function openModal(ts) {
  if (sending) return;
  chosen = ts; lastFocus = document.activeElement;
  if (!langReady) { for (const [c, n] of meetingLanguages()) { const o = document.createElement('option'); o.value = c; o.textContent = n; $('bk-lang').appendChild(o) } langReady = true; if (window.WMSelect) WMSelect.enhance($('bk-lang')) }
  const codes = meetingLanguages().map(([code]) => code); $('bk-lang').value = codes.includes(I().lang()) ? I().lang() : codes[0];
  $('bk-when').textContent = fmt(ts, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  $('bkform').hidden = false; $('bk-done').hidden = true; $('bk-err').textContent = '';
  modal.classList.add('on'); setTimeout(() => $('bk-name').focus(), 30);
}
function closeModal() { if (!modal.classList.contains('on')) return; modal.classList.remove('on'); if (lastFocus && lastFocus.focus) { try { lastFocus.focus() } catch (e) {} } }
$('bkm-close').onclick = closeModal; $('bk-ok').onclick = closeModal;
modal.addEventListener('click', e => { if (e.target === modal) closeModal() });
addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('on')) closeModal() });

$('bkform').onsubmit = async ev => {
  ev.preventDefault(); if (sending) return;
  const btn = $('bk-send'), err = $('bk-err'); err.textContent = '';
  const name = $('bk-name').value.trim(), email = $('bk-email').value.trim();
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = T('b_invalid'); return }
  sending = true; btn.disabled = true; btn.firstElementChild.textContent = T('b_sending');
  try {
    const payload = { action: 'request', slot: chosen, name, email, company: $('bk-company').value.trim(), note: $('bk-note').value.trim(), lang: $('bk-lang').value, tz, website: $('bk-web').value }; payload.requestId = bookingRequestId(payload);
    const j = await requestJson(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 60000);
    const success = $('bk-done'); success.querySelectorAll('.booking-result-link').forEach(e=>e.remove());
    const managementUrl = safeManagementUrl(j.manageUrl); if (managementUrl) { const a=document.createElement('a'); a.className='booking-result-link go'; a.href=managementUrl; a.textContent=T('b_manage'); success.appendChild(a); }
    if (!j.notifications || !j.notifications.visitor) { const n=document.createElement('p'); n.className='booking-result-link'; n.textContent=T('b_mail_pending'); success.appendChild(n); }
    requestMemo=null;
    $('bk-donewhen').textContent = fmt(chosen, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' · ' + tz.replace('_', ' ');
    $('bkform').hidden = true; $('bk-done').hidden = false; $('bk-name').value = ''; $('bk-note').value = ''; load();
    setTimeout(() => $('bk-ok').focus(), 30);
  } catch (e) {
    err.textContent = T({ slot_taken: 'b_taken', rate: 'b_rate', invalid: 'b_invalid' }[e.message] || 'b_err');
    if (e.message === 'slot_taken') { closeModal(); load() }
  }
  sending = false; btn.disabled = false; btn.firstElementChild.textContent = T('b_send');
};
$('cprev').onclick = () => { vm--; if (vm < 0) { vm = 11; vy-- } renderGrid() };
$('cnext').onclick = () => { vm++; if (vm > 11) { vm = 0; vy++ } renderGrid() };

/* app.js calls this once the language is known and whenever it changes */
window.WMHome = { async onLang() { await loadCats(); renderAll() }, start: async () => { const config = await window.MeetConfigReady; if (!config.features.booking) return; await loadCats(); renderAll(); load() } };
})();
