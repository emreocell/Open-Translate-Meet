/* Pure meeting boundary checks shared by the browser and dependency-free tests. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WMCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const ROOM = /^[a-f0-9]{10}\.[a-f0-9]{12,64}$/;
  const HOST = /^[a-f0-9]{16,128}$/;
  const LANG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;

  function participantLink(href, roomCode, title) {
    const url = new URL(href);
    url.search = ''; url.hash = '';
    if (ROOM.test(roomCode || '')) url.searchParams.set('r', roomCode);
    if (title) url.searchParams.set('t', String(title).slice(0, 60));
    return url.toString();
  }

  function parseInvite(raw) {
    const value = String(raw || '').trim();
    if (ROOM.test(value)) return { r: value, h: '', t: '' };
    if (!value || value.length > 4096) return null;
    let url;
    try { url = new URL(/^[a-z]+:\/\//i.test(value) ? value : 'https://invite.invalid/' + (value.startsWith('?') ? value : '?' + value)); }
    catch (_) { return null; }
    const r = url.searchParams.get('r') || '';
    if (!ROOM.test(r)) return null;
    const h = new URLSearchParams(url.hash.slice(1)).get('h') || url.searchParams.get('h') || '';
    return { r, h: HOST.test(h) ? h : '', t: (url.searchParams.get('t') || '').slice(0, 60) };
  }

  function metadata(participant) {
    try { const value = JSON.parse(participant?.metadata || '{}'); return value && !Array.isArray(value) && typeof value === 'object' ? value : {}; }
    catch (_) { return {}; }
  }

  function normalizeCaption(message, participant, me) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || !me) return null;
    const identity = participant ? participant.identity : me.identity;
    if (!identity || message.from !== identity || typeof message.id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(message.id)) return null;
    if (typeof message.to !== 'string' || !LANG.test(message.to)) return null;
    if (typeof message.orig !== 'string' || typeof message.trn !== 'string' || message.orig.length > 2000 || message.trn.length > 2000) return null;
    const speak = participant ? metadata(participant).speak : me.speak;
    if (typeof speak !== 'string' || !LANG.test(speak)) return null;
    return {
      id: identity + ':' + message.id,
      sourceId: message.id,
      from: identity,
      name: String((participant ? participant.name : me.name) || '').slice(0, 80),
      speak, to: message.to, orig: message.orig, trn: message.trn,
    };
  }

  class CaptionGate {
    constructor({ burst = 20, perSecond = 8, maxEntries = 600 } = {}) {
      this.burst = burst; this.perSecond = perSecond; this.maxEntries = maxEntries;
      this.senders = new Map(); this.messages = new Map();
    }
    accept(caption, now) {
      if (!caption || !Number.isFinite(now)) return false;
      const last = this.messages.get(caption.id);
      if (last && last.orig === caption.orig && last.trn === caption.trn) return false;
      const state = this.senders.get(caption.from) || { tokens: this.burst, at: now };
      state.tokens = Math.min(this.burst, state.tokens + Math.max(0, now - state.at) * this.perSecond / 1000);
      state.at = now; this.senders.set(caption.from, state);
      if (state.tokens < 1) return false;
      state.tokens--;
      this.messages.delete(caption.id);
      this.messages.set(caption.id, { orig: caption.orig, trn: caption.trn });
      if (this.messages.size > this.maxEntries) this.messages.delete(this.messages.keys().next().value);
      if (this.senders.size > 256) this.senders.delete(this.senders.keys().next().value);
      return true;
    }
    forget(identity) {
      this.senders.delete(identity);
      for (const id of this.messages.keys()) if (id.startsWith(identity + ':')) this.messages.delete(id);
    }
    clear() { this.senders.clear(); this.messages.clear(); }
  }

  function normalizeChat(message, participant, room, now) {
    if (!participant?.identity || !message || typeof message !== 'object' || Array.isArray(message) || !Number.isFinite(now)) return null;
    if (typeof message.id !== 'string' || !/^[A-Za-z0-9:_-]{1,64}$/.test(message.id) || (message.from !== undefined && message.from !== participant.identity)) return null;
    if (message.text !== undefined && (typeof message.text !== 'string' || message.text.length > 2000)) return null;
    const text = (message.text || '').trim(); let file = null;
    if (message.file !== undefined) {
      const input = message.file, kinds = { 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'video/mp4': 'video', 'video/webm': 'video' };
      if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
      if (typeof input.url !== 'string' || typeof input.type !== 'string' || !Object.prototype.hasOwnProperty.call(kinds, input.type)) return null;
      const link = /^api\/file\.php\?r=([a-f0-9]{10})&f=[a-f0-9]{16}&e=\d{9,11}&s=[a-f0-9]{64}$/.exec(input.url || '');
      if (!link || link[1] !== room || kinds[input.type] !== input.kind || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > (input.kind === 'image' ? 32 : 100) * 1024 * 1024 || typeof input.name !== 'string' || [...input.name].length > 80) return null;
      file = { url: input.url, type: input.type, kind: input.kind, size: input.size, name: input.name };
    }
    if (!text && !file) return null;
    return { id: participant.identity + ':' + message.id, from: participant.identity, name: String(participant.name || '').slice(0, 80), speak: metadata(participant).speak || '', text, file, ts: now };
  }
  class MessageGate {
    constructor({ maxEntries = 2000, burst = 12, perSecond = 2 } = {}) { this.seen = new Set(); this.rate = new CaptionGate({ maxEntries: 1, burst, perSecond }); this.maxEntries = maxEntries }
    accept(message, now) {
      if (!message || this.seen.has(message.id) || !this.rate.accept({ from: message.from, id: message.id, orig: message.text, trn: message.file?.url || '' }, now)) return false;
      this.seen.add(message.id); if (this.seen.size > this.maxEntries) this.seen.delete(this.seen.values().next().value); return true;
    }
    clear() { this.seen.clear(); this.rate.clear() }
  }

  function translationIsPlaying({ until = 0, now, publication, element, level = 1 }) {
    return level > 0 && until > now && !!publication?.isSubscribed && !publication.isMuted &&
      !!publication.track && publication.track.streamState !== 'paused' && !publication.track.isMuted &&
      !!element && !element.paused && !element.muted;
  }

  function originalVolume({ translated, duck, factor = 1 }) {
    const safeFactor = Number.isFinite(factor) ? Math.max(0, Math.min(1, factor)) : 1;
    return (translated ? (duck ? 0.12 : 0.4) : 1) * safeFactor;
  }

  return { participantLink, parseInvite, metadata, normalizeCaption, CaptionGate, normalizeChat, MessageGate, translationIsPlaying, originalVolume, validRoom: value => typeof value === 'string' && ROOM.test(value), validLanguage: value => typeof value === 'string' && LANG.test(value) };
});
