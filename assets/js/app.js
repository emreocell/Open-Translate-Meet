/* Auto Translate Meeting - front-end. Video/audio rooms on LiveKit; translation lives in translate.js. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const LS = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v) } catch (e) { return null } };
const LANGS = [['tr','Türkçe'],['en','English'],['de','Deutsch'],['fr','Français'],['es','Español'],['it','Italiano'],['nl','Nederlands'],['pt','Português'],['pl','Polski'],['ru','Русский'],['ar','العربية'],['ja','日本語']];

/* ---------- i18n ----------
   One catalog per language. Only the source language (tr) is written; other languages are added
   from reviewed catalog files. Missing keys fall back to tr. */
const I18N = { tr: {
  _lang:'Türkçe', privacy:'Gizlilik', source_code:'Kaynak kodu', administration:'Yönetim', secure:'Şifreli bağlantı', cam_preview:'Kamera önizleme', live_on:'Canlı çeviri açık',
  join_title:'Toplantıya katılın', join_lead:'Konuştuğunuz her şey, karşı tarafın dilinde anında duyulur.',
  name:'Adınız', name_ph:'Örn. Anna Schmidt', i_speak:'Konuştuğum dil', i_hear:'Duymak istediğim dil',
  audio_out:'Ses çıkışı', headset:'Kulaklık', speaker:'Hoparlör', join:'Toplantıya katıl',
  consent:'Katılarak çeviri için sesinizin işlenmesini kabul edersiniz.',
  room_small:'Auto Translate Meeting', live_trans:'Canlı çeviri', trans_vol:'Çeviri sesi', mute_orig:'Orijinal sesi kıs', leave:'Ayrıl',
  mic:'Mikrofon', cam:'Kamera', share:'Ekran paylaş', panel:'Çeviri ve sohbet paneli', layout:'Düzen: Izgara / Odak',
  translating:'Çevriliyor', focus:'Odakla', you:'Siz', theme:'Tema', theme_light:'Açık', theme_dark:'Koyu',
  lang_more:'Diğer diller, çeviriler hazır olunca eklenecek.',
  no_link_title:'Toplantı bağlantısı gerekli', no_link_text:'Bu sayfaya bir davet bağlantısıyla girebilirsiniz. Bağlantıyı size gönderen kişiyle iletişime geçin.',
  bad_link:'Bu davet bağlantısı geçersiz.', join_err:'Katılınamadı. Biraz sonra tekrar deneyin.',
  media_denied:'Mikrofon veya kamera izni verilmedi. Kapalı katılıyorsunuz.',
  reconnecting:'Yeniden bağlanılıyor…', reconnected:'Yeniden bağlandınız.',
  disconnected_t:'Bağlantı koptu', disconnected_p:'Toplantıya yeniden katılmak için tekrar giriş yapın.',
  left_t:'Toplantıdan ayrıldınız', left_p:'İsterseniz tekrar katılabilirsiniz.', rejoin:'Tekrar katıl',
  link_copied:'Davet bağlantısı kopyalandı', copy_link:'Bağlantıyı kopyala', guest:'Misafir', screen_of:'{n} · ekran',
  mic_failed:'Mikrofon açılamadı.', cam_failed:'Kamera açılamadı.', share_failed:'Ekran paylaşılamadı.',
  participants:'{n} kişi', no_tx:'Konuşma başlayınca çeviri burada görünür.',
  chat:'Sohbet', chat_ph:'Mesaj yazın…', send:'Gönder', attach:'Görsel veya video ekle', close:'Kapat',
  chat_empty:'Henüz mesaj yok. Yazın ya da görsel/video ekleyin.', chat_note:'Mesajlar kaydedilmez, dosyalar 24 saat sonra silinir.',
  file_type:'Bu dosya türü desteklenmiyor. Yalnızca JPEG, PNG, WebP görseller ve MP4, WebM videolar gönderebilirsiniz.',
  file_big_img:'Görsel en fazla 32 MB olabilir.', file_big_vid:'Video en fazla 100 MB olabilir.',
  file_invalid:'Dosya geçerli bir görsel ya da video değil, bozuk olabilir.', file_quota:'Bu odanın dosya alanı doldu.',
  file_rate:'Çok fazla dosya gönderdiniz, biraz bekleyin.', upload_failed:'Gönderilemedi, tekrar deneyin.', upload_cancelled:'İptal edildi.',
  uploading:'Yükleniyor…', processing:'Güvenlik kontrolü yapılıyor…', cancel_up:'İptal', file_expired:'Bu dosyanın süresi doldu (24 saat).',
  host:'Yönetici', host_panel:'Yönetici', host_panel_t:'Toplantı yönetimi', host_entering:'Yönetici olarak giriyorsunuz',
  limit_label:'Katılımcı sınırı', lock_label:'Odayı kilitle (yeni giriş olmasın)', host_count:'Şu an odada {n} kişi var, sınır {m}.',
  end_meeting:'Toplantıyı bitir', end_t:'Toplantı herkes için bitsin mi?', end_p:'Tüm katılımcılar odadan çıkarılır. Bu işlem geri alınamaz.',
  kick:'Odadan çıkar', kick_t:'{n} odadan çıkarılsın mı?', kick_p:'Kişi odadan atılır. Oda kilitli değilse bağlantıyla tekrar girebilir.',
  mute_mic:'Mikrofonunu kapat', mute_cam:'Kamerasını kapat', done_mute_mic:'{n} için mikrofon kapatıldı', done_mute_cam:'{n} için kamera kapatıldı',
  done_kick:'{n} odadan çıkarıldı', done_limit:'Katılımcı sınırı güncellendi', done_lock:'Oda kilitlendi', done_unlock:'Oda kilidi açıldı',
  host_err:'İşlem yapılamadı, tekrar deneyin.', cancel:'Vazgeç', back_to_join:'Katılma ekranına dön',
  kicked_t:'Toplantıdan çıkarıldınız', kicked_p:'Yönetici sizi odadan çıkardı.', ended_t:'Toplantı sona erdi', ended_p:'Yönetici toplantıyı bitirdi.',
  room_full:'Oda dolu: katılımcı sınırına ulaşıldı.', room_locked:'Bu oda kilitli: yönetici yeni girişleri kapattı.',
  muted_mic_by_host:'Yönetici mikrofonunuzu kapattı. Açmak için mikrofon düğmesine basın.', muted_cam_by_host:'Yönetici kameranızı kapattı. Açmak için kamera düğmesine basın.',
  home_title:'Toplantınıza hoş geldiniz', home_lead:'Size gönderilen toplantı bağlantısını ya da kodunu aşağıya yapıştırın.',
  link_label:'Toplantı bağlantınız var mı?', link_ph:'Bağlantıyı veya kodu yapıştırın', link_go:'Devam et',
  link_bad:'Bu bağlantı ya da kod geçersiz görünüyor. Size gönderilen bağlantıyı olduğu gibi yapıştırın.',
  home_help:'Davet bağlantısı için toplantı düzenleyicisiyle iletişime geçin.',
  password:'Toplantı şifresi', password_ph:'Şifreyi girin', pw_required:'Bu toplantı şifreli. Lütfen şifreyi girin.', pw_wrong:'Şifre yanlış, tekrar deneyin.',
  room_closed:'Bu toplantı kapatılmış.', alone_warn:'Uzun süredir odada yalnızsınız. Birkaç dakika içinde bağlantınız otomatik kapatılacak.',
  alone_t:'Bağlantı kapatıldı', alone_p:'Uzun süre odada yalnız kaldığınız için bağlantınız kapatıldı. İsterseniz tekrar katılabilirsiniz.',
  no_tr_audio:'Şu an çevrilmiş ses yok: aynı dili konuşuyorsunuz ya da kimse konuşmuyor. Kaydırıcı, çeviri sesi geldiğinde çalışır.',
  settings:'Ses ve cihaz ayarları', st_mic:'Mikrofon', st_device:'Cihaz', st_default:'Varsayılan', st_level:'Giriş seviyesi', st_in_vol:'Mikrofon sesi',
  st_noise:'Gürültü azaltma', st_echo:'Yankı engelleme', st_agc:'Otomatik ses seviyesi', st_spk:'Hoparlör', st_out_vol:'Toplantı sesi',
  st_test_t:'Hoparlörü dene', st_test:'Test sesi çal', st_cam:'Kamera', st_nodev:'Cihaz bulunamadı',
  st_mic_off:'Mikrofon kapalı. Giriş seviyesini görmek için mikrofonu açın.', st_perm:'Cihaz adlarını görmek için mikrofon ve kamera izni gerekir.',
  p_sound:'Bu kişinin sesi', p_mute:'Sesini kapat (yalnız sizde)', p_unmute:'Sesini aç',
  mod_label:'Yönetici işlemleri', lock_mic:'Mikrofonu kapat ve kilitle', allow_mic:'Mikrofon iznini geri ver', lock_cam:'Kamerayı kapat ve kilitle', allow_cam:'Kamera iznini geri ver',
  done_lock_mic:'{n} için mikrofon kilitlendi', done_allow_mic:'{n} için mikrofon izni verildi', done_lock_cam:'{n} için kamera kilitlendi', done_allow_cam:'{n} için kamera izni verildi',
  kick_only:'Odadan çıkar', ban_10m:'10 dakika yasakla', ban_1h:'1 saat yasakla', ban_room:'Toplantı boyunca yasakla',
  ban_t:'{n} yasaklansın mı?', ban_p_10m:'Kişi odadan çıkarılır ve 10 dakika boyunca geri giremez.', ban_p_1h:'Kişi odadan çıkarılır ve 1 saat boyunca geri giremez.',
  ban_p_room:'Kişi odadan çıkarılır ve bu toplantı sürdükçe geri giremez. Yasağı yönetici panelinden kaldırabilirsiniz.',
  done_ban:'{n} yasaklandı', ban_partial:'{n} çıkarıldı ancak tanınamadığı için yasaklanamadı.',
  bans_t:'Yasaklılar', bans_none:'Yasaklı kimse yok.', ban_remove:'Kaldır', ban_until:'{t} saatine kadar', ban_forever:'Toplantı boyunca', done_unban:'Yasak kaldırıldı',
  banned:'Bu toplantıya girişiniz yönetici tarafından engellendi.', banned_until:'Bu toplantıya girişiniz {t} saatine kadar engellendi.',
  mic_locked:'Yönetici izin verene kadar mikrofonunuz kapalı.', cam_locked:'Yönetici izin verene kadar kameranız kapalı.',
  mic_locked_by_host:'Yönetici mikrofonunuzu kapattı ve kilitledi.', cam_locked_by_host:'Yönetici kameranızı kapattı ve kilitledi.',
  mic_allowed_by_host:'Yönetici mikrofon iznini geri verdi. Açabilirsiniz.', cam_allowed_by_host:'Yönetici kamera iznini geri verdi. Açabilirsiniz.',
  locked_mic_tag:'Mikrofon yönetici tarafından kilitli', locked_cam_tag:'Kamera yönetici tarafından kilitli',
  home_book:'Toplantı talep edin',
  contact_t:'İletişim', contact_phone:'Telefon', contact_mail:'E-posta', contact_hours:'Çalışma saatleri', contact_hours_v:'',
  wait_t:'Sizinle görüşmek için sabırsızlanıyoruz', wait_p:'Toplantınız {when} için planlandı.', wait_cd:'Toplantıya kalan süre',
  wait_note:'Toplantı başlamadan {m} dakika önce bu sayfadan katılabilirsiniz. Bağlantıyı saklayın; zamanı gelince bu sayfa sizi otomatik olarak toplantıya alır.'
}};
/* The visitor's own language wins (saved choice, then the browser's languages); an unknown language gets English. */
const CODES = LANGS.map(l => l[0]);
const detectLang = () => { const s = LS('wm-lang'); if (s && CODES.includes(s)) return s;
  for (const l of (navigator.languages || [navigator.language || 'en'])) { const c = l.slice(0, 2).toLowerCase(); if (CODES.includes(c)) return c } return 'en' };
let LANG = detectLang();
// Missing key: own language, then English, then the Turkish source.
const MEETING_I18N = {};
const t = (k, v) => { let s = MEETING_I18N[LANG]?.[k] || MEETING_I18N.en?.[k] || (I18N[LANG] && I18N[LANG][k]) || (I18N.en && I18N.en[k]) || I18N.tr[k] || k; if (v) for (const x in v) s = s.replace('{' + x + '}', v[x]); return s };
/* Every other language is a catalog file (assets/i18n/<code>.json) loaded on demand; if one cannot be loaded the app keeps working. */
async function ensureLang(c) {
  if (!CODES.includes(c)) return false;
  const read = async path => { const response = await fetch(path); if (!response.ok) throw new Error('catalog'); const value = await response.json(); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('catalog'); return value };
  try {
    const jobs = [];
    if (!I18N[c]) jobs.push(read('assets/i18n/' + c + '.json?v=6').then(value => { I18N[c] = value }));
    if (!MEETING_I18N[c]) jobs.push(read('assets/i18n/meeting/' + c + '.json?v=1').then(value => { MEETING_I18N[c] = value }));
    await Promise.all(jobs); return true;
  } catch (_) { return false }
}

/* ---------- icons ---------- */
const P = {mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',micoff:'<path d="M3 3l18 18M9 9v2a3 3 0 0 0 5 2M15 9V6a3 3 0 0 0-5.5-1.7M5 11a7 7 0 0 0 11 5.6M19 11a7 7 0 0 1-.6 2.8M12 18v3"/>',
cam:'<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3"/>',camoff:'<path d="M3 3l18 18M7 6h6a3 3 0 0 1 3 3v3M16 10l5-3v10M5.5 7.5A3 3 0 0 0 3 10v5a3 3 0 0 0 3 3h7a3 3 0 0 0 2.5-1.3"/>',
screen:'<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8 20h8M12 16v4"/>',
trn:'<path d="M4 5h9M8.5 3v2M6 5c0 4 3 7 7 8M12 5c-.5 3.5-3.5 6.5-8 8M14 20l4-9 4 9M15.5 17h5"/>',cc:'<rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="M7.5 11h3M13.5 11h3M7.5 15h6"/>',
leave:'<path d="M10 17l-5-5 5-5M5 12h11M21 4v16"/>',users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
spot:'<rect x="3" y="4" width="12" height="16" rx="2.5"/><rect x="17.5" y="4" width="3.5" height="4.5" rx="1.2"/><rect x="17.5" y="10" width="3.5" height="4.5" rx="1.2"/><rect x="17.5" y="15.5" width="3.5" height="4.5" rx="1.2"/>',
grid:'<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.7 5.7 3.7 9S14.5 18.3 12 21c-2.5-2.7-3.7-5.7-3.7-9S9.5 5.7 12 3Z"/>',
shield:'<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',wave:'<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2"/>',
head:'<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6" rx="1.8"/><rect x="16.5" y="14" width="4.5" height="6" rx="1.8"/>',
spk:'<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
pin:'<path d="M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 13v7"/>',chat:'<path d="M4 5h16v11H9l-5 4V5Z"/>',clip:'<path d="M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7L9.5 17a1.7 1.7 0 0 1-2.4-2.4L14 7.7"/>',send:'<path d="M4 12 20 4l-4 16-4-6-8-2Z"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>',crown:'<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8Z"/>',kick:'<circle cx="10" cy="8" r="3.5"/><path d="M3 20a7 7 0 0 1 11-5.5M17 14l4 4M21 14l-4 4"/>',link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
more:'<circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/>',
gear:'<path d="M4 7h9M18 7h2M4 17h2M11 17h9"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="8.5" cy="17" r="2.3"/>',
volmute:'<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
ban:'<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
lock:'<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
unlock:'<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 7.6-1.7"/>',
timer:'<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.7M9.5 3h5"/>',
cal:'<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h2M12 14h2M8 17h2"/>',
chev:'<path d="m9 6 6 6-6 6"/>',check:'<path d="m5 12 5 5 9-10"/>',
phone:'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
mail:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',
wa:'<path d="M4 20l1.3-4.2A8 8 0 1 1 8.4 18.8L4 20Z"/><path d="M9 9.5c.3 2.2 2.3 4.2 4.5 4.5l1.2-1.2-1.9-1-.8.7a4 4 0 0 1-1.6-1.6l.7-.8-1-1.9L9 9.5Z"/>',
clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
ig:'<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/><path d="M16.8 7.2h.01"/>',
li:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 11v5M8 8v.01M12 16v-5M12 13a2.5 2.5 0 0 1 5 0v3"/>',
fb:'<path d="M14 8h2.5V5H14a3.5 3.5 0 0 0-3.5 3.5V11H8v3h2.5v6H14v-6h2.5l.5-3h-3V8.5A.5.5 0 0 1 14 8Z"/>'};
const ico = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`;
const paint = (r = document) => r.querySelectorAll('[data-i]').forEach(e => e.innerHTML = ico(e.dataset.i));

/* ---------- theme + language menu ---------- */
function setTheme(th, persist = true) { document.documentElement.dataset.theme = th; if (persist) LS('wm-theme', th); document.querySelectorAll('.tbtn').forEach(b => b.setAttribute('aria-checked', b.dataset.th === th)) }
document.querySelectorAll('.tbtn').forEach(b => b.onclick = () => setTheme(b.dataset.th));
setTheme(document.documentElement.dataset.theme || 'dark', false);
function langMenu() {
  const m = $('lmenu');
  m.innerHTML = LANGS.map(([c, n]) => `<button type="button" role="menuitemradio" aria-checked="${c === LANG}" data-lc="${c}" lang="${c}">${n}<span class="lang">${c.toUpperCase()}</span></button>`).join('');
  m.querySelectorAll('[data-lc]').forEach(b => b.onclick = async () => {
    const c = b.dataset.lc; m.classList.remove('open');
    if (!(await ensureLang(c))) { toast(t('host_err')); return }
    LANG = c; LS('wm-lang', c); langMenu(); applyI18n();
  });
}
$('lbtn').onclick = e => { e.stopPropagation(); $('lmenu').classList.toggle('open') };
addEventListener('click', () => $('lmenu').classList.remove('open'));
function applyI18n() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';           // Arabic reads right to left
  document.querySelectorAll('[data-t]').forEach(e => e.textContent = t(e.dataset.t));
  document.querySelectorAll('[data-t="live_on"]').forEach(element => { element.textContent = t(window.MeetConfig?.translation?.enabled ? 'live_on' : 'translation_disabled') });
  if (window.WMC) WMC.refreshLang();
  document.querySelectorAll('[data-t-ph]').forEach(e => e.placeholder = t(e.dataset.tPh));
  document.querySelectorAll('[data-t-title]').forEach(e => { e.title = t(e.dataset.tTitle); e.setAttribute('aria-label', e.title) });
  $('lcode').textContent = LANG.toUpperCase();
  if (title) { $('room-title').textContent = title }
  if (room) { sync(); renderHealth(); renderMeetingLanguages() }
  if (window.WMHome) WMHome.onLang();
  document.dispatchEvent(new CustomEvent('wm:locale'));
}

/* ---------- helpers ---------- */
const params = new URLSearchParams(location.search);
const linkR = params.get('r') || '';
let title = (params.get('t') || '').slice(0, 60);               // the room's own title from the server replaces this once known
// Host key: arrives only in the secret host link. Kept for this tab (reload-safe) and removed from the address bar,
// so copying the page address never hands out host rights.
let hostKey = new URLSearchParams(location.hash.slice(1)).get('h') || params.get('h') || '';
if (hostKey) {
  if (!/^[a-f0-9]{16,128}$/.test(hostKey)) hostKey = '';
  try { if (hostKey) sessionStorage.setItem('wm-h-' + linkR, hostKey) } catch (_) {}
  const clean = new URL(location.href); clean.searchParams.delete('h'); clean.hash = ''; history.replaceState(null, '', clean.toString());
} else { try { hostKey = sessionStorage.getItem('wm-h-' + linkR) || '' } catch (_) {} }
let resumeToken = ''; try { resumeToken = sessionStorage.getItem('wm-resume-' + linkR) || '' } catch (_) {}

let isHost = false, selfActAt = 0;
const toastEl = $('toast'); let toastT;
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 3200) }
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); document.body.classList.toggle('in-room', id === 'room') }
function overlay(tt, pp, btn, fn) { $('ov-t').textContent = tt; $('ov-p').textContent = pp; const b = $('ov-btn'); b.textContent = btn; b.onclick = fn; b.classList.remove('dangerbtn'); $('ov-btn2').classList.add('hide'); $('overlay').classList.add('on') }
/* A confirm dialog in our own style (resolves true / false). */
function ask(tt, pp, ok, cancel) {
  return new Promise(res => {
    const hp = $('hostpanel'); if (hp) hp.hidden = true; const mm = $('mgmenu'); if (mm) mm.hidden = true;
    $('ov-t').textContent = tt; $('ov-p').textContent = pp;
    const b = $('ov-btn'), b2 = $('ov-btn2'); b.textContent = ok; b2.textContent = cancel; b.classList.add('dangerbtn'); b2.classList.remove('hide'); $('overlay').classList.add('on');
    const done = v => { $('overlay').classList.remove('on'); b2.classList.add('hide'); b.classList.remove('dangerbtn'); res(v) };
    b.onclick = () => done(true); b2.onclick = () => done(false);
  });
}
const initials = n => (n || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase() || '?';
const grads = ['#2f6bff,#4aa8e8','#34d399,#4aa8e8','#5b4dff,#2f9bff','#0f86d9,#35d0c0','#7c5cff,#4aa3ff','#2f6bff,#6ee0f0'];
const gradOf = id => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return grads[h % grads.length] };
const meta = p => window.WMCore.metadata(p);

/* ---------- lobby ---------- */
// The choice is remembered. With both off the browser is never asked for camera or microphone access.
let micOn = LS('wm-mic') !== '0', camOn = LS('wm-cam') !== '0', audioMode = 'headset', pvStream = null;
for (const [c, n] of LANGS) { for (const id of ['speak', 'hear']) { const o = document.createElement('option'); o.value = c; o.textContent = n; $(id).appendChild(o) } }
const guessLang = (() => { const c = ((navigator.language || 'tr').slice(0, 2)).toLowerCase(); return LANGS.some(l => l[0] === c) ? c : 'tr' })();
if (window.WMSelect) { WMSelect.enhance($('speak')); WMSelect.enhance($('hear')) }
$('speak').value = LS('wm-speak') || guessLang;
$('hear').value = LS('wm-hear') || $('speak').value;
$('n').value = LS('wm-name') || '';
$('n').oninput = () => { $('pv-avatar').textContent = initials($('n').value) };
$('n').addEventListener('focus', () => { if (window.WMT) WMT.preload() }, { once: true });   // fetch the speech detector while the person types a name
$('pv-avatar').textContent = initials($('n').value);
document.querySelectorAll('#aout button').forEach(b => b.onclick = () => { document.querySelectorAll('#aout button').forEach(x => x.classList.remove('on')); b.classList.add('on'); audioMode = b.dataset.m });

/* Chosen devices and audio options are remembered. A device that is no longer there falls back to the default one. */
const DEV = { mic: LS('wm-micdev') || '', cam: LS('wm-camdev') || '', spk: LS('wm-spkdev') || '' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const AUD = { ns: LS('wm-ns') !== '0', ec: LS('wm-ec') !== '0', agc: LS('wm-agc') !== '0', gain: clamp((LS('wm-gain') === null ? 100 : +LS('wm-gain')) / 100, 0, 2), master: clamp((LS('wm-master') === null ? 100 : +LS('wm-master')) / 100, 0, 1) };
const micC = useDev => ({ echoCancellation: AUD.ec, noiseSuppression: AUD.ns, autoGainControl: AUD.agc, ...(useDev && DEV.mic ? { deviceId: { exact: DEV.mic } } : {}) });
const camC = useDev => ({ width: 1280, height: 720, ...(useDev && DEV.cam ? { deviceId: { exact: DEV.cam } } : { facingMode: 'user' }) });

/* A random id this browser keeps; lets the host's ban / lock recognise the same person coming back. */
function deviceId() {
  let d = LS('wm-did');
  if (!/^[a-f0-9]{16,32}$/.test(d || '')) { d = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join(''); LS('wm-did', d) }
  return d;
}

let pvSeq = 0;
async function startPreview() {
  stopPreview();                                           // always release the devices first (camera light off)
  const seq = ++pvSeq;
  if (!micOn && !camOn) return;                            // nothing wanted: do not touch the devices, do not ask for permission
  const md = navigator.mediaDevices; if (!md || !md.getUserMedia) return;
  let s = null;
  for (const useDev of (DEV.mic || DEV.cam) ? [true, false] : [false]) {
    try { s = await md.getUserMedia({ audio: micOn ? micC(useDev) : false, video: camOn ? camC(useDev) : false }); break } catch (e) { s = null }
  }
  if (!s && camOn && micOn) { try { s = await md.getUserMedia({ audio: micC(false) }) } catch (e2) { s = null } }   // camera blocked: keep the microphone
  if (seq !== pvSeq || !s) { if (s) s.getTracks().forEach(x => x.stop()); return }   // a newer request replaced this one
  pvStream = s; $('pv-video').srcObject = s;
  $('pv').classList.toggle('hasvideo', !!s.getVideoTracks()[0]);
}
function stopPreview() { pvSeq++; if (pvStream) { pvStream.getTracks().forEach(x => x.stop()); pvStream = null } $('pv-video').srcObject = null; $('pv').classList.remove('hasvideo') }
function setBtn(btn, on, iconOn, iconOff) { btn.classList.toggle('on', on); btn.classList.toggle('off', !on); const i = btn.querySelector('[data-i]'); i.dataset.i = on ? iconOn : iconOff; paint(btn) }
$('pv-mic').onclick = () => { micOn = !micOn; LS('wm-mic', micOn ? '1' : '0'); setBtn($('pv-mic'), micOn, 'mic', 'micoff'); startPreview() };
$('pv-cam').onclick = () => { camOn = !camOn; LS('wm-cam', camOn ? '1' : '0'); setBtn($('pv-cam'), camOn, 'cam', 'camoff'); startPreview() };
setBtn($('pv-mic'), micOn, 'mic', 'micoff'); setBtn($('pv-cam'), camOn, 'cam', 'camoff');

/* ---------- room state ---------- */
const { Room, RoomEvent, Track, VideoPresets } = window.LivekitClient || {};
let room = null, joinedAt = 0, timer = null, pinKey = null, lastSpeaker = null, autoSpot = false;
const tiles = new Map();
const tilesEl = $('tiles');

/* ---------- language changes, observable health and admission ---------- */
let mediaStatus = 'connecting', mediaQuality = 'unknown', translationHealth = null, admissionTimer = null, pendingAdmission = null;
const admissionScreen = document.createElement('section'); admissionScreen.id = 'admission'; admissionScreen.className = 'screen';
admissionScreen.innerHTML = '<div class="wait glass admission-box"><h1 data-t="waiting_title"></h1><p class="lead" data-t="waiting_description"></p><p id="admission-state" role="status" aria-live="polite"></p><button type="button" id="admission-cancel" class="go ghost" data-t="cancel"></button></div>';
document.body.appendChild(admissionScreen);
const languageSection = document.createElement('section'); languageSection.id = 'meeting-language-settings'; languageSection.hidden = true;
languageSection.innerHTML = '<h3 data-t="meeting_languages"></h3><div class="two field"><div><label for="meeting-speak" data-t="i_speak"></label><select id="meeting-speak" class="select"></select></div><div><label for="meeting-hear" data-t="i_hear"></label><select id="meeting-hear" class="select"></select></div></div><button type="button" class="gh" id="language-apply" data-t="language_apply"></button><p class="hint" id="language-result" role="status"></p>';
$('settings').querySelector('.sbox-b').prepend(languageSection);
const healthSection = document.createElement('section'); healthSection.id = 'meeting-health'; healthSection.hidden = true;
healthSection.innerHTML = '<h3 data-t="health_title"></h3><dl class="health-details"><dt data-t="health_media"></dt><dd id="health-media"></dd><dt data-t="mic"></dt><dd id="health-mic"></dd><dt data-t="health_translation"></dt><dd id="health-translation"></dd><dt data-t="health_usage"></dt><dd id="health-usage"></dd></dl><p id="health-fallback" class="hint"></p><p class="hint" data-t="health_usage_note"></p><button type="button" class="gh" id="translation-retry" data-t="translation_retry"></button>';
$('settings').querySelector('.sbox-b').appendChild(healthSection);
const healthButton = document.createElement('button'); healthButton.id = 'health-button'; healthButton.type = 'button'; healthButton.className = 'chip linkbtn health-chip'; healthButton.setAttribute('data-t-title', 'health_title');
healthButton.innerHTML = '<span class="health-dot" aria-hidden="true"></span><span class="hide-s" id="health-label"></span>';
$('copylink').before(healthButton); healthButton.onclick = () => openSettings();
const waitingControls = document.createElement('div'); waitingControls.className = 'admission-controls';
waitingControls.innerHTML = '<label class="waiting-toggle"><input type="checkbox" id="hwaiting"><span data-t="waiting_enabled"></span></label><h4 data-t="waiting_participants"></h4><div id="waiting-list" class="waiting-list"></div>';
$('hcount').after(waitingControls);
$('overlay').setAttribute('role', 'dialog'); $('overlay').setAttribute('aria-modal', 'true'); $('overlay').setAttribute('aria-labelledby', 'ov-t');
$('msgs').setAttribute('aria-label', t('live_trans'));

function configureMeetingLanguages() {
  const configured = window.MeetConfig?.translation?.languages;
  const languages = Array.isArray(configured) && configured.length ? configured.filter(window.WMCore.validLanguage) : CODES;
  for (const id of ['speak', 'hear', 'meeting-speak', 'meeting-hear']) {
    const select = $(id), previous = select.value; select.innerHTML = '';
    for (const code of languages) {
      const option = document.createElement('option'); option.value = code;
      let label = LANGS.find(value => value[0] === code)?.[1];
      if (!label) { try { label = new Intl.DisplayNames([LANG], { type: 'language' }).of(code) } catch (_) {} }
      option.textContent = label || code; select.appendChild(option);
    }
    select.value = languages.includes(previous) ? previous : languages.includes(guessLang) ? guessLang : (languages[0] || 'en');
  }
  const maximum = Math.max(2, Math.min(100, Number(window.MeetConfig?.limits?.maxParticipants) || 8));
  $('hlimit').innerHTML = '';
  for (let number = 2; number <= maximum; number++) { const option = document.createElement('option'); option.value = String(number); option.textContent = String(number); $('hlimit').appendChild(option) }
}
function renderMeetingLanguages() {
  languageSection.hidden = !window.WM; healthSection.hidden = !window.WM;
  if (!window.WM) return;
  $('meeting-speak').value = window.WM.me.speak; $('meeting-hear').value = window.WM.me.hear;
}
$('language-apply').onclick = async () => {
  const current = window.WM; if (!current) return;
  const speak = $('meeting-speak').value, hear = $('meeting-hear').value;
  if (speak === current.me.speak && hear === current.me.hear) return;
  const button = $('language-apply'); button.disabled = true; $('language-result').textContent = '';
  try {
    const response = await request('api/participant.php', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Meet-Token': current.me.ticket }, body: JSON.stringify({ action: 'languages', speak, hear }) });
    const result = await response.json(); if (!response.ok || !result.ok) throw new Error('language_failed');
    if (window.WM !== current) return;
    current.me.speak = result.speak; current.me.hear = result.hear;
    $('speak').value = result.speak; $('hear').value = result.hear;
    LS('wm-speak', result.speak); LS('wm-hear', result.hear);
    window.WMT?.changeLanguages(); sync(); $('language-result').textContent = t('language_saved');
    document.dispatchEvent(new CustomEvent('wm:languages', { detail: { speak: result.speak, hear: result.hear } }));
  } catch (_) { if (window.WM === current) { renderMeetingLanguages(); $('language-result').textContent = t('language_failed') } }
  finally { button.disabled = false }
};
function renderHealth() {
  if (!window.WM || !room) return;
  const tr = translationHealth || window.WMT?.health() || { enabled: false, sessions: [], inputSeconds: 0 };
  const ready = tr.sessions?.length && tr.sessions.every(session => session.ready);
  const translating = !tr.enabled ? 'translation_disabled' : tr.captureError ? 'translation_degraded' : tr.limited ? 'translation_limited' : !tr.sessions?.length ? 'translation_idle' : ready ? 'translation_ready' : tr.sessions.some(session => !['connecting', 'ready'].includes(session.state)) ? 'translation_degraded' : 'translation_connecting';
  $('health-media').textContent = t('health_' + mediaStatus) + (mediaStatus === 'connected' ? ' · ' + t('quality_' + (['excellent', 'good', 'poor', 'lost'].includes(mediaQuality) ? mediaQuality : 'unknown')) : '');
  $('health-mic').textContent = t(room.localParticipant.isMicrophoneEnabled ? 'health_mic_on' : 'health_mic_off');
  $('health-translation').textContent = t(translating);
  $('health-usage').textContent = new Intl.NumberFormat(LANG, { maximumFractionDigits: 1 }).format(tr.inputSeconds || 0) + ' s';
  $('health-fallback').textContent = tr.vad === 'loudness-fallback' ? t('health_capture_fallback') : t('translation_fallback');
  const warn = mediaStatus !== 'connected' || mediaQuality === 'poor' || mediaQuality === 'lost' || ['translation_degraded', 'translation_limited'].includes(translating);
  healthButton.dataset.state = warn ? 'warn' : 'ok';
  $('health-label').textContent = t(warn ? 'health_attention' : 'health_title');
  $('translation-retry').hidden = !tr.enabled || !(tr.captureError || tr.sessions?.some(session => !session.ready));
}
document.addEventListener('wm:translation-status', event => { translationHealth = event.detail; renderHealth() });
$('translation-retry').onclick = () => window.WMT?.retry();
async function request(url, options = {}, milliseconds = 20000) {
  const controller = new AbortController(), external = options.signal;
  const abort = () => controller.abort(); if (external?.aborted) abort(); else external?.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(abort, milliseconds);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal }), body = await response.json();
    return { ok: response.ok, status: response.status, json: async () => body };
  }
  finally { clearTimeout(deadline); external?.removeEventListener('abort', abort) }
}
function cancelAdmission() { if (pendingAdmission) pendingAdmission.abort(); pendingAdmission = null }
$('admission-cancel').onclick = () => { cancelAdmission(); show('lobby'); $('join').disabled = false; startPreview() };
function admissionPause(ms, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(new Error('waiting_cancelled')) };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, ms);
    if (signal.aborted) { cancel(); return } signal.addEventListener('abort', cancel, { once: true });
  });
}
async function waitForAdmission(payload, initial) {
  cancelAdmission(); const controller = new AbortController(); pendingAdmission = controller;
  const requestedAt = Date.now(); let token = initial.waitingToken;
  if (typeof token !== 'string' || !token) throw new Error('waiting_expired');
  show('admission'); $('admission-state').textContent = t('waiting_description'); $('admission-cancel').focus();
  try {
    while (!controller.signal.aborted) {
      await admissionPause(3000, controller.signal);
      if (Date.now() - requestedAt > 15 * 60 * 1000) throw new Error('waiting_expired');
      let response, result;
      try {
        response = await request('api/join.php', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, waitingToken: token }) });
        result = await response.json();
      } catch (_) {
        if (controller.signal.aborted) throw new Error('waiting_cancelled');
        $('admission-state').textContent = t('waiting_retrying'); continue;
      }
      if (controller.signal.aborted) throw new Error('waiting_cancelled');
      if (response.status === 202 && result.status === 'waiting') { token = result.waitingToken || token; $('admission-state').textContent = t('waiting_description'); continue }
      if (response.status >= 500 || response.status === 429) { $('admission-state').textContent = t('waiting_retrying'); await admissionPause(5000, controller.signal); continue }
      if (!response.ok) throw new Error(result.error || 'waiting_rejected');
      return result;
    }
    throw new Error('waiting_cancelled');
  } finally { if (pendingAdmission === controller) pendingAdmission = null }
}
function renderWaitingParticipants(list) {
  const box = $('waiting-list'); box.innerHTML = '';
  if (!list.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = t('waiting_empty'); box.appendChild(empty); return }
  for (const person of list.slice(0, 100)) {
    const row = document.createElement('div'); row.className = 'waiting-person';
    const name = document.createElement('span'); name.textContent = String(person.name || t('guest')).slice(0, 80); row.appendChild(name);
    for (const action of ['admit', 'reject']) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'gh'; button.textContent = t(action === 'admit' ? 'waiting_accept' : 'waiting_reject');
      button.onclick = async () => { button.disabled = true; try { await hostCall(action, { waitingId: person.id }); await refreshHostState() } catch (_) { toast(t('host_err')); button.disabled = false } };
      row.appendChild(button);
    }
    box.appendChild(row);
  }
}
$('hwaiting').onchange = async () => {
  const checkbox = $('hwaiting'), enabled = checkbox.checked; checkbox.disabled = true;
  try { await hostCall('waiting', { enabled }); toast(t('waiting_saved')) } catch (_) { checkbox.checked = !enabled; toast(t('host_err')) }
  finally { checkbox.disabled = false; refreshHostState() }
};
// Keep keyboard focus inside the currently visible modal; Escape remains owned by
// each modal so it cannot silently accept or cancel an irreversible action.
addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const modal = [...document.querySelectorAll('.overlay.on')].at(-1); if (!modal) return;
  const focusable = [...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')].filter(element => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first.focus() }
});


$('joinform').onsubmit = async ev => {
  ev.preventDefault();
  const btn = $('join'); btn.disabled = true; $('jerr').textContent = '';
  const name = $('n').value.trim() || t('guest'), speak = $('speak').value, hear = $('hear').value;
  LS('wm-name', $('n').value.trim()); LS('wm-speak', speak); LS('wm-hear', hear);
  stopPreview();
  let j;
  const joinPayload = { r: linkR, h: hostKey, name, speak, hear, pw: $('pw').value, did: deviceId(), resumeToken };
  try {
    const r = await request('api/join.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(joinPayload) });
    j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
    if (r.status === 202 && j.status === 'waiting') j = await waitForAdmission(joinPayload, j);
  } catch (e) {
    if (e.message === 'waiting_cancelled') { btn.disabled = false; return }
    if (e.message === 'too_early' && j && j.startsAt) { btn.disabled = false; showWaiting(j.startsAt, 600, 0); return }
    const m = { bad_link: 'bad_link', bad_host: 'bad_link', room_full: 'room_full', room_locked: 'room_locked', room_closed: 'room_closed', password_required: 'pw_required', bad_password: 'pw_wrong', rate: 'file_rate', banned: 'banned', waiting_rejected: 'waiting_rejected', waiting_expired: 'waiting_expired', service_unavailable: 'join_err', room_expired: 'room_closed' }[e.message];
    if (e.message === 'password_required' || e.message === 'bad_password') { $('pwfield').classList.remove('hide'); $('pw').focus() }
    let msg = t(m || 'join_err');
    if (e.message === 'banned' && j && j.until) msg = t('banned_until', { t: new Date(j.until * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    show('lobby'); $('jerr').textContent = msg; btn.disabled = false; startPreview(); return;
  }
  try { await connect(j, { name, speak, hear }) }
  catch (_) { const failed = room; room = null; try { window.WMT?.shutdown(); window.WMC?.shutdown(); failed?.disconnect() } catch (_) {} window.WM = null; show('lobby'); $('jerr').textContent = t('join_err'); btn.disabled = false; startPreview(); return }
  btn.disabled = false;
};

async function connect(j, me) {
  me = { ...me, speak: j.speak || me.speak, hear: j.hear || me.hear };
  // iOS ignores audio element volume, so there the remote audio is mixed through web audio (gain works everywhere).
  // Elsewhere keep plain elements: the browser's echo cancellation works best with them.
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  room = new Room({
    webAudioMix: iOS,
    adaptiveStream: true, dynacast: true,
    videoCaptureDefaults: { resolution: VideoPresets.h540, ...(DEV.cam ? { deviceId: DEV.cam } : {}) },
    // stopMicTrackOnMute: muting really releases the microphone (browser indicator goes off). The camera is released on mute by default.
    publishDefaults: { simulcast: true, videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360], stopMicTrackOnMute: true },
    audioCaptureDefaults: { echoCancellation: AUD.ec, noiseSuppression: AUD.ns, autoGainControl: AUD.agc, ...(DEV.mic ? { deviceId: DEV.mic } : {}) },
    stopLocalTrackOnUnpublish: true,
  });
  isHost = !!j.host; $('hostwrap').classList.toggle('hide', !isHost); tilesEl.classList.toggle('hostview', isHost);
  resumeToken = j.resumeToken || j.ticket || ''; try { if (resumeToken) sessionStorage.setItem('wm-resume-' + linkR, resumeToken) } catch (_) {}
  const translation = { ...(window.MeetConfig?.translation || {}), ...(typeof j.translation === 'object' ? j.translation : {}), ...(typeof j.translation === 'boolean' ? { enabled: j.translation } : {}) };
  window.WM = { room, me: { ...me, identity: j.identity, ticket: j.ticket || j.token, host: isHost, room: j.room }, features: j.features || window.MeetConfig?.features || {}, translation, t, toast, addTx };
  if (window.WMT) WMT.init({ room, me: window.WM.me, addTx, t, audio: $('audio'), trvol: $('trvol'), muteorig: $('muteorig'), trchip: $('trchip'), config: translation, audioMode: () => audioMode });
  if (window.WMC) WMC.init({ room, me: { ...window.WM.me, room: j.room, name: me.name }, t, toast });
  const upd = () => sync();
  room.on(RoomEvent.ParticipantConnected, upd).on(RoomEvent.ParticipantDisconnected, p => { for (const el of $('audio').querySelectorAll('audio')) if (el.dataset.pid === p.identity) el.remove(); captionGate.forget(p.identity); upd() })
    .on(RoomEvent.ParticipantMetadataChanged, upd).on(RoomEvent.ParticipantNameChanged, upd)
    .on(RoomEvent.TrackMuted, upd).on(RoomEvent.TrackUnmuted, upd)
    .on(RoomEvent.LocalTrackPublished, pub => { if (pub.source === 'microphone') applyGain(); upd() }).on(RoomEvent.LocalTrackUnpublished, upd)
    .on(RoomEvent.ParticipantPermissionsChanged, (prev, p) => { if (room && p === room.localParticipant) localLockChanged(true); upd() })
    .on(RoomEvent.TrackPublished, upd).on(RoomEvent.TrackUnpublished, upd)
    .on(RoomEvent.TrackSubscribed, (track, pub, p) => { if (track.kind === 'audio') { const el = track.attach(); el._lk = track; el.dataset.pid = p.identity; el.dataset.name = pub.trackName || ''; el.dataset.src = pub.source || ''; $('audio').appendChild(el) } upd() })
    .on(RoomEvent.TrackUnsubscribed, track => { track.detach().forEach(e => e.remove()); upd() })
    .on(RoomEvent.ActiveSpeakersChanged, speakers => { for (const [k, tl] of tiles) tl.el.classList.toggle('speak', tl.kind === 'cam' && speakers.some(s => s.identity === tl.p.identity)); const r = speakers.find(s => s !== room.localParticipant); if (r) { lastSpeaker = r.identity; layout() } })
    .on(RoomEvent.DataReceived, (payload, p, kind, topic) => { if (topic === 'tx' && p && room?.remoteParticipants.has(p.identity) && payload.byteLength <= 12000) { try { addTx(JSON.parse(new TextDecoder().decode(payload)), p) } catch (_) {} } })
    .on(RoomEvent.Reconnecting, () => { mediaStatus = 'reconnecting'; renderHealth(); toast(t('reconnecting')) }).on(RoomEvent.Reconnected, () => { mediaStatus = 'connected'; renderHealth(); toast(t('reconnected')) })
    .on(RoomEvent.ConnectionQualityChanged, (quality, p) => { if (p === room?.localParticipant) { mediaQuality = quality; renderHealth() } })
    .on(RoomEvent.TrackMuted, (pub, p) => { if (room && p === room.localParticipant && Date.now() - selfActAt > 2500 && (pub.source === 'microphone' || pub.source === 'camera')) toast(t(pub.source === 'microphone' ? 'muted_mic_by_host' : 'muted_cam_by_host')) })
    .on(RoomEvent.Disconnected, reason => {
      if (!room) return;                                         // we left ourselves
      window.WMT?.shutdown(); window.WMC?.shutdown(); clearInterval(timer); clearInterval(aloneTimer); clearInterval(admissionTimer);
      mediaStatus = 'disconnected'; renderHealth(); document.dispatchEvent(new CustomEvent('wm:disconnected'));
      const R = window.LivekitClient.DisconnectReason || {};
      if (reason === R.PARTICIPANT_REMOVED) overlay(t('kicked_t'), t('kicked_p'), t('back_to_join'), () => leaveRoom());
      else if (reason === R.ROOM_DELETED) overlay(t('ended_t'), t('ended_p'), t('back_to_join'), () => leaveRoom());
      else if (!$('overlay').classList.contains('on')) overlay(t('disconnected_t'), t('disconnected_p'), t('rejoin'), () => location.reload());
    });

  await room.connect(j.url, j.token, { autoSubscribe: false });   // translate.js decides which tracks to subscribe to
  try { await room.startAudio() } catch (e) {}
  if (window.WMT) { WMT.afterConnect(); WMT.setMaster(AUD.master) }
  if (DEV.spk) { try { await room.switchActiveDevice('audiooutput', DEV.spk) } catch (e) {} }
  const lp = room.localParticipant; let denied = false;
  lockSeen = { mic: false, cam: false }; localLockChanged(false);        // the host may have locked this person's devices before they left
  if (micOn && !locksOf(lp).mic) { try { await lp.setMicrophoneEnabled(true) } catch (e) { denied = true } }
  if (camOn && !locksOf(lp).cam) { try { await lp.setCameraEnabled(true) } catch (e) { denied = true } }
  if (denied) toast(t('media_denied'));

  $('rname').textContent = title || t('room_small');
  show('room'); joinedAt = Date.now(); mediaStatus = 'connected'; mediaQuality = room.localParticipant.connectionQuality || 'unknown'; renderMeetingLanguages(); renderHealth();
  timer = setInterval(() => { const s = Math.floor((Date.now() - joinedAt) / 1000); $('t').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }, 1000);
  setCtl(); sync();
  aloneAt = 0; aloneWarned = false; clearInterval(aloneTimer); aloneTimer = setInterval(checkAlone, 30000);
  clearInterval(admissionTimer); if (isHost) { refreshHostState(); admissionTimer = setInterval(refreshHostState, 5000) }
  document.dispatchEvent(new CustomEvent('wm:joined'));
}

/* ---------- tiles ---------- */
function makeTile(a) {
  const el = document.createElement('div'); el.className = 'tile' + (a.kind === 'screen' ? ' scr' : '') + (a.p === room.localParticipant ? ' me' : '');
  el.innerHTML = '<video autoplay playsinline muted></video><div class="avatar"></div><span class="badge" hidden><b class="ic" data-i="trn"></b></span><button type="button" class="pin"><b class="ic" data-i="pin"></b></button><button type="button" class="mg" hidden><b class="ic" data-i="more"></b></button><div class="nm"><b class="ic mic" data-i="mic"></b><b class="ic hostmark" data-i="crown" hidden></b><span class="n"></span><span class="lang"></span></div>';
  paint(el);
  if (a.kind === 'cam' && a.p !== room.localParticipant) el.querySelector('.mg').onclick = ev => { ev.stopPropagation(); openMenu(ev.currentTarget, a.p.identity, () => a.p.name || t('guest')) };
  el.querySelector('.pin').onclick = () => { pinKey = pinKey === a.k ? null : a.k; if (pinKey) { tilesEl.classList.add('spot'); setLayIcon() } layout() };
  tilesEl.appendChild(el);
  return { el, video: el.querySelector('video'), kind: a.kind, p: a.p, tr: null, k: a.k };
}
function sync() {
  if (!room) return;
  const lp = room.localParticipant, all = [{ k: lp.identity, p: lp, kind: 'cam' }];
  room.remoteParticipants.forEach(p => all.push({ k: p.identity, p, kind: 'cam' }));
  for (const x of [lp, ...room.remoteParticipants.values()]) { const pub = x.getTrackPublication(Track.Source.ScreenShare); if (pub && pub.track && !pub.isMuted) all.push({ k: x.identity + '#screen', p: x, kind: 'screen' }) }
  for (const [k, tl] of tiles) if (!all.some(a => a.k === k)) { if (tl.tr) tl.tr.detach(tl.video); tl.el.remove(); tiles.delete(k) }
  for (const a of all) {
    let tl = tiles.get(a.k); if (!tl) { tl = makeTile(a); tiles.set(a.k, tl) } tl.p = a.p;
    const src = a.kind === 'screen' ? Track.Source.ScreenShare : Track.Source.Camera;
    const pub = a.p.getTrackPublication(src), tr = pub && pub.track, live = !!tr && !pub.isMuted;
    if (live) { if (tl.tr !== tr) { if (tl.tr) tl.tr.detach(tl.video); tr.attach(tl.video); tl.tr = tr } } else if (tl.tr) { tl.tr.detach(tl.video); tl.tr = null }
    tl.el.classList.toggle('hasvideo', live); tl.el.classList.toggle('cam', live && a.kind === 'cam');
    const nm = a.p.name || t('guest'), isMe = a.p === lp, m = meta(a.p);
    tl.el.querySelector('.avatar').textContent = initials(nm); tl.el.querySelector('.avatar').style.background = `linear-gradient(135deg,${gradOf(a.p.identity)})`;
    tl.el.querySelector('.n').textContent = a.kind === 'screen' ? t('screen_of', { n: nm }) : (nm + (isMe ? ` (${t('you')})` : ''));
    tl.el.querySelector('.lang').textContent = (m.speak || '').toUpperCase(); tl.el.querySelector('.lang').style.display = m.speak && a.kind === 'cam' ? '' : 'none';
    tl.el.querySelector('.nm').title = a.kind === 'screen' ? t('screen_of', { n: nm }) : nm;
    tl.el.querySelector('.mg').hidden = !(!isMe && a.kind === 'cam');             // everyone: volume of this person; the host: moderation too
    const hm = tl.el.querySelector('.hostmark'); hm.hidden = !(m.role === 'host' && a.kind === 'cam'); hm.title = t('host');
    const mic = tl.el.querySelector('.mic'); const micOk = a.p.isMicrophoneEnabled; if (mic.dataset.i !== (micOk ? 'mic' : 'micoff')) { mic.dataset.i = micOk ? 'mic' : 'micoff'; paint(mic.parentNode) } mic.classList.toggle('mute', !micOk); mic.style.display = a.kind === 'cam' ? '' : 'none';
    const lkd = locksOf(a.p).mic; mic.classList.toggle('lockd', lkd && !micOk); mic.parentNode.title = lkd ? t('locked_mic_tag') : nm;
    tl.el.classList.toggle('pinned', pinKey === a.k);
  }
  const people = all.filter(a => a.kind === 'cam').length;
  $('cnt').innerHTML = '<b class="ic">' + ico('users') + '</b>' + people;
  // auto spotlight when someone shares a screen
  const hasScreen = all.some(a => a.kind === 'screen');
  if (hasScreen && !tilesEl.classList.contains('spot')) { tilesEl.classList.add('spot'); autoSpot = true; setLayIcon() }
  if (!hasScreen && autoSpot) { tilesEl.classList.remove('spot'); autoSpot = false; setLayIcon() }
  layout(all); setCtl();
}
function layout(all) {
  if (!room) return;
  all = all || [...tiles.values()].map(t => ({ k: t.k, kind: t.kind, p: t.p }));
  const n = all.length; tilesEl.style.setProperty('--cols', n <= 1 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4); tilesEl.style.setProperty('--rows', Math.max(1, n - 1));
  let main = null;
  if (pinKey && all.some(a => a.k === pinKey)) main = pinKey; else { const sc = all.find(a => a.kind === 'screen'); if (sc) main = sc.k; else if (lastSpeaker && all.some(a => a.k === lastSpeaker)) main = lastSpeaker; else { const r = all.find(a => a.p !== room.localParticipant); main = (r || all[0]).k } }
  const spot = tilesEl.classList.contains('spot'); let i = 1;
  for (const a of all) { const tl = tiles.get(a.k); if (!tl) continue; tl.el.classList.toggle('main', a.k === main); tl.el.style.order = spot ? (a.k === main ? 0 : i++) : ''; }
}
function setLayIcon() { const b = $('lay').firstElementChild; b.dataset.i = tilesEl.classList.contains('spot') ? 'grid' : 'spot'; paint($('lay')) }

/* ---------- controls ---------- */
/* The host can take a person's microphone / camera permission away (and give it back). LiveKit carries it as the allowed publish sources:
   an empty list means everything is allowed. Source numbers: camera 1, microphone 2. */
function locksOf(p) {
  const cs = p && p.permissions && p.permissions.canPublishSources;
  const ok = n => p?.permissions?.canPublish !== false && (!cs || !cs.length || cs.includes(n));
  return { mic: !ok(2), cam: !ok(1) };
}
let lockSeen = { mic: false, cam: false };
function localLockChanged(announce) {
  if (!room) return; const l = locksOf(room.localParticipant);
  if (announce) {
    if (l.mic !== lockSeen.mic) toast(t(l.mic ? 'mic_locked_by_host' : 'mic_allowed_by_host'));
    else if (l.cam !== lockSeen.cam) toast(t(l.cam ? 'cam_locked_by_host' : 'cam_allowed_by_host'));
  } else if (l.mic || l.cam) toast(t(l.mic ? 'mic_locked' : 'cam_locked'));
  lockSeen = l; setCtl();
}
function setCtl() {
  if (!room) return; const lp = room.localParticipant, lk = locksOf(lp);
  setBtn($('mic'), lp.isMicrophoneEnabled, 'mic', 'micoff'); setBtn($('cam'), lp.isCameraEnabled, 'cam', 'camoff');
  for (const [id, k, key] of [['mic', 'mic', 'locked_mic_tag'], ['cam', 'cam', 'locked_cam_tag']]) {
    const b = $(id); b.classList.toggle('locked', lk[k]); b.title = lk[k] ? t(key) : t(id); b.setAttribute('aria-label', b.title); b.setAttribute('aria-disabled', lk[k] ? 'true' : 'false');
  }
  $('share').classList.toggle('on', lp.isScreenShareEnabled);
  $('mic').setAttribute('aria-pressed', String(lp.isMicrophoneEnabled)); $('cam').setAttribute('aria-pressed', String(lp.isCameraEnabled));
  renderHealth();
}

/* Microphone input level: a gain stage in front of what is sent (and what the translator hears). */
let gainProc = null, gainCtx = null;
function makeGainProc(v) {
  let src = null, g = null, dest = null;
  const p = { name: 'wm-gain', processedTrack: undefined, gain: v,
    async init(o) { src = o.audioContext.createMediaStreamSource(new MediaStream([o.track])); g = o.audioContext.createGain(); g.gain.value = p.gain; dest = o.audioContext.createMediaStreamDestination(); src.connect(g).connect(dest); p.processedTrack = dest.stream.getAudioTracks()[0] },
    async restart(o) { await p.destroy(); await p.init(o) },
    async destroy() { try { src && src.disconnect(); g && g.disconnect() } catch (e) {} src = g = dest = null },
    setGain(x) { p.gain = x; if (g) g.gain.value = x } };
  return p;
}
async function applyGain() {
  if (!room) return;
  const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone), tr = pub && pub.track; if (!tr || !tr.setProcessor) return;
  try {
    if (!gainProc) { if (AUD.gain === 1) return; gainProc = makeGainProc(AUD.gain) }
    gainProc.setGain(AUD.gain);
    if (tr.getProcessor && tr.getProcessor() === gainProc) return;
    if (!tr.audioContext && tr.setAudioContext) { gainCtx = gainCtx || new (window.AudioContext || window.webkitAudioContext)(); tr.setAudioContext(gainCtx) }
    await tr.setProcessor(gainProc);
    if (window.WMT) WMT.rewire();                          // the translator must listen to the processed track
  } catch (e) { console.warn('[wm] input gain unavailable', e); gainProc = null }
}
$('mic').onclick = async () => { if (locksOf(room.localParticipant).mic) { toast(t('mic_locked')); return } selfActAt = Date.now(); try { await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled) } catch (e) { toast(t('mic_failed')) } setCtl(); sync() };
$('cam').onclick = async () => { if (locksOf(room.localParticipant).cam) { toast(t('cam_locked')); return } selfActAt = Date.now(); try { await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled) } catch (e) { toast(t('cam_failed')) } setCtl(); sync() };
if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) $('share').classList.add('hide');
$('share').onclick = async () => { try { await room.localParticipant.setScreenShareEnabled(!room.localParticipant.isScreenShareEnabled) } catch (e) { if (e && e.name !== 'NotAllowedError') toast(t('share_failed')) } setCtl(); sync() };
$('cap').onclick = e => { const r = $('room'); r.classList.toggle('noside'); e.currentTarget.classList.toggle('on', !r.classList.contains('noside')) };
$('lay').onclick = () => { autoSpot = false; tilesEl.classList.toggle('spot'); setLayIcon(); layout() };
/* Leaving returns to the join screen (camera preview back on), ready to join again. */
function leaveRoom() {
  cancelAdmission();
  const leaving = window.WM?.me;
  if (leaving?.ticket) fetch('api/participant.php', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Meet-Token': leaving.ticket }, body: JSON.stringify({ action: 'leave' }) }).catch(() => {});
  resumeToken = ''; try { sessionStorage.removeItem('wm-resume-' + linkR) } catch (_) {}
  try { window.WMT && WMT.shutdown() } catch (e) {}
  document.dispatchEvent(new CustomEvent('wm:left'));
  try { window.WMC && WMC.shutdown() } catch (e) {}
  const r = room; room = null;
  try { r && r.disconnect() } catch (e) {}
  clearInterval(timer); clearInterval(aloneTimer); clearInterval(admissionTimer); captionGate.clear();
  for (const [, tl] of tiles) { try { tl.tr && tl.tr.detach(tl.video) } catch (e) {} tl.el.remove() }
  gainProc = null; if (gainCtx) { try { gainCtx.close() } catch (_) {} gainCtx = null } closeSettings(); tiles.clear(); $('audio').innerHTML = ''; $('msgs').innerHTML = ''; $('overlay').classList.remove('on');
  pinKey = null; lastSpeaker = null; autoSpot = false; tilesEl.classList.remove('spot', 'hostview'); setLayIcon(); window.WM = null;
  isHost = false; $('hostwrap').classList.add('hide'); $('hostpanel').hidden = true; $('mgmenu').hidden = true;
  $('cap-who').textContent = ''; $('cap-orig').textContent = ''; $('cap-trn').textContent = ''; $('trchip').textContent = '—';
  show('lobby'); $('join').disabled = false; $('jerr').textContent = ''; startPreview();
}
$('leave').onclick = leaveRoom;
$('copylink').onclick = async () => {
  const invite = window.WMCore.participantLink(location.href, linkR, title);
  try { await navigator.clipboard.writeText(invite); toast(t('link_copied')) }
  catch (e) { overlay(t('copy_link'), invite, t('close'), () => $('overlay').classList.remove('on')) }     // no clipboard access: show the link in our own dialog instead of the browser's prompt
};

/* ---------- meeting host (only the secret host link carries the rights; the server checks every action) ---------- */
async function hostCall(action, extra) {
  const r = await request('api/host.php', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Meet-Token': window.WM.me.ticket }, body: JSON.stringify({ action, ...extra }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j;
}
async function hostAct(action, extra, okMsg) { try { await hostCall(action, extra); if (okMsg) toast(okMsg) } catch (e) { toast(t('host_err')) } }
const mgmenu = $('mgmenu');
function closeMenu() { mgmenu.hidden = true }
mgmenu.onclick = e => e.stopPropagation();               // the volume slider lives in here: clicks must not close it
const setFill = el => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
setFill($('trvol')); $('trvol').addEventListener('input', () => setFill($('trvol')));      // translation volume slider uses the same style
function openMenu(btn, identity, nameFn) {
  mgmenu.innerHTML = '';
  const nm = nameFn(), P = room && room.remoteParticipants.get(identity);
  const add = (icon, label, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; if (cls) b.className = cls; b.innerHTML = `<b class="ic" data-i="${icon}"></b><span></span>`; b.lastChild.textContent = label; b.onclick = e => { e.stopPropagation(); closeMenu(); fn() }; mgmenu.appendChild(b) };
  const head = document.createElement('div'); head.className = 'pm-head'; head.textContent = nm; mgmenu.appendChild(head);
  // my own mix of this person (voice and translation of what they say), kept only on this device
  const cur = window.WMT ? WMT.getPerson(identity) : { vol: 1, muted: false };
  const vrow = document.createElement('div'); vrow.className = 'pm-vol';
  const mb = document.createElement('button'); mb.type = 'button'; mb.className = 'pm-mute'; mb.innerHTML = '<b class="ic" data-i="spk"></b>';
  const sl = document.createElement('input'); sl.type = 'range'; sl.className = 'sld'; sl.min = 0; sl.max = 100; sl.value = Math.round(cur.vol * 100); sl.setAttribute('aria-label', t('p_sound'));
  const out = document.createElement('output'); out.textContent = sl.value + '%';
  const paintMute = () => { const m = WMT.getPerson(identity).muted; mb.classList.toggle('off', m); mb.querySelector('[data-i]').dataset.i = m ? 'volmute' : 'spk'; mb.title = t(m ? 'p_unmute' : 'p_mute'); mb.setAttribute('aria-label', mb.title); mb.setAttribute('aria-pressed', String(m)); sl.disabled = m; paint(mb) };
  mb.onclick = e => { e.stopPropagation(); WMT.setPerson(identity, { muted: !WMT.getPerson(identity).muted }); paintMute() };
  sl.oninput = () => { out.textContent = sl.value + '%'; setFill(sl); WMT.setPerson(identity, { vol: sl.value / 100 }) };
  vrow.append(mb, sl, out); mgmenu.appendChild(vrow); setFill(sl);
  if (isHost) {
    const lk = locksOf(P);
    const sep = document.createElement('div'); sep.className = 'pm-sep'; mgmenu.appendChild(sep);
    const lab = document.createElement('div'); lab.className = 'pm-label'; lab.textContent = t('mod_label'); mgmenu.appendChild(lab);
    if (lk.mic) add('unlock', t('allow_mic'), () => hostAct('allow', { identity, source: 'microphone' }, t('done_allow_mic', { n: nm })), 'warn');
    else add('micoff', t('lock_mic'), () => hostAct('mute', { identity, source: 'microphone' }, t('done_lock_mic', { n: nm })));
    if (lk.cam) add('unlock', t('allow_cam'), () => hostAct('allow', { identity, source: 'camera' }, t('done_allow_cam', { n: nm })), 'warn');
    else add('camoff', t('lock_cam'), () => hostAct('mute', { identity, source: 'camera' }, t('done_lock_cam', { n: nm })));
    const sep2 = document.createElement('div'); sep2.className = 'pm-sep'; mgmenu.appendChild(sep2);
    add('kick', t('kick_only'), async () => { if (await ask(t('kick_t', { n: nm }), t('kick_p'), t('kick'), t('cancel'))) hostAct('kick', { identity }, t('done_kick', { n: nm })) }, 'danger');
    for (const [ban, icon, key] of [['10m', 'timer', 'ban_10m'], ['1h', 'timer', 'ban_1h'], ['room', 'ban', 'ban_room']]) {
      add(icon, t(key), async () => {
        if (!(await ask(t('ban_t', { n: nm }), t('ban_p_' + ban), t(key), t('cancel')))) return;
        try { const r = await hostCall('kick', { identity, ban }); toast(r.banned ? t('done_ban', { n: nm }) : t('ban_partial', { n: nm })); refreshBans() } catch (e) { toast(t('host_err')) }
      }, 'danger');
    }
  }
  paint(mgmenu); paintMute(); mgmenu.hidden = false;
  const r = btn.getBoundingClientRect();
  mgmenu.style.top = Math.max(8, Math.min(innerHeight - mgmenu.offsetHeight - 8, r.bottom + 6)) + 'px';
  mgmenu.style.left = Math.max(8, Math.min(innerWidth - mgmenu.offsetWidth - 8, r.right - mgmenu.offsetWidth)) + 'px';
}
for (let n = 2; n <= 8; n++) { const o = document.createElement('option'); o.value = String(n); o.textContent = String(n); $('hlimit').appendChild(o) }
if (window.WMSelect) WMSelect.enhance($('hlimit'), { cls: 'sm' });
let hostDirty = false;                                   // the host already changed something: a late status reply must not overwrite it
async function refreshHostState() { if (!isHost || !window.WM) return; try { const s = await hostCall('state'); if (!isHost || !window.WM) return; if (!hostDirty) { $('hlimit').value = String(s.max); $('hlock').classList.toggle('on', !!s.locked); $('hwaiting').checked = !!s.waitingRoom } $('hcount').textContent = t('host_count', { n: s.count, m: $('hlimit').value || s.max }); renderWaitingParticipants(s.waiting || []) } catch (_) { /* Polling failures never overwrite the last confirmed host state. */ } }
async function refreshBans() {
  const box = $('banlist'); if (!box || !isHost) return;
  let list = []; try { list = (await hostCall('bans')).bans || [] } catch (e) { return }
  box.innerHTML = '';
  if (!list.length) { const n = document.createElement('div'); n.className = 'bannone'; n.textContent = t('bans_none'); box.appendChild(n); return }
  for (const b of list) {
    const row = document.createElement('div'); row.className = 'banrow';
    const info = document.createElement('div'); info.style.minWidth = 0;
    const nm = document.createElement('b'); nm.textContent = b.name || t('guest');
    const sm = document.createElement('small'); sm.textContent = b.until ? t('ban_until', { t: new Date(b.until * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : t('ban_forever');
    info.append(nm, sm);
    const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = t('ban_remove');
    rm.onclick = async e => { e.stopPropagation(); try { await hostCall('unban', { id: b.id }); toast(t('done_unban')); refreshBans() } catch (x) { toast(t('host_err')) } };
    row.append(info, rm); box.appendChild(row);
  }
}
$('hostbtn').onclick = e => { e.stopPropagation(); const p = $('hostpanel'); p.hidden = !p.hidden; if (!p.hidden) { hostDirty = false; refreshHostState(); refreshBans() } };
$('hostpanel').onclick = e => e.stopPropagation();
addEventListener('click', () => { $('hostpanel').hidden = true; closeMenu() });
$('hlimit').onchange = async () => { const requested = Number($('hlimit').value); hostDirty = true; try { await hostCall('limit', { max: requested }); toast(t('done_limit')) } catch (_) { toast(t('host_err')) } finally { hostDirty = false; refreshHostState() } };
$('hlock').onclick = async () => {
  hostDirty = true; const on = !$('hlock').classList.contains('on');
  $('hlock').classList.toggle('on', on);                   // instant feedback, undone if the server refuses
  try { await hostCall('lock', { locked: on }); toast(on ? t('done_lock') : t('done_unlock')) } catch (e) { $('hlock').classList.toggle('on', !on); toast(t('host_err')) } finally { hostDirty = false; refreshHostState() }
};
$('hend').onclick = async () => { $('hostpanel').hidden = true; if (await ask(t('end_t'), t('end_p'), t('end_meeting'), t('cancel'))) { try { await hostCall('end') } catch (e) { toast(t('host_err')) } } };
if (hostKey) $('hostchip').classList.remove('hide');

/* ---------- sound and device settings (works in the lobby and in the room) ---------- */
const stEl = $('settings'); let stFocus = null, stRaf = 0, stCtx = null, stSrcTrack = null, stSrc = null, stAn = null, stBuf = null;
if (window.WMSelect) for (const id of ['st-micdev', 'st-spkdev', 'st-camdev']) WMSelect.enhance($(id));
if (!('setSinkId' in HTMLMediaElement.prototype)) $('st-spkfield').classList.add('hide');          // Safari / iOS cannot pick the speaker
function fillDevices(sel, list, cur, label) {
  sel.innerHTML = '';
  const d = document.createElement('option'); d.value = ''; d.textContent = t('st_default'); sel.appendChild(d);
  list.filter(x => x.deviceId !== 'default' && x.deviceId !== 'communications').forEach((x, i) => { const o = document.createElement('option'); o.value = x.deviceId; o.textContent = x.label || (label + ' ' + (i + 1)); sel.appendChild(o) });
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
}
async function refreshDevices() {
  const md = navigator.mediaDevices; if (!md || !md.enumerateDevices) return;
  let all = []; try { all = await md.enumerateDevices() } catch (e) {}
  const of = k => all.filter(d => d.kind === k && d.deviceId);
  fillDevices($('st-micdev'), of('audioinput'), DEV.mic, t('st_mic')); fillDevices($('st-camdev'), of('videoinput'), DEV.cam, t('st_cam')); fillDevices($('st-spkdev'), of('audiooutput'), DEV.spk, t('st_spk'));
  $('st-micnote').textContent = all.some(d => d.kind !== 'audiooutput' && d.deviceId && !d.label) ? t('st_perm') : '';
}
function paintSettings() {
  const g = $('st-gain'), m = $('st-master');
  g.value = Math.round(AUD.gain * 100); $('st-gainv').textContent = g.value + '%'; setFill(g);
  m.value = Math.round(AUD.master * 100); $('st-masterv').textContent = m.value + '%'; setFill(m);
  for (const [id, k] of [['st-ns', 'ns'], ['st-ec', 'ec'], ['st-agc', 'agc']]) { $(id).classList.toggle('on', AUD[k]); $(id).setAttribute('aria-checked', String(AUD[k])) }
}
function liveMicTrack() {
  if (room) { const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone); const tr = pub && pub.track && !pub.isMuted ? pub.track.mediaStreamTrack : null; return tr && tr.readyState === 'live' ? tr : null }
  return pvStream ? (pvStream.getAudioTracks().find(x => x.readyState === 'live') || null) : null;
}
function meterLoop() {
  if (!stEl.classList.contains('on')) return;
  const tr = liveMicTrack(); let lvl = 0;
  if (tr) {
    try {
      if (!stCtx) stCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (tr !== stSrcTrack) { try { stSrc && stSrc.disconnect() } catch (e) {} stSrc = stCtx.createMediaStreamSource(new MediaStream([tr])); stAn = stCtx.createAnalyser(); stAn.fftSize = 1024; stSrc.connect(stAn); stBuf = new Float32Array(stAn.fftSize); stSrcTrack = tr }
      stAn.getFloatTimeDomainData(stBuf); let s = 0; for (let i = 0; i < stBuf.length; i++) s += stBuf[i] * stBuf[i];
      const rms = Math.sqrt(s / stBuf.length); lvl = clamp((20 * Math.log10(rms || 1e-6) + 60) / 60, 0, 1);
    } catch (e) {}
  } else stSrcTrack = null;
  $('st-lvl').style.width = (lvl * 100).toFixed(0) + '%';
  stRaf = requestAnimationFrame(meterLoop);
}
async function openSettings() {
  stFocus = document.activeElement; renderMeetingLanguages(); renderHealth(); paintSettings(); stEl.classList.add('on'); $('st-close').focus();
  await refreshDevices(); cancelAnimationFrame(stRaf); meterLoop();
}
function closeSettings() {
  if (!stEl.classList.contains('on')) return;
  stEl.classList.remove('on'); cancelAnimationFrame(stRaf);
  try { stSrc && stSrc.disconnect() } catch (e) {} stSrc = null; stSrcTrack = null; if (stCtx) { try { stCtx.close() } catch (e) {} stCtx = null }
  if (stFocus && stFocus.focus) { try { stFocus.focus() } catch (e) {} }
}
async function restartMic() {
  if (!room) { startPreview(); return }
  const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone); if (!pub || !pub.track) return;
  try { await pub.track.restartTrack(micC(true)) } catch (e) { try { await pub.track.restartTrack(micC(false)) } catch (e2) { toast(t('mic_failed')) } }
  if (window.WMT) WMT.rewire();
}
$('setbtn').onclick = openSettings; $('pv-set').onclick = openSettings; $('st-close').onclick = closeSettings;
stEl.addEventListener('click', e => { if (e.target === stEl) closeSettings() });
addEventListener('keydown', e => { if (e.key === 'Escape' && stEl.classList.contains('on')) { closeSettings() } });
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => { if (stEl.classList.contains('on')) refreshDevices() });
$('st-micdev').onchange = async () => { DEV.mic = $('st-micdev').value; LS('wm-micdev', DEV.mic); if (room) { try { await room.switchActiveDevice('audioinput', DEV.mic || 'default'); if (window.WMT) WMT.rewire() } catch (e) { toast(t('mic_failed')) } } else startPreview() };
$('st-camdev').onchange = async () => { DEV.cam = $('st-camdev').value; LS('wm-camdev', DEV.cam); if (room) { try { await room.switchActiveDevice('videoinput', DEV.cam || 'default') } catch (e) { toast(t('cam_failed')) } } else startPreview() };
$('st-spkdev').onchange = async () => { DEV.spk = $('st-spkdev').value; LS('wm-spkdev', DEV.spk); if (room) { try { await room.switchActiveDevice('audiooutput', DEV.spk || 'default') } catch (e) {} } };
$('st-gain').oninput = () => { AUD.gain = $('st-gain').value / 100; $('st-gainv').textContent = $('st-gain').value + '%'; setFill($('st-gain')); LS('wm-gain', $('st-gain').value); applyGain() };
$('st-master').oninput = () => { AUD.master = $('st-master').value / 100; $('st-masterv').textContent = $('st-master').value + '%'; setFill($('st-master')); LS('wm-master', $('st-master').value); if (window.WMT) WMT.setMaster(AUD.master) };
for (const [id, k] of [['st-ns', 'ns'], ['st-ec', 'ec'], ['st-agc', 'agc']]) $(id).onclick = () => { AUD[k] = !AUD[k]; LS('wm-' + k, AUD[k] ? '1' : '0'); paintSettings(); restartMic() };
$('st-test').onclick = async () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(), dest = ctx.createMediaStreamDestination(), el = new Audio();
    el.srcObject = dest.stream; el.volume = AUD.master; if (DEV.spk && el.setSinkId) { try { await el.setSinkId(DEV.spk) } catch (e) {} }
    const now = ctx.currentTime; [[660, 0], [880, .28]].forEach(([f, at]) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0, now + at); g.gain.linearRampToValueAtTime(.35, now + at + .03); g.gain.linearRampToValueAtTime(0, now + at + .26); o.connect(g).connect(dest); o.start(now + at); o.stop(now + at + .3) });
    await el.play(); setTimeout(() => { try { el.pause(); ctx.close() } catch (e) {} }, 900);
  } catch (e) { toast(t('host_err')) }
};

/* ---------- transcripts (filled by translate.js through the data channel) ---------- */
const msgs = $('msgs');
const captionGate = new window.WMCore.CaptionGate();
function addTx(message, participant, transcript) {
  const me = window.WM?.me; if (!me) return;
  const m = window.WMCore.normalizeCaption(message, participant, me);
  if (!m || m.to !== me.hear) return;
  // Only the originating browser may supply its primary provider session's
  // translation for its own consented archive; remote peers cannot override it.
  const archive = !participant && transcript ? window.WMCore.normalizeCaption({ ...message, to: transcript.to, trn: transcript.translated }, null, me) || m : m;
  if (!captionGate.accept({ ...m, trn: archive.trn }, performance.now())) return;
  document.dispatchEvent(new CustomEvent('wm:caption', { detail: {
    identity: m.from, id: m.sourceId, original: archive.orig, translated: archive.trn,
    from: m.speak, to: archive.to, name: m.name, speak: m.speak, local: !participant, at: Date.now(),
  } }));
  let el = msgs.querySelector(`[data-id="${CSS.escape(m.id)}"]`);
  if (!el) {
    el = document.createElement('div'); el.className = 'msg'; el.dataset.id = m.id;
    el.innerHTML = '<div class="who2"><span class="wn"></span> <span class="lang"></span></div><div class="orig"></div><div class="trn"></div>';
    msgs.appendChild(el); while (msgs.children.length > 300) msgs.firstElementChild.remove();
  }
  el.querySelector('.wn').textContent = m.name; el.querySelector('.lang').textContent = m.speak.toUpperCase();
  el.querySelector('.orig').textContent = m.orig; el.querySelector('.trn').textContent = m.trn || m.orig;
  el.querySelector('.orig').style.display = m.trn ? '' : 'none';
  msgs.querySelector('.cur')?.classList.remove('cur'); el.classList.add('cur');
  msgs.scrollTop = msgs.scrollHeight;
  $('cap-who').textContent = m.name + ' '; $('cap-orig').textContent = m.trn || m.orig; $('cap-trn').textContent = m.trn ? m.orig : '';
}

/* ---------- nobody else in the room: do not keep the connection (and the free minutes) running for ever ---------- */
let aloneAt = 0, aloneWarned = false, aloneTimer = null;
const ALONE_LIMIT_MIN = 30;
function checkAlone() {
  if (!room) return;
  if (room.remoteParticipants.size > 0) { aloneAt = 0; aloneWarned = false; return }
  if (!aloneAt) aloneAt = Date.now();
  const min = (Date.now() - aloneAt) / 60000;
  if (min >= ALONE_LIMIT_MIN) { leaveRoom(); overlay(t('alone_t'), t('alone_p'), t('close'), () => $('overlay').classList.remove('on')) }
  else if (min >= ALONE_LIMIT_MIN - 3 && !aloneWarned) { aloneWarned = true; toast(t('alone_warn')) }
}

/* ---------- home: paste a meeting link or code ---------- */
function parseLink(raw) { return window.WMCore.parseInvite(raw) }
$('linkform').onsubmit = e => {
  e.preventDefault(); const p = parseLink($('linkin').value);
  if (!p) { $('linkerr').textContent = t('link_bad'); return }
  const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('r', p.r); if (p.h) u.hash = new URLSearchParams({ h: p.h }).toString(); if (p.t) u.searchParams.set('t', p.t);
  location.assign(u.toString());
};
$('linkin').addEventListener('input', () => { $('linkerr').textContent = '' });
function showHome(msg) { stopPreview(); show('nolink'); $('linkerr').textContent = msg || '' }
async function loadRoomInfo() {
  try {
    const r = await fetch('api/room-info.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ r: linkR }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 410) return showHome(t('room_closed'));
    if (!r.ok) return showHome(t('link_bad'));
    $('pwfield').classList.toggle('hide', !(j.password && !hostKey));
    if (j.title) { title = String(j.title).slice(0, 60); applyI18n() }
    if (j.startsAt && !hostKey) { const skew = (j.now || 0) - Date.now() / 1000; if (Date.now() / 1000 + skew < j.startsAt - (j.earlySec || 600)) showWaiting(j.startsAt, j.earlySec || 600, skew) }
  } catch (e) { /* the join step reports problems too */ }
}

/* ---------- a booked meeting that has not started yet: a friendly waiting page that opens the join screen by itself ---------- */
let waitTimer = null;
function showWaiting(startsAt, earlySec, skew) {
  stopPreview(); show('waiting'); clearInterval(waitTimer);
  const unit = (u, n) => { try { const p = new Intl.NumberFormat(LANG, { style: 'unit', unit: u, unitDisplay: 'long' }).formatToParts(n).find(x => x.type === 'unit'); return p ? p.value : u } catch (e) { return u } };
  const when = new Intl.DateTimeFormat(LANG, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(startsAt * 1000));
  $('wait-when').textContent = t('wait_p', { when });
  $('wait-note').textContent = t('wait_note', { m: Math.round(earlySec / 60) });
  const cd = $('wait-cd'); cd.innerHTML = '';
  const parts = [['day', 'd'], ['hour', 'h'], ['minute', 'm'], ['second', 's']].map(([u, k]) => { const b = document.createElement('div'); b.className = 'cdb'; b.innerHTML = '<b></b><small></small>'; cd.appendChild(b); return { u, k, b } });
  const tick = () => {
    const now = Date.now() / 1000 + skew, left = Math.max(0, Math.floor(startsAt - now));
    if (now >= startsAt - earlySec) { clearInterval(waitTimer); show('lobby'); startPreview(); return }
    const v = { d: Math.floor(left / 86400), h: Math.floor(left % 86400 / 3600), m: Math.floor(left % 3600 / 60), s: left % 60 };
    for (const p of parts) { p.b.firstChild.textContent = String(v[p.k]).padStart(2, '0'); p.b.lastChild.textContent = unit(p.u, v[p.k]) }
  };
  tick(); waitTimer = setInterval(tick, 1000);
}

/* ---------- boot ---------- */
window.WMI = { lang: () => LANG, paint: () => paint(), toast, t, LANGS };              // used by home.js (the calendar on the home page)
// Wait (briefly) for the visitor's language so no wrong-language text flashes; if it cannot be loaded, fall back to the source language.
async function boot() {
  try { await (window.MeetConfigReady || Promise.resolve()) } catch (_) {}
  configureMeetingLanguages();
  const preferred = window.MeetConfig?.app?.defaultLocale;
  if (!LS('wm-lang') && CODES.includes(preferred) && !(navigator.languages || []).some(value => CODES.includes(value.slice(0, 2)))) LANG = preferred;
  const catalogReady = Promise.all([ensureLang('en'), ensureLang(LANG)]);
  await Promise.race([catalogReady, new Promise(resolve => setTimeout(resolve, 3000))]);
  paint(); langMenu(); applyI18n();
  const linkOk = window.WMCore.validRoom(linkR);
  if (!window.LivekitClient || !linkOk) show('nolink');
  else { show('lobby'); startPreview(); loadRoomInfo() }
  if ($('nolink').classList.contains('on') && window.WMHome) WMHome.start();
}
boot();
})();
