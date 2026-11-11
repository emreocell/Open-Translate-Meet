/* Standalone administration. Credentials and CSRF tokens are kept out of browser storage. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const languageNames = { en: 'English', tr: 'Türkçe', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', nl: 'Nederlands', pt: 'Português', pl: 'Polski', ru: 'Русский', ar: 'العربية', ja: '日本語' };
  const state = { csrf: null, config: null, rooms: [], bookings: [], health: null, tab: 'rooms', editing: null, reportRoom: null, roomVersion: 0, reportVersion: 0, authEpoch: 0, locale: 'en', catalogs: {} };
  const t = (key, values = {}) => { let text = state.catalogs[state.locale]?.[key] ?? state.catalogs.en?.[key] ?? key; for (const [name, value] of Object.entries(values)) text = text.replaceAll('{' + name + '}', String(value)); return text; };
  const node = (tag, attrs = {}, children = []) => {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'text') element.textContent = value;
      else if (key === 'class') element.className = value;
      else element.setAttribute(key, value);
    }
    for (const child of children) element.append(child);
    return element;
  };
  function notify(text, kind = 'status') { const box = $('ad-message'); box.textContent = text; box.dataset.kind = kind; box.hidden = false; box.setAttribute('role', kind === 'error' ? 'alert' : 'status'); }
  function errorMessage(error) {
    const keys = { forbidden: 'error_password', unauthorized: 'error_session', csrf: 'error_session', rate: 'error_rate', ai_limit: 'error_rate',
      room_closed: 'error_closed', not_found: 'error_closed', below_live_count: 'error_capacity', bad_schedule: 'error_schedule', bad_password_length: 'error_room_password',
      media_unavailable: 'media_unknown', provider_unavailable: 'error_provider', provider_quota: 'error_provider', calendar_unavailable: 'error_provider',
      slot_taken: 'error_slot', invalid_slot: 'error_slot', invalid: 'error_invalid', feature_disabled: 'error_disabled', server_config: 'error_config',
      booking_config: 'error_config', provider_config: 'error_config', calendar_changed: 'error_config', calendar_binding_required: 'error_config', booking_sync_pending: 'error_sync', summary_empty: 'error_summary_empty',
      summary_unverifiable: 'error_summary', transcript_changed: 'error_summary_changed', transcript_disabled: 'error_disabled', timeout: 'error_uncertain' };
    return t(keys[error.code] || 'error_generic');
  }
  function fail(error, dialog = null) {
    if (error.code === 'obsolete') return;
    const message = errorMessage(error); notify(message, 'error');
    if (error.status === 401 || error.code === 'csrf') {
      state.authEpoch++; state.csrf = null; state.rooms = []; state.bookings = []; state.health = null;
      document.querySelectorAll('dialog[open]').forEach(open => open.close()); authView(false, true); $('ad-password').focus(); return;
    }
    if (dialog?.open) {
      let alert = dialog.querySelector('.ad-dialog-error');
      if (!alert) { alert = node('p', { class: 'ad-message ad-dialog-error', 'data-kind': 'error', role: 'alert', tabindex: '-1' }); dialog.querySelector('.ad-dialog-head').after(alert); }
      alert.textContent = message; alert.focus();
    }
  }
  async function api(action, payload = null, endpoint = '../api/admin.php') {
    const epoch = state.authEpoch;
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 60000);
    const method = payload === null ? 'GET' : 'POST';
    const headers = method === 'POST' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' } : {};
    const url = endpoint + (method === 'GET' ? '?action=' + encodeURIComponent(action) : '');
    try {
      const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers, signal: controller.signal, body: method === 'POST' ? JSON.stringify({ action, ...payload }) : undefined });
      const data = await response.json();
      if (epoch !== state.authEpoch) { const error = new Error('obsolete'); error.code = 'obsolete'; throw error; }
      if (!response.ok) { const error = new Error(data.error || 'request'); error.code = data.error; error.status = response.status; error.data = data; throw error; }
      return data;
    } catch (error) { if (error.name === 'AbortError') error.code = 'timeout'; throw error; }
    finally { clearTimeout(timeout); }
  }
  async function busy(button, work) {
    if (button.disabled) return;
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    const dialog = button.closest('dialog'); const version = dialog?.id === 'ad-room-dialog' ? state.roomVersion : state.reportVersion;
    dialog?.querySelector('.ad-dialog-error')?.remove();
    try { await work(); } catch (error) {
      if (error.data?.closed || error.data?.policySaved) { await loadRooms().catch(() => {}); notify(t('sync_pending'), 'warning'); }
      else fail(error, version === (dialog?.id === 'ad-room-dialog' ? state.roomVersion : state.reportVersion) ? dialog : null);
    }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
  const fmt = timestamp => timestamp ? new Intl.DateTimeFormat(state.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp * 1000)) : '—';
  const count = value => new Intl.NumberFormat(state.locale, { maximumFractionDigits: 2 }).format(value);
  function localInput(timestamp) { const date = new Date(timestamp * 1000); const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
  function timestamp(value, optional = false) {
    if (!value && optional) return 0;
    const parsed = new Date(value).getTime() / 1000;
    if (!Number.isFinite(parsed) || localInput(parsed) !== value) { const error = new Error('schedule'); error.code = 'bad_schedule'; throw error; }
    return parsed;
  }
  function authView(authenticated, configured) {
    $('ad-app').hidden = !authenticated; $('ad-logout').hidden = !authenticated; $('ad-login').hidden = authenticated; $('ad-loading').hidden = true;
    $('ad-setup').hidden = configured; $('ad-login-form').hidden = !configured;
  }
  async function setLocale(code) {
    if (!languageNames[code]) code = 'en';
    for (const lang of new Set(['en', code])) {
      if (state.catalogs[lang]) continue;
      const response = await fetch('../assets/i18n/admin/' + lang + '.json', { cache: 'force-cache' });
      if (response.ok) state.catalogs[lang] = await response.json();
    }
    state.locale = code; $('ad-locale').value = code; document.documentElement.lang = code; document.documentElement.dir = code === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-a]').forEach(element => { element.textContent = t(element.dataset.a); });
    document.querySelectorAll('[data-a-placeholder]').forEach(element => { element.placeholder = t(element.dataset.aPlaceholder); });
    document.title = t('administration') + ' · ' + (state.config?.app.name || 'Auto Translate Meeting');
    try { localStorage.setItem('meet-admin-locale', code); } catch (_) { /* preference only */ }
    renderRooms(); renderBookings(); if (state.health) renderHealth();
  }
  function actionButton(action, id, label, danger = false) { return node('button', { type: 'button', class: 'ad-button' + (danger ? ' danger' : ''), 'data-action': action, 'data-id': id, text: t(label) }); }
  function badge(label, style = '') { return node('span', { class: 'ad-badge ' + style, text: t(label) }); }
  function renderRooms() {
    const list = $('ad-room-list'); list.replaceChildren();
    const search = $('ad-search').value.toLocaleLowerCase();
    const rows = state.rooms.filter(room => (room.title + ' ' + room.id).toLocaleLowerCase().includes(search));
    if (!rows.length) { list.append(node('p', { class: 'ad-empty', text: t('no_rooms') })); return; }
    for (const room of rows) {
      const card = node('article', { class: 'ad-card' }, [node('h2', { text: room.title || t('untitled') }), node('div', { class: 'ad-sub', text: room.id })]);
      const badges = node('div', { class: 'ad-badges' }, [badge(room.open ? 'active' : room.status === 'active' ? 'expired' : room.status, room.open ? 'active' : room.status)]);
      if (room.waitingRoom) badges.append(badge('waiting_short'));
      if (room.locked) badges.append(badge('locked_short'));
      if (room.hasPassword) badges.append(badge('password_short'));
      if (room.mediaClosePending) badges.append(badge('sync_pending', 'pending'));
      card.append(badges, node('div', { class: 'ad-data' }, [node('span', { text: t('live_count', { n: room.live === null ? t('unknown') : room.live, max: room.max }) }), node('span', { text: t('expires_at', { when: fmt(room.expiresAt) }) })]));
      if (room.startsAt) card.append(node('p', { text: t('starts_at', { when: fmt(room.startsAt) }) }));
      const actions = node('div', { class: 'ad-actions' });
      if (room.open) actions.append(actionButton('links', room.id, 'links'), actionButton('edit', room.id, 'edit'), actionButton('rotate_links', room.id, 'rotate'));
      actions.append(actionButton('usage', room.id, 'usage'));
      if (state.config?.features.transcripts) actions.append(actionButton('transcript', room.id, 'transcript'));
      if (room.open || room.mediaClosePending) actions.append(actionButton('end', room.id, room.mediaClosePending ? 'retry' : 'end', true));
      actions.append(actionButton('delete', room.id, 'delete', true)); card.append(actions); list.append(card);
    }
  }
  async function loadRooms() { const response = await api('rooms'); state.rooms = response.rooms || []; $('ad-media-warning').hidden = response.mediaAvailable; renderRooms(); }
  function renderBookings() {
    const list = $('ad-booking-list'); list.replaceChildren();
    if (!state.bookings.length) { list.append(node('p', { class: 'ad-empty', text: t('no_bookings') })); return; }
    for (const booking of state.bookings) {
      const card = node('article', { class: 'ad-card' }, [node('h2', { text: booking.name }), node('div', { class: 'ad-sub', text: booking.email || '' }), node('div', { class: 'ad-badges' }, [badge(booking.status, booking.status)]), node('p', { text: fmt(booking.slot) + ' · ' + booking.slotMin + ' ' + t('minutes') })]);
      if (booking.company) card.append(node('p', { text: booking.company }));
      if (booking.note) card.append(node('p', { text: booking.note }));
      const failedMail = booking.notifications && (booking.notifications.visitor === false || booking.notifications.owner === false);
      if (failedMail) card.append(node('p', { class: 'ad-note warning', text: t('mail_failed') }));
      if (booking.mediaClosePending) card.append(node('p', { class: 'ad-note warning', text: t('sync_pending') }));
      const actions = node('div', { class: 'ad-actions' });
      if (booking.status === 'pending') actions.append(actionButton('booking_approve', booking.id, 'approve'), actionButton('booking_reject', booking.id, 'reject'));
      if (['pending', 'approved'].includes(booking.status)) actions.append(actionButton('booking_reschedule', booking.id, 'reschedule'), actionButton('booking_cancel', booking.id, 'cancel_booking', true));
      if (['approving', 'cancelling', 'rescheduling'].includes(booking.status)) actions.append(actionButton('booking_retry', booking.id, 'retry'));
      if (failedMail && ['pending', 'approved', 'rejected', 'cancelled'].includes(booking.status)) actions.append(actionButton('booking_retry_notifications', booking.id, 'retry_mail'));
      if (booking.link) actions.append(actionButton('booking_invite', booking.id, 'copy_invite'));
      card.append(actions); list.append(card);
    }
  }
  async function loadBookings() { const response = await api('bookings'); state.bookings = response.bookings || []; renderBookings(); }
  function metrics(rows) { const list = node('dl', { class: 'ad-metrics' }); for (const [label, value] of rows) list.append(node('dt', { text: label }), node('dd', { text: value })); return list; }
  function renderHealth() {
    const h = state.health; const yes = value => t(value ? 'yes' : 'no');
    const rows = [[t('storage'), yes(h.privateStorageWritable)], [t('media_config'), yes(h.mediaConfigured)], [t('translation_config'), yes(h.translationConfigured)], [t('text_config'), yes(h.textConfigured)], [t('booking_config'), yes(h.bookingEnabled)], [t('calendar_provider'), h.calendarProvider], [t('calendar_connected'), yes(h.calendarConnected)], [t('mail_config'), yes(h.mailConfigured)], [t('transcript_config'), yes(h.transcriptsEnabled)], ['PHP', h.phpVersion]];
    $('ad-health-list').replaceChildren(...metrics(rows).children);
    $('ad-google').hidden = h.calendarProvider !== 'google';
  }
  async function loadHealth() { state.health = await api('health'); renderHealth(); }
  async function loadTab() { if (state.tab === 'rooms') await loadRooms(); else if (state.tab === 'bookings') await loadBookings(); else await loadHealth(); }
  function selectTab(tab) {
    state.tab = tab;
    document.querySelectorAll('[data-tab]').forEach(button => { const selected = button.dataset.tab === tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
    for (const name of ['rooms', 'bookings', 'health']) $('panel-' + name).hidden = name !== tab;
  }
  function editRoom(room = null) {
    state.roomVersion++; $('ad-room-dialog').querySelector('.ad-dialog-error')?.remove();
    state.editing = room?.id || null;
    $('ad-room-title').textContent = t(room ? 'edit' : 'create'); $('room-title').value = room?.title || '';
    $('room-max').max = state.config.limits.maxParticipants; $('room-max').value = room?.max || state.config.limits.maxParticipants;
    $('room-password').value = ''; $('room-clear').checked = false; $('room-clear-wrap').hidden = !room?.hasPassword;
    $('room-start').value = room?.startsAt ? localInput(room.startsAt) : ''; $('room-expiry').value = localInput(room?.expiresAt || Math.floor(Date.now() / 1000) + 30 * 86400);
    $('room-waiting').checked = !!room?.waitingRoom; $('room-locked').checked = !!room?.locked; $('room-lock-wrap').hidden = !room;
    $('room-timezone').textContent = t('local_timezone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
    $('ad-room-dialog').showModal(); $('room-title').focus();
  }
  function openReport(title, room = null) {
    state.reportVersion++; $('ad-report-dialog').querySelector('.ad-dialog-error')?.remove();
    state.reportRoom = room; $('ad-report-title').textContent = title; $('ad-report-body').replaceChildren(); $('ad-report-actions').replaceChildren();
    if (!$('ad-report-dialog').open) $('ad-report-dialog').showModal();
    return $('ad-report-body');
  }
  function reportButton(label, handler, danger = false) { const button = node('button', { type: 'button', class: 'ad-button' + (danger ? ' danger' : ''), text: t(label) }); button.addEventListener('click', () => busy(button, handler)); $('ad-report-actions').append(button); return button; }
  async function copy(value, field = null) {
    try { await navigator.clipboard.writeText(value); notify(t('copied')); }
    catch (_) { if (field) { field.focus(); field.select(); } notify(t('copy_failed'), 'warning'); }
  }
  function showLinks(links) {
    const body = openReport(t('links'));
    for (const [key, label] of [['link', 'participant_link'], ['hostLink', 'host_link']]) {
      if (!links[key]) continue;
      const row = node('div', { class: 'ad-field' }); const input = node('input', { class: 'input ad-link-field', type: 'text', readonly: 'readonly', 'aria-label': t(label) }); input.value = links[key];
      const button = node('button', { type: 'button', class: 'ad-button', text: t('copy') }); button.onclick = () => copy(links[key], input);
      row.append(node('label', { text: t(label) }), input, button); body.append(row);
    }
    body.append(node('p', { class: 'ad-report-note', text: t('host_private') }));
    if (links.hostLink) { const url = new URL(links.hostLink); if (['http:', 'https:'].includes(url.protocol)) $('ad-report-actions').append(node('a', { class: 'ad-button primary', href: url.href, target: '_blank', rel: 'noopener noreferrer', text: t('open_host') })); }
  }
  function download(data, filename, type) {
    const url = URL.createObjectURL(new Blob([data], { type })); const anchor = node('a', { href: url, download: filename }); document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function transcriptText(data) {
    const lines = [t('transcript') + ' · ' + data.room, data.notice || '', ''];
    for (const row of data.entries || []) { lines.push('[' + new Date(row.at * 1000).toISOString() + '] ' + row.name + ' (' + row.language + ')', row.original || ''); for (const [lang, text] of Object.entries(row.translations || {})) lines.push('[' + lang + '] ' + text); lines.push(''); }
    if (data.summary) lines.push(t('summary'), JSON.stringify(data.summary, null, 2)); return lines.join('\n');
  }
  function appendSummary(body, summary) {
    if (!summary) return;
    body.append(node('p', { class: 'ad-report-note', text: summary.notice || t('summary_draft') }));
    const report = node('div', { class: 'ad-summary' });
    for (const key of ['brief', 'topics', 'decisions', 'actions', 'followUps']) {
      const items = summary.report?.[key]; if (!Array.isArray(items) || !items.length) continue;
      report.append(node('h3', { text: t(key) })); const list = node('ul');
      for (const item of items) { const li = node('li', { text: item.text }); if (item.assignee) li.append(node('small', { text: item.assignee })); li.append(node('small', { text: t('evidence') + ': ' + (item.evidence || []).join(', ') })); list.append(li); }
      report.append(list);
    }
    body.append(report);
  }
  async function showTranscript(id) {
    const data = await api('transcript_export', { room: id }); const body = openReport(t('transcript'), id);
    body.append(node('p', { class: 'ad-report-note', text: t('transcript_detail', { n: data.entries?.length || 0, when: fmt(data.expiresAt) }) }), node('p', { class: 'ad-report-note', text: t('transcript_partial') }));
    appendSummary(body, data.summary);
    reportButton('download_json', async () => download(JSON.stringify(data, null, 2), 'meeting-' + id + '.json', 'application/json'));
    reportButton('download_text', async () => download(transcriptText(data), 'meeting-' + id + '.txt', 'text/plain;charset=utf-8'));
    if (state.config.features.summary) {
      const select = node('select', { class: 'ad-select', 'aria-label': t('language') });
      for (const lang of state.config.translation.languages) select.append(node('option', { value: lang, text: languageNames[lang] || lang }));
      select.value = state.config.translation.languages.includes(state.locale) ? state.locale : state.config.translation.languages[0]; $('ad-report-actions').append(select);
      const version = state.reportVersion;
      reportButton('generate_summary', async () => { await api('transcript_summary', { room: id, language: select.value }); if (state.reportRoom === id && state.reportVersion === version) await showTranscript(id); });
    }
    reportButton('delete_transcript', async () => { if (!confirm(t('confirm_transcript'))) return; await api('transcript_delete', { room: id }); $('ad-report-dialog').close(); notify(t('saved')); }, true);
  }
  async function showUsage(id) {
    const data = await api('usage', { room: id }); const body = openReport(t('usage'), id);
    let estimate = t('unknown');
    if (data.estimatedCost !== null) { try { estimate = new Intl.NumberFormat(state.locale, { style: 'currency', currency: data.estimatedCostCurrency, maximumFractionDigits: 4 }).format(data.estimatedCost); } catch (_) { estimate = count(data.estimatedCost) + ' ' + data.estimatedCostCurrency; } }
    body.append(metrics([[t('reported_sessions'), count(data.activeSessionsReported || 0)], [t('audio_seconds'), count(data.clientInputSeconds || 0)], [t('session_seconds'), count(data.clientSessionSeconds || 0)], [t('issued_tokens'), count(data.issuedLiveTokens || 0)], [t('text_requests'), count(data.textRequests || 0)], [t('failed_requests'), count(data.failedRequests || 0)], [t('input_tokens'), count(data.providerInputTokens || 0)], [t('output_tokens'), count(data.providerOutputTokens || 0)], [t('estimated_cost'), estimate], [t('audio_provider'), data.audioProvider], [t('text_provider'), data.textProvider]]));
    body.append(node('p', { class: 'ad-report-note', text: t('usage_note') }));
  }
  async function reschedule(booking) {
    const response = await fetch('../api/book.php', { cache: 'no-store', credentials: 'same-origin' }); const data = await response.json();
    if (!response.ok) { const error = new Error('calendar'); error.code = data.error; throw error; }
    const body = openReport(t('reschedule')); const select = node('select', { class: 'input', 'aria-label': t('new_slot') });
    for (const slot of data.slots || []) if (slot !== booking.slot) select.append(node('option', { value: slot, text: fmt(slot) }));
    body.append(node('p', { class: 'ad-report-note', text: t('local_timezone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }) }), select);
    if (!select.options.length) { body.append(node('p', { class: 'ad-report-note', text: t('no_slots') })); return; }
    const version = state.reportVersion;
    reportButton('save', async () => {
      const result = await api('booking_reschedule', { booking: booking.id, slot: Number(select.value) });
      if (state.reportVersion === version) $('ad-report-dialog').close();
      await loadBookings(); await loadRooms();
      const failedMail = result.notifications?.visitor === false || result.notifications?.owner === false;
      notify(t(failedMail ? 'mail_failed' : result.mediaClosePending ? 'sync_pending' : 'saved'), failedMail || result.mediaClosePending ? 'warning' : 'status');
    });
  }
  async function handleAction(button) {
    const { action, id } = button.dataset;
    await busy(button, async () => {
      if (action === 'edit') { editRoom(state.rooms.find(room => room.id === id)); return; }
      if (action === 'links') { showLinks(await api('links', { room: id })); return; }
      if (action === 'usage') { await showUsage(id); return; }
      if (action === 'transcript') { await showTranscript(id); return; }
      if (['end', 'delete', 'rotate_links'].includes(action)) {
        if (!confirm(t('confirm_' + action))) return;
        const data = await api(action, { room: id }); await loadRooms();
        if (action === 'rotate_links') showLinks(data);
        notify(t(data.mediaClosePending ? 'sync_pending' : 'saved'), data.mediaClosePending ? 'warning' : 'status'); return;
      }
      const booking = state.bookings.find(row => row.id === id); if (!booking) return;
      if (action === 'booking_invite') { await copy(booking.link); return; }
      if (action === 'booking_reschedule') { await reschedule(booking); return; }
      if (action === 'booking_cancel' && !confirm(t('confirm_cancel'))) return;
      let request = action; let payload = { booking: id };
      if (['booking_approve', 'booking_reject'].includes(action)) { request = 'booking_decide'; payload.decision = action === 'booking_approve' ? 'approve' : 'reject'; }
      if (action === 'booking_retry') {
        if (booking.status === 'approving') { request = 'booking_decide'; payload.decision = 'approve'; }
        else if (booking.status === 'cancelling') request = 'booking_cancel';
        else { request = 'booking_reschedule'; payload.slot = booking.pendingSlot; }
      }
      const data = await api(request, payload); await loadBookings(); await loadRooms();
      const failedMail = data.notifications?.visitor === false || data.notifications?.owner === false;
      notify(t(failedMail ? 'mail_failed' : data.mediaClosePending ? 'sync_pending' : 'saved'), failedMail || data.mediaClosePending ? 'warning' : 'status');
    });
  }
  document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => $(button.dataset.close).close(); });
  $('ad-report-dialog').addEventListener('close', () => { state.reportVersion++; state.reportRoom = null; $('ad-report-body').replaceChildren(); $('ad-report-actions').replaceChildren(); });
  $('ad-room-dialog').addEventListener('close', () => { state.roomVersion++; $('room-password').value = ''; });
  for (const name of ['rooms', 'bookings', 'health']) {
    $('tab-' + name).onclick = () => { selectTab(name); loadTab().catch(fail); };
    $('ad-refresh-' + name).onclick = event => busy(event.currentTarget, () => name === 'rooms' ? loadRooms() : name === 'bookings' ? loadBookings() : loadHealth());
  }
  document.querySelector('.ad-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('[data-tab]')]; const index = tabs.indexOf(document.activeElement); if (index < 0) return;
    event.preventDefault(); const reverse = state.locale === 'ar' ? -1 : 1; const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? reverse : -reverse) + tabs.length) % tabs.length;
    tabs[next].focus(); tabs[next].click();
  });
  $('ad-search').addEventListener('input', renderRooms);
  $('ad-create').onclick = () => editRoom();
  $('ad-room-list').addEventListener('click', event => { const button = event.target.closest('button[data-action]'); if (button) handleAction(button); });
  $('ad-booking-list').addEventListener('click', event => { const button = event.target.closest('button[data-action]'); if (button) handleAction(button); });
  $('ad-login-form').onsubmit = event => { event.preventDefault(); const button = event.submitter || $('ad-login-form').querySelector('button'); busy(button, async () => { let password = $('ad-password').value; $('ad-password').value = ''; const data = await api('login', { password }); password = ''; state.authEpoch++; state.csrf = data.csrf; authView(true, true); $('ad-message').hidden = true; await loadTab(); }); };
  $('ad-logout').onclick = event => busy(event.currentTarget, async () => { await api('logout', {}); state.authEpoch++; state.csrf = null; state.rooms = []; state.bookings = []; state.health = null; document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); authView(false, true); $('ad-password').focus(); });
  $('ad-room-form').onsubmit = event => { event.preventDefault(); const button = event.submitter || $('ad-room-form').querySelector('[type=submit]'); busy(button, async () => {
    const version = state.roomVersion; const editing = state.editing;
    const payload = { title: $('room-title').value, max: Number($('room-max').value), password: $('room-password').value, startsAt: timestamp($('room-start').value, true), expiresAt: timestamp($('room-expiry').value), waitingRoom: $('room-waiting').checked };
    if (editing) Object.assign(payload, { room: editing, clearPassword: $('room-clear').checked, locked: $('room-locked').checked });
    const data = await api(editing ? 'update' : 'create', payload); await loadRooms();
    if (state.roomVersion !== version) return;
    $('ad-room-dialog').close();
    notify(t(data.mediaSyncPending ? 'sync_pending' : 'saved'), data.mediaSyncPending ? 'warning' : 'status'); if (!editing) showLinks(data);
  }); };
  $('ad-google').onclick = event => busy(event.currentTarget, async () => { const data = await api('connect', {}, '../api/google-connect.php'); const url = new URL(data.url); if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com') throw new Error('oauth'); location.assign(url.href); });
  for (const [code, name] of Object.entries(languageNames)) $('ad-locale').append(node('option', { value: code, text: name }));
  $('ad-locale').onchange = () => setLocale($('ad-locale').value).catch(fail);
  (async () => {
    state.config = await window.MeetConfigReady;
    let saved; try { saved = localStorage.getItem('meet-admin-locale'); } catch (_) { /* preference only */ }
    const preferred = saved || (navigator.languages || [navigator.language]).map(value => value.slice(0, 2)).find(value => languageNames[value]) || state.config.app.defaultLocale;
    await setLocale(preferred);
    const status = await api('status'); state.config = status.config; state.csrf = status.csrf; authView(status.authenticated, status.configured);
    if (status.authenticated) await loadTab();
  })().catch(error => { $('ad-loading').hidden = true; fail(error); });
})();
