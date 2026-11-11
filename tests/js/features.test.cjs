const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
let code = fs.readFileSync(path.join(__dirname, '../../assets/js/features.js'), 'utf8');
// A private test seam exposes state controls without changing the delivered module.
code = code.replace(/\}\)\(\);\s*$/, `window.testFeature = { start(person, snapshot) { me=person; state=snapshot; blocked=false; confirmed=true }, setState(snapshot) { state=snapshot }, flushCaptions, drainCaptions, flushUsage, stop, stats:()=>({queued:queue.size,pendingInput,pendingSessions}) };})();`);
function harness() {
  const handlers = new Map(), calls = [], elements = new Map();
  const person = { identity: 'speaker', ticket: 'private-application-ticket', room: 'abcdef1234', host: false };
  const document = { addEventListener(type, fn) { const list = handlers.get(type)||[];list.push(fn);handlers.set(type,list) }, getElementById(id) { if(!elements.has(id)) elements.set(id,{textContent:'',dataset:{},hidden:false});return elements.get(id) } };
  const ctx = { document, window: null, console, AbortController, setInterval, clearInterval, setTimeout, clearTimeout,
    fetch: async (url,options) => {calls.push({url,...options});return {ok:true,json:async()=>({ok:true})}},
    WM:{me:person,features:{transcripts:true},t:key=>key}, WMT:{setTranscriptionRequested(){},health:()=>({activeSessions:1})} };
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(code,ctx);
  return { calls, ctx, person, start(consent=true,enabled=true){ctx.testFeature.start(person,{enabled,consent:{record:consent,summary:false}})}, event(type,detail){for(const fn of handlers.get(type)||[])fn({detail})} };
}
const caption = { identity:'speaker',id:'caption-1',original:'Private meeting speech',translated:'',from:'en',to:'en',local:true };
test('captions never persist before explicit consent or while capture is disabled', async()=>{
  const h=harness();h.start(false);h.event('wm:caption',caption);await h.ctx.testFeature.flushCaptions();assert.equal(h.calls.length,0);
  h.start(true,false);h.event('wm:caption',caption);await h.ctx.testFeature.flushCaptions();assert.equal(h.calls.length,0);
});
test('only local captions with this authenticated speaker identity may be uploaded',async()=>{
  const h=harness();h.start();
  h.event('wm:caption',{...caption,local:false});h.event('wm:caption',{...caption,identity:'someone-else'});
  assert.equal(h.ctx.testFeature.stats().queued,0);
  h.event('wm:caption',caption);await h.ctx.testFeature.flushCaptions();assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].headers['X-Meet-Token'],h.person.ticket);
  const body=JSON.parse(h.calls[0].body);assert.equal(body.action,'append');assert.equal(body.original,caption.original);assert.equal(body.speaker,undefined);
});
test('caption updates coalesce and private browser queue stays bounded',async()=>{
  const h=harness();h.start();h.event('wm:caption',caption);h.event('wm:caption',{...caption,original:'Final revision'});
  assert.equal(h.ctx.testFeature.stats().queued,1);await h.ctx.testFeature.flushCaptions();assert.equal(JSON.parse(h.calls[0].body).original,'Final revision');
  for(let i=0;i<150;i++)h.event('wm:caption',{...caption,id:'caption-'+i});assert.equal(h.ctx.testFeature.stats().queued,100);
});
test('usage sends deltas once, ignores regressing counters, and remains client-reported',async()=>{
  const h=harness();h.start();const usage={sessionId:'session',inputSeconds:10,sessionSeconds:20};
  h.event('wm:translation-usage',usage);h.event('wm:translation-usage',usage);h.event('wm:translation-usage',{...usage,inputSeconds:5,sessionSeconds:10});
  h.event('wm:translation-usage',{...usage,inputSeconds:12,sessionSeconds:25});
  await h.ctx.testFeature.flushUsage();const body=JSON.parse(h.calls[0].body);assert.equal(body.inputSeconds,12);assert.equal(body.sessionSeconds,25);
  await h.ctx.testFeature.flushUsage();assert.equal(JSON.parse(h.calls[1].body).inputSeconds,0);
});

test('export draining waits for every queued source and preserves its translation',async()=>{
  const h=harness();h.start();
  h.event('wm:caption',{...caption,translated:'Gespräch',to:'de'});
  h.event('wm:caption',{...caption,id:'second',original:'Second utterance'});
  const inflight=h.ctx.testFeature.flushCaptions();
  assert.equal(await h.ctx.testFeature.drainCaptions(),true);await inflight;
  assert.equal(h.calls.length,2);assert.equal(h.ctx.testFeature.stats().queued,0);
  assert.equal(JSON.parse(h.calls[0].body).translated,'Gespräch');assert.equal(JSON.parse(h.calls[0].body).to,'de');
});
test('leaving aborts pending private-content requests and clears the queue',async()=>{
  const h=harness();h.start();let request;
  h.ctx.fetch=(_url,options)=>new Promise((_resolve,reject)=>{request=options;options.signal.addEventListener('abort',()=>reject(new Error('aborted')))});
  h.event('wm:caption',caption);const pending=h.ctx.testFeature.flushCaptions();
  // The final usage keepalive has its own lightweight response.
  h.ctx.fetch=async()=>({ok:true,json:async()=>({ok:true})});h.ctx.testFeature.stop();
  assert.equal(request.signal.aborted,true);await pending;assert.equal(h.ctx.testFeature.stats().queued,0);
});
