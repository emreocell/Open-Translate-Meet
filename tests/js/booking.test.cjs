const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'assets/js/book.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() };
function harness({ readyState = 'loading' } = {}) {
  const nodes = new Map(), events = new Map(), calls = [];
  const node = () => ({children:[],dataset:{},style:{},value:'',hidden:false,textContent:'',disabled:false,classList:{add(){},remove(){},toggle(){}},appendChild(child){this.children.push(child);return child},querySelector(){return null},querySelectorAll(){return []},setAttribute(){},focus(){},set innerHTML(_){this.children=[]}});
  const get = id => { if(!nodes.has(id))nodes.set(id,node());return nodes.get(id) };
  const context={window:null,document:{readyState,documentElement:{dataset:{}},getElementById:get,createElement:node,createTextNode:text=>({textContent:text}),querySelectorAll:()=>[],addEventListener(type,fn){events.set(type,fn)}},
    localStorage:{getItem:()=>null,setItem(){}},navigator:{languages:['en']},addEventListener(){},matchMedia:()=>({matches:false}),setTimeout,clearTimeout,AbortController,Intl,URL,location:{href:'https://meet.example/randevu/',origin:'https://meet.example'},
    fetch:async url=>{calls.push(url);return {ok:true,json:async()=>url.includes('/api/book.php')?{slots:[]}:{}}}
  };
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  return {context,get,calls,event:type=>events.get(type)?.()};
}
test('booking dependencies execute in deferred document order',()=>{
  const html=fs.readFileSync(path.join(root,'randevu/index.html'),'utf8');
  const scripts=[...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)>/g)].map(match=>({url:match[2],attributes:match[1]+match[3]}));
  const relevant=scripts.filter(script=>/\/(branding|select|book)\.js/.test(script.url));
  assert.deepEqual(relevant.map(script=>script.url.split('/').at(-1).split('?')[0]),['branding.js','select.js','book.js']);
  for(const script of relevant){assert.match(script.attributes,/\bdefer\b/);assert.doesNotMatch(script.attributes,/\basync\b/)}
});
test('fast catalogs never initialize booking languages before delayed configuration',async()=>{
  const h=harness();await flush();
  assert.equal(h.get('f-lang').children.length,0);assert.ok(!h.calls.some(url=>url.includes('/api/book.php')));
  let resolveConfiguration;
  h.context.MeetConfig={app:{defaultLocale:'en',defaultTheme:'dark'},translation:{languages:['tr','en','de','fr','es','it','nl','pt','pl','ru','ar','ja']}};
  h.context.MeetConfigReady=new Promise(resolve=>{resolveConfiguration=resolve});
  h.event('DOMContentLoaded');await flush();assert.equal(h.get('f-lang').children.length,0);
  const configured={app:{name:'Fixture',defaultLocale:'en',defaultTheme:'dark'},translation:{languages:['en','tr','de']}};
  h.context.MeetConfig=configured;resolveConfiguration(configured);await flush();
  assert.deepEqual(h.get('f-lang').children.map(option=>option.value),['en','tr','de']);
  assert.equal(h.calls.filter(url=>url.includes('/api/book.php')).length,1);
});
test('missing configuration prevents publishing guessed booking choices',async()=>{
  const h=harness({readyState:'complete'});await flush();
  assert.equal(h.get('f-lang').children.length,0);assert.ok(!h.calls.some(url=>url.includes('/api/book.php')));
  assert.equal(h.get('bk-state').className,'bk-state err');
});
