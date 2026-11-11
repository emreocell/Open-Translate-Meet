/* Auto Translate Meeting - meeting request page. Visitors pick a free slot (read from the team's calendar by the server) and send a request. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const LS = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v) } catch (e) { return null } };
const LANGS = [['tr','Türkçe'],['en','English'],['de','Deutsch'],['fr','Français'],['es','Español'],['it','Italiano'],['nl','Nederlands'],['pt','Português'],['pl','Polski'],['ru','Русский'],['ar','العربية'],['ja','日本語']];
const CODES = LANGS.map(l => l[0]);
let requestMemo = null;
function bookingRequestId(payload) { const fingerprint=JSON.stringify(payload); if (!requestMemo || requestMemo.fingerprint!==fingerprint) requestMemo={fingerprint,id:crypto.randomUUID()}; return requestMemo.id; }
async function requestJson(url, options = {}, timeout = 30000) {
  const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), timeout);
  try { const response = await fetch(url, { ...options, signal: controller.signal }); const data = await response.json(); if (!response.ok) throw new Error(data.error || String(response.status)); return data; }
  finally { clearTimeout(deadline); }
}
async function configurationReady() {
  // Legacy page templates may still load this script before deferred branding.js.
  // Wait until deferred scripts have run before reading the readiness promise.
  if (!window.MeetConfigReady && document.readyState === 'loading') {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }
  if (!window.MeetConfigReady) throw new Error('configuration');
  const config = await window.MeetConfigReady;
  if (!config || config.configurationUnavailable) throw new Error('configuration');
  return config;
}
function meetingLanguages() {
  const codes = window.MeetConfig?.translation?.languages || ['en'];
  const names = new Map(LANGS);
  return codes.map(code => { let name = names.get(code); try { name ||= new Intl.DisplayNames([LANG], { type: 'language' }).of(code) } catch (_) {} return [code, name || code] });
}
function safeManagementUrl(value) { try { const url = new URL(value, location.href); return url.origin === location.origin && url.pathname === '/randevu/manage/' ? url.href : ''; } catch (_) { return ''; } }

const API = '../api/book.php';

/* Turkish is the source; every other language is a catalog file loaded on demand (missing key: own language, English, Turkish). */
const I18N = { tr: {
  b_title:'Toplantı talep edin', b_lead:'Size uygun gün ve saati seçin. Talebinizi ekibimize iletelim; onaylanınca toplantı bağlantısını e-posta ile gönderelim.',
  b_pick_day:'Gün seçin', b_pick_time:'Saat seçin', b_tz:'Saatler {tz} saat diliminde gösteriliyor.',
  b_no_slots:'Önümüzdeki günlerde boş saat bulunamadı. Lütfen daha sonra tekrar deneyin.', b_loading:'Müsait saatler yükleniyor…',
  b_load_err:'Müsait saatler şu an alınamadı. Lütfen biraz sonra tekrar deneyin.', b_selected:'Seçtiğiniz saat', b_change:'Değiştir',
  b_name:'Adınız', b_email:'E-posta adresiniz', b_company:'Şirket (isteğe bağlı)', b_lang:'Toplantıda konuşacağınız dil', b_note:'Not (isteğe bağlı)',
  b_note_ph:'Konuşmak istediğiniz konu…', b_send:'Talebi gönder', b_sending:'Gönderiliyor…', b_done_t:'Talebiniz alındı',
  b_done_p:'Ekibimiz talebinizi inceleyip onaylayınca size e-posta ile toplantı bağlantısını göndereceğiz.',
  b_taken:'Bu saat az önce doldu. Lütfen başka bir saat seçin.', b_err:'Talep gönderilemedi. Lütfen biraz sonra tekrar deneyin.',
  b_invalid:'Lütfen adınızı ve geçerli bir e-posta adresini girin.', b_rate:'Çok fazla deneme yaptınız, lütfen biraz bekleyin.',
  b_today:'Bugün', b_tomorrow:'Yarın', b_privacy:'Bilgileriniz yalnızca toplantıyı ayarlamak için kullanılır.', b_slots:'{n} müsait', b_title_tag:'Auto Translate Meeting · Toplantı talebi',
  theme_light:'Açık', theme_dark:'Koyu',
  b_taken_lbl:'Dolu', b_prev:'Önceki ay', b_next:'Sonraki ay', b_pick_hint:'Saatleri görmek için bir gün seçin.', b_modal_t:'Toplantı talebi', b_close:'Kapat'
}};
const detectLang = () => { const s = LS('wm-lang'); if (s && CODES.includes(s)) return s;
  for (const l of (navigator.languages || [navigator.language || 'en'])) { const c = l.slice(0, 2).toLowerCase(); if (CODES.includes(c)) return c } return window.MeetConfig?.app?.defaultLocale || 'en' };
let LANG = detectLang();
const t = (k, v) => { let s = (I18N[LANG] && I18N[LANG][k]) || (I18N.en && I18N.en[k]) || I18N.tr[k] || k; if (v) for (const x in v) s = s.replace('{' + x + '}', v[x]); return s };
async function ensureLang(c) {
  if (I18N[c]) return true;
  try { const j = await requestJson('../assets/i18n/book/' + c + '.json?v=3', { cache: 'force-cache' }, 10000); if (j && typeof j === 'object') { I18N[c] = j; return true } } catch (e) {}
  return false;
}

const ICO = {
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.7 5.7 3.7 9S14.5 18.3 12 21c-2.5-2.7-3.7-5.7-3.7-9S9.5 5.7 12 3Z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>'
};
$('gico').innerHTML = ICO.globe; $('shield').innerHTML = ICO.shield; $('okico').innerHTML = ICO.check;

/* ---------- theme + language ---------- */
function setTheme(th, persist = true) { document.documentElement.dataset.theme = th; if (persist) LS('wm-theme', th); document.querySelectorAll('.tbtn').forEach(b => b.setAttribute('aria-checked', b.dataset.th === th)) }
document.querySelectorAll('.tbtn').forEach(b => b.onclick = () => setTheme(b.dataset.th));
setTheme(document.documentElement.dataset.theme || 'dark', false);
function langMenu() {
  const m = $('lmenu');
  m.innerHTML = LANGS.map(([c, n]) => `<button type="button" role="menuitemradio" aria-checked="${c === LANG}" data-lc="${c}" lang="${c}">${n}<span class="lang">${c.toUpperCase()}</span></button>`).join('');
  m.querySelectorAll('[data-lc]').forEach(b => b.onclick = async () => {
    const c = b.dataset.lc; m.classList.remove('open');
    if (c !== 'tr' && !(await ensureLang(c))) return;
    LANG = c; LS('wm-lang', c); langMenu(); applyI18n(); render();
  });
}
$('lbtn').onclick = e => { e.stopPropagation(); $('lmenu').classList.toggle('open') };
addEventListener('click', () => $('lmenu').classList.remove('open'));
function applyI18n() {
  document.documentElement.lang = LANG; document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr'; document.title = ((window.MeetConfig && MeetConfig.app.name) || 'Auto Translate Meeting') + ' · ' + t('b_title');
  document.querySelectorAll('[data-t]').forEach(e => e.textContent = t(e.dataset.t));
  document.querySelectorAll('[data-t-ph]').forEach(e => e.placeholder = t(e.dataset.tPh));
  $('th-d').title = t('theme_dark'); $('th-l').title = t('theme_light'); $('lcode').textContent = LANG.toUpperCase();
  if (!$('f-lang').dataset.ready) { const languages = meetingLanguages(); for (const [c, n] of languages) { const o = document.createElement('option'); o.value = c; o.textContent = n; $('f-lang').appendChild(o) } $('f-lang').dataset.ready = '1'; $('f-lang').value = languages.some(([code]) => code === LANG) ? LANG : languages[0][0]; if (window.WMSelect) WMSelect.enhance($('f-lang')) }
}

/* ---------- slots ---------- */
const visitorTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch (e) { return 'UTC' } })();
let slots = [], slotMin = 30, dayKey = '', chosen = 0, sending = false;
const dayOf = ts => { const d = new Date(ts * 1000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') };          // yyyy-mm-dd in the visitor's own time zone
const fmt = (ts, o) => new Intl.DateTimeFormat(LANG, o).format(new Date(ts * 1000));
const setState = (msg, err, spin) => { const s = $('bk-state'); s.className = 'bk-state' + (err ? ' err' : ''); s.innerHTML = ''; if (spin) { const i = document.createElement('i'); i.className = 'bk-spin'; s.appendChild(i) } s.appendChild(document.createTextNode(msg || '')) };

async function load() {
  setState(t('b_loading'), false, true); $('bk-body').hidden = true;
  try {
    const j = await requestJson(API, { cache: 'no-store' });
    slots = j.slots || []; slotMin = j.slotMin || 30;
  } catch (e) { setState(t(e.message === 'rate' ? 'b_rate' : 'b_load_err'), true); return }
  if (!slots.length) { setState(t('b_no_slots'), true); return }
  setState(''); dayKey = dayKey && slots.some(s => dayOf(s) === dayKey) ? dayKey : dayOf(slots[0]); render();
}
function render() {
  if (!slots.length) return;
  $('bk-body').hidden = false;
  const groups = new Map(); for (const s of slots) { const k = dayOf(s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s) }
  const today = dayOf(Date.now() / 1000), tomorrow = dayOf(Date.now() / 1000 + 86400);
  const days = $('days'); days.innerHTML = '';
  for (const [k, list] of groups) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'day'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(k === dayKey));
    const first = list[0], rel = k === today ? t('b_today') : k === tomorrow ? t('b_tomorrow') : fmt(first, { weekday: 'short' });
    b.innerHTML = '<small></small><b></b><span></span>'; b.children[0].textContent = rel; b.children[1].textContent = fmt(first, { day: 'numeric', month: 'short' }); b.children[2].textContent = t('b_slots', { n: list.length });
    b.onclick = () => { dayKey = k; render() }; days.appendChild(b);
  }
  const sel = days.querySelector('[aria-selected=true]'); if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const tm = $('times'); tm.innerHTML = '';
  for (const s of groups.get(dayKey) || []) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'tm'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(s === chosen));
    b.textContent = fmt(s, { hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset' }); b.onclick = () => pick(s); tm.appendChild(b);
  }
  $('tzline').textContent = t('b_tz', { tz: visitorTz.replace('_', ' ') });
}
function pick(ts) { if (sending) return; chosen = ts; showForm() }
function showForm() {
  $('sel-when').textContent = fmt(chosen, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  $('step-pick').hidden = true; $('step-form').hidden = false; $('f-err').textContent = ''; $('f-name').focus(); scrollTo({ top: 0 });
}
$('sel-change').onclick = () => { $('step-form').hidden = true; $('step-pick').hidden = false; render(); scrollTo({ top: 0 }) };

$('step-form').onsubmit = async ev => {
  ev.preventDefault(); if (sending) return;
  const btn = $('f-send'), err = $('f-err'); err.textContent = '';
  const name = $('f-name').value.trim(), email = $('f-email').value.trim();
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = t('b_invalid'); return }
  sending = true; btn.disabled = true; btn.firstElementChild.textContent = t('b_sending');
  try {
    const payload = { action: 'request', slot: chosen, name, email, company: $('f-company').value.trim(), note: $('f-note').value.trim(), lang: $('f-lang').value, tz: visitorTz, website: $('f-web').value }; payload.requestId = bookingRequestId(payload);
    const j = await requestJson(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 60000);
    const success = $('step-done'); success.querySelectorAll('.booking-result-link').forEach(e=>e.remove());
    const managementUrl = safeManagementUrl(j.manageUrl); if (managementUrl) { const a=document.createElement('a'); a.className='booking-result-link go'; a.href=managementUrl; a.textContent=t('b_manage'); success.appendChild(a); }
    if (!j.notifications || !j.notifications.visitor) { const n=document.createElement('p'); n.className='booking-result-link'; n.textContent=t('b_mail_pending'); success.appendChild(n); }
    requestMemo=null;
    $('done-when').textContent = fmt(chosen, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' · ' + visitorTz.replace('_', ' ');
    $('step-form').hidden = true; $('step-done').hidden = false; scrollTo({ top: 0 });
  } catch (e) {
    const m = { slot_taken: 'b_taken', rate: 'b_rate', invalid: 'b_invalid' }[e.message] || 'b_err';
    err.textContent = t(m);
    if (e.message === 'slot_taken') { $('step-form').hidden = true; $('step-pick').hidden = false; chosen = 0; load() }
  }
  sending = false; btn.disabled = false; btn.firstElementChild.textContent = t('b_send');
};

(async () => {
  const [config] = await Promise.all([configurationReady(), ensureLang('en'), requestJson('../assets/i18n/book/tr.json?v=3', {}, 10000).then(j=>{I18N.tr=j}).catch(()=>{})]);
  LANG = detectLang(); if (LANG !== 'tr') await ensureLang(LANG);
  const selectedTheme = LS('wm-theme');
  setTheme(selectedTheme || (config.app.defaultTheme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : config.app.defaultTheme), false);
  langMenu(); applyI18n(); load();
})().catch(() => setState(t('b_load_err'), true));
})();
