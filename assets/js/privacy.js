/* Public privacy information, localized without sending personal data. */
(() => {
  'use strict';
  const fallback = {
  "page_title": "Privacy",
  "language": "Language",
  "heading": "Meeting data and your choices",
  "intro": "This page explains the software’s data flows. The organization running this installation is responsible for its privacy policy, retention and legal obligations.",
  "features_title": "Features on this installation",
  "loading": "Loading the installation’s public configuration…",
  "config_unavailable": "Installation configuration is unavailable. Ask the organizer which processors and retention periods apply.",
  "live_translation": "Live speech translation: {state}.",
  "chat_translation": "Automatic chat translation: {state}.",
  "transcripts": "Persistent transcripts: {state}.",
  "summary": "AI summaries: {state}.",
  "booking": "Public booking: {state}.",
  "off": "off",
  "available": "available",
  "record_permission": "available; each speaker’s consent is required",
  "summary_permission": "available; separate consent is required",
  "enabled": "enabled",
  "media_title": "Video, sound and messages",
  "media_body": "LiveKit carries live media and participant metadata. This application does not record audio or video to disk by default. Participants can see or hear what you share and may make their own copies.",
  "chat_files": "Ordinary chat stays in meeting browsers. Uploaded files are available to admitted members while their room access is valid. Configured file retention: {hours}.",
  "translation_title": "Optional translation",
  "translation_body": "Live translation sends microphone audio from the speaking browser to the configured speech provider. Translated audio travels through LiveKit. Optional chat translation sends the relevant text to the configured text provider; the original stays available. Provider processing and retention depend on the operator’s agreements.",
  "records_title": "Transcript and AI summary consent",
  "records_body": "Persistent capture starts off. When the installation and host enable it, each speaker may allow their own captions to be saved. A separate choice allows saved text to be sent for an AI summary. Joining a meeting gives neither permission.",
  "records_withdraw": "You can withdraw consent in the meeting. Withdrawing transcript consent deletes your saved rows and invalidates summaries. Copies already sent to a provider, emailed or downloaded cannot be recalled. Transcripts may be incomplete or inaccurate; AI summaries require review.",
  "records_retention": "Configured transcript retention: {hours}. The operator controls scheduled cleanup and backup retention.",
  "booking_title": "Requests and schedules",
  "booking_body": "If booking is enabled, the server stores the name, email, chosen time and other details you submit. Calendar and email services are used only when configured. Keep the private management link safe: it permits cancellation and rescheduling.",
  "contact_title": "Questions, access and deletion",
  "contact_body": "Ask the organization that invited you about the data controller, processors, regional policies, access or deletion requests and backups. An open source license does not make every installation compliant with privacy law.",
  "retention_unknown": "ask the organizer",
  "hours": "{n} hours",
  "back": "Back to meetings",
  "source": "Source code · Apache-2.0",
  "locale_unavailable": "This language could not be loaded. English is shown.",
  "usage_title": "Usage measurements",
  "usage_body": "The server retains request counts and provider-reported token totals. Browsers may report approximate audio and session durations. These measurements support resource limits and cost estimates; they do not contain spoken text and are not provider invoices. Configured usage retention: {days}.",
  "booking_retention": "Pending requests expire after {pending}. Booking details are retained for {days}, measured from the later of creation or the booked time.",
  "browser_storage": "Browser storage keeps language and device preferences and tab-scoped access credentials. Cookies support admitted file access and administrator sessions.",
  "days": "{n} days"
};
  const languages = { tr: 'Türkçe', en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', nl: 'Nederlands', pt: 'Português', pl: 'Polski', ru: 'Русский', ar: 'العربية', ja: '日本語' };
  const $ = id => document.getElementById(id), catalogs = { en: fallback };
  let config = null, locale = 'en', generation = 0;
  const t = (key, values = {}) => { let text = catalogs[locale]?.[key] || fallback[key] || key; for (const [name, value] of Object.entries(values)) text = text.replaceAll('{' + name + '}', String(value)); return text };
  function paint() {
    document.documentElement.lang = locale; document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.dataset.pageTitle = t('page_title'); document.title = t('page_title') + ' · ' + (config?.app?.name || 'Auto Translate Meeting');
    document.querySelectorAll('[data-p]').forEach(element => { element.textContent = t(element.dataset.p) });
    const period = (value, unit = 'hour') => { if (config?.configurationUnavailable || !Number.isFinite(value)) return t('retention_unknown'); try { return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(value) } catch (_) { return t(unit === 'hour' ? 'hours' : 'days', { n: new Intl.NumberFormat(locale).format(value) }) } };
    const hours = value => period(value);
    $('privacy-chat-files').textContent = t('chat_files', { hours: hours(config?.limits?.fileRetentionHours) });
    $('privacy-records-retention').textContent = t('records_retention', { hours: hours(config?.limits?.transcriptRetentionHours) });
    $('privacy-booking-retention').textContent = t('booking_retention', { pending: hours(config?.limits?.bookingPendingHours), days: period(config?.limits?.bookingRetentionDays, 'day') });
    $('privacy-usage').textContent = t('usage_body', { days: period(config?.limits?.usageRetentionDays, 'day') });
    const list = $('privacy-features'); list.replaceChildren();
    const rows = !config ? [t('loading')] : config.configurationUnavailable ? [t('config_unavailable')] : [
      t('live_translation', { state: config.features.translation ? config.translation.provider : t('off') }),
      t('chat_translation', { state: t(config.features.chatTranslation ? 'available' : 'off') }),
      t('transcripts', { state: t(config.features.transcripts ? 'record_permission' : 'off') }),
      t('summary', { state: t(config.features.summary ? 'summary_permission' : 'off') }),
      t('booking', { state: t(config.features.booking ? 'enabled' : 'off') })
    ];
    for (const text of rows) { const row = document.createElement('li'); row.textContent = text; list.append(row) }
  }
  async function read(code) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('../assets/i18n/privacy/' + code + '.json', { signal: controller.signal, cache: 'force-cache' });
      if (!response.ok) return null;
      const value = await response.json(); if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const clean = {}; for (const key of Object.keys(fallback)) if (typeof value[key] === 'string' && value[key].length < 10000) clean[key] = value[key];
      return Object.keys(clean).length ? clean : null;
    } catch (_) { return null } finally { clearTimeout(timer) }
  }
  async function setLocale(code, persist = false) {
    const owner = ++generation; if (!languages[code]) code = 'en';
    if (persist) { try { localStorage.setItem('wm-lang', code) } catch (_) {} }
    if (!catalogs[code]) { const data = await read(code); if (data) catalogs[code] = data }
    if (owner !== generation) return;
    const unavailable = !catalogs[code]; locale = unavailable ? 'en' : code; $('privacy-locale').value = locale;
    paint(); $('privacy-status').textContent = unavailable ? t('locale_unavailable') : '';
  }
  for (const [code, name] of Object.entries(languages)) { const option = document.createElement('option'); option.value = code; option.textContent = name; option.lang = code; $('privacy-locale').append(option) }
  $('privacy-locale').onchange = () => setLocale($('privacy-locale').value, true);
  (async () => {
    try { config = await window.MeetConfigReady } catch (_) {}
    if (!config) config = { configurationUnavailable: true }; paint();
    let saved = ''; try { saved = localStorage.getItem('wm-lang') || '' } catch (_) {}
    const browser = (navigator.languages || [navigator.language || 'en']).map(value => value.slice(0, 2).toLowerCase()).find(code => languages[code]);
    const preferred = languages[saved] ? saved : browser || config.app?.defaultLocale || 'en';
    await setLocale(preferred); $('privacy-locale').disabled = false;
  })();
})();
