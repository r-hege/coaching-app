'use strict';
/* Coaching-App U14 – eine Datei, kein Build-Schritt.
   Daten: Supabase (Tabelle "items": id, kind, data) mit Login; lokal gecacht für offline. */

const CFG = window.APP_CONFIG || {};
const REMOTE = !!(CFG.supabaseUrl && CFG.supabaseKey);
const VERSION = '1.2';

// ───────────────────────── Hilfsfunktionen ─────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => p + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || '');
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'de');
const cap = (n, s, p) => `${n} ${n === 1 ? s : p}`;

const D = {
  parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
  iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  today() { return D.iso(new Date()); },
  add(s, n) { const d = D.parse(s); d.setDate(d.getDate() + n); return D.iso(d); },
  diff(a, b) { return Math.round((D.parse(b) - D.parse(a)) / 864e5); },
  week(s) {
    const d = D.parse(s), day = (d.getDay() + 6) % 7, mon = new Date(d); mon.setDate(d.getDate() - day);
    const thu = new Date(mon); thu.setDate(mon.getDate() + 3); const y = thu.getFullYear();
    const jan4 = new Date(y, 0, 4), w1 = new Date(jan4); w1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    const wk = 1 + Math.round((mon - w1) / (7 * 864e5));
    return { year: y, week: wk, key: `${y}-W${String(wk).padStart(2, '0')}`, monday: D.iso(mon) };
  },
  fromKey(key) {
    const [y, w] = key.split('-W').map(Number), jan4 = new Date(y, 0, 4), w1 = new Date(jan4);
    w1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7); return D.iso(w1);
  },
  wd(s) { return ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][D.parse(s).getDay()]; },
  short(s) { const d = D.parse(s); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.'; },
  long(s) { return D.wd(s) + ' ' + D.short(s); },
  full(s) { return D.short(s) + D.parse(s).getFullYear(); },
  month(s) { return D.parse(s).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }); },
};
const WD = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

// ───────────────────────── Fachliche Konstanten ─────────────────────────
// Spielphasen: interne Schlüssel bleiben (Daten), angezeigt werden die Kürzel s
const GP = {
  EBB: { s: 'B+', l: 'Eigener Ballbesitz', c: '#2563eb' },
  GBB: { s: 'B−', l: 'Gegnerischer Ballbesitz', c: '#dc2626' },
  UBG: { s: 'U+', l: 'Umschalten nach Ballgewinn', c: '#16a34a' },
  UBV: { s: 'U−', l: 'Umschalten nach Ballverlust', c: '#ea580c' },
  STD: { s: 'S', l: 'Standards', c: '#7c3aed' },
  ATH: { s: 'ATH', l: 'Athletik', c: '#0891b2' },
  FREI: { s: 'frei', l: 'Trainingsfrei', c: '#94a3b8' },
};
const GP5 = ['EBB', 'GBB', 'UBG', 'UBV', 'STD'];
const gpS = k => GP[k]?.s || k;
const TIERS = [
  { k: 'top', l: 'Top Tier', s: 'Top', c: '#1e40af', bg: '#dbe4ff' }, { k: 'good', l: 'Gut', s: 'Gut', c: '#15803d', bg: '#dcf3e3' },
  { k: 'okay', l: 'Okay', s: 'Okay', c: '#ca8a04', bg: '#fdf1cf' }, { k: 'q', l: '?', s: '?', c: '#d2544a', bg: '#fbe1de' },
  { k: '', l: 'Ohne Einstufung', s: 'Ohne', c: '#a3a1b1', bg: '#eceaf2' }];
const TIER_RANK = ['top', 'good', 'okay', 'q'];
const tierOf = k => TIERS.find(t => t.k === (k || '')) || TIERS[TIERS.length - 1];
// Stärke auf einer Position: Stammposition = eigene Einstufung, „kommt in Frage“ = eine Stufe tiefer
function effTier(p, posKey) {
  const lv = (p.posv || {})[posKey]; const r = TIER_RANK.indexOf(p.tier || '');
  if (!lv || r < 0) return null;
  const e = r + (lv === 2 ? 1 : 0);
  return e < TIER_RANK.length ? { rank: e, tier: TIER_RANK[e], lv } : { rank: 9, tier: null, lv };
}
const POSV = [
  { k: 'TW', l: 'TW', f: 'Torwart', g: 'Tor' },
  { k: 'LIV', l: 'LIV', f: 'Linker Innenverteidiger', g: 'Abwehr' }, { k: 'ZIV', l: 'ZIV', f: 'Zentraler Innenverteidiger', g: 'Abwehr' },
  { k: 'RIV', l: 'RIV', f: 'Rechter Innenverteidiger', g: 'Abwehr' },
  { k: 'LV', l: 'LV', f: 'Linksverteidiger (Viererkette)', g: 'Abwehr' }, { k: 'RV', l: 'RV', f: 'Rechtsverteidiger (Viererkette)', g: 'Abwehr' },
  { k: 'LS', l: 'LAV', f: 'Linker Außenverteidiger', g: 'Abwehr' }, { k: 'RS', l: 'RAV', f: 'Rechter Außenverteidiger', g: 'Abwehr' },
  { k: 'SECHS', l: '6', f: 'Defensives Mittelfeld (6)', g: 'Mittelfeld' }, { k: 'ACHT', l: '8', f: 'Zentrales Mittelfeld (8)', g: 'Mittelfeld' },
  { k: 'ZEHN', l: '10', f: 'Offensives Mittelfeld (10)', g: 'Mittelfeld' },
  { k: 'LF', l: 'LF', f: 'Linker Flügel', g: 'Angriff' }, { k: 'RF', l: 'RF', f: 'Rechter Flügel', g: 'Angriff' },
  { k: 'ACHTFUENF', l: '8,5', f: 'Hängende Spitze (8,5)', g: 'Angriff' }, { k: 'NEUN', l: '9', f: 'Spitze (9)', g: 'Angriff' }];
const posvOf = k => POSV.find(p => p.k === k);
const POSVLV = { 1: 'Stamm', 2: 'in Frage' };
const GROUPS = ['TW', 'Abwehr', 'Mittelfeld', 'Sturm'];
const GROUPL = { TW: 'Torwart', Abwehr: 'Abwehr', Mittelfeld: 'Mittelfeld', Sturm: 'Sturm' };
// Feld-Anordnung (6er-Raster): [Position, Spalte von, Spalte bis]
const PITCH = [
  [['LF', 1, 3], ['NEUN', 3, 5], ['RF', 5, 7]],
  [['ACHTFUENF', 2, 4], ['ZEHN', 4, 6]],
  [['LS', 1, 3], ['ACHT', 3, 5], ['RS', 5, 7]],
  [['LV', 1, 3], ['SECHS', 3, 5], ['RV', 5, 7]],
  [['LIV', 1, 3], ['ZIV', 3, 5], ['RIV', 5, 7]],
  [['TW', 3, 5]]];
// Einmalige Umstellung: alte grobe Positionen (TW, VZ, VA, MZ, MA, AZ, AA) + alter Positionsplan → 15 Positionen
function migratePositions() {
  const lu = (Store.data('lineup:main') || {}).slots || {};
  const SLOTMAP = { TW: 'TW', RAV: 'RV', LAV: 'LV', RIV: 'RIV', ZIV: 'ZIV', LIV: 'LIV', RFV: 'RS', LFV: 'LS', DM: 'SECHS', ZM: 'ACHT', ZEHN: 'ZEHN', ACHT: 'ACHTFUENF', MS: 'NEUN', RF: 'RF', LF: 'LF' };
  const FAM = {
    TW: { 1: { TW: 1 }, x: { TW: 2 } },
    VZ: { 1: { LIV: 1, ZIV: 1, RIV: 1 }, x: { LIV: 2, ZIV: 2, RIV: 2 } },
    VA: { 1: { LV: 1, RV: 1, LS: 2, RS: 2 }, x: { LV: 2, RV: 2 } },
    MZ: { 1: { SECHS: 1, ACHT: 1, ZEHN: 2 }, x: { SECHS: 2, ACHT: 2 } },
    MA: { 1: { LS: 2, RS: 2, LF: 2, RF: 2 }, x: { LF: 2, RF: 2 } },
    AZ: { 1: { NEUN: 1, ZEHN: 2 }, x: { NEUN: 2 } },
    AA: { 1: { LF: 1, RF: 1 }, x: { LF: 2, RF: 2 } } };
  let n = 0;
  for (const p of Store.all('player')) {
    if (p.posv) continue;
    const pv = {}, set = (k, l) => { if (!pv[k] || l < pv[k]) pv[k] = l; };
    for (const [fam, lvl] of Object.entries(p.pos || {})) { const m = FAM[fam]; if (m) for (const [k, l] of Object.entries(lvl === 1 ? m[1] : m.x)) set(k, l); }
    for (const [slot, ids] of Object.entries(lu)) { const i = (ids || []).indexOf(p.id); if (i >= 0 && SLOTMAP[slot]) set(SLOTMAP[slot], i < 2 ? 1 : 2); }
    Store.put(p.id, 'player', { ...Store.data(p.id), posv: pv }, true); n++;
  }
  if (n) Store.flushSoon();
}
const MAKRO = { HR: 'Hinrunde', RR: 'Rückrunde' };
const PHC = { vorb: '#0284c7', wettk: '#15803d', nachb: '#9333ea' };
const LEVELS = [
  { k: 'NLZ', l: 'NLZ' }, { k: 'Regio', l: 'Regionalliga' }, { k: 'VL', l: 'Verbandsliga' },
  { k: 'BZL', l: 'Bezirksliga' }, { k: 'SDL', l: 'Sonderliga' }, { k: '', l: 'Ohne Niveau' }];
const GTYPES = ['Liga', 'Test', 'Turnier', 'Leistungsvergleich', 'Sonstiges'];
const LVL3 = ['niedrig', 'mittel', 'hoch'];
const FITL = { 3: 'Ideal', 2: 'Gut', 1: 'Möglich', 0: '–' };

const IC = {
  heute: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
  saison: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7.5 14h3M13.5 14h3M7.5 17.5h3"/>',
  spiele: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5l4 2.9-1.5 4.6h-5L8 10.4z"/><path d="M12 7.5V3.2M16 10.4l4.2-1.3M14.5 15l2.6 3.6M9.5 15l-2.6 3.6M8 10.4 3.8 9.1"/>',
  kader: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.6 3.2-5.6 6.5-5.6s6 2 6.5 5.6"/><circle cx="17.2" cy="9" r="2.6"/><path d="M16.6 14.6c2.6.2 4.4 2 4.9 4.9"/>',
  training: '<path d="M12 3.5 17.8 19H6.2z"/><path d="M8.3 13.5h7.4M9.9 9h4.2M3 21h18"/>',
  tests: '<path d="M4 20V5a1 1 0 0 1 1.4-.9L12 7l6.6-2.9A1 1 0 0 1 20 5v9.5l-8 3.5-8-3.5"/><path d="M12 7v11"/>',
  mehr: '<circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  chat: '<path d="M4 20l1.4-4A8 8 0 1 1 8 18.6z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.6 3.2-5.6 6.5-5.6s6 2 6.5 5.6"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
};
const crestBtn = on => `<button class="crest ${on ? 'on' : ''}" data-a="open" data-h="#/mehr" aria-label="Mehr: Kontakte, Material, Scouting, Einstellungen"><img src="icons/wappen.png" alt="FC Hennef 05"></button>`;
const icon = (n, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}">${IC[n] || ''}</svg>`;

// ───────────────────────── Datenspeicher ─────────────────────────
const Store = {
  items: new Map(), pending: {}, user: null, sb: null, syncing: false, error: '',
  key() { return 'ca_cache_' + (this.user?.id || 'local'); },
  all(kind) { const o = []; for (const it of this.items.values()) if (it.kind === kind) o.push({ id: it.id, ...it.data }); return o; },
  get(id) { const it = this.items.get(id); return it ? { id, ...it.data } : null; },
  data(id) { return this.items.get(id)?.data; },
  put(id, kind, data, quiet) {
    const clean = { ...data }; delete clean.id;
    this.items.set(id, { id, kind, data: clean });
    this.pending[id] = { op: 'up', kind, data: clean };
    this.persist(); if (!quiet) this.flushSoon();
  },
  patch(id, kind, part) { this.put(id, kind, { ...(this.items.get(id)?.data || {}), ...part }); },
  remove(id) { this.items.delete(id); this.pending[id] = { op: 'del' }; this.persist(); this.flushSoon(); },
  persist() {
    try {
      localStorage.setItem(this.key(), JSON.stringify([...this.items.values()]));
      localStorage.setItem(this.key() + '_p', JSON.stringify(this.pending));
    } catch (e) { console.warn(e); }
  },
  restore() {
    try {
      this.items = new Map(JSON.parse(localStorage.getItem(this.key()) || '[]').map(x => [x.id, x]));
      this.pending = JSON.parse(localStorage.getItem(this.key() + '_p') || '{}');
    } catch (e) { this.items = new Map(); this.pending = {}; }
  },
  async fetchAll() {
    if (!REMOTE) return;
    let from = 0, rows = [];
    for (;;) {
      const { data, error } = await this.sb.from('items').select('id,kind,data').range(from, from + 999);
      if (error) throw error;
      rows = rows.concat(data); if (data.length < 1000) break; from += 1000;
    }
    const m = new Map(rows.map(r => [r.id, { id: r.id, kind: r.kind, data: r.data }]));
    for (const [id, p] of Object.entries(this.pending)) { if (p.op === 'del') m.delete(id); else m.set(id, { id, kind: p.kind, data: p.data }); }
    this.items = m; this.persist();
  },
  flushSoon() { clearTimeout(this._t); this._t = setTimeout(() => this.flush(), 350); },
  async flush() {
    if (!REMOTE) { this.pending = {}; this.persist(); return; }
    if (this.syncing || !this.user) return;
    const snap = { ...this.pending }, ids = Object.keys(snap);
    if (!ids.length) return;
    this.syncing = true; Sync.show();
    try {
      const ups = [], dels = [];
      for (const id of ids) {
        const p = snap[id];
        if (p.op === 'del') dels.push(id);
        else ups.push({ user_id: this.user.id, id, kind: p.kind, data: p.data, updated_at: new Date().toISOString() });
      }
      for (let i = 0; i < ups.length; i += 400) {
        const { error } = await this.sb.from('items').upsert(ups.slice(i, i + 400), { onConflict: 'user_id,id' });
        if (error) throw error;
      }
      for (let i = 0; i < dels.length; i += 150) {
        const { error } = await this.sb.from('items').delete().in('id', dels.slice(i, i + 150));
        if (error) throw error;
      }
      for (const id of ids) if (this.pending[id] === snap[id]) delete this.pending[id];
      this.error = ''; this.persist();
    } catch (e) { this.error = e.message || String(e); console.warn('sync', e); }
    this.syncing = false; Sync.show();
    if (!this.error && Object.keys(this.pending).length) this.flushSoon();
  },
};
const Sync = {
  show() {
    const el = $('#sync'); if (!el) return;
    const n = Object.keys(Store.pending).length;
    el.className = !REMOTE ? 'local' : Store.syncing ? 'busy' : Store.error ? 'err' : n ? 'busy' : '';
    el.title = !REMOTE ? 'Lokaler Testmodus' : Store.error ? 'Offline – Änderungen werden später gespeichert' : n ? 'Speichert…' : 'Gespeichert';
  },
};
const setting = () => Store.data('setting:main') || { trainingDays: [2, 4, 5], squadMax: 17, dresscode: {}, exPlayers: 16 };

// ───────────────────────── UI-Grundgerüst ─────────────────────────
const UI = { ex: { n: null, diff: '', int: '', ph: '', q: '', sort: 'fit' }, ath: { cat: '', q: '' }, kader: { grp: '', q: '' },
  games: { when: 'next', type: '' }, tests: { lvls: new Set(), st: '', q: '' }, contacts: { q: '' }, scout: { prio: '', q: '' }, topics: { ph: '' }, mat: 'need' };

const TABS = [
  { k: 'heute', l: 'Heute' }, { k: 'saison', l: 'Saison' }, { k: 'spiele', l: 'Spiele' }, { k: 'kader', l: 'Kader' },
  { k: 'training', l: 'Training' }, { k: 'tests', l: 'Testspiele' }];

function route() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const parts = h.split('/').filter(Boolean);
  return { tab: VIEWS[parts[0]] ? parts[0] : 'heute', parts: parts.slice(1) };
}
const go = h => { location.hash = h; };
let LAST = {}; try { LAST = JSON.parse(localStorage.getItem('ca_last') || '{}'); } catch (_) { }

let lastHash = null;
function render() {
  const r = route(), sameRoute = lastHash === location.hash, y = window.scrollY;
  lastHash = location.hash;
  $('#tabs').innerHTML = TABS.map(t => `<button data-a="tab" data-k="${t.k}" class="${t.k === r.tab ? 'on' : ''}">${icon(t.k)}<span>${t.l}</span></button>`).join('');
  let out;
  try { out = (VIEWS[r.tab] || VIEWS.heute)(r.parts); }
  catch (e) { console.error(e); out = { title: 'Fehler', html: `<div class="card">Da ist etwas schiefgelaufen: ${esc(e.message)}</div>` }; }
  $('#title').textContent = out.title || 'Coaching';
  $('#back').hidden = !out.back;
  $('#topActions').innerHTML = (out.actions || '') + crestBtn(r.tab === 'mehr');
  const main = !out.back;
  if (main && TABS.some(t => t.k === r.tab)) { LAST[r.tab] = location.hash || '#/' + r.tab; try { localStorage.setItem('ca_last', JSON.stringify(LAST)); } catch (_) { } }
  $('#view').innerHTML = out.html + (main ? `<button class="fab" data-a="quick" data-ctx="${out.fab || ''}" aria-label="Schnell hinzufügen">${icon('plus')}</button>`
    : out.fab ? `<button class="fab" data-a="${out.fab}" aria-label="Neu">${icon('plus')}</button>` : '');
  window.scrollTo(0, sameRoute ? y : 0);
  Sync.show();
}

function renderResults() {
  const r = route(), tmp = document.createElement('div');
  tmp.innerHTML = (VIEWS[r.tab] || VIEWS.heute)(r.parts).html;
  const nr = $('#results', tmp), cr = $('#results');
  if (nr && cr) cr.replaceWith(nr); else render();
}
const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800); };
const check = (on, label, attrs, sub = '') =>
  `<label class="check ${on ? 'on' : ''}"><input type="checkbox" ${on ? 'checked' : ''} ${attrs}><span class="box"></span><span class="ct">${esc(label)}${sub ? `<small>${sub}</small>` : ''}</span></label>`;
const badge = (txt, color) => `<span class="badge ${color ? 'c' : ''}" style="${color ? `background:${color}` : ''}">${esc(txt)}</span>`;
const sec = (title, right = '') => `<div class="sec"><span class="grow">${esc(title)}</span>${right}</div>`;
const chips = (items, cur, action, extra = '') => `<div class="chips ${extra}">${items.map(([v, l]) => `<button class="chip ${String(cur) === String(v) ? 'on' : ''}" data-a="${action}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;

// ───────────────────────── Bottom-Sheet & Formulare ─────────────────────────
const Sheet = {
  pushed: false, onClose: null,
  open(title, body, foot = '', mount) {
    const el = $('#sheet'), prevBody = $('.sheet-body', el), keep = !el.hidden && prevBody && $('.sheet-head h2', el)?.textContent === title ? prevBody.scrollTop : 0;
    el.innerHTML = `<div class="sheet-bg" data-a="sheetClose"></div><div class="sheet-panel" role="dialog">
      <div class="sheet-head"><button class="link" data-a="sheetClose">Schließen</button><h2>${esc(title)}</h2><span class="sp"></span></div>
      <div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}</div>`;
    if (el.hidden) { el.hidden = false; document.body.classList.add('noscroll'); history.pushState({ sheet: 1 }, ''); this.pushed = true; }
    if (keep) $('.sheet-body', el).scrollTop = keep;
    mount && mount(el);
  },
  close() {
    return new Promise(res => {
      if ($('#sheet').hidden) return res();
      if (this.pushed) { this._res = res; this.pushed = false; history.back(); } else { this._hide(); res(); }
    });
  },
  _hide() { const el = $('#sheet'); el.hidden = true; el.innerHTML = ''; document.body.classList.remove('noscroll'); const r = this._res; this._res = null; r && r(); },
};
window.addEventListener('popstate', () => { if (!$('#sheet').hidden) { Sheet.pushed = false; Sheet._hide(); } });

let FORM = null;
function field(f, v) {
  const val = v[f.k] ?? f.def ?? '';
  const id = 'f_' + f.k;
  const lab = f.l ? `<label for="${id}">${esc(f.l)}</label>` : '';
  const hint = f.hint ? `<div class="hint">${esc(f.hint)}</div>` : '';
  switch (f.t) {
    case 'textarea': return `<div class="f">${lab}<textarea id="${id}" name="${f.k}" placeholder="${esc(f.ph || '')}">${esc(val)}</textarea>${hint}</div>`;
    case 'number': case 'date': case 'time': case 'email': case 'tel': case 'url':
      return `<div class="f">${lab}<input id="${id}" type="${f.t}" name="${f.k}" value="${esc(val)}" placeholder="${esc(f.ph || '')}">${hint}</div>`;
    case 'select': return `<div class="f">${lab}<select id="${id}" name="${f.k}">${f.opts.map(o => `<option value="${esc(o[0])}" ${String(o[0]) === String(val) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>${hint}</div>`;
    case 'toggle': return `<div class="f"><label class="toggle"><input type="checkbox" name="${f.k}" ${val ? 'checked' : ''}>${esc(f.l)}</label>${hint}</div>`;
    case 'seg': return `<div class="f"><div class="lab">${esc(f.l)}</div><div class="segf">${f.opts.map(o => `<label><input type="radio" name="${f.k}" value="${esc(o[0])}" ${String(o[0]) === String(val) ? 'checked' : ''}><span>${esc(o[1])}</span></label>`).join('')}</div>${hint}</div>`;
    case 'chips': { const arr = Array.isArray(val) ? val : [];
      return `<div class="f"><div class="lab">${esc(f.l)}</div><div class="segf">${f.opts.map(o => `<label><input type="checkbox" name="${f.k}" value="${esc(o[0])}" ${arr.includes(o[0]) ? 'checked' : ''}><span>${esc(o[1])}</span></label>`).join('')}</div>${hint}</div>`; }
    case 'multi': { const arr = Array.isArray(val) ? val : []; let grp = null, rows = '';
      const opts = f.opts.slice();
      if (f.selFirst) opts.sort((a, b) => (arr.includes(b.v) ? 1 : 0) - (arr.includes(a.v) ? 1 : 0));
      for (const o of opts) {
        if (!f.selFirst && o.g !== undefined && o.g !== grp) { grp = o.g; rows += `<div class="grp">${esc(grp)}</div>`; }
        rows += `<label data-q="${esc((o.l + ' ' + (o.s || '') + ' ' + (o.g || '')).toLowerCase())}"><input type="checkbox" name="${f.k}" value="${esc(o.v)}" ${arr.includes(o.v) ? 'checked' : ''}><span class="ml">${esc(o.l)}${o.s ? `<small>${esc(o.s)}</small>` : ''}</span>${o.r || ''}</label>`;
      }
      return `<div class="f">${f.l ? `<div class="lab">${esc(f.l)}</div>` : ''}${opts.length > 8 ? `<input type="text" class="search" placeholder="Suchen…" data-filter="${f.k}">` : ''}
        <div class="multi" data-multi="${f.k}">${rows || '<div class="empty">Keine Einträge</div>'}</div><div class="multi-count" data-count="${f.k}" data-max="${f.max || ''}"></div>${hint}</div>`; }
    case 'fit': { const fit = val || {}; let b = '';
      for (let n = 1; n <= 21; n++) { const s = fit[n] || 0; b += `<button type="button" class="fit${s}" data-a="fitCycle" data-n="${n}">${n}</button>`; }
      return `<div class="f"><div class="lab">${esc(f.l)}</div><div class="fitgrid" data-fit="${f.k}" data-val='${esc(JSON.stringify(fit))}'>${b}</div>
        <div class="hint">Antippen wechselt: – → Möglich → Gut → Ideal</div></div>`; }
    case 'posv': { const pv = val || {}; let grp = null, b = '';
      for (const P of POSV) { if (P.g !== grp) { b += `<div class="pvg">${P.g}</div>`; grp = P.g; } const l = pv[P.k] || 0; b += `<button type="button" class="${l ? 'l' + l : ''}" data-a="posvCycle" data-p="${P.k}" title="${esc(P.f)}"><b>${P.l}</b><span>${l ? POSVLV[l] : '–'}</span></button>`; }
      return `<div class="f"><div class="lab">${esc(f.l)}</div><div class="posgrid pv" data-posv="${f.k}" data-val='${esc(JSON.stringify(pv))}'>${b}</div>
        <div class="hint">Antippen wechselt: – → Stamm → in Frage → –. „In Frage“ zählt eine Stufe tiefer.</div></div>`; }
    case 'html': return f.html;
    default: return `<div class="f">${lab}<input id="${id}" type="text" name="${f.k}" value="${esc(val)}" placeholder="${esc(f.ph || '')}" ${f.auto ? 'autofocus' : ''}>${hint}</div>`;
  }
}
function openForm({ title, fields, value = {}, onSave, onDelete, saveLabel = 'Speichern', top = '' }) {
  FORM = { fields, value, onSave, onDelete };
  const body = top + fields.map(f => Array.isArray(f) ? `<div class="two">${f.map(x => field(x, value)).join('')}</div>` : field(f, value)).join('');
  const foot = `${onDelete ? `<button class="btn danger" data-a="formDelete">${icon('trash')}</button>` : ''}<button class="btn primary" data-a="formSave">${esc(saveLabel)}</button>`;
  Sheet.open(title, body, foot, el => { updateCounts(el); });
}
function updateCounts(el) {
  $$('[data-count]', el).forEach(c => {
    const n = $$(`[data-multi="${c.dataset.count}"] input:checked`, el).length, max = +c.dataset.max;
    c.textContent = max ? `${n} von max. ${max} ausgewählt` + (n > max ? ' – zu viele!' : '') : `${n} ausgewählt`;
    c.style.color = max && n > max ? 'var(--danger)' : '';
  });
}
function readForm() {
  const el = $('#sheet'), out = {};
  for (const f of FORM.fields.flat()) {
    if (!f.k) continue;
    if (f.t === 'toggle') out[f.k] = !!$(`[name="${f.k}"]`, el)?.checked;
    else if (f.t === 'chips' || f.t === 'multi') out[f.k] = $$(`[name="${f.k}"]:checked`, el).map(i => i.value);
    else if (f.t === 'seg') out[f.k] = $(`[name="${f.k}"]:checked`, el)?.value ?? '';
    else if (f.t === 'fit') out[f.k] = JSON.parse($(`[data-fit="${f.k}"]`, el).dataset.val);
    else if (f.t === 'posv') out[f.k] = JSON.parse($(`[data-posv="${f.k}"]`, el).dataset.val);
    else if (f.t === 'html') continue;
    else { const i = $(`[name="${f.k}"]`, el); if (i) out[f.k] = f.t === 'number' ? (i.value === '' ? '' : +i.value) : i.value.trim(); }
  }
  return out;
}
const confirmDel = what => confirm(`${what} wirklich löschen?`);

// ───────────────────────── Saison-Logik ─────────────────────────
const phases = () => Store.all('phase').sort((a, b) => a.start.localeCompare(b.start));
const phaseAt = d => phases().find(p => p.start <= d && d <= p.end);
const nextPhase = d => phases().find(p => p.start > d);
const phaseName = p => `${p.label} · ${MAKRO[p.makro] || p.makro}`;
function weeksOf(p) { const o = []; let m = D.week(p.start).monday; while (m <= p.end) { o.push(D.week(m)); m = D.add(m, 7); } return o; }
const tasksOf = (pid, mode) => Store.all('ptask').filter(t => t.phase === pid && (t.mode || 'meso') === mode).sort(byOrder);
const weekData = key => Store.data('week:' + key) || {};
const gamesBetween = (a, b) => Store.all('game').filter(g => g.date >= a && g.date <= b).sort(byDate);
const weekGames = key => { const m = D.fromKey(key); return gamesBetween(m, D.add(m, 6)); };

function taskRow(t, opts = {}) {
  return `<div class="checkwrap">${check(t.done, t.title, `data-a="ptask" data-id="${esc(t.id)}"`, opts.sub || '')}${opts.edit ? `<button class="iconbtn" data-a="editPtask" data-id="${esc(t.id)}" aria-label="Bearbeiten">${icon('edit')}</button>` : ''}</div>`;
}
function weekTaskRows(p, key) {
  const tasks = tasksOf(p.id, 'mikro'), done = weekData(key).tasks || {};
  if (!tasks.length) return '<div class="mute small">Keine wöchentlichen Aufgaben für diese Phase.</div>';
  return `<div class="list checks">${tasks.map(t => check(!!done[t.id], t.title, `data-a="wtask" data-id="${esc(t.id)}" data-week="${key}"`)).join('')}</div>`;
}
function gameLine(g) {
  const o = outcome(g), res = g.cancelled ? ' · abgesagt' : o ? ` · <b style="color:${OUT[o].c}">${esc(g.result)}</b>` : needsResult(g) ? ' · <b style="color:#7c3aed">Ergebnis fehlt</b>' : '';
  return `<div class="li" data-a="open" data-h="#/spiele/${encodeURIComponent(g.id)}"><div class="grow"><div class="t ell">${esc(g.opponent || 'Spiel')}</div>
    <div class="s">${g.tentative ? 'KW ' + D.week(g.date).week + ' · Tag offen' : D.long(g.date)}${g.kickoff ? ' · ' + esc(g.kickoff) : ''}${g.type ? ' · ' + esc(g.type) : ''}${res}</div></div>
    ${g.ha ? `<span class="ha ${g.ha}">${g.ha}</span>` : ''}${icon('chev', 'chev')}</div>`;
}
function trainingLineShort(key) {
  const w = weekData(key), days = setting().trainingDays || [2, 4, 5];
  const l = days.map(d => { const ph = GP[((w.days || {})[d] || {}).phase]; return WD[d].slice(0, 2) + ' ' + (ph ? ph.s : '–'); });
  return l.join(' · ');
}
function trainingSummary(key, compact) {
  const w = weekData(key), mon = D.fromKey(key), days = setting().trainingDays || [2, 4, 5];
  return days.map(d => {
    const dd = (w.days || {})[d] || {}, date = D.add(mon, d - 1), ph = GP[dd.phase];
    const tops = (dd.topics || []).map(id => Store.data(id)?.title).filter(Boolean);
    const nEx = (dd.exercises || []).length + (dd.athletics || []).length;
    return `<div class="row" style="padding:6px 0"><span class="dot" style="background:${ph ? ph.c : '#cbd5e1'}"></span>
      <div class="grow small"><b>${D.wd(date)} ${D.short(date)}</b> · ${ph ? esc(ph.s + ' · ' + ph.l) : '<span class="mute">noch nicht geplant</span>'}
      ${!compact && tops.length ? `<div class="mute tiny ell">${esc(tops.join(', '))}</div>` : ''}</div>${nEx ? `<span class="badge">${nEx} Üb.</span>` : ''}</div>`;
  }).join('');
}

// ───────────────────────── Heute (Startseite) ─────────────────────────
const dayIdx = s => ((D.parse(s).getDay() + 6) % 7) + 1; // Mo=1 … So=7
function trainingOn(date) {
  if (!(setting().trainingDays || [2, 4, 5]).includes(dayIdx(date))) return null;
  const key = D.week(date).key, dd = ((weekData(key).days || {})[dayIdx(date)]) || {};
  return dd.phase === 'FREI' ? null : { date, key, wd: dayIdx(date), dd };
}
function nextTraining(from) { for (let i = 0; i < 21; i++) { const t = trainingOn(D.add(from, i)); if (t) return t; } return null; }
const nextGame = from => Store.all('game').filter(g => !g.cancelled && g.date >= from).sort(byDate)[0];
const relDay = d => { const n = D.diff(D.today(), d); return n === 0 ? 'heute' : n === 1 ? 'morgen' : n === 2 ? 'übermorgen' : n > 0 ? `in ${n} Tagen` : `vor ${-n} Tagen`; };
function phaseLine(cur, t) {
  const weeks = weeksOf(cur), idx = weeks.findIndex(w => w.key === D.week(t).key);
  return `${MAKRO[cur.makro]} · ${esc(cur.label)} · Woche ${idx + 1}/${weeks.length}`;
}
function nextGameCard(g) {
  const items = Store.all('checkitem'), done = items.filter(i => (g.checks || {})[i.id]).length, s = setting();
  const club = findClub(g.opponent), L = club && LEVELS.find(l => l.k === club.level);
  const n = D.diff(D.today(), g.date);
  return `<div class="nextcard ng" data-a="open" data-h="#/spiele/${encodeURIComponent(g.id)}">
    <div class="nc-top"><span class="nc-kind">${icon('spiele', 'mini')} Nächstes Spiel</span><span class="nc-when ${n <= 2 ? 'soon' : ''}">${relDay(g.date)}</span></div>
    <div class="nc-title">${esc(g.opponent || 'Spiel')}</div>
    <div class="nc-sub">${D.long(g.date)}${g.kickoff ? ' · ' + esc(g.kickoff) + ' Uhr' : ''}${g.ha ? ` · ${g.ha === 'H' ? 'Heim' : 'Auswärts'}` : ''}${g.type ? ' · ' + esc(g.type) : ''}${g.important ? ' · ⭐ wichtig' : ''}${L && L.k ? ' · ' + esc(L.l) : ''}</div>
    <div class="nc-stats">
      <span class="${(g.squad || []).length ? 'ok' : ''}"><b>${(g.squad || []).length}/${s.squadMax || 17}</b>Kader</span>
      <span class="${(g.start11 || []).length === 11 ? 'ok' : ''}"><b>${(g.start11 || []).length}/11</b>Startelf</span>
      <span class="${items.length && done === items.length ? 'ok' : ''}"><b>${done}/${items.length}</b>Checkliste</span>
      <span class="${g.prep && Object.values(g.prep).some(Boolean) ? 'ok' : ''}"><b>${g.prep && Object.values(g.prep).some(Boolean) ? '✓' : '–'}</b>Plan</span></div></div>`;
}
function nextTrainingCard(t) {
  const ph = GP[t.dd.phase], tops = (t.dd.topics || []).map(id => Store.data(id)?.title).filter(Boolean);
  const nEx = (t.dd.exercises || []).length, nAth = (t.dd.athletics || []).length, planned = ph || tops.length || nEx || nAth;
  return `<div class="nextcard train" style="--c:${ph ? ph.c : 'var(--accent)'}" data-a="open" data-h="#/training/woche/${t.key}">
    <div class="nc-top"><span class="nc-kind">${icon('training', 'mini')} ${t.date === D.today() ? 'Training heute' : 'Nächstes Training'}</span><span class="nc-when">${t.date === D.today() ? WD[t.wd] : relDay(t.date)}</span></div>
    <div class="nc-title">${ph ? `<span class="phcode">${esc(ph.s)}</span> ${esc(ph.l)}` : WD[t.wd] + ' ' + D.short(t.date)}</div>
    ${planned ? `<div class="nc-sub">${tops.length ? esc(tops.slice(0, 3).join(' · ')) + (tops.length > 3 ? ` +${tops.length - 3}` : '') : 'Noch keine Schwerpunkte'}</div>
      <div class="nc-stats"><span class="${nEx ? 'ok' : ''}"><b>${nEx}</b>Übungen</span><span class="${nAth ? 'ok' : ''}"><b>${nAth}</b>Athletik</span><span class="${t.dd.note ? 'ok' : ''}"><b>${t.dd.note ? '✓' : '–'}</b>Notiz</span></div>`
      : `<div class="nc-sub">Noch nicht geplant – antippen zum Planen</div>`}</div>`;
}
function weekStrip(t) {
  const wk = D.week(t), mon = wk.monday, games = weekGames(wk.key);
  let h = `<div class="wstrip">`;
  for (let i = 0; i < 7; i++) {
    const d = D.add(mon, i), tr = trainingOn(d), g = games.find(x => x.date === d && !x.cancelled), ph = tr && GP[tr.dd.phase];
    const href = g ? '#/spiele/' + encodeURIComponent(g.id) : tr ? '#/training/woche/' + wk.key : '#/saison/woche/' + wk.key;
    h += `<button class="wd ${d === t ? 'now' : ''} ${d < t ? 'past' : ''}" data-a="open" data-h="${href}">
      <span class="wn">${D.wd(d)}</span><span class="wdt">${D.parse(d).getDate()}</span>
      <span class="wm">${g ? `<i class="mg ${outcome(g) ? 'o' + outcome(g) : ''}" title="${esc(g.opponent)}">${icon('spiele')}</i>` : ''}${tr ? `<i class="mt" style="--c:${ph ? ph.c : 'var(--mute)'}">${ph ? esc(ph.s) : 'T'}</i>` : ''}</span></button>`;
  }
  return h + `</div>`;
}
const todoRow = (ic, title, sub, attrs, right = '') => `<div class="todo" ${attrs}><span class="ti">${icon(ic)}</span><div class="grow"><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>${right || icon('chev', 'chev')}</div>`;
function viewHeute() {
  if (!phases().length && !Store.all('game').length) return { title: 'Heute', html: emptyState() };
  const t = D.today(), cur = phaseAt(t), nxt = nextPhase(t), wk = D.week(t);
  const dl = D.parse(t).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  let h = `<div class="hello" data-a="open" data-h="#/saison"><div class="hd">${esc(dl)}</div>
    <div class="hs">KW ${wk.week}${cur ? ' · ' + phaseLine(cur, t) : nxt ? ' · Pause bis ' + D.short(nxt.start) : ''}</div>
    ${cur ? `<div class="thinbar"><i style="width:${Math.min(100, Math.round((D.diff(cur.start, t) + 1) / (D.diff(cur.start, cur.end) + 1) * 100))}%;background:${PHC[cur.type]}"></i></div>` : ''}</div>`;

  const g = nextGame(t), tr = nextTraining(t);
  const cards = [];
  if (tr) cards.push([tr.date, nextTrainingCard(tr)]);
  if (g) cards.push([g.date, nextGameCard(g)]);
  cards.sort((a, b) => a[0].localeCompare(b[0]));
  h += cards.map(c => c[1]).join('');
  h += sec(`Diese Woche · KW ${wk.week}`, `<button class="link" data-a="open" data-h="#/saison/woche/${wk.key}">Woche öffnen</button>`) + weekStrip(t);

  // Zu erledigen – alles an einem Ort
  let todo = '', n = 0;
  const nr = Store.all('game').filter(needsResult).sort(byDate);
  for (const x of nr.slice(0, 3)) { n++; todo += todoRow('spiele', `Ergebnis: ${esc(shortOpp(x.opponent))}`, D.long(x.date), `data-a="quickResult" data-id="${esc(x.id)}"`, '<span class="link">Eintragen</span>'); }
  if (nr.length > 3) { n += nr.length - 3; todo += todoRow('spiele', `${nr.length - 3} weitere Ergebnisse fehlen`, 'im Spiele-Tab', `data-a="open" data-h="#/spiele"`); }
  if (g && D.diff(t, g.date) <= 7) {
    const items = Store.all('checkitem'), open = items.filter(i => !(g.checks || {})[i.id]).length;
    if (open) { n++; todo += todoRow('spiele', `Spieltag ${esc(shortOpp(g.opponent))}: ${open} Punkte offen`, `Checkliste · ${relDay(g.date)}`, `data-a="open" data-h="#/spiele/${encodeURIComponent(g.id)}"`); }
    if (!(g.squad || []).length) { n++; todo += todoRow('kader', `Kader für ${esc(shortOpp(g.opponent))} wählen`, relDay(g.date), `data-a="pickSquad" data-id="${esc(g.id)}"`); }
  }
  const cb = Store.all('club').filter(c => c.callback && !c.done).length;
  if (cb) { n++; todo += todoRow('tests', `Testspiele: ${cap(cb, 'Verein', 'Vereine')} zurückmelden`, 'Testspielplanung', `data-a="testsStatus" data-v="callback"`); }
  const noNum = players().filter(p => !p.number);
  if (noNum.length) { n++; todo += todoRow('kader', `${cap(noNum.length, 'Spieler', 'Spieler')} ohne Rückennummer`, esc(noNum.map(p => p.short || p.name).join(', ')), `data-a="open" data-h="#/kader/liste"`); }
  if (cur) {
    const wt = tasksOf(cur.id, 'mikro'), wdn = weekData(wk.key).tasks || {}, openW = wt.filter(x => !wdn[x.id]);
    if (openW.length) todo += `<div class="todo-sub">Jede Woche</div><div class="list checks">${openW.map(x => check(false, x.title, `data-a="wtask" data-id="${esc(x.id)}" data-week="${wk.key}"`)).join('')}</div>`;
    const om = tasksOf(cur.id, 'meso').filter(x => !x.done);
    if (om.length) todo += `<div class="todo-sub"><span class="grow">${esc(cur.label)} · noch ${om.length} offen</span><button class="link" data-a="open" data-h="#/saison/phase/${cur.id}">Alle</button></div><div class="list checks">${om.slice(0, 3).map(x => taskRow(x)).join('')}</div>`;
    n += openW.length + om.length;
  }
  if (nxt && D.diff(t, nxt.start) <= 14) {
    const on = tasksOf(nxt.id, 'meso').filter(x => !x.done).length;
    if (on) { n++; todo += todoRow('saison', `Bald: ${esc(phaseName(nxt))}`, `startet ${relDay(nxt.start)} · ${cap(on, 'Aufgabe', 'Aufgaben')} vorbereiten`, `data-a="open" data-h="#/saison/phase/${nxt.id}"`); }
  }
  h += sec('Zu erledigen', n ? `<span class="nbadge static">${n}</span>` : '');
  h += `<div class="card todos">${todo || '<div class="mute small" style="padding:6px 2px">Alles erledigt 🎉</div>'}</div>`;

  // Form kompakt
  const played = Store.all('game').filter(x => !x.cancelled && x.date < t && outcome(x)).sort(byDate);
  if (played.length) {
    const tot = { S: 0, U: 0, N: 0 }; played.forEach(x => tot[outcome(x)]++);
    const last5 = played.slice(-5), pts = { S: 3, U: 1, N: 0 }, avg = last5.reduce((s, x) => s + pts[outcome(x)], 0) / last5.length;
    h += sec('Form') + `<div class="card tap formmini" data-a="open" data-h="#/spiele"><div class="grow"><div class="fm-big">${avg.toFixed(1).replace('.', ',')} <span>Punkte/Spiel (letzte 5)</span></div>
      <div class="small mute">${tot.S} S · ${tot.U} U · ${tot.N} N</div></div><div>${last5.map(x => `<span class="fdot" style="background:${OUT[outcome(x)].c}">${outcome(x)}</span>`).join('')}</div>${icon('chev', 'chev')}</div>`;
  }
  return { title: 'Heute', html: h };
}

// ───────────────────────── Saison (Makro → Meso → Mikro) ─────────────────────────
function seasonTimeline(t) {
  const ps = phases(); if (!ps.length) return '';
  const a = ps[0].start, b = ps[ps.length - 1].end, total = D.diff(a, b) + 1, pos = d => (D.diff(a, d) / total * 100);
  const now = t >= a && t <= b ? pos(t) : null;
  let segs = '', labels = '';
  for (const p of ps) segs += `<i class="seg-${p.type}" style="left:${pos(p.start)}%;width:${(D.diff(p.start, p.end) + 1) / total * 100}%;background:${PHC[p.type]}" data-a="open" data-h="#/saison/phase/${p.id}" title="${esc(phaseName(p))}"></i>`;
  for (const mk of ['HR', 'RR']) { const m = ps.filter(p => p.makro === mk); if (m.length) labels += `<span style="left:${pos(m[0].start)}%">${MAKRO[mk]}</span>`; }
  return `<div class="card tline"><div class="tl-bar">${segs}${now != null ? `<b class="tl-now" style="left:${now}%"></b>` : ''}</div><div class="tl-lab">${labels}</div>
    <div class="legend">${[['vorb', 'Vorbereitung'], ['wettk', 'Wettkampf'], ['nachb', 'Nachbereitung']].map(([k, l]) => `<span><span class="dot" style="background:${PHC[k]};width:8px;height:8px"></span> ${l}</span>`).join('')}<span><b class="tl-key"></b> heute</span></div></div>`;
}
function viewSaison(parts) {
  if (parts[0] === 'phase') return viewPhase(parts[1]);
  if (parts[0] === 'woche') return viewWeek(parts[1]);
  if (!phases().length) return { title: 'Saison', html: emptyState() };
  const t = D.today(), cur = phaseAt(t), nxt = nextPhase(t), wk = D.week(t);
  let h = seasonTimeline(t);
  if (cur) {
    const weeks = weeksOf(cur), idx = weeks.findIndex(w => w.key === wk.key);
    const meso = tasksOf(cur.id, 'meso'), done = meso.filter(x => x.done).length;
    h += `<div class="phasecard" style="--pc:${PHC[cur.type]}" data-a="open" data-h="#/saison/phase/${cur.id}">
      <div class="pc-eye">Jetzt · ${MAKRO[cur.makro]}</div><div class="pc-title">${esc(cur.label)}</div>
      <div class="pc-sub">Woche ${idx + 1} von ${weeks.length} · ${D.short(cur.start)}–${D.short(cur.end)}</div>
      <div class="pc-weeks">${weeks.map((w, i) => `<i class="${i < idx ? 'done' : i === idx ? 'now' : ''}"></i>`).join('')}</div>
      <div class="pc-foot"><span>${done}/${meso.length} Aufgaben erledigt</span>${nxt ? `<span>danach ${esc(nxt.label)} ${relDay(nxt.start)}</span>` : ''}</div></div>`;
    const open = meso.filter(x => !x.done);
    h += sec(`Aufgaben · ${cur.label}`, `<button class="link" data-a="addPtask" data-phase="${cur.id}" data-mode="meso">+ Aufgabe</button>`);
    h += `<div class="card">${open.length ? `<div class="list checks">${open.slice(0, 8).map(x => taskRow(x)).join('')}</div>${open.length > 8 ? `<button class="link" data-a="open" data-h="#/saison/phase/${cur.id}">+ ${open.length - 8} weitere ansehen</button>` : ''}` : '<div class="mute small">Alles erledigt 🎉</div>'}</div>`;
    h += sec(`Jede Woche · KW ${wk.week}`, `<button class="link" data-a="open" data-h="#/saison/woche/${wk.key}">Woche öffnen</button>`);
    h += `<div class="card">${weekTaskRows(cur, wk.key)}</div>`;
  } else if (nxt) {
    h += `<div class="phasecard" style="--pc:#64748b"><div class="pc-eye">Pause</div><div class="pc-title">Saisonpause</div><div class="pc-sub">${esc(phaseName(nxt))} startet ${D.long(nxt.start)} · ${relDay(nxt.start)}</div></div>`;
  }
  if (nxt && D.diff(t, nxt.start) <= 21) {
    const on = tasksOf(nxt.id, 'meso').filter(x => !x.done);
    if (on.length) h += sec(`Bald: ${nxt.label} · ${relDay(nxt.start)}`, `<button class="link" data-a="open" data-h="#/saison/phase/${nxt.id}">Alle</button>`)
      + `<div class="card soon"><div class="list checks">${on.slice(0, 6).map(x => taskRow(x)).join('')}</div>${on.length > 6 ? `<div class="tiny mute" style="margin-top:6px">+ ${on.length - 6} weitere</div>` : ''}</div>`;
  }
  for (const mk of ['HR', 'RR']) {
    const ps = phases().filter(p => p.makro === mk); if (!ps.length) continue;
    h += sec(`${MAKRO[mk]}`, `<span class="tiny">${D.short(ps[0].start)} – ${D.full(ps[ps.length - 1].end)}</span>`);
    h += `<div class="card list mesolist">${ps.map(p => mesoCard(p, cur && cur.id === p.id)).join('')}</div>`;
  }
  return { title: 'Saison', html: h };
}

function phaseAlert(p, title, intro) {
  const open = tasksOf(p.id, 'meso').filter(x => !x.done);
  if (!open.length) return '';
  return `<div class="card alert"><h3>${esc(title)}</h3><div class="small mute">${esc(intro)}</div>
    <div class="list checks">${open.slice(0, 6).map(x => taskRow(x)).join('')}</div>
    ${open.length > 6 ? `<button class="link" data-a="open" data-h="#/saison/phase/${p.id}">Alle ${open.length} Aufgaben ansehen</button>` : ''}</div>`;
}
function mesoCard(p, now) {
  const tasks = tasksOf(p.id, 'meso'), done = tasks.filter(t => t.done).length, weeks = weeksOf(p);
  const nGames = gamesBetween(p.start, p.end).length;
  return `<div class="meso tap ${now ? 'now' : ''}" data-a="open" data-h="#/saison/phase/${p.id}">
    <span class="stripe" style="background:${PHC[p.type]}"></span><div class="grow" style="flex:1;min-width:0">
    <div class="row"><b class="grow">${esc(p.label)}</b>${now ? badge('jetzt', 'var(--accent)') : ''}</div>
    <div class="small mute">${D.short(p.start)} – ${D.short(p.end)} · ${cap(weeks.length, 'Woche', 'Wochen')} · ${cap(nGames, 'Spiel', 'Spiele')}</div>
    <div class="prog"><i style="width:${tasks.length ? Math.round(done / tasks.length * 100) : 0}%"></i></div>
    <div class="tiny mute" style="margin-top:4px">${done}/${tasks.length} Aufgaben erledigt</div></div>${icon('chev', 'chev')}</div>`;
}
function viewPhase(pid) {
  const p = Store.get(pid); if (!p) return notFound();
  const t = D.today(), curKey = D.week(t).key;
  const meso = tasksOf(p.id, 'meso'), mikro = tasksOf(p.id, 'mikro');
  let h = `<div class="phasecard" style="--pc:${PHC[p.type]}"><div class="pc-eye">${MAKRO[p.makro]} · Mesozyklus</div>
    <div class="pc-title">${esc(p.label)}</div><div class="pc-sub">${D.long(p.start)} – ${D.long(p.end)} · KW ${D.week(p.start).week}–${D.week(p.end).week}</div></div>`;
  h += sec(`Aufgaben dieser Phase (${meso.filter(x => x.done).length}/${meso.length})`, `<button class="link" data-a="addPtask" data-phase="${p.id}" data-mode="meso">+ Aufgabe</button>`);
  h += `<div class="card">${meso.length ? `<div class="list checks">${meso.map(x => taskRow(x, { edit: true })).join('')}</div>` : '<div class="mute small">Noch keine Aufgaben.</div>'}</div>`;
  h += sec('Jede Woche (Mikrozyklus)', `<button class="link" data-a="addPtask" data-phase="${p.id}" data-mode="mikro">+ Aufgabe</button>`);
  h += `<div class="card"><div class="small mute" style="margin-bottom:4px">Diese Punkte erscheinen in jeder Woche der Phase zum Abhaken.</div>
    <div class="list">${mikro.map(x => `<div class="li" data-a="editPtask" data-id="${esc(x.id)}"><div class="grow">${esc(x.title)}</div>${icon('edit', 'chev')}</div>`).join('') || '<div class="mute small">Keine.</div>'}</div></div>`;
  h += sec('Wochen');
  h += `<div class="card list">${weeksOf(p).map(w => {
    const games = weekGames(w.key), wd = weekData(w.key), dn = Object.values(wd.tasks || {}).filter(Boolean).length;
    const planned = Object.values(wd.days || {}).filter(d => d.phase).length;
    return `<div class="weekrow ${w.key === curKey ? 'now' : ''}" data-a="open" data-h="#/saison/woche/${w.key}"><div class="kw">KW ${w.week}</div>
      <div class="grow" style="min-width:0"><div class="small"><b>${D.short(w.monday)}–${D.short(D.add(w.monday, 6))}</b>${w.key === curKey ? ' · <b style="color:var(--accent)">aktuell</b>' : ''}</div>
      <div class="tiny mute ell">${games.length ? games.map(g => esc(g.opponent)).join(' · ') : 'kein Spiel'}</div>
      <div class="tiny mute">Training: ${planned ? planned + ' Tage geplant' : '–'} · Wochenaufgaben ${dn}/${mikro.length}</div></div>${icon('chev', 'chev')}</div>`;
  }).join('')}</div>`;
  return { title: phaseName(p), back: true, html: h, actions: `<button class="iconbtn" data-a="editPhase" data-id="${p.id}" aria-label="Bearbeiten">${icon('edit')}</button>` };
}
function weekNav(key, base) {
  const mon = D.fromKey(key), prev = D.week(D.add(mon, -7)).key, next = D.week(D.add(mon, 7)).key, p = phaseAt(mon) || phaseAt(D.add(mon, 6));
  return `<div class="navweek"><button class="iconbtn" data-a="open" data-h="${base}${prev}" aria-label="Vorherige Woche">${icon('left')}</button>
    <div class="grow"><b>KW ${D.week(mon).week} · ${D.short(mon)}–${D.short(D.add(mon, 6))}</b><span class="small mute">${p ? esc(phaseName(p)) : 'keine Saisonphase'}</span></div>
    <button class="iconbtn" data-a="open" data-h="${base}${next}" aria-label="Nächste Woche">${icon('right')}</button></div>`;
}
function viewWeek(key) {
  key = key || D.week(D.today()).key;
  const mon = D.fromKey(key), p = phaseAt(mon) || phaseAt(D.add(mon, 6)), games = weekGames(key), w = weekData(key);
  let h = weekNav(key, '#/saison/woche/');
  h += `<div class="card"><h3>Spiele</h3>${games.length ? `<div class="list">${games.map(gameLine).join('')}</div>` : '<div class="mute small">Kein Spiel in dieser Woche.</div>'}
    <button class="link" data-a="newGame" data-date="${D.add(mon, 5)}">+ Spiel eintragen</button></div>`;
  h += `<div class="card tap" data-a="open" data-h="#/training/woche/${key}"><h3><span class="grow">Training</span><span class="link">Planen</span></h3>${trainingSummary(key)}</div>`;
  if (p) h += `<div class="card"><h3>Jede Woche erledigen</h3>${weekTaskRows(p, key)}</div>`;
  h += `<div class="card"><h3>Notizen zur Woche</h3><div class="f" style="margin:0"><textarea data-a="weekField" data-week="${key}" data-f="note" placeholder="z. B. Abwesenheiten, Besonderheiten…">${esc(w.note || '')}</textarea></div></div>`;
  return { title: `Woche · KW ${D.week(mon).week}`, back: true, html: h };
}

// ───────────────────────── Spiele & Spieltag ─────────────────────────
function parseResult(r) { const m = /^\s*(\d+)\s*[:\-]\s*(\d+)\s*$/.exec(r || ''); return m ? [+m[1], +m[2]] : null; }
function outcome(g) { const r = parseResult(g.result); if (!r) return null; return r[0] > r[1] ? 'S' : r[0] < r[1] ? 'N' : 'U'; }
const OUT = { S: { l: 'Sieg', c: '#16a34a' }, U: { l: 'Unentschieden', c: '#d4a106' }, N: { l: 'Niederlage', c: '#dc2626' } };
// Offene Punkte eines Spiels: nach dem Spiel Ergebnis + nicht abgehakte Checkliste
function openItems(g) {
  if (g.cancelled || g.date >= D.today()) return 0;
  const items = Store.all('checkitem');
  return (parseResult(g.result) ? 0 : 1) + items.filter(i => !(g.checks || {})[i.id]).length;
}
const gameDone = g => g.cancelled || (g.date < D.today() && !!parseResult(g.result));
const needsResult = g => !g.cancelled && g.date < D.today() && !parseResult(g.result);
const shortOpp = s => (s || 'Spiel').replace(/\s*\((?:U\d+|F)\)/gi, '').replace(/\s+U1\d(\/\d)?(-\d)?\b/g, '').trim();
function formCurve(games) {
  const gs = games.filter(g => !g.cancelled && outcome(g)).sort(byDate);
  if (gs.length < 2) return '';
  const pts = { S: 3, U: 1, N: 0 }, W = 340, H = 112, pad = 12, n = gs.length;
  const x = i => pad + (n === 1 ? 0 : i * (W - 2 * pad) / (n - 1));
  const roll = gs.map((g, i) => { const w = gs.slice(Math.max(0, i - 4), i + 1); return w.reduce((s, x) => s + pts[outcome(x)], 0) / w.length; });
  const y = v => 14 + (3 - v) / 3 * 62;
  const line = roll.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},76 L${x(0).toFixed(1)},76 Z`;
  const tot = { S: 0, U: 0, N: 0 }; let gf = 0, ga = 0;
  for (const g of gs) { tot[outcome(g)]++; const r = parseResult(g.result); gf += r[0]; ga += r[1]; }
  const last5 = gs.slice(-5);
  return `<div class="card form"><div class="row"><b class="grow">Formkurve</b><span class="small mute">${tot.S} S · ${tot.U} U · ${tot.N} N · Tore ${gf}:${ga}</span></div>
    <svg viewBox="0 0 ${W} ${H}" class="curve" role="img" aria-label="Formkurve">
      <line x1="${pad}" x2="${W - pad}" y1="${y(1.5)}" y2="${y(1.5)}" class="mid"/>
      <path d="${area}" class="area"/><path d="${line}" class="ln"/>
      ${gs.map((g, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(roll[i]).toFixed(1)}" r="2.2" class="pt"/><rect x="${(x(i) - 3).toFixed(1)}" y="${106 - { S: 20, U: 11, N: 4 }[outcome(g)]}" width="6" height="${{ S: 20, U: 11, N: 4 }[outcome(g)]}" rx="2" fill="${OUT[outcome(g)].c}"/>`).join('')}
    </svg>
    <div class="row small"><span class="mute grow">Linie: Punkteschnitt der letzten 5 Spiele (0–3)</span><span>Letzte 5: ${last5.map(g => `<span class="fdot" style="background:${OUT[outcome(g)].c}">${outcome(g)}</span>`).join('')}</span></div></div>`;
}
function gameTile(g) {
  const o = outcome(g), open = openItems(g), up = !g.cancelled && g.date >= D.today();
  const days = up ? D.diff(D.today(), g.date) : null;
  return `<div class="gtile ${o ? 'o' + o : ''} ${g.cancelled ? 'cx' : ''} ${up ? 'up' : ''}" data-a="open" data-h="#/spiele/${encodeURIComponent(g.id)}">
    ${open ? `<span class="nbadge">${open}</span>` : ''}
    <div class="gd">${D.wd(g.date)} ${D.parse(g.date).getDate()}.${g.ha ? ` <span class="ha ${g.ha}">${g.ha}</span>` : ''}</div>
    <div class="go">${esc(shortOpp(g.opponent))}</div>
    <div class="gr">${g.cancelled ? 'abgesagt' : o ? esc(g.result) : up ? (g.kickoff ? esc(g.kickoff) : days === 0 ? 'heute' : 'in ' + days + ' T.') : 'Ergebnis?'}</div>
    <div class="gt">${esc(g.type || '')}${g.important ? ' ⭐' : ''}</div></div>`;
}
function viewSpiele(parts) {
  if (parts[0]) return viewGame(parts[0]);
  const t = D.today(), f = UI.games;
  let all = Store.all('game').sort(byDate);
  if (f.type) all = all.filter(g => (g.type || '') === f.type);
  const todo = all.filter(needsResult);
  let games = f.when === 'next' ? all.filter(g => !gameDone(g) && g.date >= t) : f.when === 'past' ? all.filter(g => g.date < t).reverse() : all;
  let h = `<div class="seg">${[['next', 'Kommend'], ['past', 'Gespielt'], ['all', 'Alle']].map(([v, l]) => `<button class="${f.when === v ? 'on' : ''}" data-a="gWhen" data-v="${v}">${l}</button>`).join('')}</div>`;
  h += chips([['', 'Alle Typen'], ...GTYPES.map(x => [x, x])], f.type, 'gType');
  h += formCurve(all.filter(g => g.date < t));
  { const cl = Store.all('club'), cb = cl.filter(c => c.callback && !c.done).length, dn = cl.filter(c => c.done).length;
    h += `<div class="linkrow" data-a="open" data-h="#/tests">${icon('tests', 'mini')}<span class="grow">Testspielplanung${cb ? ` · <b>${cb} zurückmelden</b>` : ''} · ${dn} vereinbart</span>${icon('chev', 'chev')}</div>`; }
  if (todo.length) h += `<div class="card alert"><h3><span class="grow">Ergebnis eintragen</span><span class="nbadge static">${todo.length}</span></h3>
    <div class="list">${todo.map(g => `<div class="li" data-a="quickResult" data-id="${esc(g.id)}"><div class="grow"><div class="t ell">${esc(g.opponent)}</div><div class="s">${D.long(g.date)} · ${esc(g.type || 'Spiel')}</div></div><span class="link">Eintragen</span></div>`).join('')}</div></div>`;
  if (!games.length) h += '<div class="empty">Keine Spiele für diese Auswahl.</div>';
  let month = null;
  for (const g of games) {
    const m = D.month(g.date);
    if (m !== month) { if (month) h += '</div>'; h += sec(m) + '<div class="gtiles">'; month = m; }
    h += gameTile(g);
  }
  if (month) h += '</div>';
  h += `<div class="legend" style="margin:12px 4px">${Object.values(OUT).map(o => `<span><span class="dot" style="background:${o.c};width:9px;height:9px"></span> ${o.l}</span>`).join('')}<span><span class="nbadge static">1</span> offen</span></div>`;
  return { title: 'Spiele', html: h, fab: 'newGame' };
}
function prepStatus(g) {
  const items = Store.all('checkitem'), done = items.filter(i => (g.checks || {})[i.id]).length;
  return `Kader ${(g.squad || []).length}/${setting().squadMax || 17} · Checkliste ${done}/${items.length}`;
}
const playerName = id => Store.data(id)?.short || Store.data(id)?.name || '?';
function startWarnings(g) {
  if (!g.important || !(g.start11 || []).length) return [];
  const prev = Store.all('game').filter(x => x.important && x.id !== g.id && x.date < g.date && (x.start11 || []).length).sort(byDate).slice(-2);
  if (prev.length < 2) return [];
  return g.start11.filter(p => prev.every(x => x.start11.includes(p)));
}
function viewGame(id) {
  const g = Store.get(id); if (!g) return notFound();
  const club = findClub(g.opponent), contacts = contactsFor(club ? club.name : g.opponent);
  const items = Store.all('checkitem').sort(byOrder), checks = g.checks || {};
  const prep = g.prep || {}, s = setting(), o = outcome(g);
  let h = `<div class="card ${o ? 'o' + o : ''}" style="${o ? `border-left:5px solid ${OUT[o].c}` : ''}"><div class="row"><div class="grow"><div style="font-size:21px;font-weight:800">${esc(g.opponent || 'Spiel')}</div>
    <div class="small mute">${g.tentative ? 'KW ' + D.week(g.date).week + ' · Tag noch offen' : D.long(g.date) + ' ' + D.parse(g.date).getFullYear()}</div></div>
    ${g.ha ? `<span class="ha ${g.ha}" style="font-size:14px">${g.ha === 'H' ? 'Heim' : 'Auswärts'}</span>` : ''}</div>
    ${o ? `<div class="bigres" style="color:${OUT[o].c}">${esc(g.result)} <span>${OUT[o].l}</span></div>` : ''}
    <div class="badges">${g.cancelled ? badge('abgesagt', '#64748b') : ''}${g.type ? badge(g.type) : ''}${g.important ? badge('wichtiges Spiel', '#d97706') : ''}${club && club.level ? badge(LEVELS.find(l => l.k === club.level)?.l || club.level) : ''}${g.source ? badge('fussball.de') : ''}</div>
    <dl class="kv" style="margin-top:12px">${g.meet ? `<dt>Treffen</dt><dd>${esc(g.meet)} Uhr</dd>` : ''}${g.kickoff ? `<dt>Anstoß</dt><dd>${esc(g.kickoff)} Uhr</dd>` : ''}${g.venue ? `<dt>Ort</dt><dd>${esc(g.venue)}</dd>` : ''}${g.note ? `<dt>Notiz</dt><dd>${esc(g.note)}</dd>` : ''}</dl>
    <div class="row" style="margin-top:10px;gap:6px"><button class="btn sm" data-a="editGame" data-id="${esc(id)}">${icon('edit')} Spieldaten</button>
    ${!g.cancelled && g.date <= D.today() ? `<button class="btn sm primary" data-a="quickResult" data-id="${esc(id)}">${o ? 'Ergebnis ändern' : 'Ergebnis eintragen'}</button>` : ''}</div></div>`;
  if (needsResult(g)) h += `<div class="warnbox">Das Spiel ist vorbei – bitte noch das Ergebnis eintragen.</div>`;

  const squad = g.squad || [], start = g.start11 || [], warn = startWarnings(g);
  h += sec('Kader & Startelf');
  h += `<div class="card"><div class="row"><b class="grow">Kader ${squad.length}/${s.squadMax || 17}</b><button class="btn sm" data-a="pickSquad" data-id="${esc(id)}">Kader wählen</button></div>
    <div style="margin-top:6px">${squad.map(p => `<span class="pill">${esc(playerName(p))}</span>`).join('') || '<span class="mute small">Noch kein Kader.</span>'}</div>
    <div class="row" style="margin-top:14px"><b class="grow">Startelf ${start.length}/11</b><button class="btn sm" data-a="pickStart" data-id="${esc(id)}">Startelf wählen</button></div>
    <div style="margin-top:6px">${start.map(p => `<span class="pill">${esc(playerName(p))}</span>`).join('') || '<span class="mute small">Noch keine Startelf.</span>'}</div>
    ${warn.length ? `<div class="warnbox">Drittes wichtiges Spiel in Folge in der Startelf: ${warn.map(p => esc(playerName(p))).join(', ')}</div>` : ''}
    ${g.important ? '' : '<div class="tiny mute" style="margin-top:8px">Tipp: Markiere wichtige Spiele, dann warnt die App, wenn jemand drei wichtige Spiele hintereinander beginnt.</div>'}</div>`;

  h += sec('Spielvorbereitung', `<button class="link" data-a="editPrep" data-id="${esc(id)}">Bearbeiten</button>`);
  const pr = [['Formation', prep.formation], ['Ziele – mental', prep.goalMental], ['Ziele – mit Ball', prep.goalBall], ['Ziele – ohne Ball', prep.goalNoBall],
    ['Pressing', prep.pressing], ['Motivation', prep.motivation]].filter(x => x[1]);
  const st = [['Ecken links', prep.cornerL], ['Ecken rechts', prep.cornerR], ['Freistoß links', prep.fkL], ['Freistoß rechts', prep.fkR], ['Elfmeter', prep.penalty], ['Einwürfe', prep.throwin]].filter(x => x[1]);
  h += `<div class="card tap" data-a="editPrep" data-id="${esc(id)}">${pr.length || st.length ? `<dl class="kv">${pr.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${st.length ? `<div class="sub">Standards</div><dl class="kv">${st.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}` : '<div class="mute small">Formation, Ziele, Pressing, Standards, Motivation – antippen zum Ausfüllen.</div>'}</div>`;

  h += sec(`Spieltag-Checkliste (${items.filter(i => checks[i.id]).length}/${items.length})`);
  let grp = null, c = '<div class="card">';
  for (const it of items) {
    if (it.group !== grp) { if (grp !== null) c += '</div>'; c += `<div class="sub">${esc(it.group)}</div><div class="list checks">`; grp = it.group; }
    c += check(!!checks[it.id], it.title, `data-a="gcheck" data-id="${esc(id)}" data-item="${esc(it.id)}"`);
  }
  h += c + (grp !== null ? '</div>' : '') + '</div>';

  const dc = s.dresscode || {};
  if (Object.keys(dc).length) h += sec('Dresscode') + `<div class="card"><dl class="kv">${Object.entries(dc).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`;
  if (club || contacts.length) {
    h += sec('Gegner');
    h += `<div class="card">${club ? `<div class="li" data-a="openClub" data-id="${esc(club.id)}"><div class="grow"><div class="t">${esc(club.name)}</div><div class="s">${esc([club.stadt, club.verband].filter(Boolean).join(' · '))}</div></div>${icon('chev', 'chev')}</div>` : ''}
      ${contacts.map(contactRow).join('')}</div>`;
  }
  const wkKey = D.week(g.date).key, before = Store.all('game').filter(x => x.id !== g.id && !x.cancelled && x.date < g.date && sameClub(x.opponent, g.opponent)).sort(byDate).reverse();
  h += sec('Verknüpft') + `<div class="card list">
    <div class="li" data-a="open" data-h="#/training/woche/${wkKey}"><span class="ti">${icon('training')}</span><div class="grow"><div class="t">Training in dieser Woche</div><div class="s">KW ${D.week(g.date).week} · ${esc(trainingLineShort(wkKey))}</div></div>${icon('chev', 'chev')}</div>
    <div class="li" data-a="open" data-h="#/saison/woche/${wkKey}"><span class="ti">${icon('saison')}</span><div class="grow"><div class="t">Saisonwoche</div><div class="s">${esc((phaseAt(g.date) && phaseName(phaseAt(g.date))) || 'keine Phase')}</div></div>${icon('chev', 'chev')}</div>
    ${club ? '' : `<div class="li" data-a="clubFromGame" data-id="${esc(id)}"><span class="ti">${icon('tests')}</span><div class="grow"><div class="t">In Testspielplanung aufnehmen</div><div class="s">Gegner als Verein anlegen</div></div>${icon('plus', 'chev')}</div>`}
    ${before.map(x => gameLine(x)).join('')}</div>`;
  h += sec('Nachbereitung');
  h += `<div class="card"><div class="f" style="margin:0"><textarea data-a="gameField" data-id="${esc(id)}" data-f="review" placeholder="Was lief gut? Was nehmen wir mit ins Training?">${esc(g.review || '')}</textarea></div></div>`;
  return { title: g.opponent || 'Spiel', back: true, html: h };
}
function resultForm(g) {
  const r = parseResult(g.result) || ['', ''];
  openForm({
    title: `Ergebnis · ${g.opponent}`, value: { us: r[0], them: r[1] },
    top: `<div class="small mute" style="margin-bottom:12px">${D.long(g.date)} · ${g.ha === 'A' ? 'auswärts' : g.ha === 'H' ? 'zuhause' : ''} – aus unserer Sicht</div>`,
    fields: [[{ k: 'us', l: 'FC Hennef', t: 'number' }, { k: 'them', l: shortOpp(g.opponent), t: 'number' }],
      { k: 'cancelled', l: 'Spiel ist ausgefallen / abgesagt', t: 'toggle' }],
    onSave: async v => {
      if (v.cancelled) { Store.patch(g.id, 'game', { cancelled: true, result: '' }); }
      else { if (v.us === '' || v.them === '') return toast('Bitte beide Tore eintragen'); Store.patch(g.id, 'game', { result: `${v.us}:${v.them}`, cancelled: false }); }
      await Sheet.close(); toast('Gespeichert'); render();
    },
  });
}
function gameForm(g = {}, isNew) {
  openForm({
    title: isNew ? 'Neues Spiel' : 'Spieldaten', value: g,
    fields: [
      { k: 'opponent', l: 'Gegner', auto: isNew },
      [{ k: 'date', l: 'Datum', t: 'date' }, { k: 'kickoff', l: 'Anstoß', t: 'time' }],
      [{ k: 'meet', l: 'Treffen', t: 'time' }, { k: 'result', l: 'Ergebnis (wir : Gegner)', ph: 'z. B. 3:1' }],
      { k: 'ha', l: 'Heim / Auswärts', t: 'seg', opts: [['H', 'Heim'], ['A', 'Auswärts'], ['', 'offen']] },
      { k: 'type', l: 'Art', t: 'seg', opts: GTYPES.map(x => [x, x]) },
      { k: 'venue', l: 'Ort / Platz' },
      { k: 'important', l: 'Wichtiges Spiel', t: 'toggle' },
      { k: 'cancelled', l: 'Spiel abgesagt', t: 'toggle' },
      { k: 'tentative', l: 'Tag steht noch nicht fest', t: 'toggle' },
      { k: 'note', l: 'Notiz', t: 'textarea' }],
    onSave: async v => {
      if (!v.date) return toast('Bitte ein Datum wählen');
      if (v.result && !parseResult(v.result)) return toast('Ergebnis bitte als „3:1“ eintragen');
      const id = g.id || uid('game');
      Store.put(id, 'game', { ...(Store.data(id) || {}), ...v });
      await Sheet.close();
      if (isNew) go('#/spiele/' + encodeURIComponent(id)); else render();
    },
    onDelete: isNew ? null : async () => { if (!confirmDel('Spiel')) return; Store.remove(g.id); await Sheet.close(); go('#/spiele'); },
  });
}
// ───────────────────────── Kader ─────────────────────────
const players = () => Store.all('player').sort(byName);
const tierIdx = p => { const i = TIER_RANK.indexOf(p.tier || ''); return i < 0 ? 9 : i; };
function posChips(p, max = 6) {
  const e = Object.entries(p.posv || {}).sort((a, b) => a[1] - b[1] || POSV.findIndex(x => x.k === a[0]) - POSV.findIndex(x => x.k === b[0]));
  return e.slice(0, max).map(([k, l]) => `<span class="pos l${l}">${posvOf(k)?.l || k}</span>`).join(' ') + (e.length > max ? ` <span class="tiny mute">+${e.length - max}</span>` : '');
}
const posText = p => Object.entries(p.posv || {}).sort((a, b) => a[1] - b[1]).map(([k, l]) => (posvOf(k)?.l || k) + (l === 2 ? '?' : '')).join(' ');
function viewKader(parts) {
  const sub = parts[0] || 'feld';
  let h = `<div class="seg">${[['feld', 'Feld'], ['tiers', 'Tiers'], ['positionen', 'Positionen'], ['liste', 'Liste']].map(([v, l]) => `<button class="${sub === v ? 'on' : ''}" data-a="open" data-h="#/kader/${v}">${l}</button>`).join('')}</div>`;
  if (sub === 'tiers') h += tierBoard();
  else if (sub === 'positionen') h += posMatrix();
  else if (sub === 'liste') h += kaderListe();
  else h += pitchView();
  return { title: 'Kader & Mannschaft', html: h, fab: sub === 'liste' || sub === 'tiers' ? 'newPlayer' : null };
}
const tierLegend = () => `<div class="legend" style="margin:8px 4px 2px">${TIERS.slice(0, 4).map(t => `<span><span class="dot" style="background:${t.c};width:9px;height:9px"></span> ${esc(t.l)}</span>`).join('')}
  <span><span class="pos l1">Stamm</span></span><span><span class="pos l2">in Frage</span> = eine Stufe tiefer</span></div>`;
function eligible(posKey, maxRank = 2) {
  return players().map(p => ({ p, e: effTier(p, posKey) })).filter(x => x.e && x.e.rank <= maxRank)
    .sort((a, b) => a.e.rank - b.e.rank || a.e.lv - b.e.lv || tierIdx(a.p) - tierIdx(b.p) || byName(a.p, b.p));
}
function pchip(p, e) {
  const t = tierOf(e.tier);
  return `<span class="pchip ${e.lv === 2 ? 'frage' : ''}" style="--tc:${t.c};--tb:${t.bg}" title="${esc(POSVLV[e.lv])} · ${esc(t.l)}${p.number ? ' · #' + esc(p.number) : ''}">${esc(p.short || p.name)}</span>`;
}
function pitchView() {
  let h = `<div class="pitch3"><div class="pm pm-touch"></div><div class="pm pm-box top"></div><div class="pm pm-six top"></div>
    <div class="pm pm-box bot"></div><div class="pm pm-six bot"></div>`;
  PITCH.forEach((row, i) => {
    if (i === 2) h += `<div class="halfway"><i class="hl"></i><i class="cc"></i><i class="cs"></i></div>`;
    for (const [k, a, b] of row) {
      const P = posvOf(k), list = eligible(k);
      h += `<div class="pbox" style="grid-column:${a}/${b}" data-a="posSheet" data-k="${k}" title="${esc(P.f)}">
        <div class="pl2"><b>${esc(P.l)}</b><em>${list.length || ''}</em></div><div class="pfull">${esc(P.f.replace(/ \(.*\)$/, ''))}</div>
        <div class="pchips">${list.map(x => pchip(x.p, x.e)).join('') || '<span class="pnone">niemand</span>'}</div></div>`;
    }
  });
  h += `</div>${tierLegend()}<div class="tiny mute" style="margin:6px 4px">Zu sehen ist jeder, der auf der Position mindestens „Okay“ ist. Position antippen, um Stamm / in Frage zu ändern.</div>`;
  const none = players().filter(p => !Object.keys(p.posv || {}).length);
  if (none.length) h += sec('Ohne Positionen') + `<div class="card">${none.map(p => `<span class="pill" data-a="editPlayer" data-id="${esc(p.id)}">${esc(p.name)}</span>`).join('')}</div>`;
  return h;
}
function posSheet(k) {
  const P = posvOf(k), ps = players().slice().sort((a, b) => tierIdx(a) - tierIdx(b) || byName(a, b));
  const row = p => {
    const lv = (p.posv || {})[k] || 0, e = effTier(p, k), t = tierOf(p.tier);
    return `<div class="li" style="padding:7px 2px"><span class="dot" style="background:${t.c}"></span><div class="grow"><div class="t">${esc(p.name)} <span class="tiny mute">${esc(t.l)}</span></div>
      <div class="s">${e ? (e.tier ? 'auf dieser Position: <b style="color:' + tierOf(e.tier).c + '">' + esc(tierOf(e.tier).l) + '</b>' : 'auf dieser Position: zu schwach') : '–'}</div></div>
      <div class="lvseg">${[[1, 'Stamm'], [2, 'in Frage'], [0, '–']].map(([v, l]) => `<button class="${lv === v ? 'on' : ''}" data-a="setPos" data-id="${esc(p.id)}" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div></div>`;
  };
  const on = ps.filter(p => (p.posv || {})[k]), off = ps.filter(p => !(p.posv || {})[k]);
  Sheet.open(`${P.l} · ${P.f}`, `<div class="card list">${on.map(row).join('') || '<div class="mute small">Noch niemand auf dieser Position.</div>'}</div>
    ${sec('Weitere Spieler')}<div class="card list">${off.map(row).join('')}</div>`);
}
function tierBoard() {
  const ps = players();
  let h = `<div class="small mute" style="margin:0 4px 8px">Spieler gedrückt halten und in eine andere Zeile ziehen – oder antippen und die Stufe wählen.</div>
    <div class="board"><div></div>${GROUPS.map(g => `<div class="h">${GROUPL[g]} <span>${ps.filter(p => p.group === g).length}</span></div>`).join('')}`;
  for (const t of TIERS) {
    const row = ps.filter(p => (p.tier || '') === t.k);
    if (!t.k && !row.length) continue;
    h += `<div class="rl" style="background:${t.c}">${esc(t.s)}<span>${row.length}</span></div>`;
    for (const g of GROUPS) h += `<div class="cell" data-drop="1" data-tier="${t.k}" data-group="${g}" style="--tb:${t.bg}">${row.filter(p => p.group === g).map(p => `<div class="nm" data-drag="${esc(p.id)}">${esc(p.short || p.name)}${p.number ? `<i>${esc(p.number)}</i>` : ''}</div>`).join('')}</div>`;
  }
  const noGroup = ps.filter(p => !p.group);
  h += `</div>${noGroup.length ? `<div class="small mute" style="margin-top:10px">Ohne Mannschaftsteil: ${noGroup.map(p => `<a class="link" data-a="quickTier" data-id="${esc(p.id)}">${esc(p.name)}</a>`).join(', ')}</div>` : ''}`;
  h += sec('Tiefe pro Position') + `<div class="card"><div class="depth">${POSV.map(P => {
    const c = r => eligible(P.k).filter(x => x.e.rank === r).length;
    return `<div class="drow" data-a="posSheet" data-k="${P.k}"><b>${esc(P.l)}</b><span class="dn">${[0, 1, 2].map(r => `<span style="background:${TIERS[r].c};opacity:${c(r) ? 1 : .18}">${c(r)}</span>`).join('')}</span></div>`;
  }).join('')}</div><div class="tiny mute" style="margin-top:8px">Anzahl Spieler je Position: <b style="color:${TIERS[0].c}">Top</b> · <b style="color:${TIERS[1].c}">Gut</b> · <b style="color:${TIERS[2].c}">Okay</b> – zeigt, wo der Kader dünn ist.</div></div>`;
  return h;
}
function quickTier(id) {
  const p = Store.get(id); if (!p) return;
  Sheet.open(p.name, `<div class="lab small mute" style="margin-bottom:6px">Einstufung</div>
    <div class="tierbtns">${TIERS.map(t => `<button class="${(p.tier || '') === t.k ? 'on' : ''}" style="--tc:${t.c}" data-a="setTier" data-id="${esc(id)}" data-t="${t.k}">${esc(t.l)}</button>`).join('')}</div>
    <div class="lab small mute" style="margin:14px 0 6px">Mannschaftsteil</div>
    <div class="tierbtns">${GROUPS.map(g => `<button class="${p.group === g ? 'on' : ''}" style="--tc:var(--accent)" data-a="setGroup" data-id="${esc(id)}" data-g="${g}">${GROUPL[g]}</button>`).join('')}</div>
    <div class="lab small mute" style="margin:14px 0 6px">Positionen</div><div>${posChips(p, 15) || '<span class="tiny mute">keine</span>'}</div>`,
    `<button class="btn primary" data-a="editPlayer" data-id="${esc(id)}">${icon('edit')} Profil bearbeiten</button>`);
}
function posMatrix() {
  const ps = players().sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || tierIdx(a) - tierIdx(b) || byName(a, b));
  return `<div class="small mute" style="margin:0 4px 8px">Zelle antippen: – → <b>S</b> (Stamm) → <b>F</b> (in Frage) → –. Wird sofort gespeichert.</div>
    <div class="matrix"><table><thead><tr><th></th>${POSV.map(P => `<th title="${esc(P.f)}">${esc(P.l)}</th>`).join('')}</tr></thead><tbody>
    ${ps.map(p => `<tr><th><span class="dot" style="background:${tierOf(p.tier).c};width:8px;height:8px"></span> ${esc(p.short || p.name)}</th>${POSV.map(P => {
      const lv = (p.posv || {})[P.k] || 0, e = effTier(p, P.k), t = e && e.tier ? tierOf(e.tier) : null;
      return `<td class="mx l${lv}" data-a="mxCycle" data-id="${esc(p.id)}" data-k="${P.k}" style="${t ? `--tc:${t.c};--tb:${t.bg}` : ''}">${lv === 1 ? 'S' : lv === 2 ? 'F' : ''}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>${tierLegend()}`;
}
function kaderListe() {
  const f = UI.kader;
  let ps = players();
  if (f.grp) ps = ps.filter(p => p.group === f.grp);
  if (f.q) ps = ps.filter(p => (p.name + ' ' + (p.short || '') + ' ' + (p.number || '')).toLowerCase().includes(f.q));
  let h = `<input class="search" type="search" placeholder="Spieler suchen…" value="${esc(f.q)}" data-a="kQ"><div id="results">`;
  h += chips([['', `Alle (${players().length})`], ...GROUPS.map(g => [g, GROUPL[g]])], f.grp, 'kGrp');
  for (const t of TIERS) {
    const list = ps.filter(p => (p.tier || '') === t.k).sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || byName(a, b)); if (!list.length) continue;
    h += `<div class="sec"><span class="dot" style="background:${t.c}"></span><span class="grow">${esc(t.l)} · ${list.length}</span></div><div class="card list">`;
    h += list.map(p => `<div class="pl" data-a="editPlayer" data-id="${esc(p.id)}"><span class="num" style="background:${t.c}">${esc(p.number || '?')}</span>
      <div class="grow"><div class="t ell">${esc(p.name)}</div><div class="tiny mute" style="margin-top:2px">${esc(GROUPL[p.group] || 'keine Gruppe')}${p.note ? ' · ' + esc(p.note) : ''}</div>
      <div style="margin-top:5px">${posChips(p)}</div></div>
      <div class="updown"><button class="iconbtn" data-a="tierMove" data-id="${esc(p.id)}" data-d="-1" ${tierIdx(p) === 0 ? 'disabled' : ''} aria-label="Höher einstufen">${icon('up')}</button>
      <button class="iconbtn" data-a="tierMove" data-id="${esc(p.id)}" data-d="1" ${tierIdx(p) >= 3 && p.tier ? 'disabled' : ''} aria-label="Tiefer einstufen">${icon('down')}</button></div></div>`).join('');
    h += '</div>';
  }
  if (!ps.length) h += '<div class="empty">Keine Spieler gefunden.</div>';
  return h + '</div>';
}
function playerForm(p = {}, isNew) {
  openForm({
    title: isNew ? 'Neuer Spieler' : p.name, value: { tier: '', group: '', ...p },
    fields: [
      [{ k: 'name', l: 'Vorname / Rufname', auto: isNew }, { k: 'number', l: 'Rückennummer', t: 'number' }],
      { k: 'tier', l: 'Einstufung', t: 'seg', opts: TIERS.map(t => [t.k, t.l]) },
      { k: 'group', l: 'Mannschaftsteil', t: 'seg', opts: [...GROUPS.map(g => [g, GROUPL[g]]), ['', 'keiner']] },
      { k: 'posv', l: 'Positionen', t: 'posv' },
      { k: 'stp', l: 'Stützpunkt', t: 'toggle' },
      { k: 'note', l: 'Notiz', t: 'textarea' }],
    onSave: async v => {
      if (!v.name) return toast('Bitte einen Namen eingeben');
      v.short = v.name;
      Store.put(p.id || uid('player'), 'player', { ...(p.id ? Store.data(p.id) : {}), ...v }); await Sheet.close(); render();
    },
    onDelete: isNew ? null : async () => { if (!confirmDel(p.name)) return; Store.remove(p.id); await Sheet.close(); render(); },
  });
}
// Ziehen & Ablegen im Tier-Board (Maus + Touch, Touch per langem Drücken)
const Drag = { el: null, id: null, ghost: null, timer: null, start: null, active: false };
function dragEnd(commit, x, y) {
  clearTimeout(Drag.timer);
  const wasActive = Drag.active, id = Drag.id;
  if (Drag.ghost) Drag.ghost.remove();
  $$('.cell.over').forEach(c => c.classList.remove('over'));
  Drag.el && Drag.el.classList.remove('lifted');
  Object.assign(Drag, { el: null, id: null, ghost: null, timer: null, start: null, active: false });
  if (!commit || !id) return;
  if (!wasActive) return quickTier(id);
  const t = document.elementFromPoint(x, y)?.closest('[data-drop]');
  if (!t) return;
  const p = Store.data(id); if (!p) return;
  if ((p.tier || '') === t.dataset.tier && p.group === t.dataset.group) return;
  Store.patch(id, 'player', { tier: t.dataset.tier, group: t.dataset.group });
  toast(`${p.short || p.name} → ${tierOf(t.dataset.tier).l}`); render();
}
function dragActivate(x, y) {
  Drag.active = true; Drag.el.classList.add('lifted');
  const g = Drag.el.cloneNode(true); g.className = 'nm ghost'; document.body.appendChild(g); Drag.ghost = g;
  dragMove(x, y); if (navigator.vibrate) navigator.vibrate(15);
}
function dragMove(x, y) {
  if (!Drag.ghost) return;
  Drag.ghost.style.left = x + 'px'; Drag.ghost.style.top = y + 'px';
  $$('.cell.over').forEach(c => c.classList.remove('over'));
  Drag.ghost.style.display = 'none'; const t = document.elementFromPoint(x, y)?.closest('[data-drop]'); Drag.ghost.style.display = '';
  t && t.classList.add('over');
}
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-drag]'); if (!el) return;
  Object.assign(Drag, { el, id: el.dataset.drag, start: [e.clientX, e.clientY], active: false, touch: e.pointerType !== 'mouse' });
  if (Drag.touch) Drag.timer = setTimeout(() => dragActivate(Drag.start[0], Drag.start[1]), 320);
});
document.addEventListener('pointermove', e => {
  if (!Drag.el) return;
  const dx = e.clientX - Drag.start[0], dy = e.clientY - Drag.start[1], far = Math.hypot(dx, dy) > 8;
  if (!Drag.active) { if (far) { if (Drag.touch) { dragEnd(false); } else dragActivate(e.clientX, e.clientY); } return; }
  e.preventDefault(); dragMove(e.clientX, e.clientY);
});
document.addEventListener('pointerup', e => { if (Drag.el) dragEnd(true, e.clientX, e.clientY); });
document.addEventListener('pointercancel', () => { if (Drag.el && !Drag.active) dragEnd(false); });
document.addEventListener('touchmove', e => {
  if (!Drag.active) return; e.preventDefault();
  const t = e.touches[0]; Drag.last = [t.clientX, t.clientY]; dragMove(t.clientX, t.clientY);
}, { passive: false });
document.addEventListener('touchend', e => { if (Drag.active) { const t = e.changedTouches[0]; dragEnd(true, t.clientX, t.clientY); } });
document.addEventListener('contextmenu', e => { if (e.target.closest('[data-drag]')) e.preventDefault(); });
// ───────────────────────── Training ─────────────────────────
function viewTraining(parts) {
  const sub = parts[0] || 'woche';
  let h = `<div class="seg">${[['woche', 'Woche'], ['uebungen', 'Übungen'], ['athletik', 'Athletik'], ['themen', 'Themen']].map(([v, l]) => `<button class="${sub === v ? 'on' : ''}" data-a="open" data-h="#/training/${v}">${l}</button>`).join('')}</div>`;
  let fab = null;
  if (sub === 'uebungen') { h += exerciseList(); fab = 'newExercise'; }
  else if (sub === 'athletik') { h += athleticList(); fab = 'newAthletic'; }
  else if (sub === 'themen') { h += topicList(); fab = 'newTopic'; }
  else h += trainingWeek(parts[1] || D.week(D.today()).key);
  return { title: 'Training', html: h, fab };
}
function mesoDistribution(p) {
  const cnt = {}; let total = 0;
  for (const w of weeksOf(p)) for (const d of Object.values(weekData(w.key).days || {})) if (d.phase && d.phase !== 'FREI') { cnt[d.phase] = (cnt[d.phase] || 0) + 1; total++; }
  if (!total) return `<div class="tiny mute">In dieser Phase ist noch kein Trainingstag einer Spielphase zugeordnet.</div>`;
  const keys = Object.keys(GP).filter(k => cnt[k]);
  return `<div class="distbar">${keys.map(k => `<i style="width:${cnt[k] / total * 100}%;background:${GP[k].c}"></i>`).join('')}</div>
    <div class="legend">${keys.map(k => `<span><span class="dot" style="background:${GP[k].c};width:8px;height:8px"></span> ${gpS(k)} ${cnt[k]}×</span>`).join('')}</div>`;
}
function trainingWeek(key) {
  const mon = D.fromKey(key), p = phaseAt(mon) || phaseAt(D.add(mon, 6)), w = weekData(key), days = setting().trainingDays || [2, 4, 5];
  let h = weekNav(key, '#/training/woche/');
  h += `<div class="card"><h3>Fokus der Woche</h3><div class="f" style="margin:0"><input type="text" data-a="weekField" data-week="${key}" data-f="focus" value="${esc(w.focus || '')}" placeholder="z. B. Schnelligkeit & Explosivität, Umschalten…"></div>
    ${p ? `<div class="sub" style="margin-top:12px">Spielphasen in der ${esc(p.label)} bisher</div>${mesoDistribution(p)}` : ''}</div>`;
  for (const d of days) {
    const date = D.add(mon, d - 1), dd = (w.days || {})[d] || {}, ph = GP[dd.phase];
    const tops = (dd.topics || []).map(id => Store.get(id)).filter(Boolean);
    const exs = (dd.exercises || []).map(id => Store.get(id)).filter(Boolean);
    const aths = (dd.athletics || []).map(id => Store.get(id)).filter(Boolean);
    const games = gamesBetween(date, date);
    const isToday = date === D.today();
    h += `<div class="card day ${isToday ? 'today' : ''}" style="--dc:${ph ? ph.c : 'var(--line)'}"><h3><span class="grow">${WD[d]} ${D.short(date)}${isToday ? ' <span class="todaytag">heute</span>' : ''}</span></h3>
      ${games.map(g => `<div class="gamelink" data-a="open" data-h="#/spiele/${encodeURIComponent(g.id)}">${icon('spiele', 'mini')} Spiel: <b>${esc(g.opponent)}</b>${g.kickoff ? ' · ' + esc(g.kickoff) : ''}${icon('chev', 'chev')}</div>`).join('')}
      <button class="phpick ${ph ? 'set' : ''}" style="--c:${ph ? ph.c : 'var(--mute)'}" data-a="phasePick" data-week="${key}" data-day="${d}">
        ${ph ? `<span class="phcode">${esc(ph.s)}</span><span class="grow">${esc(ph.l)}</span>` : `<span class="grow">Spielphase wählen</span>`}${icon('down', 'chev')}</button>
      ${dd.phase === 'FREI' ? '' : `
      <div class="sub"><span class="grow">Schwerpunkte</span><button class="link" data-a="pickDay" data-what="topics" data-week="${key}" data-day="${d}">+ wählen</button></div>
      <div>${tops.map(t => `<span class="topicchip">${esc(t.title)}</span>`).join('') || '<span class="tiny mute">Aus dem Periodisierungsplan wählen</span>'}</div>
      <div class="sub"><span class="grow">Übungen</span><button class="link" data-a="pickDay" data-what="exercises" data-week="${key}" data-day="${d}">+ wählen</button></div>
      ${exs.map(e => `<div class="li" data-a="exOpen" data-id="${esc(e.id)}" style="padding:7px 0"><div class="grow small"><b>${esc(exName(e))}</b> <span class="mute">${esc([e.diff, e.intensity].filter(Boolean).join(' · '))}</span></div>${icon('chev', 'chev')}</div>`).join('') || '<div class="tiny mute">Aus dem Übungsportfolio wählen</div>'}
      <div class="sub"><span class="grow">Athletik</span><button class="link" data-a="pickDay" data-what="athletics" data-week="${key}" data-day="${d}">+ wählen</button></div>
      ${aths.map(a => `<div class="li" data-a="athOpen" data-id="${esc(a.id)}" style="padding:7px 0"><div class="grow small"><b>${esc(a.name)}</b> <span class="mute">${esc([a.dist, a.reps].filter(Boolean).join(' · '))}</span></div>${icon('chev', 'chev')}</div>`).join('') || '<div class="tiny mute">Aus dem Athletikportfolio wählen</div>'}`}
      <div class="f" style="margin:10px 0 0"><textarea data-a="dayNote" data-week="${key}" data-day="${d}" placeholder="Notiz zum Training…" style="min-height:52px">${esc(dd.note || '')}</textarea></div></div>`;
  }
  h += `<div class="tiny mute" style="margin:4px">Trainingstage änderst du über das Wappen oben rechts → Einstellungen.</div>`;
  return h;
}
const exName = e => e.name + (e.variant ? ' ' + e.variant : '');
function fitRange(e) { const ks = Object.keys(e.fit || {}).map(Number).filter(n => e.fit[n]); return ks.length ? `${Math.min(...ks)}–${Math.max(...ks)} Spieler` : ''; }
function exerciseList() {
  const f = UI.ex; if (f.n == null) f.n = setting().exPlayers || 16;
  const lv = x => LVL3.indexOf(x);
  let ex = Store.all('exercise');
  if (f.diff) ex = ex.filter(e => e.diff === f.diff);
  if (f.int) ex = ex.filter(e => e.intensity === f.int);
  if (f.ph) ex = ex.filter(e => (e.phases || []).includes(f.ph));
  if (f.q) ex = ex.filter(e => (exName(e) + ' ' + (e.expl || '')).toLowerCase().includes(f.q));
  const fit = e => (e.fit || {})[f.n] || 0;
  const sorts = { fit: (a, b) => fit(b) - fit(a) || byName(a, b), name: byName, diff: (a, b) => lv(a.diff) - lv(b.diff), int: (a, b) => lv(b.intensity) - lv(a.intensity), rating: (a, b) => (b.rating || 0) - (a.rating || 0) };
  ex.sort(sorts[f.sort] || sorts.fit);
  if (f.sort === 'fit' && f.onlyFit) ex = ex.filter(e => fit(e) > 0);
  let h = `<input class="search" type="search" placeholder="Übung suchen…" value="${esc(f.q)}" data-a="exQ"><div id="results">
    <div class="filters"><div class="stepper"><button data-a="exN" data-d="-1">−</button><b>${f.n}</b><button data-a="exN" data-d="1">+</button></div><span class="small mute">Feldspieler</span>
    <select data-a="exSel" data-f="sort"><option value="fit" ${f.sort === 'fit' ? 'selected' : ''}>Passend zuerst</option><option value="name" ${f.sort === 'name' ? 'selected' : ''}>Name</option><option value="diff" ${f.sort === 'diff' ? 'selected' : ''}>Schwierigkeit ↑</option><option value="int" ${f.sort === 'int' ? 'selected' : ''}>Intensität ↓</option><option value="rating" ${f.sort === 'rating' ? 'selected' : ''}>Bewertung</option></select></div>
    <div class="filters"><select data-a="exSel" data-f="diff"><option value="">Schwierigkeit: alle</option>${LVL3.map(x => `<option ${f.diff === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <select data-a="exSel" data-f="int"><option value="">Intensität: alle</option>${LVL3.map(x => `<option ${f.int === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <select data-a="exSel" data-f="ph"><option value="">Spielphase: alle</option>${GP5.map(k => `<option value="${k}" ${f.ph === k ? 'selected' : ''}>${GP[k].s} · ${GP[k].l}</option>`).join('')}</select></div>`;
  h += `<div class="card list">${ex.map(e => { const s = fit(e); return `<div class="li" data-a="exOpen" data-id="${esc(e.id)}"><div class="grow"><div class="t">${esc(exName(e))}</div>
    <div class="badges">${e.diff ? badge('Schwierigkeit ' + e.diff) : ''}${e.intensity ? badge('Intensität ' + e.intensity) : ''}${(e.phases || []).map(k => badge(gpS(k), GP[k]?.c)).join('')}${e.rating ? badge('★'.repeat(e.rating)) : ''}</div>
    <div class="tiny mute" style="margin-top:4px">${esc(fitRange(e) || 'Spielerzahl nicht hinterlegt')}</div></div><span class="fitb fit${s}">${FITL[s]}</span></div>`; }).join('') || '<div class="empty">Keine Übungen gefunden.</div>'}</div></div>`;
  return h;
}
function exerciseDetail(id) {
  const e = Store.get(id); if (!e) return;
  const rows = [['Erklärung', e.expl], ['Aufbau', e.setup], ['Material', e.material], ['Vorteile', e.pros], ['Nachteile', e.cons], ['Variationen', e.variations], ['Vorteile der Variation', e.varPros], ['Nachteile der Variation', e.varCons]].filter(x => x[1]);
  let fitg = ''; for (let n = 1; n <= 21; n++) { const s = (e.fit || {})[n] || 0; fitg += `<span class="fitb fit${s}" style="text-align:center">${n}</span>`; }
  const plannedIn = Store.all('week').filter(w => Object.values(w.days || {}).some(d => (d.exercises || []).includes(id))).length;
  Sheet.open(exName(e), `<div class="badges" style="margin-top:0">${e.diff ? badge('Schwierigkeit ' + e.diff) : ''}${e.intensity ? badge('Intensität ' + e.intensity) : ''}${(e.phases || []).map(k => badge(GP[k].s + ' · ' + GP[k].l, GP[k].c)).join('')}${e.rating ? badge('★'.repeat(e.rating)) : ''}</div>
    <div class="sub" style="margin-top:14px">Feldspieler (grün = ideal, hell = möglich)</div><div class="fitgrid">${fitg}</div>
    ${rows.length ? `<dl class="kv" style="margin-top:14px">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '<div class="mute small" style="margin-top:14px">Noch keine Beschreibung – über „Bearbeiten“ ergänzen.</div>'}
    ${e.link ? `<p><a class="link" href="${esc(e.link)}" target="_blank" rel="noopener">${icon('link')} Video / Link öffnen</a></p>` : ''}
    <div class="tiny mute" style="margin-top:12px">${plannedIn ? `In ${cap(plannedIn, 'Trainingswoche', 'Trainingswochen')} eingeplant.` : 'Noch in keiner Trainingswoche eingeplant.'}</div>`,
    `<button class="btn primary" data-a="editExercise" data-id="${esc(id)}">${icon('edit')} Bearbeiten</button>`);
}
function exerciseForm(e = {}, isNew) {
  openForm({
    title: isNew ? 'Neue Übung' : 'Übung bearbeiten', value: e,
    fields: [[{ k: 'name', l: 'Name', auto: isNew }, { k: 'variant', l: 'Variante (z. B. 1, 2)' }],
      { k: 'phases', l: 'Spielphasen', t: 'chips', opts: GP5.map(k => [k, GP[k].s + ' · ' + GP[k].l]) },
      { k: 'expl', l: 'Erklärung', t: 'textarea' }, { k: 'fit', l: 'Passt für … Feldspieler', t: 'fit' },
      { k: 'diff', l: 'Schwierigkeit', t: 'seg', opts: [...LVL3.map(x => [x, x]), ['', 'offen']] },
      { k: 'intensity', l: 'Intensität', t: 'seg', opts: [...LVL3.map(x => [x, x]), ['', 'offen']] },
      { k: 'rating', l: 'Bewertung', t: 'seg', opts: [[0, '–'], [1, '★'], [2, '★★'], [3, '★★★'], [4, '★★★★'], [5, '★★★★★']] },
      { k: 'setup', l: 'Aufbau', t: 'textarea' }, { k: 'material', l: 'Material' },
      { k: 'pros', l: 'Vorteile', t: 'textarea' }, { k: 'cons', l: 'Nachteile', t: 'textarea' },
      { k: 'variations', l: 'Variationen', t: 'textarea' }, [{ k: 'varPros', l: 'Vorteile Variation' }, { k: 'varCons', l: 'Nachteile Variation' }],
      { k: 'link', l: 'Link (Video, Instagram …)', t: 'url' }],
    onSave: async v => {
      if (!v.name) return toast('Bitte einen Namen eingeben');
      v.rating = +v.rating || 0; const id = e.id || uid('ex');
      Store.put(id, 'exercise', { ...(e.id ? Store.data(e.id) : {}), ...v }); await Sheet.close(); render();
    },
    onDelete: isNew ? null : async () => { if (!confirmDel('Übung')) return; Store.remove(e.id); await Sheet.close(); render(); },
  });
}
const ATHCATS = ['Explosivität / Sprint', 'Kraft / Muskelaufbau', 'Sprungkraft', 'Ausdauer', 'Mobilisation / Dehnung'];
function athleticList() {
  const f = UI.ath;
  let list = Store.all('athletic').sort(byOrder);
  if (f.cat) list = list.filter(a => a.cat === f.cat);
  if (f.q) list = list.filter(a => (a.name + ' ' + a.expl + ' ' + a.area + ' ' + a.sub).toLowerCase().includes(f.q));
  let h = `<input class="search" type="search" placeholder="Athletikübung suchen…" value="${esc(f.q)}" data-a="athQ"><div id="results">`;
  h += chips([['', 'Alle'], ...ATHCATS.map(c => [c, c.split(' / ')[0]])], f.cat, 'athCat');
  let cur = null, open = false;
  for (const a of list) {
    const head = a.cat + (a.sub ? ' · ' + a.sub : '');
    if (head !== cur) { if (open) h += '</div>'; h += sec(head) + '<div class="card list">'; cur = head; open = true; }
    h += `<div class="li" data-a="athOpen" data-id="${esc(a.id)}"><div class="grow"><div class="t">${esc(a.name)}</div>
      <div class="s">${esc([a.area && a.area !== a.name ? a.area : '', a.mode, a.dist, a.reps].filter(Boolean).join(' · '))}</div>
      ${a.expl ? `<div class="tiny mute clamp2 prewrap" style="margin-top:3px">${esc(a.expl)}</div>` : ''}</div>${icon('chev', 'chev')}</div>`;
  }
  if (open) h += '</div>';
  if (!list.length) h += '<div class="empty">Keine Übungen gefunden.</div>';
  const sess = Store.all('athsession').sort(byDate);
  if (sess.length && !f.q) {
    h += sec('Athletik-Einheiten (Vorlagen)') + `<div class="card list">${sess.map(s => `<div class="li" data-a="sessOpen" data-id="${esc(s.id)}"><div class="grow"><div class="t">${esc(s.title)}</div><div class="s">${esc(s.focus || '')}${s.date ? ' · ' + D.full(s.date) : ''}</div></div>${icon('chev', 'chev')}</div>`).join('')}</div>`;
  }
  return h + '</div>';
}
function athleticForm(a = {}, isNew) {
  openForm({
    title: isNew ? 'Neue Athletikübung' : 'Athletikübung', value: { cat: UI.ath.cat || ATHCATS[0], ...a },
    fields: [{ k: 'name', l: 'Übung', auto: isNew }, { k: 'cat', l: 'Bereich', t: 'select', opts: ATHCATS.map(c => [c, c]) },
      [{ k: 'sub', l: 'Unterbereich', ph: 'z. B. Start / Antritt' }, { k: 'area', l: 'Körperregion', ph: 'z. B. Core' }],
      { k: 'expl', l: 'Erklärung', t: 'textarea' }, [{ k: 'dist', l: 'Distanz' }, { k: 'reps', l: 'Wiederholungen' }], { k: 'link', l: 'Link', t: 'url' }],
    onSave: async v => { if (!v.name) return toast('Bitte einen Namen eingeben'); Store.put(a.id || uid('ath'), 'athletic', { ...(a.id ? Store.data(a.id) : { order: 999 }), ...v }); await Sheet.close(); render(); },
    onDelete: isNew ? null : async () => { if (!confirmDel('Übung')) return; Store.remove(a.id); await Sheet.close(); render(); },
  });
}
function athDetail(id) {
  const a = Store.get(id); if (!a) return;
  const rows = [['Bereich', a.cat + (a.sub ? ' · ' + a.sub : '')], ['Körperregion', a.area], ['Art', a.mode], ['Distanz', a.dist], ['Wiederholungen', a.reps], ['Erklärung', a.expl]].filter(x => x[1]);
  Sheet.open(a.name, `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${a.link ? `<p><a class="link" href="${esc(a.link)}" target="_blank" rel="noopener">${icon('link')} Link öffnen</a></p>` : ''}`,
    `<button class="btn primary" data-a="editAthletic" data-id="${esc(id)}">${icon('edit')} Bearbeiten</button>`);
}
const TOPICCATS = ['Grundlagen', 'Gruppentaktik', 'Mannschaftstaktik', 'Individualtaktik & Technik', 'Individuelle Fähigkeiten'];
function topicUse() { const c = {}; for (const w of Store.all('week')) for (const d of Object.values(w.days || {})) for (const t of d.topics || []) c[t] = (c[t] || 0) + 1; return c; }
function topicList() {
  const f = UI.topics, use = topicUse();
  let ts = Store.all('topic').sort(byOrder);
  if (f.ph) ts = ts.filter(t => (t.phases || []).includes(f.ph) || (t.phases || []).includes('ALL'));
  let h = `<div class="small mute" style="margin:0 4px 8px">Dein Periodisierungsplan: Themen je Spielphase. Die Zahl zeigt, wie oft ein Thema schon im Training eingeplant ist.</div>`;
  h += chips([['', 'Alle'], ...GP5.map(k => [k, gpS(k)])], f.ph, 'topPh');
  if (f.ph) h += `<div class="small" style="margin:0 4px 6px;color:${GP[f.ph].c};font-weight:700">${GP[f.ph].s} · ${GP[f.ph].l}</div>`;
  for (const cat of TOPICCATS) {
    const list = ts.filter(t => t.cat === cat); if (!list.length) continue;
    h += sec(cat) + `<div class="card">${list.map(t => `<span class="topicchip" data-a="editTopic" data-id="${esc(t.id)}">${(t.phases || []).filter(p => p !== 'ALL').map(p => `<span class="dot" style="background:${GP[p]?.c};width:7px;height:7px"></span>`).join('')}${esc(t.title)}${use[t.id] ? ` <span class="n">${use[t.id]}×</span>` : ''}</span>`).join('')}</div>`;
  }
  return h;
}
function topicForm(t = {}, isNew) {
  openForm({
    title: isNew ? 'Neues Thema' : 'Thema', value: { cat: 'Gruppentaktik', phases: UI.topics.ph ? [UI.topics.ph] : [], ...t },
    fields: [{ k: 'title', l: 'Thema', auto: isNew }, { k: 'cat', l: 'Kategorie', t: 'select', opts: TOPICCATS.map(c => [c, c]) },
      { k: 'phases', l: 'Spielphasen', t: 'chips', opts: [...GP5.map(k => [k, GP[k].s + ' · ' + GP[k].l]), ['ALL', 'alle Phasen']] }],
    onSave: async v => { if (!v.title) return toast('Bitte einen Titel eingeben'); Store.put(t.id || uid('topic'), 'topic', { ...(t.id ? Store.data(t.id) : { order: 999 }), ...v }); await Sheet.close(); render(); },
    onDelete: isNew ? null : async () => { if (!confirmDel('Thema')) return; Store.remove(t.id); await Sheet.close(); render(); },
  });
}
function pickDay(what, key, day) {
  const w = weekData(key), dd = (w.days || {})[day] || {}, sel = dd[what] || [];
  let opts, title;
  if (what === 'topics') {
    title = 'Schwerpunkte';
    const ph = dd.phase, rank = t => (t.phases || []).includes(ph) ? 0 : (t.phases || []).includes('ALL') ? 1 : 2;
    opts = Store.all('topic').sort((a, b) => rank(a) - rank(b) || TOPICCATS.indexOf(a.cat) - TOPICCATS.indexOf(b.cat) || byOrder(a, b))
      .map(t => ({ v: t.id, l: t.title, g: rank(t) === 0 ? `${GP[ph].l} · ${t.cat}` : rank(t) === 1 ? 'Für alle Phasen' : `Andere Phasen · ${t.cat}`, s: (t.phases || []).filter(x => x !== 'ALL').map(gpS).join(', ') }));
  } else if (what === 'exercises') {
    title = 'Übungen'; const n = UI.ex.n || setting().exPlayers || 16, ph = dd.phase;
    opts = Store.all('exercise').sort((a, b) => ((b.phases || []).includes(ph) - (a.phases || []).includes(ph)) || (((b.fit || {})[n] || 0) - ((a.fit || {})[n] || 0)) || byName(a, b))
      .map(e => ({ v: e.id, l: exName(e), s: [e.diff && 'Schwierigkeit ' + e.diff, e.intensity && 'Intensität ' + e.intensity, fitRange(e)].filter(Boolean).join(' · '), r: `<span class="fitb fit${(e.fit || {})[n] || 0}">${n}: ${FITL[(e.fit || {})[n] || 0]}</span>` }));
  } else {
    title = 'Athletik';
    opts = Store.all('athletic').sort(byOrder).map(a => ({ v: a.id, l: a.name, g: a.cat + (a.sub ? ' · ' + a.sub : ''), s: [a.area, a.dist, a.reps].filter(Boolean).join(' · ') }));
  }
  openForm({
    title, value: { sel }, fields: [{ k: 'sel', t: 'multi', opts }], saveLabel: 'Übernehmen',
    onSave: async v => { setDay(key, day, { [what]: v.sel }); await Sheet.close(); render(); },
  });
}
function setDay(key, day, part) {
  const w = { ...weekData(key) }; w.days = { ...(w.days || {}) }; w.days[day] = { ...(w.days[day] || {}), ...part };
  Store.put('week:' + key, 'week', w);
}

// ───────────────────────── Testspiele & Kontakte ─────────────────────────
const norm = s => ' ' + (s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, ' ') + ' ';
const STOP = /\s(1|fc|sc|sv|tus|vfl|vfb|sg|fv|tsv|ev|u1\d|u\d|f|04|05|06|07|08|09|19|2012er|2013|e)(?=\s)/g;
const normC = s => norm(s).replace(STOP, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();
function sameClub(a, b) {
  const x = normC(a), y = normC(b); if (!x || !y) return false; if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.split(' ').length >= 2 && (' ' + l + ' ').includes(' ' + s + ' ');
}
const findClub = name => name ? Store.all('club').find(c => normC(c.name) === normC(name)) || Store.all('club').find(c => sameClub(c.name, name)) : null;
const contactsFor = name => name ? Store.all('contact').filter(c => c.club && sameClub(c.club, name)) : [];
const TSTATUS = [
  { k: 'callback', l: 'Zurückmelden', d: 'Hier müssen wir uns melden', c: '#d97706', f: c => c.callback && !c.done },
  { k: 'open', l: 'Noch nicht angefragt', d: 'Kandidaten für die nächste Anfrage', c: '#5b4a8f', f: c => !c.requested && !c.callback && !c.done },
  { k: 'requested', l: 'Angefragt – warten auf Antwort', d: '', c: '#0e7490', f: c => c.requested && !c.callback && !c.done },
  { k: 'done', l: 'Vereinbart', d: '', c: '#15803d', f: c => c.done }];
const LVC = { NLZ: '#312e81', Regio: '#7c3aed', VL: '#0e7490', BZL: '#15803d', SDL: '#a16207', '': '#94a3b8' };
const lvlRank = k => { const i = LEVELS.findIndex(l => l.k === (k || '')); return i < 0 ? 99 : i; };
function viewTests() {
  const f = UI.tests; if (!(f.lvls instanceof Set)) f.lvls = new Set();
  let cl = Store.all('club');
  const all = cl.length;
  if (f.q) cl = cl.filter(c => (c.name + ' ' + c.stadt + ' ' + c.kreis + ' ' + c.trainer).toLowerCase().includes(f.q));
  if (f.lvls.size) cl = cl.filter(c => f.lvls.has(c.level || ''));
  cl.sort((a, b) => lvlRank(a.level) - lvlRank(b.level) || byName(a, b));
  const tg = Store.all('game').filter(g => g.type === 'Test' && !g.cancelled && g.date >= D.today()).sort(byDate);
  let h = `<div class="linkrow" data-a="gTest">${icon('spiele', 'mini')}<span class="grow">Testspiele im Spielplan${tg.length ? ` · nächstes: <b>${esc(shortOpp(tg[0].opponent))}</b> ${D.short(tg[0].date)}` : ' · keins geplant'}</span>${icon('chev', 'chev')}</div>
    <input class="search" type="search" placeholder="Verein, Stadt, Kreis suchen…" value="${esc(f.q)}" data-a="tQ"><div id="results">`;
  h += `<div class="chips wrapchips"><button class="chip ${f.lvls.size ? '' : 'on'}" data-a="tLvl" data-v="*">Alle Niveaus (${all})</button>${LEVELS.filter(l => l.k).map(l => `<button class="chip ${f.lvls.has(l.k) ? 'on' : ''}" data-a="tLvl" data-v="${l.k}">${esc(l.k)}</button>`).join('')}</div>`;
  h += chips([['', 'Jeder Status'], ...TSTATUS.map(s => [s.k, s.l.split(' –')[0]])], f.st, 'tSt');
  for (const S of TSTATUS) {
    if (f.st && f.st !== S.k) continue;
    const list = cl.filter(S.f); if (!list.length) continue;
    h += `<div class="sec"><span class="dot" style="background:${S.c}"></span><span class="grow">${esc(S.l)} · ${list.length}</span></div>${S.d ? `<div class="tiny mute" style="margin:-4px 4px 6px">${esc(S.d)}</div>` : ''}
      <div class="ctiles">${list.map(clubTile).join('')}</div>`;
  }
  if (!cl.length) h += '<div class="empty">Keine Vereine für diese Auswahl.</div>';
  h += '</div>';
  return { title: 'Testspielplanung', html: h, fab: 'newClub' };
}
function clubTile(c) {
  const n = contactsFor(c.name).length, L = LEVELS.find(l => l.k === (c.level || ''));
  const g = Store.all('game').filter(x => !x.cancelled && x.date >= D.today() && sameClub(x.opponent, c.name)).sort(byDate)[0];
  return `<div class="ctile" data-a="openClub" data-id="${esc(c.id)}" style="--lc:${LVC[c.level || '']}">
    <div class="row" style="gap:6px"><span class="lvb">${esc(c.level || '–')}</span>${n ? `<span class="tiny mute">${icon('phone', 'mini')}${n}</span>` : ''}${c.result ? `<span class="tiny" style="margin-left:auto;font-weight:700">${esc(c.result)}</span>` : ''}</div>
    <div class="cn">${esc(c.name)}</div><div class="cp">${g ? `<b class="cgame">${icon('spiele', 'mini')}${D.short(g.date)}</b> ` : ''}${esc(c.stadt || c.kreis || L?.l || '')}</div>
    <div class="cflags"><button class="flagbtn ${c.requested ? 'on' : ''}" data-a="clubFlag" data-id="${esc(c.id)}" data-f="requested">angefragt</button><button class="flagbtn cb ${c.callback ? 'on' : ''}" data-a="clubFlag" data-id="${esc(c.id)}" data-f="callback">melden</button><button class="flagbtn ok ${c.done ? 'on' : ''}" data-a="clubFlag" data-id="${esc(c.id)}" data-f="done">fix</button></div></div>`;
}
function clubDetail(id) {
  const c = Store.get(id); if (!c) return;
  const contacts = contactsFor(c.name), games = Store.all('game').filter(g => sameClub(g.opponent, c.name) || normC(g.opponent) === normC(c.name)).sort(byDate);
  const rows = [['Niveau', LEVELS.find(l => l.k === c.level)?.l], ['Jahrgang', c.jahrgang], ['Stadt', c.stadt], ['Kreis', c.kreis], ['Verband', c.verband], ['Bundesland', c.bundesland], ['Trainer', c.trainer], ['Ergebnis / Termin', c.result], ['Notiz', c.note]].filter(x => x[1]);
  Sheet.open(c.name, `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="sub" style="margin-top:14px">Kontakte</div>${contacts.length ? `<div class="card list" style="margin:0">${contacts.map(contactRow).join('')}</div>` : '<div class="tiny mute">Kein Kontakt zu diesem Verein gespeichert.</div>'}
    <div class="sub" style="margin-top:14px">Spiele gegen diesen Verein</div>${games.length ? `<div class="card list" style="margin:0">${games.map(gameLine).join('')}</div>` : '<div class="tiny mute">Noch keins eingetragen.</div>'}`,
    `<button class="btn" data-a="editClub" data-id="${esc(id)}">${icon('edit')} Bearbeiten</button><button class="btn primary" data-a="clubToGame" data-id="${esc(id)}">Als Spiel eintragen</button>`);
}
function clubForm(c = {}, isNew) {
  openForm({
    title: isNew ? 'Neuer Verein' : 'Verein bearbeiten', value: { jahrgang: '2013', ...c },
    fields: [{ k: 'name', l: 'Verein', auto: isNew }, { k: 'level', l: 'Niveau', t: 'seg', opts: LEVELS.map(l => [l.k, l.l]) },
      [{ k: 'stadt', l: 'Stadt' }, { k: 'kreis', l: 'Kreis' }], [{ k: 'verband', l: 'Verband' }, { k: 'bundesland', l: 'Bundesland' }],
      [{ k: 'jahrgang', l: 'Jahrgang (Team)' }, { k: 'result', l: 'Ergebnis / Termin' }], { k: 'trainer', l: 'Trainer' },
      { k: 'requested', l: 'Angefragt', t: 'toggle' }, { k: 'callback', l: 'Muss sich zurückmelden', t: 'toggle' }, { k: 'done', l: 'Vereinbart / abgeschlossen', t: 'toggle' },
      { k: 'note', l: 'Notiz', t: 'textarea' }],
    onSave: async v => { if (!v.name) return toast('Bitte einen Namen eingeben'); Store.put(c.id || uid('club'), 'club', { ...(c.id ? Store.data(c.id) : {}), ...v }); await Sheet.close(); render(); },
    onDelete: isNew ? null : async () => { if (!confirmDel(c.name)) return; Store.remove(c.id); await Sheet.close(); render(); },
  });
}
const telHref = p => 'tel:' + (p || '').replace(/[^\d+]/g, '');
const waHref = p => 'https://wa.me/' + (p || '').replace(/\D/g, '').replace(/^0/, '49');
function contactRow(c) {
  return `<div class="li"><div class="grow" data-a="editContact" data-id="${esc(c.id)}"><div class="t ell">${esc([c.first, c.last].filter(Boolean).join(' '))}</div>
    <div class="s ell">${esc([c.role, c.club, c.team && (/^\d{4}$/.test(c.team) ? 'Jg. ' + c.team : c.team)].filter(Boolean).join(' · '))}</div></div>
    <div class="actions">${c.phone ? `<a href="${telHref(c.phone)}" aria-label="Anrufen">${icon('phone')}</a><a href="${waHref(c.phone)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('chat')}</a>` : ''}${c.email ? `<a href="mailto:${esc(c.email)}" aria-label="E-Mail">${icon('mail')}</a>` : ''}</div></div>`;
}
function viewKontakte() {
  const f = UI.contacts;
  let cs = Store.all('contact').sort((a, b) => (a.club || 'zzz').localeCompare(b.club || 'zzz', 'de') || (a.first || '').localeCompare(b.first || '', 'de'));
  if (f.q) cs = cs.filter(c => [c.first, c.last, c.club, c.role, c.team].join(' ').toLowerCase().includes(f.q));
  let h = `<input class="search" type="search" placeholder="Name, Verein, Funktion…" value="${esc(f.q)}" data-a="cQ"><div id="results">`;
  let club = null, open = false;
  for (const c of cs) {
    const k = c.club || 'Ohne Verein';
    if (k !== club) { if (open) h += '</div>'; h += sec(k) + '<div class="card list">'; club = k; open = true; }
    h += contactRow(c);
  }
  if (open) h += '</div>';
  if (!cs.length) h += '<div class="empty">Keine Kontakte gefunden.</div>';
  h += '</div>';
  return { title: 'Kontakte', back: true, html: h, fab: 'newContact' };
}
function contactForm(c = {}, isNew) {
  openForm({
    title: isNew ? 'Neuer Kontakt' : 'Kontakt', value: { since: D.today(), ...c },
    fields: [[{ k: 'first', l: 'Vorname', auto: isNew }, { k: 'last', l: 'Nachname' }], [{ k: 'role', l: 'Funktion', ph: 'Trainer, Scout…' }, { k: 'team', l: 'Team / Jahrgang' }],
      { k: 'club', l: 'Verein' }, { k: 'phone', l: 'Handynummer', t: 'tel' }, { k: 'email', l: 'E-Mail', t: 'email' }, { k: 'social', l: 'Instagram etc.' },
      { k: 'since', l: 'Stand', t: 'date' }, { k: 'note', l: 'Notiz', t: 'textarea' }],
    onSave: async v => { if (!v.first && !v.last) return toast('Bitte einen Namen eingeben'); Store.put(c.id || uid('contact'), 'contact', { ...(c.id ? Store.data(c.id) : {}), ...v }); await Sheet.close(); render(); },
    onDelete: isNew ? null : async () => { if (!confirmDel('Kontakt')) return; Store.remove(c.id); await Sheet.close(); render(); },
  });
}

// ───────────────────────── Mehr: Material, Scouting, Einstellungen ─────────────────────────
function viewMehr(parts) {
  const sub = parts[0];
  if (sub === 'kontakte') return viewKontakte();
  if (sub === 'material') return viewMaterial();
  if (sub === 'scouting') return viewScouting();
  if (sub === 'einstellungen') return viewSettings();
  const n = k => Store.all(k).length;
  const need = Store.all('material').filter(m => m.list !== 'have' && !m.done).length;
  const item = (h, ic, t, s) => `<div class="li" data-a="open" data-h="${h}"><span class="actions"><a>${icon(ic)}</a></span><div class="grow"><div class="t">${t}</div><div class="s">${s}</div></div>${icon('chev', 'chev')}</div>`;
  const html = `<div class="card list">
    ${item('#/mehr/kontakte', 'phone', 'Kontakte', cap(n('contact'), 'Kontakt', 'Kontakte'))}
    ${item('#/mehr/material', 'box', 'Material', need ? `${need} Dinge zu besorgen` : 'Bestand & Einkaufsliste')}
    ${item('#/mehr/scouting', 'eye', 'Scouting', cap(n('scout'), 'Spieler', 'Spieler') + ' auf der Liste')}
    ${item('#/mehr/einstellungen', 'gear', 'Einstellungen', 'Saisonphasen, Trainingstage, Checkliste, Import/Export')}</div>
    <div class="card small"><div class="row"><span class="grow">${REMOTE ? `Angemeldet als <b>${esc(Store.user?.email || '')}</b>` : '<b>Lokaler Testmodus</b> – Daten nur in diesem Browser'}</span></div>
    ${REMOTE ? `<button class="btn sm" data-a="logout" style="margin-top:10px">Abmelden</button>` : ''}</div>
    <div class="tiny mute" style="text-align:center">Coaching-App · Version ${VERSION}</div>`;
  return { title: 'Mehr', back: true, html };
}
function viewMaterial() {
  const tab = UI.mat, all = Store.all('material').sort(byOrder);
  const list = all.filter(m => (m.list === 'have') === (tab === 'have'));
  let h = `<div class="seg"><button class="${tab === 'need' ? 'on' : ''}" data-a="matTab" data-v="need">Brauchen wir (${all.filter(m => m.list !== 'have' && !m.done).length})</button><button class="${tab === 'have' ? 'on' : ''}" data-a="matTab" data-v="have">Haben wir (${all.filter(m => m.list === 'have').length})</button></div>`;
  if (tab === 'need') {
    h += `<div class="card">${list.length ? `<div class="list checks">${list.map(m => `<div class="checkwrap">${check(m.done, m.name + (m.qty ? ` (${m.qty})` : ''), `data-a="matDone" data-id="${esc(m.id)}"`, esc(m.note || ''))}<button class="iconbtn" data-a="editMat" data-id="${esc(m.id)}">${icon('edit')}</button></div>`).join('')}</div>` : '<div class="mute small">Nichts auf der Liste.</div>'}</div>`;
    if (list.some(m => m.done)) h += `<button class="btn block" data-a="matMove">Abgehakte in „Haben wir“ verschieben</button>`;
  } else {
    h += `<div class="card list">${list.map(m => `<div class="li"><div class="grow" data-a="editMat" data-id="${esc(m.id)}"><div class="t">${esc(m.name)}</div>${m.note ? `<div class="s">${esc(m.note)}</div>` : ''}</div>
      <div class="stepper"><button data-a="matQty" data-id="${esc(m.id)}" data-d="-1">−</button><b>${esc(m.qty || 0)}</b><button data-a="matQty" data-id="${esc(m.id)}" data-d="1">+</button></div></div>`).join('') || '<div class="empty">Noch kein Bestand eingetragen.</div>'}</div>`;
  }
  const notes = Store.data('setting:material-notes')?.text || '';
  h += sec('Gedanken zum Material') + `<div class="card"><div class="f" style="margin:0"><textarea data-a="matNotes" style="min-height:96px">${esc(notes)}</textarea></div></div>`;
  return { title: 'Material', back: true, html: h, fab: 'newMat' };
}
function matForm(m = {}, isNew) {
  openForm({
    title: isNew ? 'Material' : m.name, value: { list: UI.mat, ...m },
    fields: [{ k: 'name', l: 'Was?', auto: isNew }, [{ k: 'qty', l: 'Menge', t: 'number' }, { k: 'list', l: 'Liste', t: 'select', opts: [['need', 'Brauchen wir'], ['have', 'Haben wir']] }], { k: 'note', l: 'Notiz' }],
    onSave: async v => { if (!v.name) return toast('Bitte eingeben, was'); Store.put(m.id || uid('mat'), 'material', { ...(m.id ? Store.data(m.id) : { order: 999, done: false }), ...v }); await Sheet.close(); render(); },
    onDelete: isNew ? null : async () => { Store.remove(m.id); await Sheet.close(); render(); },
  });
}
const PRIOS = ['hoch', 'mittel', 'niedrig', 'unauffällig'];
function viewScouting() {
  const f = UI.scout;
  let ss = Store.all('scout');
  if (f.prio) ss = ss.filter(s => s.prio === f.prio);
  if (f.q) ss = ss.filter(s => [s.name, s.club, s.pos].join(' ').toLowerCase().includes(f.q));
  ss.sort((a, b) => (PRIOS.indexOf(a.prio) + 1 || 9) - (PRIOS.indexOf(b.prio) + 1 || 9) || byName(a, b));
  const pc = { hoch: '#15803d', mittel: '#ca8a04', niedrig: '#64748b', unauffällig: '#94a3b8' };
  let h = `<div class="small mute" style="margin:0 4px 8px">Gerade nicht im Fokus – die Liste bleibt aber griffbereit.</div><input class="search" type="search" placeholder="Name, Verein, Position…" value="${esc(f.q)}" data-a="sQ"><div id="results">`;
  h += chips([['', 'Alle'], ...PRIOS.map(p => [p, p])], f.prio, 'sPrio');
  h += `<div class="card list">${ss.map(s => `<div class="li" data-a="editScout" data-id="${esc(s.id)}"><div class="grow"><div class="t">${esc(s.name)}</div><div class="s">${esc([s.club, s.pos].filter(Boolean).join(' · '))}${s.requested ? ' · angefragt' : ''}</div></div>${s.prio ? badge(s.prio, pc[s.prio]) : ''}</div>`).join('') || '<div class="empty">Keine Einträge.</div>'}</div></div>`;
  return { title: 'Scouting', back: true, html: h, fab: 'newScout' };
}
function scoutForm(s = {}, isNew) {
  openForm({
    title: isNew ? 'Neuer Scouting-Eintrag' : s.name, value: s,
    fields: [{ k: 'name', l: 'Name', auto: isNew }, [{ k: 'club', l: 'Verein' }, { k: 'pos', l: 'Position(en)' }],
      { k: 'prio', l: 'Priorität', t: 'seg', opts: [...PRIOS.map(p => [p, p]), ['', 'offen']] },
      { k: 'requested', l: 'Angefragt', t: 'toggle' }, { k: 'answered', l: 'Antwort erhalten', t: 'toggle' },
      { k: 'strengths', l: 'Stärken', t: 'textarea' }, { k: 'weaknesses', l: 'Schwächen', t: 'textarea' }, { k: 'note', l: 'Bericht / Notiz', t: 'textarea' }],
    onSave: async v => { if (!v.name) return toast('Bitte einen Namen eingeben'); Store.put(s.id || uid('scout'), 'scout', { ...(s.id ? Store.data(s.id) : {}), ...v }); await Sheet.close(); render(); },
    onDelete: isNew ? null : async () => { if (!confirmDel('Eintrag')) return; Store.remove(s.id); await Sheet.close(); render(); },
  });
}
function viewSettings() {
  const s = setting();
  let h = sec('Saisonphasen (Makro- & Mesozyklen)') + `<div class="card list">${phases().map(p => `<div class="li" data-a="editPhase" data-id="${p.id}"><span class="dot" style="background:${PHC[p.type]}"></span><div class="grow"><div class="t">${esc(phaseName(p))}</div><div class="s">${D.full(p.start)} – ${D.full(p.end)}</div></div>${icon('edit', 'chev')}</div>`).join('')}</div>
    <button class="link" data-a="newPhase">+ Phase hinzufügen (z. B. neue Saison)</button>`;
  h += sec('Training & Spieltag') + `<div class="card">
    <div class="f"><div class="lab">Trainingstage</div><div class="segf">${[1, 2, 3, 4, 5, 6, 7].map(d => `<label><input type="checkbox" data-a="tDay" value="${d}" ${(s.trainingDays || []).includes(d) ? 'checked' : ''}><span>${WD[d].slice(0, 2)}</span></label>`).join('')}</div></div>
    <div class="two"><div class="f"><label>Max. Spieltagskader</label><input type="number" data-a="setNum" data-f="squadMax" value="${esc(s.squadMax || 17)}"></div>
    <div class="f"><label>Feldspieler (Standard Übungen)</label><input type="number" data-a="setNum" data-f="exPlayers" value="${esc(s.exPlayers || 16)}"></div></div>
    <button class="btn sm" data-a="editDress">Dresscode bearbeiten</button></div>`;
  h += sec('Spieltag-Checkliste', '<button class="link" data-a="newCheck">+ Punkt</button>') + `<div class="card list">${Store.all('checkitem').sort(byOrder).map(c => `<div class="li" data-a="editCheck" data-id="${c.id}"><div class="grow"><div class="t">${esc(c.title)}</div><div class="s">${esc(c.group)}</div></div>${icon('edit', 'chev')}</div>`).join('')}</div>`;
  h += sec('Daten') + `<div class="card"><div class="small mute" style="margin-bottom:10px">Import: deine Excel-Daten (Datei <b>coaching-daten.json</b>) einmalig hochladen. Export: Sicherungskopie aller Daten.</div>
    <label class="btn" style="margin-right:6px">Daten importieren<input type="file" accept=".json,application/json" data-a="importFile" hidden></label>
    <button class="btn" data-a="export">Sicherung herunterladen</button>
    <div class="tiny mute" style="margin-top:10px">${Store.items.size} Einträge gespeichert${REMOTE ? '' : ' (lokaler Testmodus)'}.</div></div>`;
  return { title: 'Einstellungen', back: true, html: h };
}
function phaseForm(p = {}, isNew) {
  openForm({
    title: isNew ? 'Neue Phase' : phaseName(p), value: { makro: 'HR', type: 'vorb', ...p },
    fields: [{ k: 'label', l: 'Name', ph: 'Vorbereitung' }, { k: 'makro', l: 'Makrozyklus', t: 'seg', opts: [['HR', 'Hinrunde'], ['RR', 'Rückrunde']] },
      { k: 'type', l: 'Art', t: 'seg', opts: [['vorb', 'Vorbereitung'], ['wettk', 'Wettkampf'], ['nachb', 'Nachbereitung']] },
      [{ k: 'start', l: 'Start (Montag)', t: 'date' }, { k: 'end', l: 'Ende (Sonntag)', t: 'date' }]],
    onSave: async v => {
      if (!v.start || !v.end || v.end < v.start) return toast('Bitte Start und Ende prüfen');
      if (!v.label) v.label = { vorb: 'Vorbereitung', wettk: 'Wettkampf', nachb: 'Nachbereitung' }[v.type];
      Store.put(p.id || uid('phase'), 'phase', { ...(p.id ? Store.data(p.id) : {}), ...v }); await Sheet.close(); render();
    },
    onDelete: isNew ? null : async () => { if (!confirmDel('Phase')) return; Store.remove(p.id); await Sheet.close(); go('#/saison'); },
  });
}
function emptyState() {
  return `<div class="card" style="text-align:center;padding:26px 16px"><div style="font-size:40px">⚽</div><h3 style="justify-content:center">Noch keine Daten</h3>
    <p class="small mute">Lade einmalig deine Excel-Daten (Datei <b>coaching-daten.json</b>) hoch – danach ist alles da.</p>
    <label class="btn primary">Daten importieren<input type="file" accept=".json,application/json" data-a="importFile" hidden></label></div>`;
}
const notFound = () => ({ title: 'Nicht gefunden', back: true, html: '<div class="empty">Dieser Eintrag existiert nicht mehr.</div>' });

const VIEWS = { heute: viewHeute, saison: viewSaison, spiele: viewSpiele, kader: viewKader, training: viewTraining, tests: viewTests, mehr: viewMehr };

// ───────────────────────── Aktionen ─────────────────────────
const A = {
  tab: el => { const k = el.dataset.k; if (route().tab === k) { go('#/' + k); window.scrollTo({ top: 0, behavior: 'smooth' }); } else go(LAST[k] || '#/' + k); },
  open: el => go(el.dataset.h),
  back: () => history.length > 1 ? history.back() : go('#/heute'),
  syncInfo: () => toast(!REMOTE ? 'Lokaler Testmodus' : Store.error ? 'Fehler: ' + Store.error : Object.keys(Store.pending).length ? 'Speichert…' : 'Alles gespeichert ✓'),
  sheetClose: () => Sheet.close(),
  quick: el => {
    const ctx = el.dataset.ctx, t = D.today(), cur = phaseAt(t), pend = Store.all('game').filter(needsResult).sort(byDate)[0];
    const CTX = { newGame: ['spiele', 'Neues Spiel'], newPlayer: ['kader', 'Neuer Spieler'], newExercise: ['training', 'Neue Übung'], newAthletic: ['training', 'Neue Athletikübung'],
      newTopic: ['training', 'Neues Thema'], newClub: ['tests', 'Neuer Verein (Testspiel)'] };
    const item = (x, ic, l, sub = '', attrs = '') => `<button class="qitem" data-a="quickDo" data-x="${x}" ${attrs}><span class="ti">${icon(ic)}</span><span class="grow"><b>${l}</b>${sub ? `<small>${sub}</small>` : ''}</span></button>`;
    let b = '';
    if (CTX[ctx]) b += item(ctx, CTX[ctx][0], CTX[ctx][1], 'passend zu dieser Seite');
    if (pend) b += item('quickResult', 'spiele', 'Ergebnis eintragen', `${esc(pend.opponent)} · ${D.long(pend.date)}`, `data-id="${esc(pend.id)}"`);
    if (ctx !== 'newGame') b += item('newGame', 'spiele', 'Neues Spiel', 'Liga, Test, Turnier …');
    if (cur) b += item('addPtask', 'saison', 'Aufgabe', `für ${esc(cur.label)}`, `data-phase="${cur.id}" data-mode="meso"`);
    b += item('open', 'training', 'Training dieser Woche planen', `KW ${D.week(t).week}`, `data-h="#/training/woche/${D.week(t).key}"`);
    if (ctx !== 'newClub') b += item('newClub', 'tests', 'Testspiel-Verein', 'neuer Verein in der Testspielplanung');
    b += item('newContact', 'phone', 'Kontakt');
    if (ctx !== 'newPlayer') b += item('newPlayer', 'kader', 'Spieler');
    if (ctx !== 'newExercise') b += item('newExercise', 'training', 'Übung');
    b += item('newMat', 'box', 'Material', 'auf die Einkaufsliste');
    Sheet.open('Schnell hinzufügen', `<div class="qlist">${b}</div>`);
  },
  quickDo: async el => { const x = el.dataset.x; await Sheet.close(); if (x === 'newMat') UI.mat = 'need'; A[x] && A[x](el); },
  testsStatus: el => { UI.tests.st = el.dataset.v; go('#/tests'); render(); },
  gTest: () => { UI.games.type = 'Test'; UI.games.when = 'all'; go('#/spiele'); render(); },
  formSave: () => FORM && FORM.onSave(readForm()),
  formDelete: () => FORM && FORM.onDelete && FORM.onDelete(),
  fitCycle: el => { const g = el.closest('[data-fit]'), v = JSON.parse(g.dataset.val), n = el.dataset.n, s = ((v[n] || 0) + 1) % 4; if (s) v[n] = s; else delete v[n]; g.dataset.val = JSON.stringify(v); el.className = 'fit' + s; },
  posvCycle: el => { const g = el.closest('[data-posv]'), v = JSON.parse(g.dataset.val), p = el.dataset.p, s = ((v[p] || 0) + 1) % 3; if (s) v[p] = s; else delete v[p]; g.dataset.val = JSON.stringify(v); el.className = s ? 'l' + s : ''; el.querySelector('span').textContent = s ? POSVLV[s] : '–'; },
  // Saison
  ptask: el => { const t = Store.data(el.dataset.id); Store.patch(el.dataset.id, 'ptask', { done: !t.done }); if (!t.done) toast('Erledigt ✓'); render(); },
  wtask: el => { const k = el.dataset.week, w = { ...weekData(k) }; w.tasks = { ...(w.tasks || {}) }; w.tasks[el.dataset.id] = !w.tasks[el.dataset.id]; Store.put('week:' + k, 'week', w); render(); },
  addPtask: el => ptaskForm({ phase: el.dataset.phase, mode: el.dataset.mode }, true),
  editPtask: el => ptaskForm(Store.get(el.dataset.id)),
  editPhase: el => phaseForm(Store.get(el.dataset.id)),
  newPhase: () => phaseForm({}, true),
  // Spiele
  gWhen: el => { UI.games.when = el.dataset.v; render(); },
  gType: el => { UI.games.type = el.dataset.v; render(); },
  newGame: el => gameForm({ date: el.dataset.date || D.today(), type: 'Liga', ha: '' }, true),
  editGame: el => gameForm(Store.get(el.dataset.id)),
  editPrep: el => {
    const g = Store.get(el.dataset.id);
    openForm({
      title: 'Spielvorbereitung', value: g.prep || {},
      fields: [{ k: 'formation', l: 'Formation', ph: 'z. B. 4-3-3' }, { k: 'goalMental', l: 'Ziele – mental', t: 'textarea' }, { k: 'goalBall', l: 'Ziele – mit Ball', t: 'textarea' },
        { k: 'goalNoBall', l: 'Ziele – ohne Ball', t: 'textarea' }, { k: 'pressing', l: 'Pressing', ph: 'Mittelfeldpressing / Angriffspressing …' },
        [{ k: 'cornerL', l: 'Ecken links' }, { k: 'cornerR', l: 'Ecken rechts' }], [{ k: 'fkL', l: 'Freistoß links' }, { k: 'fkR', l: 'Freistoß rechts' }],
        [{ k: 'penalty', l: 'Elfmeter' }, { k: 'throwin', l: 'Einwürfe' }], { k: 'motivation', l: 'Motivation / Ansprache', t: 'textarea' }],
      onSave: async v => { Store.patch(g.id, 'game', { prep: v }); await Sheet.close(); render(); },
    });
  },
  pickSquad: el => {
    const g = Store.get(el.dataset.id), max = setting().squadMax || 17;
    openForm({
      title: 'Spieltagskader', value: { sq: g.squad || [] }, saveLabel: 'Übernehmen',
      fields: [{ k: 'sq', t: 'multi', max, opts: players().sort((a, b) => tierIdx(a) - tierIdx(b) || byName(a, b)).map(p => ({ v: p.id, l: p.name, s: posText(p), g: tierOf(p.tier).l })) }],
      onSave: async v => { Store.patch(g.id, 'game', { squad: v.sq, start11: (g.start11 || []).filter(x => v.sq.includes(x)) }); await Sheet.close(); render(); },
    });
  },
  pickStart: el => {
    const g = Store.get(el.dataset.id), pool = (g.squad || []).length ? g.squad.map(id => Store.get(id)).filter(Boolean) : players();
    openForm({
      title: 'Startelf', value: { st: g.start11 || [] }, saveLabel: 'Übernehmen',
      fields: [{ k: 'st', t: 'multi', max: 11, opts: pool.sort(byName).map(p => ({ v: p.id, l: p.name, s: posText(p) })) }],
      onSave: async v => { Store.patch(g.id, 'game', { start11: v.st }); await Sheet.close(); render(); },
    });
  },
  gcheck: el => { const g = Store.data(el.dataset.id), c = { ...(g.checks || {}) }; c[el.dataset.item] = !c[el.dataset.item]; Store.patch(el.dataset.id, 'game', { checks: c }); render(); },
  // Kader
  kGrp: el => { UI.kader.grp = el.dataset.v; render(); },
  newPlayer: () => playerForm({}, true),
  editPlayer: el => playerForm(Store.get(el.dataset.id)),
  posSheet: el => posSheet(el.dataset.k),
  setPos: el => { const p = Store.data(el.dataset.id), pv = { ...(p.posv || {}) }, v = +el.dataset.v; if (v) pv[el.dataset.k] = v; else delete pv[el.dataset.k]; Store.patch(el.dataset.id, 'player', { posv: pv }); posSheet(el.dataset.k); render(); },
  mxCycle: el => { const p = Store.data(el.dataset.id), pv = { ...(p.posv || {}) }, k = el.dataset.k, s = ((pv[k] || 0) + 1) % 3; if (s) pv[k] = s; else delete pv[k]; Store.patch(el.dataset.id, 'player', { posv: pv }); render(); },
  quickTier: el => quickTier(el.dataset.id),
  setTier: el => { Store.patch(el.dataset.id, 'player', { tier: el.dataset.t }); quickTier(el.dataset.id); render(); },
  setGroup: el => { Store.patch(el.dataset.id, 'player', { group: el.dataset.g }); quickTier(el.dataset.id); render(); },
  tierMove: el => { const p = Store.data(el.dataset.id), i = TIER_RANK.indexOf(p.tier || ''), j = i < 0 ? 3 : Math.max(0, Math.min(3, i + +el.dataset.d)); Store.patch(el.dataset.id, 'player', { tier: TIER_RANK[j] }); toast(`${p.short || p.name} → ${tierOf(TIER_RANK[j]).l}`); render(); },
  quickResult: el => resultForm(Store.get(el.dataset.id)),
  // Training
  phasePick: el => {
    const k = el.dataset.week, d = el.dataset.day, cur = ((weekData(k).days || {})[d] || {}).phase || '';
    Sheet.open(`${WD[d]} ${D.short(D.add(D.fromKey(k), d - 1))} · Spielphase`, `<div class="phlist">${[...Object.entries(GP), ['', { s: '–', l: 'Keine Auswahl', c: 'var(--mute)' }]].map(([key, v]) =>
      `<button class="${cur === key ? 'on' : ''}" style="--c:${v.c}" data-a="dayPhase" data-week="${k}" data-day="${d}" data-ph="${key}"><span class="phcode">${esc(v.s)}</span><span class="grow">${esc(v.l)}</span>${cur === key ? '✓' : ''}</button>`).join('')}</div>`);
  },
  dayPhase: async el => { setDay(el.dataset.week, el.dataset.day, { phase: el.dataset.ph }); await Sheet.close(); render(); },
  pickDay: el => pickDay(el.dataset.what, el.dataset.week, el.dataset.day),
  exN: el => { UI.ex.n = Math.max(1, Math.min(21, (UI.ex.n || 16) + +el.dataset.d)); render(); },
  exOpen: el => exerciseDetail(el.dataset.id),
  newExercise: () => exerciseForm({}, true),
  editExercise: el => exerciseForm(Store.get(el.dataset.id)),
  athCat: el => { UI.ath.cat = el.dataset.v; render(); },
  athOpen: el => athDetail(el.dataset.id),
  newAthletic: () => athleticForm({}, true),
  editAthletic: el => athleticForm(Store.get(el.dataset.id)),
  sessOpen: el => {
    const s = Store.get(el.dataset.id);
    Sheet.open(s.title, `<dl class="kv">${[['Fokus', s.focus], ['Datum', s.date && D.full(s.date)], ['Hinweis', s.note], ['Aufwärmen', s.warmup], ['Aufbau', s.structure], ['Übungen', s.exercises]].filter(x => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`);
  },
  topPh: el => { UI.topics.ph = el.dataset.v; render(); },
  newTopic: () => topicForm({}, true),
  editTopic: el => topicForm(Store.get(el.dataset.id)),
  // Testspiele
  tLvl: el => { const L = UI.tests.lvls instanceof Set ? UI.tests.lvls : (UI.tests.lvls = new Set()), v = el.dataset.v; if (v === '*') L.clear(); else if (L.has(v)) L.delete(v); else L.add(v); render(); },
  tSt: el => { UI.tests.st = el.dataset.v; render(); },
  clubFlag: (el, ev) => { ev.stopPropagation(); const c = Store.data(el.dataset.id), f = el.dataset.f; Store.patch(el.dataset.id, 'club', { [f]: !c[f] }); render(); },
  openClub: el => clubDetail(el.dataset.id),
  newClub: () => clubForm({}, true),
  editClub: el => clubForm(Store.get(el.dataset.id)),
  clubFromGame: el => { const g = Store.get(el.dataset.id); clubForm({ name: shortOpp(g.opponent), done: true, result: D.short(g.date) }, true); },
  clubToGame: async el => { const c = Store.get(el.dataset.id); await Sheet.close(); gameForm({ opponent: c.name, type: 'Test', date: D.today() }, true); },
  // Kontakte
  newContact: () => contactForm({}, true),
  editContact: el => contactForm(Store.get(el.dataset.id)),
  // Material
  matTab: el => { UI.mat = el.dataset.v; render(); },
  matDone: el => { const m = Store.data(el.dataset.id); Store.patch(el.dataset.id, 'material', { done: !m.done }); render(); },
  matMove: () => { for (const m of Store.all('material').filter(x => x.list !== 'have' && x.done)) Store.patch(m.id, 'material', { list: 'have', done: false, qty: m.qty || 1 }); toast('In den Bestand verschoben'); render(); },
  matQty: el => { const m = Store.data(el.dataset.id); Store.patch(el.dataset.id, 'material', { qty: Math.max(0, (+m.qty || 0) + +el.dataset.d) }); render(); },
  newMat: () => matForm({}, true),
  editMat: el => matForm(Store.get(el.dataset.id)),
  // Scouting
  sPrio: el => { UI.scout.prio = el.dataset.v; render(); },
  newScout: () => scoutForm({}, true),
  editScout: el => scoutForm(Store.get(el.dataset.id)),
  // Einstellungen
  editDress: () => {
    const dc = setting().dresscode || {};
    openForm({ title: 'Dresscode', value: { a: dc['Zum Treffpunkt'] || '', b: dc['Beim Training'] || '' },
      fields: [{ k: 'a', l: 'Zum Treffpunkt', t: 'textarea' }, { k: 'b', l: 'Beim Training', t: 'textarea' }],
      onSave: async v => { Store.patch('setting:main', 'setting', { dresscode: { 'Zum Treffpunkt': v.a, 'Beim Training': v.b } }); await Sheet.close(); render(); } });
  },
  newCheck: () => checkForm({}, true),
  editCheck: el => checkForm(Store.get(el.dataset.id)),
  export: () => {
    const blob = new Blob([JSON.stringify({ app: 'coaching-app', version: 1, created: D.today(), items: [...Store.items.values()] }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `coaching-sicherung-${D.today()}.json`; a.click();
  },
  logout: async () => { if (!confirm('Abmelden?')) return; await Store.sb.auth.signOut(); location.reload(); },
};
function ptaskForm(t, isNew) {
  openForm({
    title: isNew ? (t.mode === 'mikro' ? 'Wöchentliche Aufgabe' : 'Neue Aufgabe') : 'Aufgabe', value: t,
    fields: [{ k: 'title', l: 'Aufgabe', auto: isNew }, { k: 'mode', l: 'Art', t: 'seg', opts: [['meso', 'Einmal in der Phase'], ['mikro', 'Jede Woche']] },
      { k: 'phase', l: 'Phase', t: 'select', opts: phases().map(p => [p.id, phaseName(p)]) }, { k: 'note', l: 'Notiz', t: 'textarea' }],
    onSave: async v => {
      if (!v.title) return toast('Bitte eine Aufgabe eingeben');
      const id = t.id || uid('ptask');
      Store.put(id, 'ptask', { done: false, order: Date.now() % 1e7, ...(t.id ? Store.data(t.id) : {}), ...v }); await Sheet.close(); render();
    },
    onDelete: isNew ? null : async () => { if (!confirmDel('Aufgabe')) return; Store.remove(t.id); await Sheet.close(); render(); },
  });
}
function checkForm(c, isNew) {
  const groups = [...new Set(Store.all('checkitem').map(x => x.group))];
  openForm({
    title: isNew ? 'Neuer Checklisten-Punkt' : 'Checklisten-Punkt', value: { group: groups[0] || 'Vor dem Spieltag', ...c },
    fields: [{ k: 'title', l: 'Punkt', auto: isNew }, { k: 'group', l: 'Zeitpunkt', t: 'select', opts: groups.map(g => [g, g]) }],
    onSave: async v => {
      if (!v.title) return toast('Bitte eingeben');
      const same = Store.all('checkitem').filter(x => x.group === v.group).sort(byOrder);
      const order = c.id && c.group === v.group ? c.order : (same.length ? same[same.length - 1].order + 0.5 : 99);
      Store.put(c.id || uid('check'), 'checkitem', { ...v, order }); await Sheet.close(); render();
    },
    onDelete: isNew ? null : async () => { if (!confirmDel('Punkt')) return; Store.remove(c.id); await Sheet.close(); render(); },
  });
}

// Eingaben (Suche, Notizen, Einstellungen)
let qTimer;
const Q = { kQ: 'kader', exQ: 'ex', athQ: 'ath', tQ: 'tests', cQ: 'contacts', sQ: 'scout' };
document.addEventListener('input', e => {
  const el = e.target, a = el.dataset.a;
  if (el.dataset.filter) {
    const q = el.value.toLowerCase().trim(), box = $(`[data-multi="${el.dataset.filter}"]`, $('#sheet'));
    $$('label', box).forEach(l => { l.style.display = !q || l.dataset.q.includes(q) ? '' : 'none'; });
    $$('.grp', box).forEach(g => { g.style.display = q ? 'none' : ''; });
    return;
  }
  if (Q[a]) {
    UI[Q[a]].q = el.value.toLowerCase().trim();
    clearTimeout(qTimer); qTimer = setTimeout(renderResults, 200);
  }
});
document.addEventListener('change', e => {
  const el = e.target, a = el.dataset.a;
  if (el.closest('#sheet') && el.closest('[data-multi]')) { updateCounts($('#sheet')); return; }
  if (['ptask', 'wtask', 'gcheck', 'matDone'].includes(a)) return A[a](el, e);
  if (a === 'exSel') { UI.ex[el.dataset.f] = el.value; return render(); }
  if (a === 'weekField') { const k = el.dataset.week, w = { ...weekData(k), [el.dataset.f]: el.value }; Store.put('week:' + k, 'week', w); return toast('Gespeichert'); }
  if (a === 'dayNote') { setDay(el.dataset.week, el.dataset.day, { note: el.value }); return toast('Gespeichert'); }
  if (a === 'gameField') { Store.patch(el.dataset.id, 'game', { [el.dataset.f]: el.value }); return toast('Gespeichert'); }
  if (a === 'matNotes') { Store.put('setting:material-notes', 'setting', { text: el.value }); return toast('Gespeichert'); }
  if (a === 'tDay') { const days = $$('[data-a="tDay"]:checked').map(i => +i.value); Store.patch('setting:main', 'setting', { trainingDays: days }); return toast('Gespeichert'); }
  if (a === 'setNum') { Store.patch('setting:main', 'setting', { [el.dataset.f]: +el.value || '' }); if (el.dataset.f === 'exPlayers') UI.ex.n = null; return toast('Gespeichert'); }
  if (a === 'importFile') return importFile(el.files[0]);
});
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
  if (el.tagName === 'LABEL' && el.querySelector('input[type=file]')) return;
  if (el.closest('label.check')) return; // Checkbox -> change-Event
  const fn = A[el.dataset.a]; if (!fn) return;
  e.preventDefault(); fn(el, e);
});

async function importFile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.items)) throw new Error('Unbekanntes Dateiformat');
    const existing = data.items.filter(it => Store.items.has(it.id)).length;
    if (existing && !confirm(`${existing} von ${data.items.length} Einträgen gibt es schon. Mit den Werten aus der Datei überschreiben?`)) return;
    for (const it of data.items) Store.put(it.id, it.kind, it.data, true);
    migratePositions(); toast(`${data.items.length} Einträge importiert`);
    await Store.flush(); render();
  } catch (e) { alert('Import fehlgeschlagen: ' + e.message); }
}

// ───────────────────────── Login & Start ─────────────────────────
function showLogin(msg = '') {
  $('#tabs').innerHTML = ''; $('#top').style.display = 'none';
  $('#view').innerHTML = `<form class="login" id="loginForm"><img class="logo" src="icons/icon-192.png" alt=""><h2>Coaching U14</h2><p>Bitte melde dich an.</p>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
    <div class="f"><label>E-Mail</label><input type="email" name="email" autocomplete="username" required></div>
    <div class="f"><label>Passwort</label><input type="password" name="pw" autocomplete="current-password" required></div>
    <button class="btn primary block" type="submit">Anmelden</button></form>`;
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target;
    f.querySelector('button').textContent = 'Melde an…';
    const { data, error } = await Store.sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.pw.value });
    if (error) return showLogin(error.message === 'Invalid login credentials' ? 'E-Mail oder Passwort falsch.' : error.message);
    startApp(data.user);
  });
}
async function startApp(user) {
  Store.user = user || null; $('#top').style.display = '';
  Store.restore(); migratePositions(); render();
  if (REMOTE) {
    try { await Store.fetchAll(); Store.error = ''; migratePositions(); } catch (e) { Store.error = e.message; }
    render(); Store.flush();
  }
}
window.addEventListener('hashchange', render);
// Wischen: links/rechts zwischen Reitern; vom linken Rand nach rechts = zurück
const Swipe = { x: 0, y: 0, t: 0, ok: false };
document.addEventListener('touchstart', e => {
  const tt = e.touches[0], tgt = e.target;
  Swipe.ok = e.touches.length === 1 && $('#sheet').hidden && !tgt.closest('.matrix,.chips,[data-drag],.board,input,textarea,select,.wstrip');
  Object.assign(Swipe, { x: tt.clientX, y: tt.clientY, t: Date.now() });
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!Swipe.ok || Drag.active) return;
  const tt = e.changedTouches[0], dx = tt.clientX - Swipe.x, dy = tt.clientY - Swipe.y;
  if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6 || Date.now() - Swipe.t > 700) return;
  if (Swipe.x < 30 && dx > 0 && !$('#back').hidden) return A.back();
  const seg = $('#view .seg'); if (!seg) return;
  const bs = $$('button', seg), i = bs.findIndex(b => b.classList.contains('on')), j = i + (dx < 0 ? 1 : -1);
  if (i >= 0 && bs[j]) { bs[j].click(); }
}, { passive: true });
window.addEventListener('online', () => Store.flush());
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && REMOTE && Store.user && $('#sheet').hidden) {
    try { await Store.flush(); await Store.fetchAll(); render(); } catch (_) { }
  }
});
(async function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
  if (!REMOTE) return startApp(null);
  Store.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data: { session } } = await Store.sb.auth.getSession();
  if (session) startApp(session.user); else showLogin();
})();
