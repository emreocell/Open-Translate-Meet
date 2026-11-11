/* Public, allowlisted deployment identity. Optional integrations default off. */
(() => {
  'use strict';
  const root = new URL('../../', document.currentScript.src);
  const fallback = {
    app: { name: 'Auto Translate Meeting', defaultLocale: 'en', defaultTheme: 'auto', logo: 'assets/brand/mark.svg', favicon: 'assets/brand/mark.svg', accent: '#7ea6ff', contactEmail: '', contactPhone: '', website: '', sourceUrl: 'https://github.com/emreocell/auto-translate-meeting' },
    features: { booking: false, translation: false, chatTranslation: false, transcripts: false, summary: false },
    translation: { enabled: false, provider: 'none', model: '', languages: ['tr', 'en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'ru', 'ar', 'ja'], maxSessions: 3 },
    uiLanguages: ['tr', 'en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'ru', 'ar', 'ja'],
    limits: { maxParticipants: 8, fileRetentionHours: 24, transcriptRetentionHours: 24, usageRetentionDays: 30, bookingPendingHours: 48, bookingRetentionDays: 120 }, privacyUrl: 'privacy/'
  };
  const localUrl = value => new URL(value, root).href;
  const apply = config => {
    const app = config.app;
    document.querySelectorAll('[data-app-name]').forEach(node => { node.textContent = app.name; });
    document.querySelectorAll('[data-brand-logo]').forEach(node => { node.src = localUrl(app.logo); node.alt = ''; });
    document.querySelectorAll('[data-source-link]').forEach(node => { node.href = app.sourceUrl; });
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) favicon.href = localUrl(app.favicon);
    const subtitle = document.documentElement.dataset.pageTitle;
    document.title = subtitle ? subtitle + ' · ' + app.name : app.name;
    document.documentElement.style.setProperty('--brand-accent', app.accent);
    let chosenTheme;
    try { chosenTheme = localStorage.getItem('wm-theme'); } catch (_) { /* optional persistence */ }
    const theme = ['dark', 'light'].includes(chosenTheme) ? chosenTheme : app.defaultTheme;
    document.documentElement.dataset.theme = ['dark', 'light'].includes(theme) ? theme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.querySelectorAll('[data-contact-email]').forEach(node => {
      node.hidden = !app.contactEmail;
      if (app.contactEmail) { node.href = 'mailto:' + app.contactEmail; node.querySelector('strong').textContent = app.contactEmail; }
    });
    document.querySelectorAll('[data-contact-phone]').forEach(node => {
      node.hidden = !app.contactPhone;
      if (app.contactPhone) { node.href = 'tel:' + app.contactPhone.replace(/[^+0-9]/g, ''); node.querySelector('strong').textContent = app.contactPhone; }
    });
    document.querySelectorAll('[data-contact-website]').forEach(node => {
      node.hidden = !app.website;
      if (app.website) { node.href = app.website; node.textContent = new URL(app.website, root).hostname; }
    });
    document.querySelectorAll('[data-contact-card]').forEach(node => { node.hidden = !app.contactEmail && !app.contactPhone && !app.website; });
    document.querySelectorAll('[data-booking-section]').forEach(node => { node.hidden = !config.features.booking; });
    document.querySelector('.home')?.classList.toggle('without-booking', !config.features.booking);
    window.dispatchEvent(new CustomEvent('meet:config', { detail: config }));
  };
  window.MeetConfig = fallback;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 10000);
  window.MeetConfigReady = fetch(new URL('api/config.php', root), { cache: 'no-store', signal: controller.signal, credentials: 'same-origin' })
    .then(response => { if (!response.ok) throw new Error('configuration'); return response.json(); })
    .then(config => {
      if (!config || typeof config.app?.name !== 'string' || !Array.isArray(config.translation?.languages)) throw new Error('configuration');
      window.MeetConfig = config;
      return config;
    })
    .catch(() => { window.MeetConfig = { ...fallback, configurationUnavailable: true }; return window.MeetConfig; })
    .finally(() => clearTimeout(deadline));
  const ready = document.readyState === 'loading' ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true })) : Promise.resolve();
  Promise.all([ready, window.MeetConfigReady]).then(([, config]) => apply(config));
})();
