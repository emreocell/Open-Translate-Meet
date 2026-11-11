/* Optional browser regression suite. Requires Playwright and Chromium; all external
   providers are replaced by local fixtures. No production credentials or media used. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean) }));
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'test-results'); fs.mkdirSync(artifacts, { recursive: true });
const fixture = {
  app: { name: 'Fixture Meeting', defaultLocale: 'en', defaultTheme: 'dark', logo: 'assets/brand/mark.svg', favicon: 'assets/brand/mark.svg', accent: '#3572ed', sourceUrl: 'https://example.invalid/source' },
  features: { booking: false, translation: false, transcripts: true, summary: true, chatTranslation: true },
  translation: { enabled: false, provider: 'none', model: '', languages: ['en', 'tr', 'de'], maxSessions: 3 },
  limits: { maxParticipants: 8, transcriptRetentionHours: 24, fileRetentionHours: 24, usageRetentionDays: 30, bookingPendingHours: 48, bookingRetentionDays: 120 }, uiLanguages: ['en', 'tr', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'ru', 'ar', 'ja'],
};
let configDelay = 0;
let host = true, waiting = false, admitted = false, appendCount = 0, participantCalls = [], hostCalls = [], consent = { record: false, summary: false }, capture = true, translatedMessages = 0;
const entries = new Map();
const bookingId = 'abcdef123456', bookingToken = 'c'.repeat(64);
const firstSlot = Math.ceil((Date.now()/1000 + 86400) / 1800) * 1800;
const bookingSlots = [firstSlot, firstSlot+1800, firstSlot+86400], bookingRequests = [], bookingMutations = [], bookingHeaders = [];
let adminAuthenticated = false, failAdminCreate = true; const adminCsrf = 'fixture-csrf-token', adminRequests = [];
const adminRooms = [{ id: 'abcdef1234', title: 'Existing fixture room', open: true, status: 'active', max: 8, live: null, expiresAt: firstSlot + 86400 }];
let failBookingRequest = true, booking = { status: 'pending', name: 'Booking visitor', slot: firstSlot, notifications: { visitor: false }, link: null };
const sdk = `(() => {
  const events = new Proxy({}, {get: (_,key) => key});
  class Room {
    constructor(){this.handlers=new Map();this.state='connected'; this.remoteParticipants=new Map();this.localParticipant={identity:'111111111111', name:'Tester', metadata:JSON.stringify({speak:'en',hear:'en',role:'host'}),isMicrophoneEnabled:false,isCameraEnabled:false,isScreenShareEnabled:false,connectionQuality:'good', permissions:{canPublish:true,canPublishSources:[0,1,2,3,4]},trackPublications:new Map(),getTrackPublication:()=>null,setMicrophoneEnabled:async()=>{},setCameraEnabled:async()=>{},publishData:async()=>{},setScreenShareEnabled:async()=>{}}; window.fixtureRoom=this}
    on(e,fn){const a=this.handlers.get(e)||[];a.push(fn);this.handlers.set(e,a);return this}
    off(e,fn){this.handlers.set(e,(this.handlers.get(e)||[]).filter(x=>x!==fn))}
    emit(e,...args){for(const fn of this.handlers.get(e)||[])fn(...args)}
    async connect(){} async startAudio(){} async disconnect(){} async switchActiveDevice(){}
  }
  window.LivekitClient={Room,RoomEvent:events,Track:{Source:{Microphone:'microphone',Camera:'camera',ScreenShare:'screen_share',Unknown:'unknown'}},VideoPresets:{h540:{},h180:{},h360:{}},DisconnectReason:{PARTICIPANT_REMOVED:4,ROOM_DELETED:5},LocalAudioTrack:class{}};
})();`;
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml' };
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost'); let body = '';
  for await (const chunk of request) body += chunk;
  let data = {}; try { data = JSON.parse(body) } catch (_) {}
  const json = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) };
  if (url.pathname === '/api/admin.php') {
    const action = request.method === 'GET' ? url.searchParams.get('action') : data.action;
    if (action === 'status') return json({ authenticated: adminAuthenticated, configured: true, csrf: adminAuthenticated ? adminCsrf : null, config: fixture });
    if (action === 'login') { if (data.password !== 'fixture-admin-password') return json({ error: 'forbidden' }, 403); adminAuthenticated = true; return json({ ok: true, csrf: adminCsrf }) }
    if (!adminAuthenticated) return json({ error: 'unauthorized' }, 401);
    if (request.method === 'POST') { adminRequests.push({ action, csrf: request.headers['x-csrf-token'] }); if (request.headers['x-csrf-token'] !== adminCsrf) return json({ error: 'csrf' }, 403) }
    if (action === 'logout') { adminAuthenticated = false; return json({ ok: true }) }
    if (action === 'rooms') return json({ rooms: adminRooms, mediaAvailable: false });
    if (action === 'bookings') return json({ bookings: [{ ...booking, id: bookingId, email: 'fixture@example.invalid', slotMin: 30 }] });
    if (action === 'health') return json({ privateStorageWritable: true, mediaConfigured: false, translationConfigured: false, textConfigured: false, bookingEnabled: true, calendarProvider: 'none', calendarConnected: false, mailConfigured: false, transcriptsEnabled: true, phpVersion: 'fixture' });
    if (action === 'create') {
      if (failAdminCreate) { failAdminCreate = false; return json({ error: 'provider_unavailable' }, 502) }
      adminRooms.push({ id: 'fedcba4321', title: data.title, max: data.max, expiresAt: data.expiresAt, waitingRoom: data.waitingRoom, open: true, status: 'active', live: null });
      const link = 'http://' + request.headers.host + '/?r=fedcba4321.' + 'd'.repeat(24);
      return json({ ok: true, link, hostLink: link + '#h=' + 'e'.repeat(64) });
    }
    return json({ error: 'bad_action' }, 400);
  }
  if (url.pathname === '/api/book.php') {
    if (request.method === 'GET') return json({ slots: bookingSlots, taken: [], slotMin: 30, tz: 'UTC' });
    bookingRequests.push(data);
    if (failBookingRequest) { failBookingRequest = false; return json({ error: 'calendar_unavailable' }, 503) }
    booking = { ...booking, name: data.name, slot: data.slot };
    return json({ ok: true, manageUrl: '/randevu/manage/?b=' + bookingId + '#m=' + bookingToken, notifications: { visitor: false } });
  }
  if (url.pathname === '/api/book-manage.php') {
    bookingHeaders.push(request.headers['x-booking-token']);
    if (request.headers['x-booking-token'] !== bookingToken) return json({ error: 'unauthorized' }, 403);
    if (request.method === 'GET') return json(url.searchParams.get('action') === 'slots' ? { slots: bookingSlots.slice(0, 2), slotMin: 30, tz: 'UTC' } : booking);
    bookingMutations.push(data);
    if (data.action === 'reschedule') { booking.slot = data.slot; booking.status = 'approved'; booking.notifications.visitor = true; delete booking.pendingSlot; booking.link = '/?r=abcdef1234.'+'a'.repeat(24) }
    if (data.action === 'cancel') { booking.status = 'cancelled'; booking.link = null }
    return json({ ok: true });
  }
  if (url.pathname === '/api/config.php') { if (configDelay) await new Promise(resolve => setTimeout(resolve, configDelay)); return json(fixture) }
  if (url.pathname === '/api/room-info.php') return json({ title: 'Fixture room', password: false });
  if (url.pathname === '/api/join.php') {
    if (waiting && !admitted) return json({ status: 'waiting', waitingToken: 'fixture-wait-token' }, 202);
    return json({ token: 'fixture-media-token', ticket: 'fixture-api-ticket', resumeToken: 'fixture-resume', identity: '111111111111', room: 'abcdef1234', host, url: 'wss://fixture.invalid', translation: false });
  }
  if (url.pathname === '/api/participant.php') { participantCalls.push(data); return json({ ok: true, speak: data.speak, hear: data.hear }) }
  if (url.pathname === '/api/host.php') { hostCalls.push(data); return json(data.action === 'state' ? { max: 8, count: 1, locked: false, waitingRoom: true, waiting: [{ id: 'waiter', name: 'Waiting person', speak: 'tr', hear: 'en' }] } : data.action === 'bans' ? { bans: [] } : { ok: true }) }
  if (url.pathname === '/api/transcript.php') {
    if (data.action === 'consent') { consent = { record: data.record, summary: data.summary }; if (!data.record) entries.clear() }
    if (data.action === 'enabled') capture = data.enabled;
    if (data.action === 'append') { if (!consent.record || !capture) return json({ error: 'consent_required' }, 403); appendCount++; entries.set(data.id, { id: data.id, speaker: '111111111111', name: 'Tester', language: 'de', at: Math.floor(Date.now()/1000), original: data.original, translations: data.translated ? { [data.to]: data.translated } : {} }) }
    if (data.action === 'export') return json({ room: 'abcdef1234', entries: [...entries.values()], summary: null });
    if (data.action === 'summary') return json({ draft: true, report: { brief: [{ text: 'Fixture summary', evidence: [...entries.keys()] }] } });
    return json({ ok: true, enabled: capture, consent, entries: appendCount, summaryProvider: 'fixture-text', expiresAt: Math.floor(Date.now()/1000)+86400 });
  }
  if (url.pathname === '/api/text-translate.php') { translatedMessages++; return json({ text: 'How are you?' }) }
  if (url.pathname === '/api/usage.php') return json({ ok: true, issuedLiveTokens: 0, textRequests: 0, failedRequests: 0, providerInputTokens: 0, providerOutputTokens: 0, activeSessionsReported: 0, clientInputSeconds: 0, estimatedCost: null });
  if (url.pathname === '/assets/js/livekit-client.umd.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); return response.end(sdk) }
  if (url.pathname.startsWith('/api/')) return json({ error: 'disabled' }, 503);
  let filename = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
  if (fs.existsSync(filename) && fs.statSync(filename).isDirectory()) filename = path.join(filename, 'index.html');
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) { response.writeHead(404); return response.end() }
  response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' }); response.end(fs.readFileSync(filename));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  const errors = []; let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => { localStorage.setItem('wm-mic','0'); localStorage.setItem('wm-cam','0'); localStorage.setItem('wm-lang','en'); Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.fixtureCopied = value } } }); });
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/?r=abcdef1234.' + 'a'.repeat(24) + '#h=' + 'b'.repeat(64));
    await page.locator('#lobby.on').waitFor(); assert.equal(new URL(page.url()).hash, '');
    await page.locator('#n').fill('Tester'); await page.locator('#join').click(); await page.locator('#room.on').waitFor();
    assert.equal(await page.evaluate(() => window.WM.me.ticket), 'fixture-api-ticket');
    await page.locator('#copylink').click(); const copied = await page.evaluate(() => window.fixtureCopied); assert.ok(!copied.includes('#')); assert.ok(!new URL(copied).searchParams.has('h'));
    await page.locator('#setbtn').click(); await page.locator('#meeting-speak').selectOption('de', { force: true }); await page.locator('#language-apply').click(); await page.waitForFunction(() => window.WM.me.speak === 'de');
    assert.equal(participantCalls.some(call => call.action === 'languages' && call.speak === 'de'), true);
    const caption = async id => page.evaluate(id => document.dispatchEvent(new CustomEvent('wm:caption', { detail: { identity: window.WM.me.identity, id, original: 'Dieser Satz darf gespeichert werden.', translated: 'This sentence may be saved.', from: 'de', to: 'en', local: true, at: Date.now() } })), id);
    await caption('before-consent'); await page.waitForTimeout(1200); assert.equal(appendCount, 0);
    await page.locator('#record-consent').check(); await page.waitForFunction(() => document.getElementById('record-consent').checked && !document.getElementById('record-consent').disabled);
    assert.equal(await page.locator('#summary-consent').isChecked(), false);
    await caption('after-consent'); await page.waitForTimeout(1200); assert.equal(appendCount, 1);
    const downloadEvent = page.waitForEvent('download'); await page.locator('#export-json').click();
    const download = await downloadEvent; await download.saveAs(path.join(artifacts, 'fixture-transcript.json'));
    const exported = JSON.parse(fs.readFileSync(path.join(artifacts, 'fixture-transcript.json'), 'utf8'));
    assert.equal(exported.entries.length, 1); assert.equal(exported.entries[0].translations.en, 'This sentence may be saved.');
    await page.locator('#record-consent').uncheck(); await page.waitForTimeout(300); await caption('after-withdraw'); await page.waitForTimeout(1200); assert.equal(appendCount, 1);
    await page.locator('#st-close').click(); await page.locator('#hostbtn').click(); await page.locator('#waiting-list button').first().click(); assert.ok(hostCalls.some(call => call.action === 'admit' && call.waitingId === 'waiter'));
    await page.evaluate(() => {
      const p={identity:'222222222222',name:'Verified person',metadata:JSON.stringify({speak:'tr',hear:'en'}),trackPublications:new Map(),getTrackPublication:()=>null}; window.fixtureRoom.remoteParticipants.set(p.identity,p);
      const send=m=>window.fixtureRoom.emit('DataReceived', new TextEncoder().encode(JSON.stringify(m)),p,null,'tx');
      send({from:window.WM.me.identity,name:'Forged',id:'x',speak:'tr',to:'en',orig:'attack',trn:'attack'});
      send({from:p.identity,name:'Forged host',id:'y',speak:'de',to:'en',orig:'Merhaba',trn:'Hello'});
    });
    assert.equal(await page.locator('#msgs .msg').count(), 1); assert.equal(await page.locator('#msgs .wn').textContent(), 'Verified person');
    await page.locator('#chatbtn').click();
    assert.equal(await page.locator('#chat-translate').isChecked(), false);
    const sendChat = async (id,text) => page.evaluate(({id,text}) => {
      const p = window.fixtureRoom.remoteParticipants.get('222222222222');
      window.fixtureRoom.emit('DataReceived', new TextEncoder().encode(JSON.stringify({ id, from: p.identity, text })), p, null, 'chat');
    }, {id,text});
    await sendChat('first-chat', 'Merhaba'); assert.equal(translatedMessages, 0);
    await page.locator('#chat-translate').check(); await sendChat('second-chat', 'Nasılsın?');
    await page.locator('.cm-translated').waitFor(); assert.equal(await page.locator('.cm-translated').textContent(), 'How are you?');
    assert.equal(await page.locator('.cm-original .cm-b').textContent(), 'Nasılsın?');
    await page.evaluate(() => { window.fixtureRoom.localParticipant.publishData = async () => { throw new Error('fixture offline') } });
    await page.locator('#chatin').fill('Keep this draft'); await page.locator('#chatsend').click();
    await page.waitForFunction(() => !document.getElementById('chatsend').disabled);
    assert.equal(await page.locator('#chatin').inputValue(), 'Keep this draft');
    const sidebarGeometry = await page.evaluate(() => {
      const tx = document.getElementById('tab-tx').getBoundingClientRect(), chat = document.getElementById('tab-chat').getBoundingClientRect(), status = document.getElementById('trchip').getBoundingClientRect();
      return { txWidth: tx.width, chatWidth: chat.width, controlsBottom: Math.max(tx.bottom, chat.bottom), statusTop: status.top };
    });
    assert.ok(sidebarGeometry.txWidth >= 100 && sidebarGeometry.chatWidth >= 100, 'Translation status must leave both sidebar tabs readable');
    assert.ok(sidebarGeometry.statusTop >= sidebarGeometry.controlsBottom, 'Translation status must not overlap sidebar tabs');
    await page.screenshot({ path: path.join(artifacts, 'meeting-desktop.png'), fullPage: true });
    await page.locator('#lbtn').click(); await page.locator('[data-lc="ar"]').click(); await page.waitForFunction(() => document.documentElement.dir === 'rtl');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const mobileHeader = await page.evaluate(() => {
      const title = document.getElementById('rname').getBoundingClientRect(), brand = document.querySelector('#room .rtop .brand [data-app-name]').getBoundingClientRect(), header = document.querySelector('#room .rtop').getBoundingClientRect();
      return { titleWidth: title.width, titleHeight: title.height, brandHeight: brand.height, headerHeight: header.height };
    });
    assert.ok(mobileHeader.titleWidth >= 180 && mobileHeader.titleHeight <= 25, 'Mobile room title must remain readable on one line');
    assert.ok(mobileHeader.brandHeight <= 25 && mobileHeader.headerHeight <= 100, 'Mobile branding must not wrap into vertical fragments');
    await page.locator('#hostbtn').click(); await page.locator('#hostpanel').waitFor();
    const mobileHostPanel = await page.locator('#hostpanel').evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, viewport: innerWidth } });
    assert.ok(mobileHostPanel.left >= 8 && mobileHostPanel.right <= mobileHostPanel.viewport - 8, 'Mobile host controls must stay within the viewport in RTL');
    await page.locator('#hostbtn').click();
    await page.screenshot({ path: path.join(artifacts, 'meeting-arabic-mobile.png'), fullPage: true });
    await page.locator('#leave').click(); await page.locator('#lobby.on').waitFor();
    host = false; waiting = true; admitted = false;
    await page.locator('#join').click(); await page.locator('#admission.on').waitFor(); assert.equal(await page.evaluate(() => window.WM), null);
    admitted = true; await page.locator('#room.on').waitFor({ timeout: 12000 });
    assert.equal(await page.locator('#hostwrap').evaluate(element => element.classList.contains('hide')), true);
    await page.locator('#leave').click();
    fixture.features.booking = true; configDelay = 500; // Fast catalogs must wait for deliberately slower deployment configuration.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin + '/randevu/'); await page.locator('#times .tm').first().click();
    await page.locator('#f-name').fill('Booking visitor'); await page.locator('#f-email').fill('fixture@example.invalid');
    assert.deepEqual(await page.locator('#f-lang option').evaluateAll(options => options.map(option => option.value)), ['en', 'tr', 'de']);
    await page.locator('#f-lang').selectOption('en', { force: true });
    await page.locator('#f-send').click(); await page.locator('#f-err').filter({ hasText: /.+/ }).waitFor();
    await page.waitForFunction(() => !document.getElementById('f-send').disabled); await page.locator('#f-send').click();
    await page.locator('#step-done:not([hidden])').waitFor();
    assert.equal(bookingRequests.length, 2); assert.equal(bookingRequests[0].requestId, bookingRequests[1].requestId);
    assert.match(bookingRequests[0].requestId, /^[a-f0-9-]{36}$/);
    const privateLink = await page.locator('#step-done a.booking-result-link').getAttribute('href'); assert.ok(privateLink.includes('#m='));
    await page.locator('#step-done a.booking-result-link').click(); await page.locator('#manage-detail:not([hidden])').waitFor();
    assert.equal(new URL(page.url()).hash, ''); await page.locator('#manage-copy').click();
    assert.ok((await page.evaluate(() => window.fixtureCopied)).endsWith('#m=' + bookingToken));
    await page.locator('#manage-times button').nth(1).click(); await page.locator('#manage-save').click();
    await page.waitForFunction(() => !document.getElementById('manage-cancel').disabled && document.getElementById('manage-save').disabled);
    assert.equal(bookingMutations.at(-1).slot, bookingSlots[1]);
    await page.locator('#manage-times button').first().click();
    const bookingVisuals = [];
    for (const scenario of [{ width: 390, theme: 'dark' }, { width: 320, theme: 'dark' }, { width: 390, theme: 'light' }]) {
      await page.setViewportSize({ width: scenario.width, height: 844 });
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, scenario.theme);
      // Finish finite UI transitions so this screenshot tests the selected palette.
      await page.screenshot({ path: path.join(artifacts, `booking-approved-${scenario.width}-${scenario.theme}.png`), fullPage: true, animations: 'disabled' });
      const visual = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('#manage-refresh, #manage-copy, #manage-cancel, #manage-days button, #manage-times button')].filter(element => element.getBoundingClientRect().height > 0).map(element => {
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
          return { id: element.id || element.parentElement.id, height: rect.height, radius: parseFloat(style.borderRadius), border: parseFloat(style.borderTopWidth), borderStyle: style.borderTopStyle, appearance: style.appearance, background: style.backgroundColor, color: style.color };
        });
        const actions = document.querySelector('.manage-actions'), bounds = actions.getBoundingClientRect();
        const actionRects = [...actions.children].map(element => element.getBoundingClientRect()).filter(rect => rect.height > 0).map(rect => ({ width: rect.width, top: rect.top, bottom: rect.bottom }));
        const gridsFit = [...document.querySelectorAll('.manage-grid')].every(grid => { const bounds = grid.getBoundingClientRect(); return [...grid.children].every(child => { const rect = child.getBoundingClientRect(); return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 }) });
        const join = document.getElementById('manage-join');
        return { controls, actionRects, actionWidth: bounds.width, gridsFit, overflow: document.documentElement.scrollWidth > innerWidth + 1, selectedDay: !!document.querySelector('#manage-days [aria-pressed="true"]'), selectedTime: !!document.querySelector('#manage-times [aria-pressed="true"]'), joinHeight: join.getBoundingClientRect().height, joinMarginTop: parseFloat(getComputedStyle(join).marginTop) };
      });
      for (const control of visual.controls) {
        assert.ok(control.height >= 48 && control.radius >= 12, `Booking ${control.id} must provide a readable touch target at ${scenario.width}px`);
        assert.equal(control.appearance, 'none'); assert.equal(control.border, 1); assert.equal(control.borderStyle, 'solid');
        assert.notEqual(control.background, 'rgb(239, 239, 239)', 'Booking controls must not revert to native gray buttons');
        assert.notEqual(control.color, 'rgb(0, 0, 0)', 'Booking controls must use the selected theme');
      }
      assert.ok(!visual.overflow && visual.gridsFit, 'Booking controls must fit the narrow viewport');
      assert.ok(visual.actionRects.every(rect => Math.abs(rect.width - visual.actionWidth) <= 1), 'Mobile booking actions must fill one row each');
      assert.ok(visual.actionRects.slice(1).every((rect, i) => rect.top - visual.actionRects[i].bottom >= 9.5), 'Mobile booking actions need separate touch spacing');
      assert.ok(visual.selectedDay && visual.selectedTime); assert.ok(visual.joinHeight >= 48); assert.equal(visual.joinMarginTop, 0);
      bookingVisuals.push({ ...scenario, ...visual });
    }
    await page.setViewportSize({ width: 1280, height: 900 }); await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' });
    // A server-side retry can reference a held slot omitted by ordinary availability.
    booking.status = 'rescheduling'; booking.pendingSlot = bookingSlots[2];
    await page.locator('#manage-refresh').click(); await page.locator('#manage-times button[aria-pressed="true"]').waitFor();
    assert.equal(await page.locator('#manage-days button[aria-pressed="true"]').count(), 1);
    assert.equal(await page.locator('#manage-save').isEnabled(), true); await page.locator('#manage-save').click();
    await page.waitForFunction(() => !document.getElementById('manage-cancel').disabled && document.getElementById('manage-save').disabled);
    assert.equal(bookingMutations.at(-1).slot, bookingSlots[2]);
    page.once('dialog', dialog => dialog.accept()); await page.locator('#manage-cancel').click();
    await page.locator('#manage-schedule[hidden]').waitFor({ state: 'attached' });
    assert.equal(booking.status, 'cancelled'); assert.equal(await page.locator('#manage-join').isVisible(), false);
    await page.reload(); await page.locator('#manage-detail:not([hidden])').waitFor();
    assert.ok(bookingHeaders.every(value => value === bookingToken));
    await page.screenshot({ path: path.join(artifacts, 'booking-management.png'), fullPage: true });
    await page.goto(origin + '/admin/'); await page.locator('#ad-login:not([hidden])').waitFor();
    await page.locator('#ad-password').fill('fixture-admin-password'); await page.locator('#ad-login-form button').click();
    await page.locator('#ad-app:not([hidden])').waitFor(); await page.locator('#ad-room-list .ad-card').waitFor();
    assert.equal(await page.locator('#ad-password').inputValue(), '');
    assert.match(await page.locator('#ad-room-list .ad-data').textContent(), /Unknown/);
    assert.equal(await page.locator('#ad-media-warning').isVisible(), true);
    await page.locator('#ad-create').click(); await page.locator('#room-title').fill('Created fixture room');
    await page.locator('#room-max').fill('4'); await page.locator('#room-waiting').check();
    await page.locator('#ad-room-form button[type=submit]').click();
    await page.waitForFunction(() => document.getElementById('ad-message').dataset.kind === 'error' && !document.querySelector('#ad-room-form button[type=submit]').disabled);
    assert.equal(await page.locator('#ad-room-dialog').evaluate(dialog => dialog.open), true); assert.equal(adminRooms.length, 1);
    assert.equal(await page.locator('#room-title').inputValue(), 'Created fixture room');
    await page.locator('#ad-room-form button[type=submit]').click(); await page.locator('#ad-report-dialog[open]').waitFor();
    assert.equal(adminRooms.length, 2); assert.equal(adminRooms[1].waitingRoom, true);
    const adminLinks = await page.locator('#ad-report-body input').evaluateAll(inputs => inputs.map(input => input.value));
    assert.equal(new URL(adminLinks[0]).hash, ''); assert.ok(new URL(adminLinks[1]).hash.startsWith('#h='));
    await page.locator('[data-close="ad-report-dialog"]').click();
    await page.locator('#tab-health').click(); await page.locator('#ad-health-list dd').first().waitFor();
    await page.locator('#tab-bookings').click(); await page.locator('#ad-booking-list .ad-card').waitFor();
    await page.locator('#tab-rooms').click(); await page.locator('#ad-locale').selectOption('ar');
    await page.waitForFunction(() => document.documentElement.dir === 'rtl'); await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(artifacts, 'admin-arabic-mobile.png'), fullPage: true });
    assert.ok(adminRequests.every(request => request.csrf === adminCsrf));
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    assert.ok(!storage.includes('fixture-admin-password')); assert.ok(!storage.includes(adminCsrf));
    await page.locator('#ad-logout').click(); await page.locator('#ad-login:not([hidden])').waitFor();
    assert.equal(adminAuthenticated, false);
    await page.goto(origin + '/privacy/'); await page.waitForFunction(() => !document.getElementById('privacy-locale').disabled);
    await page.locator('#privacy-locale').selectOption('ar'); await page.waitForFunction(() => document.documentElement.dir === 'rtl');
    assert.equal(await page.locator('h1').textContent(), 'بيانات الاجتماعات وخياراتك');
    assert.ok(!(await page.locator('main').textContent()).includes('{hours}'));
    assert.ok((await page.title()).startsWith('الخصوصية'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const privacyContrast = {};
    for (const theme of ['light', 'dark']) {
      privacyContrast[theme] = await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        const rgba = value => { const parts = value.match(/[\d.]+/g)?.map(Number); if (!parts || parts.length < 3) throw new Error('Unsupported computed color: ' + value); return [parts[0], parts[1], parts[2], parts[3] ?? 1] };
        const over = (front, back) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3]));
        const luminance = rgb => rgb.map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4 }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
        const base = over(rgba(getComputedStyle(document.body).backgroundColor), [255, 255, 255]);
        return ['body', '.privacy-document h1', '.privacy-document h2', '.privacy-document p.lead', '#privacy-features li', '.privacy-language label', '#privacy-locale', '.privacy-document footer a'].map(selector => {
          const element = document.querySelector(selector), layers = [];
          for (let parent = element; parent && parent !== document.body; parent = parent.parentElement) layers.unshift(rgba(getComputedStyle(parent).backgroundColor));
          const background = layers.reduce((color, layer) => over(layer, color), base);
          const foreground = over(rgba(getComputedStyle(element).color), background);
          const a = luminance(foreground), b = luminance(background);
          return { selector, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), foreground, background };
        });
      }, theme);
      for (const result of privacyContrast[theme]) assert.ok(result.ratio >= 4.5, `${theme} privacy contrast below 4.5:1 for ${result.selector}: ${result.ratio.toFixed(2)}`);
      if (theme === 'light') await page.screenshot({ path: path.join(artifacts, 'privacy-arabic-mobile-light.png'), fullPage: true });
    }
    await page.screenshot({ path: path.join(artifacts, 'privacy-arabic-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []); fs.writeFileSync(path.join(artifacts, 'browser-smoke.json'), JSON.stringify({ passed: true, errors, appendCount, translatedMessages, bookingRequests: bookingRequests.length, bookingMutations: bookingMutations.length, adminCreates: adminRooms.length - 1, bookingVisuals, privacyContrast }, null, 2));
    console.log('Browser smoke passed: host-link isolation, join/admission, languages, caption identity, consent/export, chat translation/send failure, RTL/mobile, leave, booking retry/reschedule/cancel, admin authentication/create/failure/RTL, localized privacy.');
    await context.close();
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'browser-failure.png'), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(artifacts, 'browser-smoke.json'), JSON.stringify({ passed: false, error: error.message, errors }, null, 2)); throw error;
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
})().catch(error => { console.error(error); server.close(); process.exitCode=1 });
