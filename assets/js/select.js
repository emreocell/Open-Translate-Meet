/* Auto Translate Meeting - custom select. Replaces a native <select> with a list in our own style; the native element stays in the
   DOM (hidden) as the source of truth, so .value, change events and labels keep working.
   Keyboard: Enter/Space/Arrow opens, arrows move, Home/End, type-ahead, Enter picks, Esc closes. */
(() => {
'use strict';
let current = null;                                   // the one open instance
const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
let uid = 0;

function enhance(sel, opts) {
  if (!sel || sel._cs) return sel && sel._cs;
  opts = opts || {};
  const id = 'cs' + (++uid);
  const wrap = document.createElement('div'); wrap.className = 'cs' + (opts.cls ? ' ' + opts.cls : '');
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'cs-btn';
  btn.setAttribute('role', 'combobox'); btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', id + '-l');
  const val = document.createElement('span'); val.className = 'cs-val';
  const chev = document.createElement('span'); chev.className = 'cs-chev'; chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  btn.append(val, chev);
  const list = document.createElement('div'); list.className = 'cs-list glass'; list.id = id + '-l'; list.setAttribute('role', 'listbox'); list.hidden = true;
  wrap.appendChild(btn);
  sel.classList.add('cs-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  sel.after(wrap);
  const lab = sel.id ? document.querySelector('label[for="' + sel.id + '"]') : null;
  if (lab) { if (!lab.id) lab.id = id + '-lab'; btn.setAttribute('aria-labelledby', lab.id) }
  sel.addEventListener('focus', () => btn.focus());   // a label click lands on the native select: hand it over

  let items = [], active = -1, typed = '', typedT = 0;
  const text = o => o.textContent || o.label || o.value;

  function sync() {
    const o = sel.options[sel.selectedIndex];
    val.textContent = o ? text(o) : '';
    btn.disabled = sel.disabled || !sel.options.length;
    if (!list.hidden) build();
  }
  function build() {
    list.innerHTML = ''; items = [];
    [...sel.options].forEach((o, i) => {
      const it = document.createElement('div'); it.className = 'cs-opt'; it.setAttribute('role', 'option'); it.id = id + '-o' + i;
      it.setAttribute('aria-selected', i === sel.selectedIndex ? 'true' : 'false'); it.dataset.i = i;
      if (o.lang) it.lang = o.lang;
      const s = document.createElement('span'); s.textContent = text(o); it.appendChild(s);
      if (i === sel.selectedIndex) { const c = document.createElement('i'); c.className = 'cs-tick'; c.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>'; it.appendChild(c) }
      it.onmousedown = e => e.preventDefault();                  // keep focus on the button
      it.onclick = () => { pick(i) };
      it.onmousemove = () => setActive(i, false);
      list.appendChild(it); items.push(it);
    });
  }
  function setActive(i, scroll) {
    if (i < 0 || i >= items.length) return;
    if (items[active]) items[active].classList.remove('act');
    active = i; items[i].classList.add('act'); btn.setAttribute('aria-activedescendant', items[i].id);
    if (scroll !== false) items[i].scrollIntoView({ block: 'nearest' });
  }
  function place() {
    const r = btn.getBoundingClientRect(), vh = innerHeight, vw = innerWidth;
    list.style.minWidth = Math.max(r.width, 160) + 'px'; list.style.maxWidth = Math.min(vw - 16, 360) + 'px';
    const h = Math.min(list.scrollHeight, 280), below = vh - r.bottom - 12, above = r.top - 12;
    const up = below < Math.min(h, 200) && above > below;
    list.style.maxHeight = Math.max(120, Math.min(280, up ? above : below)) + 'px';
    list.style.top = up ? '' : (r.bottom + 6) + 'px'; list.style.bottom = up ? (vh - r.top + 6) + 'px' : '';
    const rtl = getComputedStyle(btn).direction === 'rtl';
    const w = list.offsetWidth; let x = rtl ? r.right - w : r.left;
    list.style.left = Math.max(8, Math.min(vw - w - 8, x)) + 'px';
  }
  function open() {
    if (btn.disabled || !list.hidden) return;
    if (current && current !== api) current.close();
    build(); list.hidden = false; document.body.appendChild(list); place();
    btn.setAttribute('aria-expanded', 'true'); wrap.classList.add('open'); current = api;
    setActive(Math.max(0, sel.selectedIndex));
  }
  function close(refocus) {
    if (list.hidden) return;
    list.hidden = true; list.remove(); btn.setAttribute('aria-expanded', 'false'); btn.removeAttribute('aria-activedescendant'); wrap.classList.remove('open');
    if (current === api) current = null; if (refocus) btn.focus();
  }
  function pick(i) {
    const changed = i !== sel.selectedIndex;
    sel.selectedIndex = i; sync(); close(true);
    if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })) }
  }
  btn.onclick = e => { e.stopPropagation(); list.hidden ? open() : close(true) };
  btn.onkeydown = e => {
    const k = e.key, n = items.length;
    if (list.hidden) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(k)) { e.preventDefault(); open() } return }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }
    else if (k === 'Tab') close(false);
    else if (k === 'ArrowDown') { e.preventDefault(); setActive(Math.min(n - 1, active + 1)) }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)) }
    else if (k === 'Home') { e.preventDefault(); setActive(0) }
    else if (k === 'End') { e.preventDefault(); setActive(n - 1) }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); if (active >= 0) pick(active) }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey) {      // type-ahead
      const now = Date.now(); typed = (now - typedT > 700 ? '' : typed) + k.toLowerCase(); typedT = now;
      const hit = [...sel.options].findIndex(o => text(o).toLowerCase().startsWith(typed)); if (hit >= 0) setActive(hit);
    }
  };
  list.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
  list.addEventListener('click', e => e.stopPropagation());     // choosing must not close panels the select lives in
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  Object.defineProperty(sel, 'value', { configurable: true, get() { return proto.get.call(sel) }, set(v) { proto.set.call(sel, v); sync() } });
  const api = { sync, open, close, el: wrap };
  sel._cs = api; sync();
  return api;
}

addEventListener('click', e => { if (current && !current.el.contains(e.target) && !(e.target.closest && e.target.closest('.cs-list'))) current.close() }, true);
addEventListener('resize', () => { if (current) current.close() });
addEventListener('scroll', e => { if (current && !(e.target && e.target.closest && e.target.closest('.cs-list'))) current.close() }, true);
window.WMSelect = { enhance };
})();
