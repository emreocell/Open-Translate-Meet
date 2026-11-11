(() => {
'use strict';
const $=id=>document.getElementById(id), params=new URLSearchParams(location.search), id=params.get('b')||'';
let token=new URLSearchParams(location.hash.slice(1)).get('m')||'';
try { if(token)sessionStorage.setItem('atm-booking-'+id,token); else token=sessionStorage.getItem('atm-booking-'+id)||''; } catch(e){}
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
const api='../../api/book-manage.php?b='+encodeURIComponent(id);
const localeCodes=['tr','en','de','fr','es','it','nl','pt','pl','ru','ar','ja'];
let language='en', catalog={}, record=null, slots=[], chosen=0, day='', busy=false, refreshVersion=0;
const t=(key,vars={})=>{let value=catalog[key]||key;for(const [k,v] of Object.entries(vars))value=value.replaceAll('{'+k+'}',String(v));return value;};
const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
const format=(at,opts)=>new Intl.DateTimeFormat(language,{...opts,timeZone:timezone}).format(new Date(at*1000));
const dayKey=at=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:timezone}).format(new Date(at*1000));
async function call(action,body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
 try{const response=await fetch(api+(action?'&action='+action:''),{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',signal:controller.signal,
  headers:{'X-Booking-Token':token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'network');return result;
 }finally{clearTimeout(timer);}
}
function error(error){const map={unauthorized:'b_manage_invalid',slot_taken:'b_taken',slot_past:'b_taken',calendar_sync_pending:'b_sync_pending',booking_sync_pending:'b_sync_pending',calendar_changed:'b_calendar_changed',calendar_binding_required:'b_calendar_changed',calendar_unavailable:'b_load_err',rate:'b_rate'};$('manage-error').textContent=t(map[error.message]||'b_manage_error');}
function render(){
 const key={pending:'b_pending',approved:'b_confirmed',rejected:'b_rejected',cancelled:'b_cancelled',expired:'b_expired',approving:'b_sync_pending',cancelling:'b_sync_pending',rescheduling:'b_sync_pending'}[record.status]||'b_status';
 $('manage-state').textContent=t(key);$('manage-detail').hidden=false;$('manage-name').textContent=record.name;
 $('manage-time').textContent=format(record.slot,{dateStyle:'full',timeStyle:'short'})+' · '+timezone;
 $('manage-notifications').textContent=record.notifications&&record.notifications.visitor?'':t('b_mail_pending');
 $('manage-media').textContent=record.mediaClosePending?t('b_media_pending'):'';
 $('manage-join').hidden=!record.link;if(record.link){const url=new URL(record.link,location.href);if(url.origin===location.origin)$('manage-join').href=url.href;else $('manage-join').hidden=true;}
 $('manage-cancel').hidden=!['pending','approved','approving','rescheduling','cancelling'].includes(record.status);
 $('manage-schedule').hidden=!['pending','approved','rescheduling'].includes(record.status);
 $('manage-timezone').textContent=t('b_tz',{tz:timezone});
 if(record.status==='rescheduling'&&record.pendingSlot){chosen=record.pendingSlot;day=dayKey(chosen);$('manage-save').disabled=busy;$('manage-save').textContent=t('b_save');}
}
async function refresh(){const version=++refreshVersion;const next=await call('');if(version!==refreshVersion)return;record=next;render();if(!$('manage-schedule').hidden)await loadSlots(version);}
async function loadSlots(version){const data=await call('slots');if(version!==refreshVersion)return;slots=Array.isArray(data.slots)?data.slots:[];
 if(record.status==='rescheduling'&&record.pendingSlot&&!slots.includes(record.pendingSlot))slots.push(record.pendingSlot);
 slots.sort((a,b)=>a-b);if(chosen&&!slots.includes(chosen))chosen=0;
 if(!slots.some(at=>dayKey(at)===day))day=slots.length?dayKey(slots[0]):'';renderSlots();$('manage-save').disabled=busy||!chosen;
}
function renderSlots(){
 const days=$('manage-days'),times=$('manage-times');days.replaceChildren();times.replaceChildren();const seen=new Set();
 for(const at of slots){const key=dayKey(at);if(!seen.has(key)){seen.add(key);const b=document.createElement('button');b.type='button';b.className='gh';b.textContent=format(at,{weekday:'short',month:'short',day:'numeric'});b.setAttribute('aria-pressed',String(key===day));b.onclick=()=>{day=key;renderSlots();};days.appendChild(b);}
  if(key===day){const b=document.createElement('button');b.type='button';b.className='gh';b.disabled=busy;b.textContent=format(at,{hour:'2-digit',minute:'2-digit',timeZoneName:'shortOffset'});b.setAttribute('aria-pressed',String(chosen===at));b.onclick=()=>{if(busy)return;chosen=at;$('manage-save').disabled=false;renderSlots();};times.appendChild(b);}
 }
 if(!slots.length)times.textContent=t('b_no_slots');
}
async function mutate(action){
 if(busy)return;if(action==='cancel'&&!confirm(t('b_confirm_cancel')))return;if(action==='reschedule'&&!chosen)return;
 busy=true;++refreshVersion;$('manage-error').textContent='';for(const id of ['manage-save','manage-cancel','manage-refresh'])$(id).disabled=true;renderSlots();
 try{await call('',{action,...(action==='reschedule'?{slot:chosen}:{})});chosen=0;day='';await refresh();}catch(e){error(e);try{await refresh();}catch(ignore){}}
 finally{busy=false;$('manage-cancel').disabled=false;$('manage-refresh').disabled=false;$('manage-save').disabled=!chosen;renderSlots();}
}
$('manage-cancel').onclick=()=>mutate('cancel');$('manage-save').onclick=()=>mutate('reschedule');
$('manage-refresh').onclick=()=>{if(!busy){$('manage-error').textContent='';refresh().catch(error);}};
$('manage-copy').onclick=async()=>{try{await navigator.clipboard.writeText(location.origin+location.pathname+'?b='+encodeURIComponent(id)+'#m='+token);$('manage-copy').textContent=t('b_copied');}catch(e){error(e);}};
(async()=>{
 const config=await window.MeetConfigReady;let saved='';try{saved=localStorage.getItem('wm-lang')||'';}catch(e){}
 language=localeCodes.includes(saved)?saved:(localeCodes.includes((navigator.language||'').slice(0,2))?navigator.language.slice(0,2):config.app.defaultLocale);
 const fallback={b_manage:'Manage your meeting',b_manage_help:'Use this private link to check, cancel or reschedule your request. Keep it to yourself.',b_manage_invalid:'The management link is invalid or expired.',b_pending:'Request received',b_confirmed:'Meeting confirmed',b_rejected:'Request declined',b_cancelled:'Meeting cancelled',b_expired:'Request expired',b_status:'Status',b_join:'Join meeting',b_cancel:'Cancel meeting',b_reschedule:'Reschedule',b_refresh:'Refresh',b_save:'Save new time',b_copy:'Copy private link',b_copied:'Copied',b_confirm_cancel:'Cancel this meeting? This revokes its meeting link.',b_manage_error:'The operation could not be completed. Please try again.',b_taken:'That time is no longer available. Please choose another time.',b_rate:'Too many attempts. Please wait and try again.',b_pick_day:'Select a day',b_pick_time:'Select a time',b_tz:'Times are shown in the {tz} time zone.',b_no_slots:'No available times. Please check back later.',b_load_err:'Available times could not be loaded. Please try again.',b_sync_pending:'Calendar synchronization is pending. Retry the operation before choosing another time.',b_mail_pending:'Saved, but email delivery is incomplete. Save your private management link and check here for updates.',b_calendar_changed:'The calendar connection needs organizer review. Please contact the meeting organizer.',b_media_pending:'The meeting link is closed. Disconnecting existing media sessions is still pending.'};
 const load=async code=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);try{const response=await fetch('../../assets/i18n/book/'+code+'.json?v=3',{signal:controller.signal});if(!response.ok)throw new Error('locale');return await response.json();}catch(e){return {};}finally{clearTimeout(timer);}};
 const [english,selected]=await Promise.all([load('en'),language==='en'?Promise.resolve({}):load(language)]);
 catalog={...fallback,...english,...selected};document.documentElement.lang=language;document.documentElement.dir=language==='ar'?'rtl':'ltr';
 document.title=t('b_manage')+' · '+config.app.name;document.querySelectorAll('[data-b]').forEach(el=>el.textContent=t(el.dataset.b));
 $('manage-days').setAttribute('aria-label',t('b_pick_day'));$('manage-times').setAttribute('aria-label',t('b_pick_time'));
 if(!/^[a-f0-9]{12}$/.test(id)||!token)throw new Error('unauthorized');await refresh();
})().catch(error);
})();
