const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../../assets/js/meeting-core.js');
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() };
let source = fs.readFileSync(path.join(__dirname, '../../assets/js/chat.js'), 'utf8');
source = source.replace(/\}\)\(\);\s*$/, `window.testChat={
  start(values){generation++;env=values;room=values.room;me=values.me;autoTranslate=false;sending=false;lastSend=0;uploadRow=values.uploadRow},
  sendText,uploadFile,queueTranslation,enabled(value){autoTranslate=value},stats:()=>({uploads:ups.size,translations:translationControllers.size,queued:translationQueue.length})
};})();`);
class Element {
  constructor(tag='div') { this.tagName=tag;this.children=[];this.style={};this.dataset={};this.value='';this.hidden=false;this.disabled=false;this.className='';this.parentNode=null;this._text='';this.isConnected=true;this.scrollHeight=100;this.clientHeight=100;this.scrollTop=0; }
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('')}
  set textContent(value){this._text=String(value);this.children=[]}
  set innerHTML(_){this._text='';this.children=[]}
  get firstElementChild(){return this.children[0]}
  append(...items){for(const item of items){item.remove();item.parentNode=this;this.children.push(item)}}
  appendChild(item){this.append(item);return item}
  insertBefore(item,before){item.remove();const i=this.children.indexOf(before);item.parentNode=this;this.children.splice(i<0?this.children.length:i,0,item)}
  remove(){if(this.parentNode){const a=this.parentNode.children;const i=a.indexOf(this);if(i>=0)a.splice(i,1)}this.parentNode=null}
  matches(selector){return selector.startsWith('.')?this.className.split(' ').includes(selector.slice(1)):this.tagName===selector}
  querySelectorAll(selector){const found=[];for(const child of this.children){if(child.matches(selector))found.push(child);found.push(...child.querySelectorAll(selector))}return found}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  setAttribute(){} removeAttribute(){} addEventListener(){} focus(){}
  get classList(){const self=this;return {contains:name=>self.className.split(' ').includes(name),add(...names){self.className=[...new Set([...self.className.split(' '),...names])].join(' ')},remove(...names){self.className=self.className.split(' ').filter(name=>!names.includes(name)).join(' ')},toggle(name,value){if(value===undefined)value=!this.contains(name);if(value)this.add(name);else this.remove(name)}}}
}
function harness() {
  const elements=new Map(), handlers=new Map(), requests=[], toasts=[], rows=[];
  const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
  const me={identity:'self',ticket:'private-api-ticket',name:'Self',speak:'en',hear:'de',room:'abcdef1234'};
  const room={remoteParticipants:new Map(),localParticipant:{publishData:async()=>{}},on(){},off(){}};
  let counter=0;
  const context={window:null,document:{hidden:false,addEventListener(type,fn){handlers.set(type,fn)},getElementById:element,createElement:tag=>new Element(tag),createTextNode:text=>{const e=new Element('#text');e.textContent=text;return e},querySelectorAll:()=>[]},
    addEventListener(){},getComputedStyle:()=>({display:'none'}),matchMedia:()=>({matches:false}),TextEncoder,TextDecoder,AbortController,Blob,setTimeout,clearTimeout,setInterval,clearInterval,performance:{now:()=>1000},crypto:{randomUUID:()=>`uuid-${++counter}`},console,
    WMCore:core,WM:{me,features:{chatTranslation:true}},LivekitClient:{RoomEvent:{DataReceived:'data'}},
    fetch:async(url,options)=>{requests.push({url,...options});return {ok:true,json:async()=>({text:'Hallo'})}}
  };
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  const uploadRow=()=>{const row={cancel:{},progress:[],set(...values){this.progress.push(values)},done(){this.removed=true},fail(value){this.error=value}};rows.push(row);return row};
  context.testChat.start({me,room,t:key=>key,toast:message=>toasts.push(message),uploadRow});
  const message=()=>{const e=new Element();e.className='cm';e._message={id:'peer:m',text:'Hello',speak:'en'};e._mine=false;const body=new Element();body.className='cm-b';body.textContent='Hello';e.append(body);element('chatlist').append(e);return e};
  return {context,room,me,requests,toasts,rows,element,message,event(type){handlers.get(type)?.({})},close(){context.WMC.shutdown()}};
}
const response=value=>({ok:true,status:200,json:async()=>value});
const file={name:'image.png',type:'image/png',size:65536,slice:(start,end)=>new Blob([new Uint8Array(Math.min(end,65536)-start)])};
test('failed async chat publication preserves the draft and reports failure',async()=>{
  const h=harness();h.element('chatin').value='My unsent message';h.room.localParticipant.publishData=async()=>{throw new Error('offline')};
  await h.context.testChat.sendText();assert.equal(h.element('chatin').value,'My unsent message');assert.equal(h.element('chatsend').disabled,false);assert.deepEqual(h.toasts,['chat_send_failed']);h.close();
});
test('text translation is opt-in and retains the original in an expandable element',async()=>{
  const h=harness(),el=h.message();h.context.testChat.queueTranslation(el);await flush();assert.equal(h.requests.length,0);
  h.context.testChat.enabled(true);h.context.testChat.queueTranslation(el);await flush();
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].headers['X-Meet-Token'],h.me.ticket);assert.deepEqual(JSON.parse(h.requests[0].body),{text:'Hello',from:'en',to:'de'});
  assert.equal(el.querySelector('.cm-translated').textContent,'Hallo');assert.equal(el.querySelector('.cm-original').querySelector('.cm-b').textContent,'Hello');h.close();
});
test('changing hearing language aborts the old request before showing any result',async()=>{
  const h=harness(),el=h.message();let pending;
  h.context.fetch=(_url,options)=>new Promise((_resolve,reject)=>{pending=options;options.signal.addEventListener('abort',()=>reject(new Error('cancel')))});
  h.context.testChat.enabled(true);h.context.testChat.queueTranslation(el);await flush();assert.ok(pending);
  h.me.hear='en';h.event('wm:languages');await flush();assert.equal(pending.signal.aborted,true);assert.equal(el.querySelector('.cm-translated'),null);assert.equal(el.querySelector('.cm-b').textContent,'Hello');h.close();
});
test('cancelling upload aborts its in-flight chunk and releases its server reservation',async()=>{
  const h=harness();let chunk,publications=0;h.room.localParticipant.publishData=async()=>{publications++};
  h.context.fetch=async(url,options)=>{
    h.requests.push({url,...options});if(url.includes('a=init'))return response({id:'a'.repeat(16),chunk:65536});
    if(url.includes('a=cancel'))return response({ok:true});
    return new Promise((_resolve,reject)=>{chunk=options;options.signal.addEventListener('abort',()=>reject(new Error('cancelled')))});
  };
  const task=h.context.testChat.uploadFile(file);await flush();assert.ok(chunk);h.rows[0].cancel.onclick();await task;
  assert.equal(chunk.signal.aborted,true);assert.ok(h.requests.some(request=>request.url.includes('a=cancel&id='+'a'.repeat(16))));
  assert.equal(h.rows[0].error,'upload_cancelled');assert.equal(publications,0);assert.equal(h.context.testChat.stats().uploads,0);h.close();
});
test('two-upload cap and leave cleanup bound concurrent work',async()=>{
  const h=harness();const pending=[];
  h.context.fetch=(_url,options)=>new Promise((_resolve,reject)=>{pending.push(options);options.signal.addEventListener('abort',()=>reject(new Error('cancelled')))});
  const a=h.context.testChat.uploadFile(file),b=h.context.testChat.uploadFile(file);await h.context.testChat.uploadFile(file);
  assert.deepEqual(h.toasts,['upload_concurrency']);assert.equal(h.context.testChat.stats().uploads,2);
  h.close();await Promise.all([a,b]);assert.ok(pending.every(request=>request.signal.aborted));assert.equal(h.context.testChat.stats().uploads,0);
});
