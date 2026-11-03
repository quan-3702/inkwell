// Inkwell – private diary. Offline: entries stay on this PC, nothing is uploaded.
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function fmtSize(b) { if (b < 1024) return b + ' B'; const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1); return (b >= 100 ? b.toFixed(0) : b >= 10 ? b.toFixed(1) : b.toFixed(2)) + ' ' + u[i]; }
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

// ---------- storage ----------
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => { const r = indexedDB.open('inkwell', 1); r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('kv'); d.createObjectStore('entries', { keyPath: 'id' }); d.createObjectStore('photos', { keyPath: 'id' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return dbp;
}
async function dbGet(k) { const d = await db(); return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function dbSet(k, v) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }

// ---------- Pro (Microsoft Store add-on via Digital Goods API) + one-time trial ----------
const STORE_BILLING = 'https://store.microsoft.com/billing';
const PRO_SKU = 'inkwell_pro';
const PRO_IDS = [PRO_SKU];
let STORE_URL = 'https://apps.microsoft.com/detail/9MWPS9LMSNGH';
let proAvailable = false, proSku = PRO_SKU, isPro = false;
proAvailable = true; // owner's rule: Pro is never free – free limits apply everywhere (website, Store, offline) until Pro is bought
// the cached Pro flag is never trusted on the website (nothing can be bought there) and in the Store app only for 30 days
// after the Store last confirmed the purchase (offline buyers stay Pro; after that the Store is asked again)
const HAS_STORE = typeof window !== 'undefined' && 'getDigitalGoodsService' in window;
const PRO_OK_MS = 30 * 864e5;
function cachedPro() {
  try {
    if (!HAS_STORE || localStorage.getItem('inkwell-pro') !== '1') return false;
    const raw = localStorage.getItem('inkwell-pro-ok');
    if (raw == null) { localStorage.setItem('inkwell-pro-ok', String(Date.now())); return true; } // a buyer from before this check counts as confirmed now, once
    const ok = Number(raw);
    return ok > 0 && ok <= Date.now() + 864e5 && Date.now() - ok < PRO_OK_MS;
  } catch (_) { return false; }
}
function rememberPro(owned) { try { if (owned) { localStorage.setItem('inkwell-pro', '1'); localStorage.setItem('inkwell-pro-ok', String(Date.now())); } else { localStorage.removeItem('inkwell-pro'); localStorage.removeItem('inkwell-pro-ok'); } } catch (_) {} }
isPro = cachedPro();
const TRIAL_DAYS = 7;
let trialStart = 0;
// a trial start in the future, NaN or garbage counts as an ENDED trial (1 = long ago); missing = never started
const trialVal = (v) => { if (v == null) return 0; const n = Number(v); return n > 0 && n <= Date.now() ? n : 1; };
try { trialStart = trialVal(localStorage.getItem('inkwell-trial')); } catch (_) {}
const trialLeft = () => (trialStart ? Math.max(0, Math.ceil((trialStart + TRIAL_DAYS * DAY - Date.now()) / DAY)) : 0);
const trialActive = () => trialLeft() > 0;
const unlocked = () => isPro || !proAvailable || trialActive();
const FREE_DOCS = 1;
async function loadTrial() {
  const t = await dbGet('trial').catch(() => undefined);
  trialStart = Math.max(trialStart, trialVal(t)); // clearing only one of the two stores does not restart the trial
  if (trialStart) { try { localStorage.setItem('inkwell-trial', String(trialStart)); } catch (_) {} dbSet('trial', trialStart).catch(() => {}); }
}
async function startTrial() {
  if (trialStart) return;
  trialStart = Date.now();
  try { localStorage.setItem('inkwell-trial', String(trialStart)); } catch (_) {}
  await dbSet('trial', trialStart).catch(() => {});
  setPro(isPro); $('proDialog').close(); toast(`★ Every Pro feature is unlocked for ${TRIAL_DAYS} days. Happy writing!`);
}
function proLabel() { return isPro ? '★ Pro' : trialActive() ? `★ Pro trial · ${trialLeft()} day${trialLeft() === 1 ? '' : 's'} left` : '★ Get Pro'; }
async function billing() {
  if (!('getDigitalGoodsService' in window)) return null;
  try { return await window.getDigitalGoodsService(STORE_BILLING); } catch (_) { return null; }
}
function setPro(v) {
  isPro = v;
  const b = $('proBtn');
  b.textContent = proLabel();
  b.classList.toggle('is-pro', v || trialActive());
  b.hidden = !proAvailable && !v;
  if (booted) render();
}
async function checkProAfterBuy() {
  for (let i = 0; i < 6; i++) {
    if (await checkPro()) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  proMessage('Thank you! If Pro is not unlocked within a minute, click “Restore purchase”.');
  return false;
}
async function checkPro() {
  const svc = await billing();
  if (!svc) return false;
  try {
    const details = await svc.getDetails(PRO_IDS).catch(() => []);
    if (details[0]) { proSku = details[0].itemId; if (!PRO_IDS.includes(proSku)) PRO_IDS.push(proSku); }
    const list = await svc.listPurchases();
    const owned = list.some((p) => PRO_IDS.includes(p.itemId));
    if (owned || details.length) { rememberPro(owned); setPro(owned); return owned; }
    setPro(isPro); // Store did not answer (offline): keep what we knew
    return isPro;
  } catch (_) { return isPro; }
}
function proMessage(text) { const m = $('proMsg'); m.hidden = !text; m.textContent = text || ''; }
async function openPro(reason) {
  if (!reason && !isPro && trialStart && !trialActive()) reason = 'Your free Pro trial has ended. Every entry stays yours – unlock Pro to keep using the Pro tools.';
  proMessage(reason || '');
  $('trialBtn').hidden = isPro || !!trialStart;
  $('trialInfo').hidden = !trialActive() || isPro; $('trialInfo').textContent = trialActive() ? `You are trying Pro: ${trialLeft()} day${trialLeft() === 1 ? '' : 's'} left.` : '';
  const svc = await billing();
  if (!svc) { $('buyBtn').textContent = 'Get Inkwell on Microsoft Store'; $('restoreBtn').hidden = true; }
  else {
    $('restoreBtn').hidden = false;
    try {
      const [d] = await svc.getDetails([proSku]);
      if (!d) proMessage((reason ? reason + ' ' : '') + 'Pro is being added to the Microsoft Store and will be on sale very soon – please check again in a day or two.');
      const price = d && d.price ? new Intl.NumberFormat(undefined, { style: 'currency', currency: d.price.currency }).format(Number(d.price.value)) : '';
      $('buyBtn').textContent = price ? `Unlock Pro – ${price}` : 'Unlock Pro';
    } catch (_) { $('buyBtn').textContent = 'Unlock Pro'; }
  }
  if (!$('proDialog').open) $('proDialog').showModal();
}
async function buyPro() {
  const svc = await billing();
  if (!svc) { window.open(STORE_URL, '_blank'); return; }
  const methods = [{ supportedMethods: STORE_BILLING, data: { sku: proSku } }];
  try {
    let req;
    try { req = new PaymentRequest(methods); } catch (_) { req = new PaymentRequest(methods, { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } }); }
    const res = await req.show();
    await res.complete('success');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    proMessage('Purchase could not be completed: ' + (e.message || e));
    return;
  }
  if (await checkProAfterBuy()) { proMessage('Thank you! Pro is unlocked. ★'); setTimeout(() => $('proDialog').close(), 1500); }
}
const needsPro = (why) => { if (unlocked()) return false; openPro(why); return true; };
// journals beyond the free one (from the trial) can be read, exported, backed up or deleted; writing in them needs Pro
const journalNeedsPro = () => !unlocked() && journals.findIndex((j) => j.id === curJ) >= FREE_DOCS && needsPro('The free version keeps one journal. You can read, export, back up or delete this one – Pro lets you keep writing in every journal.');

// ---------- generic IndexedDB helpers ----------
async function storeAll(name) { const d = await db(); return new Promise((res, rej) => { const q = d.transaction(name).objectStore(name).getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); }
async function storeGet(name, k) { const d = await db(); return new Promise((res, rej) => { const q = d.transaction(name).objectStore(name).get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function storePut(name, v) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(name, 'readwrite'); t.objectStore(name).put(v); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
async function storeDel(name, k) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(name, 'readwrite'); t.objectStore(name).delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
async function storeClear(name) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(name, 'readwrite'); t.objectStore(name).clear(); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }

// ---------- helpers ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pdate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const longDate = (s) => pdate(s).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const monthName = (d) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const MOODS = [null, { e: '😞', n: 'Awful', c: '#6b7280' }, { e: '😕', n: 'Bad', c: '#60a5fa' }, { e: '😐', n: 'Okay', c: '#fbbf24' }, { e: '🙂', n: 'Good', c: '#34d399' }, { e: '😄', n: 'Great', c: '#16a34a' }];
const words = (s) => (String(s || '').match(/[\p{L}\p{N}’']+/gu) || []).length;
const tagsOf = (e) => [...new Set(((e.title || '') + ' ' + (e.body || '')).match(/(^|\s)#([\p{L}\p{N}_-]{1,40})/gu) || [])].map((t) => t.trim().slice(1).toLowerCase()).filter((v, i, a) => a.indexOf(v) === i);
const plain = (s) => String(s || '').replace(/^#{1,3}\s+/gm, '').replace(/^>\s?/gm, '').replace(/^[-*]\s+/gm, '• ').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/\s+/g, ' ').trim();
const sortKey = (e) => e.date + ' ' + (e.time || '00:00');
function toast(t, ms = 2600) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), ms); }
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

function inline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
    .replace(/(^|\s)#([\p{L}\p{N}_-]{1,40})/gu, '$1<span class="tag-in">#$2</span>');
}
function md(src) {
  const lines = String(src || '').split('\n'); let out = '', list = null, para = [];
  const flushP = () => { if (para.length) { out += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
  const closeL = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, '');
    let m;
    if (!l.trim()) { flushP(); closeL(); continue; }
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { flushP(); closeL(); out += `<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`; continue; }
    if ((m = l.match(/^>\s?(.*)$/))) { flushP(); closeL(); out += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
    if ((m = l.match(/^\s*[-*•]\s+(.*)$/))) { flushP(); if (list !== 'ul') { closeL(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (list !== 'ol') { closeL(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; continue; }
    closeL(); para.push(l);
  }
  flushP(); closeL();
  return out;
}

// ---------- state ----------
let booted = false;
let journals = [];
let curJ = '';
let entries = [];
let view = 'timeline', editId = null, readMode = false;
let filterTag = '', filterMood = 0, search = '';
let calMonth = new Date(); calMonth.setDate(1);
let calSel = '';
let otdDate = todayStr();
let shown = 60;
const purl = new Map();
const jEntries = () => entries.filter((e) => e.j === curJ);
const byId = (id) => entries.find((e) => e.id === id);

async function photoURL(id) {
  if (purl.has(id)) return purl.get(id);
  const p = await storeGet('photos', id).catch(() => null);
  const u = p && p.blob ? URL.createObjectURL(p.blob) : '';
  purl.set(id, u);
  return u;
}
function hydrate(root) {
  return Promise.all([...(root || document).querySelectorAll('img[data-ph]')].map(async (img) => {
    const u = await photoURL(img.dataset.ph);
    if (u) { img.src = u; if (!img.complete) await new Promise((r) => { img.onload = img.onerror = r; }); } else img.closest('.ph-wrap')?.remove();
  }));
}

// ---------- journals ----------
async function loadAll() {
  journals = (await dbGet('journals').catch(() => null)) || [];
  if (!journals.length) { journals = [{ id: 'j1', name: 'My diary' }]; await dbSet('journals', journals); }
  try { curJ = localStorage.getItem('inkwell-j') || ''; } catch (_) {}
  if (!journals.some((j) => j.id === curJ)) curJ = journals[0].id;
  entries = await storeAll('entries').catch(() => []);
}
function setJournal(id) { curJ = id; try { localStorage.setItem('inkwell-j', id); } catch (_) {} filterTag = ''; filterMood = 0; if (view === 'edit') view = 'timeline'; render(); }
function renderJournals() {
  $('journalPick').innerHTML = journals.map((j) => `<option value="${esc(j.id)}"${j.id === curJ ? ' selected' : ''}>📓 ${esc(j.name)}</option>`).join('');
  $('journalPick').hidden = journals.length < 2 && !unlocked();
  $('delJournalBtn').hidden = journals.length < 2;
}
async function newJournal() {
  if (needsPro('Keep several journals – personal, travel, dreams, gratitude – with Inkwell Pro.')) return;
  const name = (prompt('Name of the new journal', 'Travel journal') || '').trim();
  if (!name) return;
  const j = { id: 'j' + uid(), name: name.slice(0, 60) };
  journals.push(j); await dbSet('journals', journals); setJournal(j.id); toast(`📓 “${j.name}” created`);
}
async function renameJournal() {
  const j = journals.find((x) => x.id === curJ); if (!j) return;
  const name = (prompt('Rename this journal', j.name) || '').trim();
  if (!name) return;
  j.name = name.slice(0, 60); await dbSet('journals', journals); render();
}
async function deleteJournal() {
  const j = journals.find((x) => x.id === curJ); if (!j || journals.length < 2) return;
  const list = jEntries();
  if (!confirm(`Delete the journal “${j.name}” and its ${list.length} entr${list.length === 1 ? 'y' : 'ies'}? This cannot be undone.`)) return;
  for (const e of list) await removeEntry(e, true);
  journals = journals.filter((x) => x.id !== j.id); await dbSet('journals', journals);
  setJournal(journals[0].id); toast('Journal deleted');
}

// ---------- entries ----------
function newEntry(date) {
  if (journalNeedsPro()) return null;
  const e = { id: uid(), j: curJ, date: date || todayStr(), time: nowTime(), title: '', body: '', mood: 0, fav: false, photos: [], created: Date.now(), updated: Date.now() };
  entries.push(e);
  openEntry(e.id, false);
  return e;
}
let saveT = null;
function saveSoon(e) { e.updated = Date.now(); e.tags = tagsOf(e); clearTimeout(saveT); const s = $('edSaved'); if (s) s.textContent = 'Saving…'; saveT = setTimeout(() => saveEntry(e), 500); }
async function saveEntry(e) {
  clearTimeout(saveT);
  e.tags = tagsOf(e);
  await storePut('entries', e).catch(() => toast('Could not save – is the disk full?'));
  const s = $('edSaved'); if (s) s.textContent = '✓ Saved';
}
const isEmpty = (e) => !e.title.trim() && !e.body.trim() && !e.photos.length && !e.mood;
async function removeEntry(e, quiet) {
  for (const p of e.photos) { await storeDel('photos', p).catch(() => {}); if (purl.get(p)) URL.revokeObjectURL(purl.get(p)); purl.delete(p); }
  await storeDel('entries', e.id).catch(() => {});
  entries = entries.filter((x) => x !== e);
  if (!quiet) toast('Entry deleted');
}
async function leaveEditor() {
  const e = byId(editId);
  if (e) { if (isEmpty(e)) await removeEntry(e, true); else await saveEntry(e); }
  editId = null;
}
async function go(v) {
  if (view === 'edit') await leaveEditor();
  view = v; render(); $('mainCol').scrollTop = 0;
}
async function openEntry(id, read) {
  if (view === 'edit' && editId && editId !== id) await leaveEditor();
  editId = id; view = 'edit'; readMode = !!read; render(); $('mainCol').scrollTop = 0;
}

// ---------- side ----------
function streakInfo(list) {
  const days = new Set(list.map((e) => e.date));
  let cur = 0; const d = new Date();
  if (!days.has(dstr(d))) d.setDate(d.getDate() - 1);
  while (days.has(dstr(d))) { cur++; d.setDate(d.getDate() - 1); }
  const sorted = [...days].sort(); let best = 0, run = 0, prev = null;
  for (const s of sorted) { const t = pdate(s).getTime(); run = prev != null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = t; }
  return { cur, best, days: days.size, today: days.has(todayStr()) };
}
function renderSide() {
  const list = jEntries();
  const st = streakInfo(list);
  $('streak').innerHTML = list.length ? `<b>🔥 ${st.cur} day${st.cur === 1 ? '' : 's'}</b> writing streak<br><span class="muted">${list.length} entr${list.length === 1 ? 'y' : 'ies'} · ${st.today ? 'written today ✓' : 'nothing yet today'}</span>` : '<span class="muted">Write a few lines every day to build a streak.</span>';
  const tc = {};
  for (const e of list) for (const t of e.tags || tagsOf(e)) tc[t] = (tc[t] || 0) + 1;
  const tags = Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 30);
  $('tagList').innerHTML = tags.length ? tags.map(([t, n]) => `<button class="chip${filterTag === t ? ' on' : ''}" data-tag="${esc(t)}">#${esc(t)} <i>${n}</i></button>`).join('') : '<span class="hint">Type #tags in an entry – like #family or #work – to group them.</span>';
  const mc = [0, 0, 0, 0, 0, 0]; for (const e of list) mc[e.mood || 0]++;
  $('moodList').innerHTML = [5, 4, 3, 2, 1].map((m) => `<button class="chip${filterMood === m ? ' on' : ''}" data-mood="${m}" title="${MOODS[m].n}">${MOODS[m].e} <i>${mc[m]}</i></button>`).join('');
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === view));
  $('lockBtn').hidden = !pinCfg;
}

// ---------- main ----------
function render() {
  applyTheme(); renderJournals(); renderSide();
  const p = $('proBtn'); p.textContent = proLabel(); p.classList.toggle('is-pro', isPro || trialActive()); p.hidden = !proAvailable && !isPro;
  const m = $('mainCol');
  if (view === 'edit' && byId(editId)) return renderEditor(m);
  if (view === 'edit') view = 'timeline';
  if (view === 'calendar') return renderCalendar(m);
  if (view === 'onthisday') return renderOTD(m);
  if (view === 'photos') return renderPhotos(m);
  if (view === 'stats') return renderStats(m);
  renderTimeline(m);
}
const dailyPrompt = () => { const d = new Date(); const doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / DAY); return PROMPTS[(doy * 7) % PROMPTS.length]; };
function card(e) {
  const t = e.title.trim() || plain(e.body).split(/[.!?\n]/)[0].slice(0, 70) || 'Untitled';
  const ex = plain(e.body).slice(0, 220);
  const d = pdate(e.date);
  const m = MOODS[e.mood];
  return `<article class="card paper" data-open="${esc(e.id)}">
    <div class="cdate"><b>${d.getDate()}</b><span>${d.toLocaleDateString(undefined, { weekday: 'short' })}</span></div>
    <div class="cbody"><h3>${e.fav ? '<span class="star">★</span> ' : ''}${esc(t)}</h3><p>${esc(ex)}</p>
      <div class="cmeta">${m ? `<span title="${m.n}">${m.e}</span>` : ''}<span>${esc(e.time || '')}</span>${(e.tags || []).slice(0, 4).map((x) => `<span class="tg">#${esc(x)}</span>`).join('')}${e.photos.length ? `<span>📷 ${e.photos.length}</span>` : ''}<span>${words(e.body)} word${words(e.body) === 1 ? '' : 's'}</span></div></div>
    ${e.photos[0] ? `<div class="ph-wrap cthumb"><img data-ph="${esc(e.photos[0])}" alt=""></div>` : ''}
  </article>`;
}
function renderTimeline(m) {
  let list = jEntries();
  const q = search.trim().toLowerCase();
  if (q) list = list.filter((e) => (e.title + ' ' + e.body + ' ' + (e.tags || []).join(' ')).toLowerCase().includes(q));
  if (filterTag) list = list.filter((e) => (e.tags || []).includes(filterTag));
  if (filterMood) list = list.filter((e) => e.mood === filterMood);
  list.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const all = jEntries().length;
  let h = '';
  const chips = [q && `🔍 “${esc(search)}”`, filterTag && `#${esc(filterTag)}`, filterMood && `${MOODS[filterMood].e} ${MOODS[filterMood].n}`].filter(Boolean);
  if (chips.length) h += `<div class="filters">Showing ${list.length} entr${list.length === 1 ? 'y' : 'ies'} for ${chips.join(' + ')} <button class="ghost sm" id="clearF">✕ Clear</button></div>`;
  if (!all) {
    h += `<div class="welcome paper"><div class="wel-ic">🖋️</div><h1>Your private diary</h1>
      <p>Write a few lines every day – how you feel, what happened, what you are grateful for. Everything stays on this PC: no account, no cloud, no ads.</p>
      <div class="row-btns center"><button class="primary big-inline" data-act="new">✍️ Write your first entry</button><button class="ghost" data-act="ideas">💡 Give me an idea</button></div>
      <div class="today-prompt"><span>Today’s prompt</span><b>${esc(dailyPrompt())}</b></div>
      <p class="hint">Tip: set a PIN in ☰ More → PIN lock so nobody else can open your diary.</p></div>`;
  } else if (!chips.length) {
    h += `<div class="prompt-bar paper"><div><span>Today’s prompt</span><b>${esc(dailyPrompt())}</b></div><button class="primary" data-act="answer">Write about it</button></div>`;
  }
  let lastM = '';
  for (const e of list.slice(0, shown)) {
    const mk = e.date.slice(0, 7);
    if (mk !== lastM) { lastM = mk; h += `<h2 class="month">${monthName(pdate(e.date))}</h2>`; }
    h += card(e);
  }
  if (list.length > shown) h += `<button class="ghost wide" id="moreBtn2">Show more (${list.length - shown})</button>`;
  if (all && !list.length) h += '<p class="empty">No entries match.</p>';
  m.innerHTML = h;
  hydrate(m);
}

// ---------- editor ----------
function renderEditor(m) {
  const e = byId(editId);
  m.innerHTML = `<div class="ed paper">
    <div class="ed-top">
      <button id="edBack" class="ghost">← All entries</button>
      <input type="date" id="edDate" value="${esc(e.date)}" title="Date">
      <input type="time" id="edTime" value="${esc(e.time || '')}" title="Time">
      <span class="grow"></span><span id="edSaved" class="muted"></span>
      <button id="edFav" class="ghost${e.fav ? ' on' : ''}" title="Favourite">${e.fav ? '★' : '☆'}</button>
      <button id="edRead" class="ghost">${readMode ? '✎ Edit' : '👁 Read'}</button>
      <button id="edDel" class="ghost danger" title="Delete entry">🗑</button>
    </div>
    <div class="ed-date">${esc(longDate(e.date))}</div>
    <div class="moods" id="edMoods"><span class="muted">How do you feel?</span>${[1, 2, 3, 4, 5].map((i) => `<button data-m="${i}" class="${e.mood === i ? 'on' : ''}" title="${MOODS[i].n}">${MOODS[i].e}<small>${MOODS[i].n}</small></button>`).join('')}</div>
    <div id="edWrite"${readMode ? ' hidden' : ''}>
      <input id="edTitle" class="ed-title" placeholder="Title (optional)" value="${esc(e.title)}" maxlength="140">
      <div class="ed-tools">
        <button data-f="b" title="Bold (Ctrl+B)"><b>B</b></button><button data-f="i" title="Italic (Ctrl+I)"><i>I</i></button><button data-f="h" title="Heading">H</button><button data-f="ul" title="List">• List</button><button data-f="q" title="Quote">❝</button>
        <span class="sep"></span><button id="edIdeas">💡 Writing ideas</button><button id="edPhoto">📷 Add photo</button>
      </div>
      <textarea id="edBody" placeholder="Dear diary…" spellcheck="true">${esc(e.body)}</textarea>
    </div>
    <div id="edRender" class="rendered"${readMode ? '' : ' hidden'}>${e.title ? `<h2>${esc(e.title)}</h2>` : ''}${md(e.body) || '<p class="muted">Nothing written yet.</p>'}</div>
    <div class="ed-photos" id="edPhotos">${e.photos.map((p) => `<div class="ph-wrap"><img data-ph="${esc(p)}" alt="" data-big="${esc(p)}"><button class="ph-x" data-rm="${esc(p)}" title="Remove photo">✕</button></div>`).join('')}</div>
    <div class="ed-foot"><span id="edCount">${words(e.body)} words</span><span class="muted">Add #tags anywhere in the text · saved automatically</span></div>
  </div>`;
  hydrate(m);
  const ta = $('edBody');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight + 4, 320) + 'px'; };
  if (!readMode) { grow(); if (!e.body && !e.title) setTimeout(() => ta.focus(), 30); }
  ta.addEventListener('input', () => { e.body = ta.value; $('edCount').textContent = words(e.body) + ' words'; grow(); saveSoon(e); });
  ta.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && (ev.key === 'b' || ev.key === 'i')) { ev.preventDefault(); fmt(ev.key); }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      const s = ta.selectionStart; const ls = ta.value.lastIndexOf('\n', s - 1) + 1; const line = ta.value.slice(ls, s);
      const mm = line.match(/^(\s*(?:[-*•]|\d+[.)])\s+)(.*)$/);
      if (mm) {
        ev.preventDefault();
        if (!mm[2]) { ta.setRangeText('', ls, s, 'end'); }
        else { let pre = mm[1]; const n = pre.match(/(\d+)/); if (n) pre = pre.replace(n[1], String(Number(n[1]) + 1)); ta.setRangeText('\n' + pre, s, ta.selectionEnd, 'end'); }
        ta.dispatchEvent(new Event('input'));
      }
    }
  });
  $('edTitle').addEventListener('input', (ev) => { e.title = ev.target.value; saveSoon(e); });
  $('edDate').addEventListener('change', (ev) => { if (journalNeedsPro()) { ev.target.value = e.date; return; } if (ev.target.value) { e.date = ev.target.value; saveSoon(e); m.querySelector('.ed-date').textContent = longDate(e.date); renderSide(); } });
  $('edTime').addEventListener('change', (ev) => { if (journalNeedsPro()) { ev.target.value = e.time || ''; return; } e.time = ev.target.value; saveSoon(e); });
  $('edFav').onclick = () => { if (journalNeedsPro()) return; e.fav = !e.fav; saveSoon(e); const b = $('edFav'); b.textContent = e.fav ? '★' : '☆'; b.classList.toggle('on', e.fav); };
  $('edRead').onclick = () => { if (readMode && journalNeedsPro()) return; readMode = !readMode; saveEntry(e); renderEditor(m); };
  $('edBack').onclick = () => go('timeline');
  $('edDel').onclick = async () => { if (isEmpty(e) || confirm('Delete this entry? This cannot be undone.')) { await removeEntry(e); editId = null; view = 'timeline'; render(); } };
  $('edMoods').onclick = (ev) => { const b = ev.target.closest('[data-m]'); if (!b || journalNeedsPro()) return; const v = Number(b.dataset.m); e.mood = e.mood === v ? 0 : v; saveSoon(e); m.querySelectorAll('#edMoods [data-m]').forEach((x) => x.classList.toggle('on', Number(x.dataset.m) === e.mood)); renderSide(); };
  m.querySelector('.ed-tools').onclick = (ev) => { const b = ev.target.closest('[data-f]'); if (b) fmt(b.dataset.f); };
  $('edIdeas').onclick = () => openPrompts('prompts');
  $('edPhoto').onclick = () => addPhotos(e);
  $('edPhotos').onclick = async (ev) => {
    const rm = ev.target.closest('[data-rm]');
    if (rm) { if (!confirm('Remove this photo from the entry?')) return; const id = rm.dataset.rm; e.photos = e.photos.filter((x) => x !== id); await storeDel('photos', id).catch(() => {}); saveSoon(e); renderEditor(m); return; }
    const im = ev.target.closest('[data-big]'); if (im) showPhoto(im.dataset.big, e.id);
  };
}
function fmt(f) {
  const ta = $('edBody'); if (!ta) return;
  const s = ta.selectionStart, en = ta.selectionEnd, sel = ta.value.slice(s, en);
  if (f === 'b' || f === 'i') { const w = f === 'b' ? '**' : '*'; ta.setRangeText(w + (sel || (f === 'b' ? 'bold' : 'italic')) + w, s, en, sel ? 'end' : 'select'); if (!sel) { ta.selectionStart = s + w.length; ta.selectionEnd = ta.selectionStart + (f === 'b' ? 4 : 6); } }
  else {
    const pre = { h: '## ', ul: '- ', q: '> ' }[f];
    const ls = ta.value.lastIndexOf('\n', s - 1) + 1;
    const block = ta.value.slice(ls, en);
    ta.setRangeText(block.split('\n').map((l) => (l.startsWith(pre) ? l.slice(pre.length) : pre + l)).join('\n'), ls, en, 'end');
  }
  ta.focus(); ta.dispatchEvent(new Event('input'));
}
function insertText(t) {
  const ta = $('edBody'); if (!ta) return;
  const s = ta.selectionStart;
  const before = ta.value.slice(0, s);
  const glue = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  ta.setRangeText(glue + t, s, ta.selectionEnd, 'end');
  ta.focus(); ta.dispatchEvent(new Event('input'));
}

// ---------- photos ----------
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.86));
}
function addPhotos(e) {
  if (journalNeedsPro()) return;
  if (!unlocked() && e.photos.length >= 1) { needsPro('The free version keeps 1 photo per entry. Inkwell Pro adds as many photos as you like.'); return; }
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = unlocked();
  inp.onchange = async () => {
    let files = [...inp.files];
    if (!unlocked()) files = files.slice(0, 1);
    for (const f of files) {
      try { const blob = await shrink(f); const id = 'p' + uid(); await storePut('photos', { id, entry: e.id, blob }); e.photos.push(id); }
      catch (_) { toast(`Could not read ${f.name} – is it a photo?`); }
    }
    await saveEntry(e); if (view === 'edit') renderEditor($('mainCol'));
  };
  inp.click();
}
let photoEntry = '';
async function showPhoto(id, entryId) { photoEntry = entryId; $('photoBig').src = await photoURL(id); $('photoOpen').hidden = view === 'edit' && editId === entryId; $('photoDlg').showModal(); }
function renderPhotos(m) {
  const list = jEntries().filter((e) => e.photos.length).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const n = list.reduce((s, e) => s + e.photos.length, 0);
  m.innerHTML = `<h1 class="vh">🖼 Photos <span class="muted">${n}</span></h1>` + (n ? `<div class="pgrid">${list.map((e) => e.photos.map((p) => `<figure class="ph-wrap" data-big="${esc(p)}" data-e="${esc(e.id)}"><img data-ph="${esc(p)}" alt=""><figcaption>${esc(pdate(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}</figcaption></figure>`).join('')).join('')}</div>` : '<p class="empty">Add photos to your entries with 📷 Add photo – they all show up here.</p>');
  hydrate(m);
}

// ---------- calendar ----------
function renderCalendar(m) {
  const y = calMonth.getFullYear(), mo = calMonth.getMonth();
  const first = new Date(y, mo, 1), days = new Date(y, mo + 1, 0).getDate();
  const by = {}; for (const e of jEntries()) (by[e.date] = by[e.date] || []).push(e);
  const wk = [...Array(7)].map((_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }));
  let h = `<div class="cal-head"><button class="ghost" data-cal="-1">‹</button><h1>${monthName(first)}</h1><button class="ghost" data-cal="1">›</button><button class="ghost sm" data-cal="0">Today</button></div><div class="cal">${wk.map((w) => `<div class="cw">${w}</div>`).join('')}`;
  for (let i = 0; i < first.getDay(); i++) h += '<div></div>';
  const t = todayStr();
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${pad(mo + 1)}-${pad(d)}`; const es = by[ds] || [];
    const mood = es.map((e) => e.mood).filter(Boolean);
    const avg = mood.length ? Math.round(mood.reduce((a, b) => a + b, 0) / mood.length) : 0;
    h += `<button class="cd${es.length ? ' has' : ''}${ds === t ? ' today' : ''}${ds === calSel ? ' sel' : ''}" data-day="${ds}" ${avg ? `style="--mc:${MOODS[avg].c}"` : ''}><span>${d}</span>${es.length ? `<em>${avg ? MOODS[avg].e : '✎'}</em>${es.length > 1 ? `<i>${es.length}</i>` : ''}` : ''}</button>`;
  }
  h += '</div>';
  const monthList = Object.keys(by).filter((k) => k.startsWith(`${y}-${pad(mo + 1)}`));
  h += `<p class="hint">${monthList.length} day${monthList.length === 1 ? '' : 's'} written this month. Click a day to read it or write for that day.</p>`;
  if (calSel) {
    const es = (by[calSel] || []).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    h += `<h2 class="month">${esc(longDate(calSel))}</h2>${es.map(card).join('')}<button class="ghost" data-act="newOn">＋ Write for this day</button>`;
  }
  m.innerHTML = h; hydrate(m);
}

// ---------- on this day (Pro) ----------
function teaser(m, title, text, icon) {
  m.innerHTML = `<div class="welcome paper"><div class="wel-ic">${icon}</div><h1>${title}</h1><p>${text}</p><div class="row-btns center"><button class="primary" data-act="pro">★ ${trialStart ? 'Unlock Pro' : 'Try Pro free for 7 days'}</button></div></div>`;
}
function renderOTD(m) {
  if (!unlocked()) return teaser(m, 'On this day', 'See what you wrote on this day one, two or five years ago – and how far you have come. Part of Inkwell Pro.', '🕰');
  const md5 = otdDate.slice(5);
  const yNow = Number(otdDate.slice(0, 4));
  const list = jEntries().filter((e) => e.date.slice(5) === md5 && Number(e.date.slice(0, 4)) < yNow).sort((a, b) => b.date.localeCompare(a.date));
  const near = [7, 30, 182].map((n) => { const d = pdate(otdDate); d.setDate(d.getDate() - n); return { n, ds: dstr(d) }; });
  let h = `<div class="cal-head"><h1>🕰 On this day</h1><input type="date" id="otdIn" value="${otdDate}"></div>`;
  if (list.length) {
    let ly = '';
    for (const e of list) { const yrs = yNow - Number(e.date.slice(0, 4)); if (e.date.slice(0, 4) !== ly) { ly = e.date.slice(0, 4); h += `<h2 class="month">${yrs} year${yrs === 1 ? '' : 's'} ago · ${ly}</h2>`; } h += card(e); }
  } else h += `<p class="empty">Nothing written on ${esc(pdate(otdDate).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }))} in earlier years – yet. Keep writing and this page fills up.</p>`;
  for (const { n, ds } of near) {
    const es = jEntries().filter((e) => e.date === ds);
    if (es.length) { h += `<h2 class="month">${n === 7 ? 'A week ago' : n === 30 ? 'A month ago' : 'Six months ago'}</h2>${es.map(card).join('')}`; }
  }
  m.innerHTML = h; hydrate(m);
  $('otdIn').onchange = (ev) => { if (ev.target.value) { otdDate = ev.target.value; render(); } };
}

// ---------- insights (Pro) ----------
function renderStats(m) {
  if (!unlocked()) return teaser(m, 'Insights', 'Writing streaks, a mood chart, your year in pixels and your most-used tags – see your patterns at a glance. Part of Inkwell Pro.', '📊');
  const list = jEntries();
  const st = streakInfo(list);
  const totalW = list.reduce((s, e) => s + words(e.body), 0);
  const yr = Number(($('statYear') && $('statYear').value) || new Date().getFullYear());
  const years = [...new Set(list.map((e) => Number(e.date.slice(0, 4))).concat(new Date().getFullYear()))].sort((a, b) => b - a);
  const dayMood = {};
  for (const e of list) if (e.date.startsWith(yr + '-')) { const a = dayMood[e.date] || (dayMood[e.date] = []); a.push(e.mood || 0); }
  let pix = '<div class="pixels"><div></div>' + [...Array(31)].map((_, i) => `<b>${i % 5 === 0 ? i + 1 : ''}</b>`).join('');
  for (let mo = 0; mo < 12; mo++) {
    pix += `<b class="pm">${new Date(yr, mo, 1).toLocaleDateString(undefined, { month: 'short' })}</b>`;
    const dim = new Date(yr, mo + 1, 0).getDate();
    for (let d = 1; d <= 31; d++) {
      if (d > dim) { pix += '<i class="no"></i>'; continue; }
      const ds = `${yr}-${pad(mo + 1)}-${pad(d)}`; const a = dayMood[ds];
      const ms = a ? a.filter(Boolean) : [];
      const avg = ms.length ? Math.round(ms.reduce((x, y) => x + y, 0) / ms.length) : 0;
      pix += `<i title="${ds}${avg ? ' · ' + MOODS[avg].n : a ? ' · written' : ''}" ${a ? `data-day="${ds}"` : ''} style="${avg ? `background:${MOODS[avg].c}` : a ? 'background:var(--accent-soft)' : ''}"></i>`;
    }
  }
  pix += '</div>';
  const mc = [0, 0, 0, 0, 0, 0]; for (const e of list) mc[e.mood || 0]++;
  const mt = Math.max(1, ...mc.slice(1));
  const moodBars = [5, 4, 3, 2, 1].map((i) => `<div class="bar"><span>${MOODS[i].e} ${MOODS[i].n}</span><div><i style="width:${(mc[i] / mt) * 100}%;background:${MOODS[i].c}"></i></div><b>${mc[i]}</b></div>`).join('');
  const months = []; const d0 = new Date(); d0.setDate(1);
  for (let i = 11; i >= 0; i--) { const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1); const k = dstr(d).slice(0, 7); const es = list.filter((e) => e.date.startsWith(k)); const ms = es.map((e) => e.mood).filter(Boolean); months.push({ l: d.toLocaleDateString(undefined, { month: 'short' }), n: es.length, avg: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0 }); }
  const mx = Math.max(1, ...months.map((x) => x.n));
  const monthBars = `<div class="cols">${months.map((x) => `<div class="col" title="${x.n} entries${x.avg ? ' · average mood ' + x.avg.toFixed(1) : ''}"><i style="height:${(x.n / mx) * 100}%;background:${x.avg ? MOODS[Math.round(x.avg)].c : 'var(--accent)'}"></i><span>${x.l}</span></div>`).join('')}</div>`;
  const tc = {}; for (const e of list) for (const t of e.tags || []) tc[t] = (tc[t] || 0) + 1;
  const tops = Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const wd = [0, 0, 0, 0, 0, 0, 0]; for (const e of list) wd[pdate(e.date).getDay()]++;
  const bestWd = list.length ? new Date(2023, 0, 1 + wd.indexOf(Math.max(...wd))).toLocaleDateString(undefined, { weekday: 'long' }) : '–';
  m.innerHTML = `<div class="cal-head"><h1>📊 Insights</h1></div>
    <div class="kpis"><div><b>${list.length}</b><span>entries</span></div><div><b>${totalW.toLocaleString()}</b><span>words</span></div><div><b>🔥 ${st.cur}</b><span>current streak</span></div><div><b>${st.best}</b><span>longest streak</span></div><div><b>${st.days}</b><span>days written</span></div><div><b>${esc(bestWd)}</b><span>favourite day to write</span></div></div>
    <section class="panel"><div class="ph"><h2>Year in pixels</h2><select id="statYear">${years.map((y) => `<option${y === yr ? ' selected' : ''}>${y}</option>`).join('')}</select></div>${pix}<p class="hint">Each square is a day, coloured by your mood. Click a square to read that day.</p></section>
    <div class="two-panels"><section class="panel"><h2>Moods</h2>${moodBars}</section><section class="panel"><h2>Entries per month</h2>${monthBars}</section></div>
    <section class="panel"><h2>Top tags</h2><div class="tags">${tops.length ? tops.map(([t, n]) => `<button class="chip" data-tag="${esc(t)}">#${esc(t)} <i>${n}</i></button>`).join('') : '<span class="hint">No #tags yet.</span>'}</div></section>`;
  $('statYear').onchange = () => renderStats(m);
}

// ---------- prompts & templates ----------
let ptab = 'prompts';
function openPrompts(tab) { ptab = tab || 'prompts'; fillPrompts(); if (!$('promptDlg').open) $('promptDlg').showModal(); }
function fillPrompts() {
  document.querySelectorAll('.ptabs button').forEach((b) => b.classList.toggle('on', b.dataset.p === ptab));
  $('promptShuffle').hidden = ptab !== 'prompts';
  if (ptab === 'prompts') {
    const pick = [...PROMPTS].sort(() => Math.random() - 0.5).slice(0, 8);
    $('promptBody').innerHTML = pick.map((p) => `<button data-prompt="${esc(p)}">💡 ${esc(p)}</button>`).join('');
  } else {
    $('promptBody').innerHTML = (unlocked() ? '' : '<p class="pro-msg">Templates are part of Inkwell Pro – try them free for 7 days.</p>') + TEMPLATES.map((t, i) => `<button data-tpl="${i}">${esc(t.name)}</button>`).join('');
  }
}
async function usePrompt(text, isTpl) {
  $('promptDlg').close();
  if (view === 'edit' && byId(editId) && journalNeedsPro()) return;
  if ((view !== 'edit' || !byId(editId)) && !newEntry()) return;
  if (readMode) { readMode = false; renderEditor($('mainCol')); }
  insertText(isTpl ? text : `> ${text}\n\n`);
}

// ---------- PIN lock ----------
let pinCfg = null, locked = false, typed = '', fails = 0, waitUntil = 0, lastAct = Date.now(), hiddenAt = 0;
try { const w = JSON.parse(localStorage.getItem('inkwell-pinwait') || '{}'); fails = Number(w.fails) || 0; waitUntil = Math.min(Number(w.until) || 0, Date.now() + 30000); } catch (_) {} // reloading must not reset the wrong-PIN wait
const keepPinWait = () => { try { if (fails || waitUntil > Date.now()) localStorage.setItem('inkwell-pinwait', JSON.stringify({ fails, until: waitUntil })); else localStorage.removeItem('inkwell-pinwait'); } catch (_) {} };
async function hashPin(pin, salt) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function lockNow() {
  if (!pinCfg || locked) return;
  if (view === 'edit') { const e = byId(editId); if (e) saveEntry(e); }
  locked = true; typed = ''; document.body.classList.add('locked'); $('lock').hidden = false; $('lockMsg').textContent = 'Enter your PIN'; drawDots();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
}
function drawDots() { const n = Math.max(4, typed.length); $('pinDots').innerHTML = [...Array(n)].map((_, i) => `<i class="${i < typed.length ? 'on' : ''}"></i>`).join(''); }
async function tryPin() {
  if (Date.now() < waitUntil) { typed = ''; drawDots(); $('lockMsg').textContent = `Too many tries – wait ${Math.ceil((waitUntil - Date.now()) / 1000)} s`; return; }
  if (typed.length < 4) return;
  if ((await hashPin(typed, pinCfg.salt)) === pinCfg.hash) {
    locked = false; fails = 0; waitUntil = 0; keepPinWait(); typed = ''; lastAct = Date.now(); $('lock').hidden = true; document.body.classList.remove('locked'); return;
  }
  fails++; typed = ''; drawDots();
  if (fails >= 5) { waitUntil = Date.now() + 30000; fails = 0; $('lockMsg').textContent = 'Too many tries – wait 30 s'; }
  else $('lockMsg').textContent = 'Wrong PIN – try again';
  keepPinWait();
  const b = $('pinDots'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
}
function pinKey(k) {
  if (!locked) return;
  if (k === 'del') typed = typed.slice(0, -1);
  else if (k === 'ok') return tryPin();
  else if (/^\d$/.test(k) && typed.length < 8) typed += k;
  drawDots();
  if (typed.length >= 4 && typed.length === (pinCfg.len || 0)) tryPin();
}
async function savePin() {
  const a = $('pin1').value.trim(), b = $('pin2').value.trim();
  if (!/^\d{4,8}$/.test(a)) { toast('Use 4 to 8 digits'); return; }
  if (a !== b) { toast('The two PINs are different'); return; }
  const salt = uid() + uid();
  pinCfg = { salt, hash: await hashPin(a, salt), len: a.length, idle: Number($('idleSel').value) };
  await dbSet('pin', pinCfg); $('pinDlg').close(); render(); toast('🔒 PIN lock is on');
}
async function pinOff() { if (!confirm('Turn the PIN lock off?')) return; pinCfg = null; await dbSet('pin', null); $('pinDlg').close(); render(); toast('PIN lock is off'); }
function openPinDlg() {
  $('pin1').value = ''; $('pin2').value = '';
  $('pinOff').hidden = !pinCfg;
  $('pinInfo').textContent = pinCfg ? 'The PIN lock is on. Enter a new PIN to change it.' : 'Ask for a PIN when Inkwell opens and after it has been idle.';
  if (pinCfg) $('idleSel').value = String(pinCfg.idle);
  $('menu').hidden = true; $('pinDlg').showModal();
}
async function forgotPin() {
  const a = prompt('Inkwell cannot recover a forgotten PIN – it is never stored, only checked.\n\nTo start over you can ERASE every entry and photo on this PC, then restore a backup if you have one.\n\nType ERASE to delete everything:');
  if ((a || '').trim().toUpperCase() !== 'ERASE') return;
  await storeClear('entries'); await storeClear('photos'); await dbSet('pin', null); await dbSet('journals', null);
  location.reload();
}

// ---------- themes ----------
const PRO_PAPER = ['sepia', 'night'], PRO_FONT = ['hand', 'mono'];
let theme = { paper: 'cream', font: 'serif', size: 18 };
try { Object.assign(theme, JSON.parse(localStorage.getItem('inkwell-theme') || '{}')); } catch (_) {}
function applyTheme() {
  const t = { ...theme };
  if (!unlocked()) { if (PRO_PAPER.includes(t.paper)) t.paper = 'cream'; if (PRO_FONT.includes(t.font)) t.font = 'serif'; }
  document.body.dataset.paper = t.paper; document.body.dataset.font = t.font;
  document.body.style.setProperty('--wsize', t.size + 'px');
}
function setTheme(k, v) {
  if (((k === 'paper' && PRO_PAPER.includes(v)) || (k === 'font' && PRO_FONT.includes(v))) && needsPro('Sepia and night paper, handwriting and typewriter fonts come with Inkwell Pro.')) { $('paperSel').value = theme.paper; $('fontSel').value = theme.font; return; }
  theme[k] = v; try { localStorage.setItem('inkwell-theme', JSON.stringify(theme)); } catch (_) {}
  applyTheme();
}

// ---------- print & export ----------
function openPrint() {
  if (needsPro('Print your journal as a beautiful book or save it as a PDF with Inkwell Pro.')) return;
  const list = jEntries().sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const j = journals.find((x) => x.id === curJ);
  $('bookTitle').value = j ? j.name : 'My diary';
  $('bookFrom').value = list[0] ? list[0].date : todayStr(); $('bookTo').value = list.length ? list[list.length - 1].date : todayStr();
  $('menu').hidden = true; $('printDlg').showModal();
}
async function printBook() {
  if (needsPro('Print your journal as a beautiful book or save it as a PDF with Inkwell Pro.')) { $('printDlg').close(); return; }
  const from = $('bookFrom').value || '0000', to = $('bookTo').value || '9999';
  let list = jEntries().filter((e) => e.date >= from && e.date <= to && !isEmpty(e)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  if ($('bookFavs').checked) list = list.filter((e) => e.fav);
  if (!list.length) { toast('No entries in that range'); return; }
  const ph = $('bookPhotos').checked;
  const fd = (s) => pdate(s).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  let h = `<section class="book-title"><div>🖋️</div><h1>${esc($('bookTitle').value || 'My diary')}</h1><p>${esc(fd(list[0].date))} – ${esc(fd(list[list.length - 1].date))}</p><p class="small">${list.length} entries</p></section>`;
  let lastM = '';
  for (const e of list) {
    const mk = e.date.slice(0, 7);
    if (mk !== lastM) { lastM = mk; h += `<h2 class="book-month">${monthName(pdate(e.date))}</h2>`; }
    h += `<article class="book-entry"><div class="be-date">${esc(longDate(e.date))}${e.time ? ' · ' + esc(e.time) : ''}${e.mood ? ' · ' + MOODS[e.mood].e + ' ' + MOODS[e.mood].n : ''}${e.fav ? ' · ★' : ''}</div>${e.title ? `<h3>${esc(e.title)}</h3>` : ''}${md(e.body)}${ph && e.photos.length ? `<div class="be-photos">${e.photos.map((p) => `<span class="ph-wrap"><img data-ph="${esc(p)}" alt=""></span>`).join('')}</div>` : ''}</article>`;
  }
  const pa = $('printArea'); pa.innerHTML = `<div class="book" data-font="${esc(document.body.dataset.font)}">${h}</div>`;
  $('printDlg').close();
  await hydrate(pa);
  window.print();
}
function txtExport() {
  const list = jEntries().filter((e) => !isEmpty(e)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  if (!list.length) { toast('Nothing to export yet'); return; }
  const j = journals.find((x) => x.id === curJ);
  const out = list.map((e) => [longDate(e.date) + (e.time ? '  ' + e.time : '') + (e.mood ? '  · mood: ' + MOODS[e.mood].n : '') + (e.fav ? '  ★' : ''), e.title ? e.title.toUpperCase() : '', '', e.body.trim(), e.photos.length ? `[${e.photos.length} photo${e.photos.length > 1 ? 's' : ''}]` : ''].filter((x, i) => x || i === 2).join('\n')).join('\n\n' + '–'.repeat(40) + '\n\n');
  download(`${(j ? j.name : 'diary').replace(/[^\p{L}\p{N} _-]+/gu, '')} ${todayStr()}.txt`, new Blob(['﻿' + out], { type: 'text/plain;charset=utf-8' }));
  $('menu').hidden = true; toast('📝 Text file saved to Downloads');
}
function docExport() {
  if (needsPro('Export your journal to Word with Inkwell Pro.')) return;
  const list = jEntries().filter((e) => !isEmpty(e)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  if (!list.length) { toast('Nothing to export yet'); return; }
  const j = journals.find((x) => x.id === curJ);
  const body = list.map((e) => `<p style="color:#5b3fa0;font-size:10pt;margin-bottom:0">${esc(longDate(e.date))}${e.time ? ' · ' + esc(e.time) : ''}${e.mood ? ' · ' + MOODS[e.mood].n : ''}</p>${e.title ? `<h2>${esc(e.title)}</h2>` : ''}${md(e.body)}<hr>`).join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(j ? j.name : 'Diary')}</title><style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.5}h1{color:#5b3fa0}h2{font-size:15pt;margin:4pt 0}blockquote{color:#555;font-style:italic;margin-left:18pt}</style></head><body><h1>${esc(j ? j.name : 'Diary')}</h1>${body}</body></html>`;
  download(`${(j ? j.name : 'diary').replace(/[^\p{L}\p{N} _-]+/gu, '')} ${todayStr()}.doc`, new Blob(['﻿' + html], { type: 'application/msword' }));
  $('menu').hidden = true; toast('📄 Word file saved to Downloads');
}

// ---------- backup ----------
const blobToData = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
async function backup() {
  $('menu').hidden = true; toast('Preparing backup…', 8000);
  const photos = await storeAll('photos').catch(() => []);
  const ph = []; for (const p of photos) ph.push({ id: p.id, entry: p.entry, data: await blobToData(p.blob) });
  const data = { app: 'inkwell', v: 1, saved: new Date().toISOString(), journals, entries, photos: ph };
  download(`Inkwell backup ${todayStr()}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
  await dbSet('lastBackup', Date.now()); toast('💾 Backup saved to Downloads – keep it somewhere safe');
}
async function restore(file) {
  let data; try { data = JSON.parse(await file.text()); } catch (_) { toast('That file is not an Inkwell backup'); return; }
  if (!data || data.app !== 'inkwell' || !Array.isArray(data.entries)) { toast('That file is not an Inkwell backup'); return; }
  if (!unlocked()) {
    const add = (data.journals || []).filter((j) => !journals.some((x) => x.id === String(j.id))).length;
    const tooMany = add > 0 && journals.length + add > FREE_DOCS;
    const many = data.entries.filter((e) => e && Array.isArray(e.photos) && e.photos.length > 1).length;
    if (tooMany || many) {
      openPro(`This backup holds ${tooMany ? `${(data.journals || []).length} journals` : ''}${tooMany && many ? ' and ' : ''}${many ? `${many} entr${many === 1 ? 'y' : 'ies'} with more than one photo` : ''}. The free version keeps one journal and 1 photo per entry – Pro opens all of it. The backup file is unchanged, so nothing is lost.`);
      return;
    }
  }
  if (!confirm(`Restore ${data.entries.length} entries and ${(data.photos || []).length} photos from this backup? Entries you already have are kept; entries with the same ID are replaced by the backup.`)) return;
  for (const j of data.journals || []) if (!journals.some((x) => x.id === j.id)) journals.push({ id: String(j.id), name: String(j.name || 'Journal').slice(0, 60) });
  await dbSet('journals', journals);
  for (const p of data.photos || []) { try { const blob = await (await fetch(p.data)).blob(); await storePut('photos', { id: p.id, entry: p.entry, blob }); purl.delete(p.id); } catch (_) {} }
  for (const e of data.entries) {
    if (!e || !e.id || !e.date) continue;
    const clean = { id: String(e.id), j: journals.some((x) => x.id === e.j) ? e.j : journals[0].id, date: String(e.date).slice(0, 10), time: String(e.time || ''), title: String(e.title || ''), body: String(e.body || ''), mood: Number(e.mood) || 0, fav: !!e.fav, photos: Array.isArray(e.photos) ? e.photos.map(String) : [], created: e.created || Date.now(), updated: e.updated || Date.now() };
    clean.tags = tagsOf(clean);
    await storePut('entries', clean);
  }
  entries = await storeAll('entries'); view = 'timeline'; render(); toast('📂 Backup restored');
}

// ---------- events ----------
function wire() {
  $('newBtn').onclick = async () => { if (view === 'edit') await leaveEditor(); newEntry(); };
  $('nav').onclick = (ev) => { const b = ev.target.closest('[data-v]'); if (b) go(b.dataset.v); };
  $('journalPick').onchange = async (ev) => { if (view === 'edit') await leaveEditor(); setJournal(ev.target.value); };
  $('searchIn').addEventListener('input', (ev) => { search = ev.target.value; shown = 60; if (view !== 'timeline') go('timeline'); else render(); });
  $('moreBtn').onclick = (ev) => { ev.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
  document.addEventListener('click', (ev) => { if (!$('menu').hidden && !ev.target.closest('#menu')) $('menu').hidden = true; });
  $('proBtn').onclick = () => { if (!isPro) openPro(); };
  $('lockBtn').onclick = lockNow;
  $('newJournalBtn').onclick = () => { $('menu').hidden = true; newJournal(); };
  $('renameJournalBtn').onclick = () => { $('menu').hidden = true; renameJournal(); };
  $('delJournalBtn').onclick = () => { $('menu').hidden = true; deleteJournal(); };
  $('printBtn').onclick = openPrint; $('txtBtn').onclick = txtExport; $('docBtn').onclick = docExport;
  $('pinBtn').onclick = openPinDlg; $('pinSave').onclick = savePin; $('pinOff').onclick = pinOff; $('pinCancel').onclick = () => $('pinDlg').close();
  $('themeBtn').onclick = () => { $('menu').hidden = true; $('paperSel').value = theme.paper; $('fontSel').value = theme.font; $('sizeSel').value = String(theme.size); $('themeDlg').showModal(); };
  $('paperSel').onchange = (ev) => setTheme('paper', ev.target.value);
  $('fontSel').onchange = (ev) => setTheme('font', ev.target.value);
  $('sizeSel').onchange = (ev) => setTheme('size', Number(ev.target.value));
  $('themeClose').onclick = () => $('themeDlg').close();
  $('backupBtn').onclick = backup;
  $('restoreBtn2').onclick = () => { $('menu').hidden = true; const f = $('fileIn'); f.accept = '.json,application/json'; f.value = ''; f.click(); };
  $('fileIn').onchange = (ev) => { const f = ev.target.files[0]; if (f) restore(f); };
  $('bookGo').onclick = printBook; $('bookCancel').onclick = () => $('printDlg').close();
  document.querySelector('.ptabs').onclick = (ev) => { const b = ev.target.closest('[data-p]'); if (b) { ptab = b.dataset.p; fillPrompts(); } };
  $('promptShuffle').onclick = fillPrompts; $('promptClose').onclick = () => $('promptDlg').close();
  $('promptBody').onclick = (ev) => {
    const p = ev.target.closest('[data-prompt]'); if (p) return usePrompt(p.dataset.prompt);
    const t = ev.target.closest('[data-tpl]'); if (t) { if (needsPro('Templates – morning pages, gratitude, travel, dream log and more – come with Inkwell Pro.')) { $('promptDlg').close(); return; } usePrompt(TEMPLATES[Number(t.dataset.tpl)].body, true); }
  };
  $('photoClose').onclick = () => $('photoDlg').close();
  $('photoOpen').onclick = () => { $('photoDlg').close(); openEntry(photoEntry, true); };
  $('buyBtn').onclick = buyPro; $('restoreBtn').onclick = async () => { proMessage((await checkPro()) ? 'Pro restored. ★' : 'No Pro purchase found on this Microsoft account.'); };
  $('closePro').onclick = () => $('proDialog').close(); $('trialBtn').onclick = startTrial;
  document.querySelector('.side').addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-tag]'); if (t) { filterTag = filterTag === t.dataset.tag ? '' : t.dataset.tag; shown = 60; go('timeline'); return; }
    const md0 = ev.target.closest('[data-mood]'); if (md0) { const v = Number(md0.dataset.mood); filterMood = filterMood === v ? 0 : v; shown = 60; go('timeline'); }
  });
  $('mainCol').addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-act]');
    if (a) {
      const k = a.dataset.act;
      if (k === 'new') newEntry(); else if (k === 'ideas') openPrompts('prompts'); else if (k === 'answer') usePrompt(dailyPrompt());
      else if (k === 'pro') openPro(); else if (k === 'newOn') newEntry(calSel);
      return;
    }
    if (ev.target.id === 'clearF') { filterTag = ''; filterMood = 0; search = ''; $('searchIn').value = ''; render(); return; }
    if (ev.target.id === 'moreBtn2') { shown += 100; render(); return; }
    const c = ev.target.closest('[data-cal]');
    if (c) { const n = Number(c.dataset.cal); if (n) calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + n, 1); else { calMonth = new Date(); calMonth.setDate(1); calSel = todayStr(); } render(); return; }
    const day = ev.target.closest('[data-day]');
    if (day) { const ds = day.dataset.day; if (view === 'stats') { calSel = ds; calMonth = new Date(pdate(ds).getFullYear(), pdate(ds).getMonth(), 1); go('calendar'); return; } calSel = calSel === ds ? '' : ds; render(); return; }
    const t = ev.target.closest('[data-tag]'); if (t) { filterTag = t.dataset.tag; go('timeline'); return; }
    const big = ev.target.closest('figure[data-big]'); if (big) { showPhoto(big.dataset.big, big.dataset.e); return; }
    const o = ev.target.closest('[data-open]'); if (o) openEntry(o.dataset.open, true);
  });
  // keypad
  $('keypad').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => `<button data-k="${k}"${k === 'ok' ? ' class="primary"' : ''}>${k === 'del' ? '⌫' : k === 'ok' ? '✓' : k}</button>`).join('');
  $('keypad').onclick = (ev) => { const b = ev.target.closest('[data-k]'); if (b) pinKey(b.dataset.k); };
  $('forgotBtn').onclick = forgotPin;
  document.addEventListener('keydown', (ev) => {
    lastAct = Date.now();
    if (locked) { ev.preventDefault(); if (/^\d$/.test(ev.key)) pinKey(ev.key); else if (ev.key === 'Backspace') pinKey('del'); else if (ev.key === 'Enter') pinKey('ok'); return; }
    if (ev.ctrlKey && ev.key.toLowerCase() === 'n' && !ev.shiftKey) { ev.preventDefault(); $('newBtn').click(); }
    if (ev.ctrlKey && ev.key.toLowerCase() === 'l' && pinCfg) { ev.preventDefault(); lockNow(); }
    if (ev.key === 'Escape' && view === 'edit' && !document.querySelector('dialog[open]')) go('timeline');
  }, true);
  ['pointerdown', 'wheel', 'touchstart'].forEach((t) => document.addEventListener(t, () => (lastAct = Date.now()), { passive: true }));
  setInterval(() => { if (pinCfg && pinCfg.idle && !locked && Date.now() - lastAct > pinCfg.idle * 60000) lockNow(); }, 10000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); const e = byId(editId); if (e && view === 'edit') saveEntry(e); }
    else if (pinCfg && pinCfg.idle && hiddenAt && Date.now() - hiddenAt > pinCfg.idle * 60000) lockNow();
  });
  window.addEventListener('beforeunload', () => { const e = byId(editId); if (e && view === 'edit' && !isEmpty(e)) saveEntry(e); });
  window.addEventListener('afterprint', () => { $('printArea').innerHTML = ''; });
}

// ---------- boot ----------
(async function boot() {
  wire();
  pinCfg = (await dbGet('pin').catch(() => null)) || null;
  if (pinCfg) lockNow();
  await loadTrial();
  await loadAll();
  applyTheme();
  booted = true;
  render();
  checkPro().then(() => { applyTheme(); render(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
