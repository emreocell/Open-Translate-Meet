/* Optional, consent-driven transcripts and client-observed usage. Never persists browser
   captions locally. The server remains authoritative for consent, ownership and retention. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
let me = null, generation = 0, state = null, blocked = false, confirmed = false, timer = null, flushTimer = null, usageTimer = null;
let captionTask = null, pollBusy = false, consentBusy = false, summaryBusy = false, section = null, badge = null, usage = null;
const queue = new Map(), sessions = new Map(), requests = new Set();
let pendingInput = 0, pendingSessions = 0;
const t = (key, vars) => (window.WM?.t || window.WMI?.t || (key => key))(key, vars);
const active = () => !!me && !!window.WM && window.WM.me.identity === me.identity;
function status(message, error = false) { const element = $('records-status'); if (element) { element.textContent = message; element.dataset.error = String(error) } }
async function api(endpoint, data, { keepalive = false } = {}) {
  const owner = me; if (!owner) throw new Error('unauthorized');
  const controller = new AbortController(); if (!keepalive) requests.add(controller);
  const deadline = setTimeout(() => controller.abort(), data?.action === 'summary' ? 65000 : 20000);
  try {
    const response = await fetch('api/' + endpoint + '.php', {
      method: data === undefined ? 'GET' : 'POST', keepalive, signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Meet-Token': owner.ticket },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'request_failed');
    return result;
  } finally { clearTimeout(deadline); requests.delete(controller) }
}
function build() {
  if (section) return;
  section = document.createElement('section'); section.id = 'records-settings';
  section.innerHTML = '<h3 data-ft="records_title"></h3><p class="hint" id="records-privacy"></p><label class="consent-row"><input type="checkbox" id="record-consent"><span data-ft="records_consent"></span></label><label class="consent-row"><input type="checkbox" id="summary-consent"><span data-ft="summary_consent"></span></label><p class="hint" data-ft="records_withdraw"></p><label class="consent-row host-records"><input type="checkbox" id="record-enable"><span data-ft="records_enable"></span></label><p id="records-status" role="status" aria-live="polite"></p><div class="record-actions"><button class="gh" type="button" id="export-json" data-ft="export_json"></button><button class="gh" type="button" id="export-txt" data-ft="export_text"></button><button class="gh host-records" type="button" id="generate-summary" data-ft="summary_generate"></button><button class="gh host-records" type="button" id="delete-records" data-ft="records_delete"></button></div><div class="record-confirm" id="record-confirm" hidden><p data-ft="records_delete_confirm"></p><button type="button" class="gh" id="confirm-delete" data-ft="records_delete"></button><button type="button" class="gh" id="cancel-delete" data-ft="cancel"></button></div><div id="summary-result"></div>';
  $('settings').querySelector('.sbox-b').appendChild(section);
  badge = document.createElement('button'); badge.id = 'records-badge'; badge.type = 'button'; badge.className = 'record-notice'; badge.onclick = () => $('setbtn').click();
  $('side').prepend(badge);
  const usageSection = document.createElement('section'); usageSection.id = 'usage-settings';
  usageSection.innerHTML = '<h3 data-ft="usage_title"></h3><dl id="usage-values" class="health-details"></dl><p class="hint" data-ft="usage_disclaimer"></p>';
  $('settings').querySelector('.sbox-b').appendChild(usageSection);
  $('record-consent').onchange = () => updateConsent();
  $('summary-consent').onchange = () => updateConsent();
  $('record-enable').onchange = async () => {
    const owner = generation, enabled = $('record-enable').checked; $('record-enable').disabled = true;
    try { await api('transcript', { action: 'enabled', enabled }); if (owner !== generation) return; await poll(); status(t('records_updated')) }
    catch (_) { if (owner === generation) { status(t('records_failed'), true); await poll() } }
    finally { if (owner === generation) $('record-enable').disabled = false }
  };
  $('export-json').onclick = () => exportRecords('json'); $('export-txt').onclick = () => exportRecords('txt');
  $('generate-summary').onclick = generateSummary;
  $('delete-records').onclick = () => { $('record-confirm').hidden = false; $('confirm-delete').focus() };
  $('cancel-delete').onclick = () => { $('record-confirm').hidden = true; $('delete-records').focus() };
  $('confirm-delete').onclick = async () => {
    const owner = generation; $('confirm-delete').disabled = true;
    try { await api('transcript', { action: 'delete' }); if (owner !== generation) return; queue.clear(); $('summary-result').textContent = ''; await poll(); status(t('records_deleted')) }
    catch (_) { if (owner === generation) status(t('records_failed'), true) }
    finally { if (owner === generation) { $('confirm-delete').disabled = false; $('record-confirm').hidden = true } }
  };
}
function labels() {
  if (!section) return;
  document.querySelectorAll('[data-ft]').forEach(element => { element.textContent = t(element.dataset.ft) });
  if (summaryBusy) $('generate-summary').textContent = t('summary_generating');
  render(); renderUsage();
}
function permitted() { return active() && confirmed && !blocked && !!state?.enabled && !!state?.consent?.record }
function render() {
  if (!section || !active()) return;
  const features = window.WM.features || {};
  section.hidden = !features.transcripts; badge.hidden = !features.transcripts; $('usage-settings').hidden = !me.host;
  section.querySelectorAll('.host-records').forEach(element => { element.hidden = !me.host });
  $('generate-summary').hidden = !me.host || !features.summary;
  $('summary-consent').disabled = consentBusy || !features.summary || !$('record-consent').checked;
  if (!consentBusy) { $('record-consent').checked = !!state?.consent?.record && !blocked; $('summary-consent').checked = !!state?.consent?.summary && !blocked; $('summary-consent').disabled = !features.summary || !$('record-consent').checked }
  $('record-enable').checked = !!state?.enabled;
  $('export-json').disabled = !state; $('export-txt').disabled = !state;
  const audioProvider = window.WM.translation?.provider || 'none', summaryProvider = state?.summaryProvider || 'none';
  const hours = window.MeetConfig?.limits?.transcriptRetentionHours || 24;
  $('records-privacy').textContent = t('records_privacy', { audio: audioProvider, summary: summaryProvider, hours });
  badge.textContent = t(permitted() ? 'records_storing' : state?.enabled ? 'records_other_speakers' : 'records_off');
  badge.dataset.active = String(permitted());
  if (!permitted()) queue.clear();
  window.WMT?.setTranscriptionRequested(permitted());
}
async function poll() {
  if (!active() || !window.WM.features?.transcripts || pollBusy) return;
  const owner = generation; pollBusy = true;
  try {
    const result = await api('transcript'); if (owner !== generation || !active()) return;
    state = result; confirmed = true; render();
  } catch (_) {
    // No provider session should start based on a stale permission snapshot.
    if (owner === generation) { confirmed = false; queue.clear(); window.WMT?.setTranscriptionRequested(false); render(); status(t('records_unavailable'), true) }
  } finally { if (owner === generation) pollBusy = false }
}
async function updateConsent() {
  if (!active() || consentBusy) return;
  const record = $('record-consent').checked, summary = record && $('summary-consent').checked;
  consentBusy = true; $('record-consent').disabled = true; $('summary-consent').disabled = true;
  if (!record) { blocked = true; queue.clear(); window.WMT?.setTranscriptionRequested(false) }
  const owner = generation;
  try {
    const result = await api('transcript', { action: 'consent', record, summary }); if (owner !== generation) return;
    state = { ...(state || {}), consent: result.consent }; blocked = !record; status(t('records_updated'));
    await poll();
  } catch (_) { if (owner === generation) { blocked = true; status(t('consent_failed'), true); window.WMT?.setTranscriptionRequested(false) } }
  finally { if (owner === generation) { consentBusy = false; if ($('record-consent')) $('record-consent').disabled = false; render() } }
}
function flushCaptions() {
  if (captionTask) return captionTask;
  if (!permitted() || !queue.size) return Promise.resolve(false);
  const [id, value] = queue.entries().next().value, owner = generation;
  queue.delete(id);
  captionTask = (async () => {
    try { await api('transcript', { action: 'append', id, original: value.original, translated: value.translated || '', to: value.to }); return true }
    catch (error) {
      if (owner === generation) {
        if (['consent_required', 'unauthorized', 'room_closed', 'transcript_limit'].includes(error.message)) { queue.clear(); confirmed = false; if (error.message !== 'consent_required') blocked = true; window.WMT?.setTranscriptionRequested(false); render(); status(t('records_unavailable'), true) }
        else if (permitted() && !queue.has(id) && (value.retries || 0) < 2) queue.set(id, { ...value, retries: (value.retries || 0) + 1 });
        else status(t('records_incomplete'), true);
      }
      return false;
    } finally { if (owner === generation) captionTask = null }
  })();
  return captionTask;
}
async function drainCaptions() {
  const owner = generation, deadline = Date.now() + 20000;
  // Drain the current local backlog before export. Active speakers may still add
  // new entries; that is why a transcript is explicitly described as a snapshot.
  for (let count = 0; count < 100 && owner === generation && permitted() && (captionTask || queue.size); count++) {
    if (!await flushCaptions() || Date.now() >= deadline) break;
  }
  if (owner === generation && queue.size) status(t('records_incomplete'), true);
  return owner === generation;
}
document.addEventListener('wm:caption', event => {
  const value = event.detail;
  if (!permitted() || !value?.local || value.identity !== me.identity || typeof value.original !== 'string' || !value.original.trim()) return;
  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(value.id || '') || value.original.length > 3000) return;
  queue.set(value.id, value);
  // A disconnected upload cannot retain unlimited meeting content in browser memory.
  if (queue.size > 100) { queue.delete(queue.keys().next().value); status(t('records_incomplete'), true) }
});
function download(content, type, extension) {
  const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
  link.href = url; link.download = 'meeting-' + String(me.room).replace(/[^a-f0-9]/g, '') + '-' + new Date().toISOString().slice(0, 10) + '.' + extension;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportRecords(format) {
  const owner = generation, button = $(format === 'json' ? 'export-json' : 'export-txt'); button.disabled = true;
  try {
    if (!await drainCaptions() || owner !== generation) return;
    const result = await api('transcript', { action: 'export' }); if (owner !== generation || !active()) return;
    if (format === 'json') download(JSON.stringify(result, null, 2), 'application/json;charset=utf-8', 'json');
    else {
      const lines = [t('records_export_notice'), ''];
      for (const entry of result.entries || []) {
        lines.push(new Date(entry.at * 1000).toISOString() + ' · ' + entry.name + ' [' + entry.language + ']', entry.original);
        for (const [language, text] of Object.entries(entry.translations || {})) lines.push('[' + language + '] ' + text);
        lines.push('');
      }
      if (result.summary) lines.push(t('summary_draft'), JSON.stringify(result.summary, null, 2));
      download(lines.join('\n'), 'text/plain;charset=utf-8', 'txt');
    }
  } catch (_) { if (owner === generation) status(t('records_failed'), true) }
  finally { if (owner === generation) button.disabled = false }
}
function renderSummary(summary) {
  const box = $('summary-result'); box.textContent = '';
  const notice = document.createElement('p'); notice.className = 'hint'; notice.textContent = t('summary_draft'); box.appendChild(notice);
  for (const [key, values] of Object.entries(summary.report || {})) {
    if (!['brief', 'topics', 'decisions', 'actions', 'followUps'].includes(key) || !Array.isArray(values) || !values.length) continue;
    const heading = document.createElement('h4'); heading.textContent = t('summary_' + key); box.appendChild(heading);
    const list = document.createElement('ul');
    for (const item of values) {
      const row = document.createElement('li'); row.textContent = String(item.text || '');
      if (item.assignee) { const name = document.createElement('b'); name.textContent = ' · ' + item.assignee; row.appendChild(name) }
      const evidence = document.createElement('small'); evidence.textContent = t('summary_evidence') + ': ' + (item.evidence || []).join(', '); row.appendChild(evidence); list.appendChild(row);
    }
    box.appendChild(list);
  }
}
async function generateSummary() {
  if (!active() || !me.host || summaryBusy) return;
  const owner = generation; summaryBusy = true; $('generate-summary').disabled = true; labels(); status(t('summary_generating'));
  try {
    if (!await drainCaptions() || owner !== generation) return;
    const result = await api('transcript', { action: 'summary', language: window.WM.me.hear }); if (owner !== generation || !active()) return;
    renderSummary(result); status(t('summary_ready'));
  } catch (error) { if (owner === generation) status(t(error.message === 'summary_empty' ? 'summary_no_consent' : error.message === 'transcript_changed' ? 'summary_changed' : 'records_failed'), true) }
  finally { if (owner === generation) { summaryBusy = false; $('generate-summary').disabled = false; labels() } }
}
document.addEventListener('wm:translation-usage', event => {
  const value = event.detail;
  if (!active() || !value?.sessionId || !Number.isFinite(value.inputSeconds) || !Number.isFinite(value.sessionSeconds) || value.inputSeconds < 0 || value.sessionSeconds < 0) return;
  const previous = sessions.get(value.sessionId) || { input: 0, duration: 0 };
  pendingInput += Math.max(0, value.inputSeconds - previous.input);
  pendingSessions += Math.max(0, value.sessionSeconds - previous.duration);
  sessions.set(value.sessionId, { input: Math.max(previous.input, value.inputSeconds), duration: Math.max(previous.duration, value.sessionSeconds) });
  if (sessions.size > 200) sessions.delete(sessions.keys().next().value);
});
async function flushUsage(keepalive = false) {
  if (!active()) return;
  const inputSeconds = pendingInput, sessionSeconds = pendingSessions;
  pendingInput = 0; pendingSessions = 0;
  try { await api('usage', { inputSeconds, sessionSeconds, activeSessions: window.WMT?.health().activeSessions || 0 }, { keepalive }) }
  catch (_) { /* Incomplete browser telemetry must never be presented as billing. */ }
}
async function refreshUsage() {
  if (!active() || !me.host) return;
  const owner = generation;
  try { const result = await api('usage'); if (owner === generation) { usage = result; renderUsage() } } catch (_) {}
}
function renderUsage() {
  if (!$('usage-values') || !me?.host) return;
  const values = $('usage-values'); values.textContent = '';
  if (!usage) { const empty = document.createElement('dd'); empty.textContent = t('usage_pending'); values.appendChild(empty); return }
  const number = value => new Intl.NumberFormat(window.WMI?.lang() || 'en', { maximumFractionDigits: 2 }).format(Number(value) || 0);
  const rows = [
    ['usage_issued', number(usage.issuedLiveTokens)], ['usage_text', number(usage.textRequests)],
    ['usage_failed', number(usage.failedRequests)], ['usage_provider_tokens', number(usage.providerInputTokens) + ' / ' + number(usage.providerOutputTokens)],
    ['usage_active', number(usage.activeSessionsReported)], ['usage_audio', number(usage.clientInputSeconds) + ' s'],
    ['usage_estimated', usage.estimatedCost === null ? t('usage_unconfigured') : number(usage.estimatedCost) + ' ' + usage.estimatedCostCurrency],
  ];
  for (const [key, value] of rows) { const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = t(key); detail.textContent = value; values.append(term, detail) }
}
function stop() {
  flushUsage(true); generation++; clearInterval(timer); clearInterval(flushTimer); clearInterval(usageTimer);
  for (const controller of requests) controller.abort(); requests.clear(); captionTask = null; pollBusy = false;
  window.WMT?.setTranscriptionRequested(false); queue.clear(); sessions.clear(); me = null; state = null; usage = null; confirmed = false;
  if (section) section.hidden = true; if (badge) badge.hidden = true; if ($('usage-settings')) $('usage-settings').hidden = true;
}
document.addEventListener('wm:joined', () => {
  if (me) stop();
  generation++; me = window.WM?.me; if (!me) return;
  state = null; blocked = false; confirmed = false; consentBusy = false; summaryBusy = false; captionTask = null; pollBusy = false; pendingInput = pendingSessions = 0; sessions.clear(); queue.clear();
  build(); $('summary-result').textContent = ''; $('record-confirm').hidden = true; $('record-consent').checked = false; $('summary-consent').checked = false; labels();
  poll(); refreshUsage();
  clearInterval(timer); clearInterval(flushTimer); clearInterval(usageTimer);
  timer = setInterval(poll, 10000); flushTimer = setInterval(flushCaptions, 1000);
  usageTimer = setInterval(() => { flushUsage(); refreshUsage() }, 30000);
});
document.addEventListener('wm:left', stop); document.addEventListener('wm:disconnected', stop); document.addEventListener('wm:locale', labels);
})();
