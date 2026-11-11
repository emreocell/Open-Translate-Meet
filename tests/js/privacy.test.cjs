const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const codes = ['tr','en','de','fr','es','it','nl','pt','pl','ru','ar','ja'];
const read = code => JSON.parse(fs.readFileSync(path.join(root, 'assets/i18n/privacy', code + '.json'), 'utf8'));
const english = read('en');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() };
function harness({ language = 'ar', unavailable = false, failedLocale = false } = {}) {
  const nodes = new Map();
  const node = () => ({ textContent:'', value:'',disabled:true,children:[],dataset:{},append(child){this.children.push(child)},replaceChildren(){this.children=[]} });
  const get = id => { if (!nodes.has(id)) nodes.set(id,node()); return nodes.get(id) };
  const heading=get('heading');heading.dataset.p='heading';
  const ctx={window:null,Intl,AbortController,setTimeout,clearTimeout,localStorage:{getItem:()=>'',setItem(){}},navigator:{languages:[language]},document:{documentElement:{dataset:{}},title:'',getElementById:get,createElement:node,querySelectorAll:()=>[heading]},
    MeetConfigReady:Promise.resolve({configurationUnavailable:unavailable,app:{name:'Fixture',defaultLocale:'en'},features:{translation:false,chatTranslation:true,transcripts:true,summary:true,booking:false},translation:{provider:'none'},limits:{fileRetentionHours:24,transcriptRetentionHours:48,bookingPendingHours:48,bookingRetentionDays:120,usageRetentionDays:30}}),
    fetch:async url=>({ok:!failedLocale,json:async()=>read(/\/([a-z]{2})\.json$/.exec(url)[1])})};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'assets/js/privacy.js'),'utf8'),ctx);return {ctx,get};
}
test('all twelve privacy catalogs preserve complete keys and dynamic placeholders',()=>{
  const placeholders=text=>[...text.matchAll(/\{([a-z]+)\}/g)].map(match=>match[1]).sort();
  for(const code of codes){const catalog=read(code);assert.deepEqual(Object.keys(catalog).sort(),Object.keys(english).sort(),code);
    for(const key of Object.keys(english)){assert.equal(typeof catalog[key],'string',code+':'+key);assert.ok(catalog[key].trim());assert.deepEqual(placeholders(catalog[key]),placeholders(english[key]),code+':'+key)}
  }
});
test('Arabic privacy renders localized status, RTL and configured retention',async()=>{
  const h=harness();await flush();assert.equal(h.ctx.document.documentElement.lang,'ar');assert.equal(h.ctx.document.documentElement.dir,'rtl');
  assert.equal(h.get('heading').textContent,read('ar').heading);assert.ok(h.ctx.document.title.startsWith(read('ar').page_title));
  assert.ok(h.get('privacy-features').children[0].textContent.includes(read('ar').off));
  assert.ok(!h.get('privacy-booking-retention').textContent.includes('{'));assert.equal(h.get('privacy-locale').disabled,false);
});
test('missing configuration never presents fallback retention as a confirmed setting',async()=>{
  const h=harness({language:'en',unavailable:true});await flush();assert.equal(h.get('privacy-features').children[0].textContent,english.config_unavailable);
  assert.ok(h.get('privacy-chat-files').textContent.includes(english.retention_unknown));assert.ok(!h.get('privacy-chat-files').textContent.includes('24'));
});
test('failed locale fetch leaves readable English privacy information',async()=>{
  const h=harness({language:'de',failedLocale:true});await flush();assert.equal(h.ctx.document.documentElement.lang,'en');assert.equal(h.get('heading').textContent,english.heading);assert.equal(h.get('privacy-status').textContent,english.locale_unavailable);
});
