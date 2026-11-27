'use strict';
/* Coaching-App U14 – eine Datei, kein Build-Schritt.
   Daten: Supabase (Tabelle "items": id, kind, data) mit Login; lokal gecacht für offline. */

const CFG = window.APP_CONFIG || {};
const REMOTE = !!(CFG.supabaseUrl && CFG.supabaseKey);
const VERSION = '1.6';

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
// Spielphase = Schwerpunkt der Woche (alte Tageswerte nur noch als Rückfall)
const phOf = (key, d) => GP[weekData(key).phase] || (d ? GP[((weekData(key).days || {})[d] || {}).phase] : null) || null;
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
  { k: 'SECHS', l: 'ZDM', f: 'Zentrales defensives Mittelfeld (ZDM)', g: 'Mittelfeld' }, { k: 'ACHT', l: 'ZM', f: 'Zentrales Mittelfeld (ZM)', g: 'Mittelfeld' },
  { k: 'ZEHN', l: 'ZOM', f: 'Zentrales offensives Mittelfeld (ZOM)', g: 'Mittelfeld' },
  { k: 'LF', l: 'LF', f: 'Linker Flügel', g: 'Angriff' }, { k: 'RF', l: 'RF', f: 'Rechter Flügel', g: 'Angriff' },
  { k: 'ACHTFUENF', l: '8,5', f: 'Hängende Spitze (8,5)', g: 'Angriff' }, { k: 'NEUN', l: 'ST', f: 'Stürmer (ST)', g: 'Angriff' }];
const posvOf = k => POSV.find(p => p.k === k);
const POSVLV = { 1: 'Stamm', 2: 'in Frage' };
const GROUPS = ['TW', 'Abwehr', 'Mittelfeld', 'Sturm'];
const GROUPL = { TW: 'Torwart', Abwehr: 'Abwehr', Mittelfeld: 'Mittelfeld', Sturm: 'Sturm' };
// Feld-Anordnung (6er-Raster): [Position, Spalte von, Spalte bis]
// Feld: 10er-Raster = 5 Zonen (Außen · Halbraum · Zentrum · Halbraum · Außen) à 2 Spalten.
// Obere Hälfte: Angriff, 8,5/10, 8 · untere Hälfte: LAV/6/RAV, Abwehrreihe, TW
const PITCH_TOP = [
  [['LF', 1, 4], ['NEUN', 4, 8], ['RF', 8, 11]],
  [['ACHTFUENF', 2, 6], ['ZEHN', 6, 10]],
  [['ACHT', 3, 9]]];
const PITCH_BOT = [
  [['LS', 1, 4], ['SECHS', 4, 8], ['RS', 8, 11]],
  [['LV', 1, 3], ['LIV', 3, 5], ['ZIV', 5, 7], ['RIV', 7, 9], ['RV', 9, 11]],
  [['TW', 4, 8]]];
const PITCH = [...PITCH_TOP, ...PITCH_BOT];
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
const PHC = { vorb: '#2f7fd1', wettk: '#5a4fcf', nachb: '#9150c9' }; // Blau → Indigo → Violett, gleich kräftig
// Trainingsbewertung 1–5 (Farbbalken rot → blau)
const RATE = { 1: { c: '#dc2626', l: 'schwach' }, 2: { c: '#f2711c', l: 'mäßig' }, 3: { c: '#eab308', l: 'okay' }, 4: { c: '#16a34a', l: 'gut' }, 5: { c: '#2563eb', l: 'top' } };
// Offene Testspieltermine (???): gelten als besetzt, sobald an dem Tag ein Spiel steht
const slotTaken = s => Store.all('game').some(g => !g.cancelled && g.date === s.date);
const slots = () => Store.all('slot').filter(s => !slotTaken(s)).sort(byDate);
const LEVELS = [
  { k: 'NLZ', l: 'NLZ' }, { k: 'Regio', l: 'Regionalliga' }, { k: 'VL', l: 'Verbandsliga' },
  { k: 'BZL', l: 'Bezirksliga' }, { k: 'SDL', l: 'Sonderliga' }, { k: '', l: 'Ohne Niveau' }];
const GTYPES = ['Liga', 'Test', 'LV', 'Turnier'];
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
    Undo.record(id, this.items.get(id));
    const clean = { ...data }; delete clean.id;
    this.items.set(id, { id, kind, data: clean });
    this.pending[id] = { op: 'up', kind, data: clean };
    this.persist(); if (!quiet) this.flushSoon();
  },
  patch(id, kind, part) { this.put(id, kind, { ...(this.items.get(id)?.data || {}), ...part }); },
  remove(id) { Undo.record(id, this.items.get(id)); this.items.delete(id); this.pending[id] = { op: 'del' }; this.persist(); this.flushSoon(); },
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
const UI = { vereine: { q: '', inc: false }, ex: { n: null, diff: '', int: '', ph: '', tph: '', q: '', sort: 'fit' }, ath: { cat: '', q: '' }, kader: { grp: '', q: '' },
  games: { when: 'next', type: '' }, tests: { lvls: new Set(), st: '', q: '' }, contacts: { q: '' }, scout: { prio: '', q: '' }, topics: { ph: '' }, mat: 'need' };

const TABS = [
  { k: 'heute', l: 'Kabine' }, { k: 'saison', l: 'Saison' }, { k: 'spiele', l: 'Spiele' }, { k: 'kader', l: 'Kader' },
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
  if (!location.hash.includes('periodisierung')) periodView._done = false;
  if (!location.hash.includes('kalender')) calView._done = false;
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
  document.documentElement.style.setProperty('--toph', $('#top').offsetHeight + 'px');
  if (Sheet.kind === 'todo' && !$('#sheet').hidden) todoSheet();
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
    this.kind = null;
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
  _hide() { this.kind = null; const el = $('#sheet'); el.hidden = true; el.innerHTML = ''; document.body.classList.remove('noscroll'); const r = this._res; this._res = null; r && r(); },
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
        rows += `<label data-q="${esc((o.l + ' ' + (o.s || '') + ' ' + (o.g || '')).toLowerCase())}"><input type="checkbox" name="${f.k}" value="${esc(o.v)}" ${arr.includes(o.v) ? 'checked' : ''}><span class="ml ${o.inline ? 'inl' : ''}">${o.dot ? `<span class="dot" style="background:${o.dot}"></span>` : ''}<b>${esc(o.l)}</b>${o.s ? (o.inline ? `<span class="mlpos">${o.s}</span>` : `<small>${esc(o.s)}</small>`) : ''}</span>${o.r || ''}</label>`;
      }
      return `<div class="f">${f.l ? `<div class="lab">${esc(f.l)}</div>` : ''}${opts.length > 8 ? `<input type="text" class="search" placeholder="Suchen…" data-filter="${f.k}">` : ''}
        <div class="multi" data-multi="${f.k}">${rows || '<div class="empty">Keine Einträge</div>'}</div><div class="multi-count" data-count="${f.k}" data-max="${f.max || ''}"></div>${hint}</div>`; }
    case 'fit': { const fit = val || {}; let b = '';
      for (let n = 1; n <= 21; n++) { const s = fit[n] || 0; b += `<button type="button" class="fit${s}" data-a="fitCycle" data-n="${n}">${n}</button>`; }
      return `<div class="f"><div class="lab">${esc(f.l)}</div><div class="fitgrid" data-fit="${f.k}" data-val='${esc(JSON.stringify(fit))}'>${b}</div>
        <div class="hint">Antippen wechselt: – → Möglich → Gut → Ideal</div></div>`; }
    case 'posv': { const pv = val || {}; let grp = null, b = '';
      for (const P of POSV) { if (P.g !== grp) { b += `<div class="pvg">${P.g}</div>`; grp = P.g; } const l = pv[P.k] || 0; b += `<button type="button" class="${l ? 'l' + l : ''}" data-a="posvCycle" data-p="${P.k}" title="${esc(P.f)}"><i class="pstar ${f.best === P.k ? 'on' : ''}" data-a="posvStar" data-p="${P.k}" title="Beste Position">★</i><b>${P.l}</b><span>${l ? POSVLV[l] : '–'}</span></button>`; }
      return `<div class="f"><div class="lab">${esc(f.l)}</div><div class="posgrid pv" data-posv="${f.k}" data-val='${esc(JSON.stringify(pv))}' data-best="${esc(f.best || '')}">${b}</div>
        <div class="hint">Antippen wechselt: – → Stamm → in Frage → –. „In Frage“ zählt eine Stufe tiefer. ★ = beste Position (bestimmt die Spalte im Kader).</div></div>`; }
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
    else if (f.t === 'posv') { const g = $(`[data-posv="${f.k}"]`, el); out[f.k] = JSON.parse(g.dataset.val); out.best = out[f.k][g.dataset.best] ? g.dataset.best : ''; }
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
  const ph = GP[w.phase];
  return (ph ? 'Schwerpunkt ' + ph.s + ' · ' : '') + days.map(d => WD[d].slice(0, 2)).join(', ');
}
function trainingSummary(key, compact) {
  const w = weekData(key), mon = D.fromKey(key), days = setting().trainingDays || [2, 4, 5];
  return days.map(d => {
    const dd = (w.days || {})[d] || {}, date = D.add(mon, d - 1), ph = phOf(key, d);
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
  return { date, key, wd: dayIdx(date), dd };
}
function nextTraining(from) { for (let i = 0; i < 21; i++) { const t = trainingOn(D.add(from, i)); if (t) return t; } return null; }
const nextGame = from => Store.all('game').filter(g => !g.cancelled && g.date >= from).sort(byDate)[0];
const relDay = d => { const n = D.diff(D.today(), d); return n === 0 ? 'heute' : n === 1 ? 'morgen' : n === 2 ? 'übermorgen' : n > 0 ? `in ${n} Tagen` : `vor ${-n} Tagen`; };
function phaseLine(cur, t) {
  const weeks = weeksOf(cur), idx = weeks.findIndex(w => w.key === D.week(t).key);
  return `${MAKRO[cur.makro]} · ${esc(cur.label)} · Woche ${idx + 1}/${weeks.length}`;
}
function gamePrep(g) {
  const items = Store.all('checkitem'), done = items.filter(i => (g.checks || {})[i.id]).length;
  const parts = [(g.squad || []).length > 0, (g.start11 || []).length === 11, !!items.length && done === items.length, !!(g.prep && Object.values(g.prep).some(Boolean))];
  return { n: parts.filter(Boolean).length, of: parts.length };
}
function weekCal(t) {
  const wk = D.week(t), mon = wk.monday, games = weekGames(wk.key), cur = phaseAt(t), wph = GP[weekData(wk.key).phase], sl = slots();
  let h = `<div class="wcal"><div class="wc-h" data-a="open" data-h="#/training/woche/${wk.key}"><div class="grow">
      <div class="wc-kw">KW ${wk.week} <span>${D.short(mon)}–${D.short(D.add(mon, 6))}</span></div>
      <div class="wc-sub">${cur ? phaseLine(cur, t) : 'keine Saisonphase'}</div></div>
      ${wph ? `<span class="phcode" style="--c:${wph.c}" title="Schwerpunkt der Woche: ${esc(wph.l)}">${esc(wph.s)}</span>` : ''}<span class="link">Woche planen</span></div>
    ${cur ? `<div class="thinbar"><i style="width:${Math.min(100, Math.round((D.diff(cur.start, t) + 1) / (D.diff(cur.start, cur.end) + 1) * 100))}%;background:${PHC[cur.type]}"></i></div>` : ''}<div class="wstrip">`;
  for (let i = 0; i < 7; i++) {
    const d = D.add(mon, i), tr = trainingOn(d), g = games.find(x => x.date === d && !x.cancelled), q = sl.find(x => x.date === d), we = i >= 5;
    const href = g ? '#/spiele/' + encodeURIComponent(g.id) : q ? '#/tests/termine' : '#/training/woche/' + wk.key;
    let m = '';
    if (g) m += `<i class="mg ${outcome(g) ? 'o' + outcome(g) : ''}" title="${esc(g.opponent)}">${icon('spiele')}</i>`;
    if (q) m += `<i class="mq" title="Offener Testspieltermin">???</i>`;
    if (Store.all('game').some(x => x.alt === d && !x.cancelled)) m += `<i class="mq red" title="Spieltag evtl. Sonntag">?</i>`;
    if (tr) m += `<i class="mt" title="Training">${wph ? esc(wph.s) : 'T'}</i>`;
    if (!m) m = `<small class="wfree">${we ? 'spiel&shy;frei' : 'trai&shy;nings&shy;frei'}</small>`;
    h += `<button class="wd ${d === t ? 'now' : ''} ${d < t ? 'past' : ''}" data-a="open" data-h="${href}"><span class="wn">${D.wd(d)}</span><span class="wdt">${D.parse(d).getDate()}</span><span class="wm">${m}</span></button>`;
  }
  return h + `</div></div>`;
}
function agenda(t) {
  const ev = [], sl = slots();
  for (let i = 0; i < 14 && ev.length < 5; i++) {
    const d = D.add(t, i);
    for (const g of Store.all('game').filter(x => x.date === d && !x.cancelled)) ev.push({ d, k: 'g', g });
    for (const q of sl.filter(x => x.date === d)) ev.push({ d, k: 'q', q });
    const tr = trainingOn(d); if (tr) ev.push({ d, k: 't', tr });
  }
  if (!ev.length) return '';
  const row = (e, href, cls, title, sub, right) => `<div class="ag ${cls}" data-a="open" data-h="${href}"><div class="ag-d"><span>${D.wd(e.d)}</span><b>${D.parse(e.d).getDate()}</b></div>
    <div class="grow"><div class="ag-t">${title}</div><div class="ag-s">${sub}</div></div>${right}</div>`;
  return `<div class="card agenda">${ev.slice(0, 5).map(e => {
    const when = relDay(e.d);
    if (e.k === 'g') {
      const g = e.g, pr = gamePrep(g);
      return row(e, '#/spiele/' + encodeURIComponent(g.id), 'g', `${esc(shortOpp(g.opponent))}${g.important ? ' ⭐' : ''}`,
        `${when}${g.kickoff ? ' · ' + esc(g.kickoff) : ''}${g.ha ? ' · ' + (g.ha === 'H' ? 'Heim' : 'Auswärts') : ''}${g.type ? ' · ' + esc(g.type) : ''}`,
        `<span class="ag-r ${pr.n === pr.of ? 'ok' : ''}"><b>${pr.n}/${pr.of}</b>bereit</span>`);
    }
    if (e.k === 'q') return row(e, '#/tests/termine', 'q', '??? · Gegner gesucht', `${when} · offener Testspieltermin`, `<span class="ag-r">suchen</span>`);
    const tr = e.tr, wph = GP[weekData(tr.key).phase], bl = dayBlocks(tr.dd), tot = bl.reduce((x, b) => x + blockMin(b), 0), dur = trainingDur(tr.dd);
    const tops = (tr.dd.topics || []).map(id => Store.data(id)?.title).filter(Boolean);
    return row(e, '#/training/woche/' + tr.key, 't', `Training${wph ? ` · <span class="phcode sm" style="--c:${wph.c}">${esc(wph.s)}</span> ${esc(wph.l)}` : ''}`,
      `${when}${tops.length ? ' · ' + esc(tops.slice(0, 2).join(', ')) : ''}`,
      `<span class="ag-r ${tot && tot >= dur ? 'ok' : ''}"><b>${tot}/${dur}</b>Min</span>`);
  }).join('')}</div>`;
}
// Kader-Aufgabe: Wochenendspiel ab Freitag 18 Uhr, Spiel unter der Woche ab Sonntag 14 Uhr davor
function squadDue(g) {
  const wd = dayIdx(g.date);
  return wd >= 6 ? new Date(D.add(g.date, 5 - wd) + 'T18:00') : new Date(D.add(g.date, -wd) + 'T14:00');
}
const todoRow = (ic, title, sub, attrs, right = '') => `<div class="todo" ${attrs}><span class="ti">${icon(ic)}</span><div class="grow"><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>${right || icon('chev', 'chev')}</div>`;
// Zu erledigen – alles an einem Ort (als Popup über den großen Knopf in der Kabine)
function todoData() {
  const t = D.today(), cur = phaseAt(t), nxt = nextPhase(t), wk = D.week(t), g = nextGame(t);
  let todo = '', n = 0;
  const nr = Store.all('game').filter(needsResult).sort(byDate);
  for (const x of nr.slice(0, 3)) { n++; todo += todoRow('spiele', `Ergebnis: ${esc(shortOpp(x.opponent))}`, D.long(x.date), `data-a="quickResult" data-id="${esc(x.id)}"`, '<span class="link">Eintragen</span>'); }
  if (nr.length > 3) { n += nr.length - 3; todo += todoRow('spiele', `${nr.length - 3} weitere Ergebnisse fehlen`, 'im Spiele-Tab', `data-a="open" data-h="#/spiele"`); }
  if (g && D.diff(t, g.date) <= 7) {
    const items = Store.all('checkitem'), open = items.filter(i => !(g.checks || {})[i.id]).length;
    if (open) { n++; todo += todoRow('spiele', `Spieltag ${esc(shortOpp(g.opponent))}: ${open} Punkte offen`, `Checkliste · ${relDay(g.date)}`, `data-a="open" data-h="#/spiele/${encodeURIComponent(g.id)}"`); }
  }
  for (const x of Store.all('game').filter(x => !x.cancelled && x.date >= t && D.diff(t, x.date) <= 8 && !(x.squad || []).length).sort(byDate))
    if (new Date() >= squadDue(x)) { n++; todo += todoRow('kader', `Kader für ${esc(shortOpp(x.opponent))} eintragen`, `${D.long(x.date)} · ${relDay(x.date)}`, `data-a="pickSquad" data-id="${esc(x.id)}"`); }
  const os = slots().filter(x => x.date >= t);
  if (os.length) { n++; todo += todoRow('tests', `${cap(os.length, 'offener Testspieltermin', 'offene Testspieltermine')} (???)`, os.map(x => D.wd(x.date) + ' ' + D.short(x.date)).join(' · '), `data-a="open" data-h="#/tests/termine"`); }
  const cb = Store.all('club').filter(c => clubStatus(c) === 'pending').length;
  if (cb) { n++; todo += todoRow('tests', `Testspiele: ${cap(cb, 'Verein', 'Vereine')} ohne Rückmeldung`, 'nachhaken in der Testspielplanung', `data-a="testsStatus" data-v="pending"`); }
  const noNum = players().filter(p => !p.number);
  if (noNum.length) { n++; todo += todoRow('kader', `${cap(noNum.length, 'Spieler', 'Spieler')} ohne Rückennummer`, esc(noNum.map(p => p.short || p.name).join(', ')), `data-a="open" data-h="#/kader/liste"`); }
  if (cur) {
    const wt = tasksOf(cur.id, 'mikro'), wdn = weekData(wk.key).tasks || {}, openW = wt.filter(x => !wdn[x.id]);
    if (openW.length) todo += `<div class="todo-sub">Wochenaufgaben</div><div class="list checks">${openW.map(x => check(false, x.title, `data-a="wtask" data-id="${esc(x.id)}" data-week="${wk.key}"`)).join('')}</div>`;
    const om = tasksOf(cur.id, 'meso').filter(x => !x.done);
    if (om.length) todo += `<div class="todo-sub"><span class="grow">Zyklusaufgaben · ${esc(cur.label)} · ${om.length} offen</span><button class="link" data-a="open" data-h="#/saison/phase/${cur.id}">Alle</button></div><div class="list checks">${om.slice(0, 3).map(x => taskRow(x)).join('')}</div>`;
    n += openW.length + om.length;
  }
  if (nxt && D.diff(t, nxt.start) <= 14) {
    const on = tasksOf(nxt.id, 'meso').filter(x => !x.done).length;
    if (on) { n++; todo += todoRow('saison', `Bald: ${esc(phaseName(nxt))}`, `startet ${relDay(nxt.start)} · ${cap(on, 'Aufgabe', 'Aufgaben')} vorbereiten`, `data-a="open" data-h="#/saison/phase/${nxt.id}"`); }
  }

  return { html: todo, n };
}
const CLEAN = ['Alles erledigt. Kopf frei – ab auf den Platz.', 'Nichts mehr offen. Sauber!', 'Liste leer. Durchatmen, Kaffee, weiter.', 'Alles abgehakt – heute gewinnt die Ruhe.', 'Clean. Hier gibt es gerade nichts zu tun.'];
const cleanMsg = () => CLEAN[D.parse(D.today()).getDate() % CLEAN.length];
function todoBig() {
  const { html, n } = todoData(), tmp = document.createElement('div'); tmp.innerHTML = html;
  const prev = [...tmp.querySelectorAll('.todo .t, .check .ct')].slice(0, 2).map(x => x.childNodes[0]?.textContent || x.textContent).filter(Boolean);
  if (!n) return `<button class="todobig clean" data-a="todoSheet"><span class="tb-n">✓</span><span class="grow"><b>Zu erledigen</b><small>${esc(cleanMsg())}</small></span></button>`;
  return `<button class="todobig" data-a="todoSheet"><span class="tb-n">${n}</span><span class="grow"><b>Zu erledigen</b><small>${esc(prev.join(' · '))}</small></span>${icon('chev', 'chev')}</button>`;
}
function todoSheet() {
  const { html, n } = todoData();
  Sheet.open('Zu erledigen', n || html ? `<div class="todos insheet">${html.replace(/data-a="open"/g, 'data-a="todoGo"').replace(/data-a="testsStatus"/g, 'data-a="todoTests"')}</div>`
    : `<div class="cleanbox"><div class="cb-i">✓</div><b>${esc(cleanMsg())}</b></div>`);
  Sheet.kind = 'todo';
}
function viewHeute() {
  if (!phases().length && !Store.all('game').length) return { title: 'Kabine', html: emptyState() };
  const t = D.today();
  let h = todoBig() + weekCal(t);
  const ag = agenda(t);
  if (ag) h += sec('Als Nächstes') + ag;


  // Form kompakt
  const played = Store.all('game').filter(x => !x.cancelled && x.date < t && outcome(x)).sort(byDate);
  if (played.length) {
    const tot = { S: 0, U: 0, N: 0 }; played.forEach(x => tot[outcome(x)]++);
    const last5 = played.slice(-5), pts = { S: 3, U: 1, N: 0 }, avg = last5.reduce((s, x) => s + pts[outcome(x)], 0) / last5.length;
    h += sec('Form') + `<div class="card tap formmini" data-a="open" data-h="#/spiele"><div class="grow"><div class="fm-big">${avg.toFixed(1).replace('.', ',')} <span>Punkte/Spiel (letzte 5)</span></div>
      <div class="small mute">${tot.S} S · ${tot.U} U · ${tot.N} N</div></div><div>${last5.map(x => `<span class="fdot" style="background:${OUT[outcome(x)].c}">${outcome(x)}</span>`).join('')}</div>${icon('chev', 'chev')}</div>`;
  }
  return { title: 'Kabine', html: h };
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
const phaseDone = p => { const m = tasksOf(p.id, 'meso'); return { n: m.filter(x => x.done).length, of: m.length, all: m.length > 0 && m.every(x => x.done) }; };
function seasonHead(t, cur, nxt) {
  if (!cur) return nxt ? `<div class="shead pause"><div class="sh-eye">Saisonpause</div><div class="sh-title">${esc(nxt.label)} startet ${relDay(nxt.start)}</div><div class="sh-sub">${esc(phaseName(nxt))} · ${D.long(nxt.start)}</div></div>` : '';
  const weeks = weeksOf(cur), idx = weeks.findIndex(w => w.key === D.week(t).key), pd = phaseDone(cur);
  return `<div class="shead ${cur.type === 'wettk' ? 'hot' : ''}" data-a="open" data-h="#/saison/phase/${cur.id}">
    <div class="sh-top"><div class="grow"><div class="sh-eye">${MAKRO[cur.makro]}</div><div class="sh-title">${esc(cur.label)}</div></div>
      <div class="sh-wk"><b>${idx + 1}</b><span>/ ${weeks.length} Wo.</span></div></div>
    <div class="sh-weeks">${weeks.map((w, i) => `<i class="${i < idx ? 'done' : i === idx ? 'now' : ''}" title="KW ${w.week}"></i>`).join('')}</div>
    <div class="sh-foot"><span>${D.short(cur.start)}–${D.short(cur.end)} · ${pd.n}/${pd.of} Zyklusaufgaben</span>${nxt ? `<span>danach ${esc(nxt.label)} ${relDay(nxt.start)}</span>` : ''}</div></div>`;
}
function wtaskRows(p, key) {
  const tasks = tasksOf(p.id, 'mikro'), done = weekData(key).tasks || {};
  return tasks.map(t => `<div class="checkwrap">${check(!!done[t.id], t.title, `data-a="wtask" data-id="${esc(t.id)}" data-week="${key}"`)}<button class="iconbtn" data-a="editPtask" data-id="${esc(t.id)}" aria-label="Bearbeiten">${icon('edit')}</button></div>`).join('');
}
function viewSaison(parts) {
  if (parts[0] === 'phase') return viewPhase(parts[1]);
  if (parts[0] === 'woche') return viewWeek(parts[1]);
  if (!phases().length) return { title: 'Saison', html: emptyState() };
  const sub = parts[0] === 'kalender' ? 'kalender' : 'zyklen';
  const t = D.today(), cur = phaseAt(t), nxt = nextPhase(t), wk = D.week(t);
  let h = seasonHead(t, cur, nxt);
  h += `<div class="seg stick">${[['zyklen', 'Zyklen'], ['kalender', 'Kalender']].map(([v, l]) => `<button class="${sub === v ? 'on' : ''}" data-a="open" data-h="#/saison/${v}">${l}</button>`).join('')}</div>`;
  if (sub === 'kalender') {
    h += calView();
    setTimeout(() => { const n = document.getElementById('cw-now'); if (n && !calView._done) { calView._done = true; n.scrollIntoView({ block: 'center' }); } }, 30);
    return { title: 'Saison', html: h };
  }
  if (cur) {
    // 1. Wochenaufgaben
    const wr = wtaskRows(cur, wk.key), wt = tasksOf(cur.id, 'mikro'), wdn = wt.filter(x => (weekData(wk.key).tasks || {})[x.id]).length;
    h += sec(`Wochenaufgaben · KW ${wk.week}`, `${wt.length ? `<span class="tiny">${wdn}/${wt.length}</span> ` : ''}<button class="link" data-a="addPtask" data-phase="${cur.id}" data-mode="mikro">+ Aufgabe</button>`);
    h += `<div class="card">${wr ? `<div class="list checks one">${wr}</div>` : '<div class="mute small">Keine Wochenaufgaben in dieser Phase. Mit „+ Aufgabe“ anlegen.</div>'}</div>`;
    // 2. Zyklusaufgaben
    const meso = tasksOf(cur.id, 'meso'), open = meso.filter(x => !x.done);
    h += sec(`Zyklusaufgaben · ${cur.label}`, `<span class="tiny">${meso.length - open.length}/${meso.length}</span> <button class="link" data-a="addPtask" data-phase="${cur.id}" data-mode="meso">+ Aufgabe</button>`);
    h += `<div class="card">${open.length ? `<div class="list checks one">${open.slice(0, 8).map(x => taskRow(x, { edit: true })).join('')}</div>${open.length > 8 ? `<button class="link" data-a="open" data-h="#/saison/phase/${cur.id}">+ ${open.length - 8} weitere ansehen</button>` : ''}`
      : `<div class="alldone"><span>✓</span><div><b>Alle Zyklusaufgaben erledigt</b><small>Hier ist nichts mehr offen.</small></div></div>`}</div>`;
  }
  // 3. Bald
  if (nxt && D.diff(t, nxt.start) <= 21) {
    const on = tasksOf(nxt.id, 'meso').filter(x => !x.done);
    if (on.length) h += sec(`Bald: ${nxt.label} · ${relDay(nxt.start)}`, `<button class="link" data-a="open" data-h="#/saison/phase/${nxt.id}">Alle</button>`)
      + `<div class="card soon"><div class="list checks">${on.slice(0, 6).map(x => taskRow(x)).join('')}</div>${on.length > 6 ? `<div class="tiny mute" style="margin-top:6px">+ ${on.length - 6} weitere</div>` : ''}</div>`;
  }
  h += sec('Saison im Überblick') + seasonTimeline(t);
  for (const mk of ['HR', 'RR']) {
    const ps = phases().filter(p => p.makro === mk); if (!ps.length) continue;
    h += sec(`${MAKRO[mk]}`, `<span class="tiny">${D.short(ps[0].start)} – ${D.full(ps[ps.length - 1].end)}</span>`);
    h += `<div class="mesolist2">${ps.map(p => mesoCard(p, p.end < t ? 'past' : p.start > t ? 'future' : 'now')).join('')}</div>`;
  }
  return { title: 'Saison', html: h };
}
function mesoCard(p, st) {
  const pd = phaseDone(p), weeks = weeksOf(p), nGames = gamesBetween(p.start, p.end).filter(g => !g.cancelled).length;
  const done = pd.all || (st === 'past' && !pd.of);
  const mark = done ? `<span class="mc-ok" title="Alles erledigt">✓</span>` : st === 'past' && pd.of - pd.n ? `<span class="mc-open">${pd.of - pd.n} offen</span>` : '';
  return `<div class="mcard ${st} ${done ? 'done' : ''}" style="--pc:${PHC[p.type]}" data-a="open" data-h="#/saison/phase/${p.id}">
    <span class="stripe"></span><div class="mc-in"><div class="mc-h"><b>${esc(p.label)}</b>${st === 'now' ? '<span class="mc-now">läuft</span>' : ''}</div>
    <div class="small mute">${D.short(p.start)} – ${D.short(p.end)} · ${cap(weeks.length, 'Woche', 'Wochen')} · ${cap(nGames, 'Spiel', 'Spiele')}</div>
    <div class="prog"><i style="width:${pd.of ? Math.round(pd.n / pd.of * 100) : (done ? 100 : 0)}%"></i></div>
    <div class="tiny mute" style="margin-top:4px">${done ? 'Alles erledigt – abgehakt' : `${pd.n}/${pd.of} Aufgaben erledigt`}</div></div>${mark}</div>`;
}
// Kalender: alle Wochen der Saison untereinander, Mo–So wie in der Kabine
function calView() {
  const ps = phases(), t = D.today(), curKey = D.week(t).key, sl = slots(), days = setting().trainingDays || [2, 4, 5];
  const games = Store.all('game').filter(g => !g.cancelled), alts = new Set(games.map(g => g.alt).filter(Boolean));
  let m = D.week(ps[0].start).monday, h = `<div class="calleg"><span><i class="cm-t">T</i> Training</span><span><i class="cm-g"></i> Spiel</span><span><i class="cm-q">?</i> noch offen</span><span><i class="cm-bar"></i> Schwerpunkt</span></div><div class="cal"><div class="cw head"><div class="cw-kw"></div><div class="cw-days">${["Mo","Di","Mi","Do","Fr","Sa","So"].map(x => `<span>${x}</span>`).join("")}</div><div class="cw-plan"></div></div>`, lastP = null;
  while (m <= ps[ps.length - 1].end) {
    const w = D.week(m), wd = weekData(w.key), wph = GP[wd.phase], p = phaseAt(m) || phaseAt(D.add(m, 6));
    if (p && p !== lastP && (!lastP || p.id !== lastP.id)) { h += `<div class="cal-ph" style="--pc:${PHC[p.type]}"><b>${esc(p.label)}</b> ${MAKRO[p.makro]} · ${D.short(p.start)}–${D.short(p.end)}</div>`; lastP = p; }
    let cells = '';
    for (let i = 0; i < 7; i++) {
      const d = D.add(m, i), gs = games.filter(g => g.date === d), q = sl.filter(x => x.date === d), tr = days.includes(i + 1) && p, alt = alts.has(d);
      let mk = gs.map(g => { const o = outcome(g), open = /offen|\?\?\?/i.test(g.opponent || ''); return `<i class="cm-g ${o ? 'o' + o : ''} ${open ? 'qq' : ''}" title="${esc(g.opponent)}">${open ? '?' : ''}</i>`; }).join('');
      if (q.length) mk += `<i class="cm-q" title="Offener Testspieltermin">???</i>`;
      if (alt) mk += `<i class="cm-q" title="Spieltag evtl. Sonntag">?</i>`;
      if (tr) mk += `<i class="cm-t" style="${wph ? `--c:${wph.c}` : ''}">${wph ? esc(wph.s) : 'T'}</i>`;
      const href = gs.length ? '#/spiele/' + encodeURIComponent(gs[0].id) : q.length ? '#/tests/termine' : '#/training/woche/' + w.key;
      cells += `<button class="cd ${d === t ? 'today' : ''} ${d < t ? 'past' : ''} ${i >= 5 ? 'we' : ''}" data-a="open" data-h="${href}"><span class="cdn">${D.parse(d).getDate()}</span><span class="cdm">${mk}</span></button>`;
    }
    h += `<div class="cw ${w.key === curKey ? 'now' : ''} ${D.add(m, 6) < t ? 'pastw' : ''}" ${w.key === curKey ? 'id="cw-now"' : ''}>
      <div class="cw-kw" style="--c:${wph ? wph.c : 'var(--line)'}" title="${wph ? 'Schwerpunkt: ' + esc(wph.l) : 'kein Schwerpunkt'}"><b>KW ${w.week}</b><small>${D.short(m)}</small></div>
      <div class="cw-days">${cells}</div>
      <button class="cw-plan" data-a="open" data-h="#/training/woche/${w.key}" aria-label="Woche planen" title="Woche planen">${icon('edit')}</button></div>`;
    m = D.add(m, 7);
  }
  return h + `</div>`;
}

function phaseAlert(p, title, intro) {
  const open = tasksOf(p.id, 'meso').filter(x => !x.done);
  if (!open.length) return '';
  return `<div class="card alert"><h3>${esc(title)}</h3><div class="small mute">${esc(intro)}</div>
    <div class="list checks">${open.slice(0, 6).map(x => taskRow(x)).join('')}</div>
    ${open.length > 6 ? `<button class="link" data-a="open" data-h="#/saison/phase/${p.id}">Alle ${open.length} Aufgaben ansehen</button>` : ''}</div>`;
}
function viewPhase(pid) {
  const p = Store.get(pid); if (!p) return notFound();
  const t = D.today(), curKey = D.week(t).key;
  const meso = tasksOf(p.id, 'meso'), mikro = tasksOf(p.id, 'mikro');
  let h = `<div class="phasecard" style="--pc:${PHC[p.type]}"><div class="pc-eye">${MAKRO[p.makro]} · Mesozyklus</div>
    <div class="pc-title">${esc(p.label)}</div><div class="pc-sub">${D.long(p.start)} – ${D.long(p.end)} · KW ${D.week(p.start).week}–${D.week(p.end).week}</div></div>`;
  h += sec(`Zyklusaufgaben (${meso.filter(x => x.done).length}/${meso.length})`, `<button class="link" data-a="addPtask" data-phase="${p.id}" data-mode="meso">+ Aufgabe</button>`);
  h += `<div class="card">${meso.length ? `<div class="list checks">${meso.map(x => taskRow(x, { edit: true })).join('')}</div>` : '<div class="mute small">Noch keine Aufgaben.</div>'}</div>`;
  h += sec('Wochenaufgaben', `<button class="link" data-a="addPtask" data-phase="${p.id}" data-mode="mikro">+ Aufgabe</button>`);
  h += `<div class="card"><div class="small mute" style="margin-bottom:4px">Erscheinen in jeder Woche dieser Phase zum Abhaken.</div>
    <div class="list">${mikro.map(x => `<div class="li" data-a="editPtask" data-id="${esc(x.id)}"><div class="grow">${esc(x.title)}</div>${icon('edit', 'chev')}</div>`).join('') || '<div class="mute small">Keine.</div>'}</div></div>`;
  h += sec('Wochen');
  h += `<div class="card list">${weeksOf(p).map(w => {
    const games = weekGames(w.key), wd = weekData(w.key), dn = Object.values(wd.tasks || {}).filter(Boolean).length;
    const planned = Object.values(wd.days || {}).filter(d => (d.topics || []).length || (d.exercises || []).length || (d.athletics || []).length).length, wph = GP[wd.phase];
    return `<div class="weekrow ${w.key === curKey ? 'now' : ''}" data-a="open" data-h="#/saison/woche/${w.key}"><div class="kw">KW ${w.week}</div>
      <div class="grow" style="min-width:0"><div class="small"><b>${D.short(w.monday)}–${D.short(D.add(w.monday, 6))}</b>${w.key === curKey ? ' · <b style="color:var(--accent)">aktuell</b>' : ''}</div>
      <div class="tiny mute ell">${games.length ? games.map(g => esc(g.opponent)).join(' · ') : 'kein Spiel'}</div>
      <div class="tiny mute">${wph ? `<b style="color:${wph.c}">${esc(wph.s)}</b> · ` : ''}Training: ${planned ? planned + ' Tage geplant' : '–'} · Wochenaufgaben ${dn}/${mikro.length}</div></div>${icon('chev', 'chev')}</div>`;
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
  if (p) h += `<div class="card"><h3>Wochenaufgaben</h3>${weekTaskRows(p, key)}</div>`;
  h += `<div class="card"><h3>Notizen zur Woche</h3><div class="f" style="margin:0"><textarea data-a="weekField" data-week="${key}" data-f="note" placeholder="z. B. Abwesenheiten, Besonderheiten…">${esc(w.note || '')}</textarea></div></div>`;
  return { title: `Woche · KW ${D.week(mon).week}`, back: true, html: h };
}

// ───────────────────────── Spiele & Spieltag ─────────────────────────
function parseResult(r) { const m = /^\s*(\d+)\s*[:\-]\s*(\d+)\s*$/.exec(r || ''); return m ? [+m[1], +m[2]] : null; }
const hasRes = g => !!(parseResult(g.result) || hasPlace(g));
const OUT = { S: { l: 'Sieg', c: '#16a34a' }, U: { l: 'Unentschieden', c: '#d4a106' }, N: { l: 'Niederlage', c: '#dc2626' } };
// Offene Punkte eines Spiels: nach dem Spiel Ergebnis + nicht abgehakte Checkliste
function openItems(g) {
  if (g.cancelled || g.date >= D.today()) return 0;
  const items = Store.all('checkitem');
  return (hasRes(g) ? 0 : 1) + items.filter(i => !(g.checks || {})[i.id]).length;
}
const gameDone = g => g.cancelled || (g.date < D.today() && hasRes(g));
const needsResult = g => !g.cancelled && g.date < D.today() && !hasRes(g);
const shortOpp = s => (s || 'Spiel').replace(/\s*\((?:U\d+|F)\)/gi, '').replace(/\s+U1\d(\/\d)?(-\d)?\b/g, '').trim();
// ───────────── Spiele: Platzierungen, Formkurve mit Sprechblase, Startelf auf dem Feld (Version 1.3) ─────────────
const PLACE_TYPES = ['LV', 'Turnier'];
const hasPlace = g => PLACE_TYPES.includes(g.type) && +g.place > 0;
function outcome(g) {
  const r = parseResult(g.result);
  if (r) return r[0] > r[1] ? 'S' : r[0] < r[1] ? 'N' : 'U';
  if (hasPlace(g)) return +g.place === 1 ? 'S' : +g.place <= 4 ? 'U' : 'N';
  return null;
}
const resText = g => parseResult(g.result) ? g.result : hasPlace(g) ? `Platz ${g.place}` : '';
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
  for (const g of gs) { tot[outcome(g)]++; const r = parseResult(g.result); if (r) { gf += r[0]; ga += r[1]; } }
  const last5 = gs.slice(-5), bh = { S: 20, U: 11, N: 4 };
  formCurve.games = gs;
  return `<div class="card form" id="formcard"><div class="row"><b class="grow">Formkurve</b><span class="small mute">${tot.S} S · ${tot.U} U · ${tot.N} N · Tore ${gf}:${ga}</span></div>
    <svg viewBox="0 0 ${W} ${H}" class="curve" role="img" aria-label="Formkurve">
      <line x1="${pad}" x2="${W - pad}" y1="${y(1.5)}" y2="${y(1.5)}" class="mid"/>
      <path d="${area}" class="area"/><path d="${line}" class="ln"/>
      ${gs.map((g, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(roll[i]).toFixed(1)}" r="2.2" class="pt"/><rect x="${(x(i) - 3).toFixed(1)}" y="${106 - bh[outcome(g)]}" width="6" height="${bh[outcome(g)]}" rx="2" fill="${OUT[outcome(g)].c}"/>
        <rect class="hit" data-fi="${i}" x="${(x(i) - (W - 2 * pad) / n / 2).toFixed(1)}" y="0" width="${((W - 2 * pad) / n).toFixed(1)}" height="${H}"/>`).join('')}
    </svg><div class="bubble" id="fbubble" hidden></div>
    <div class="row small"><span class="mute grow">Punkt antippen für Details · Linie: Punkteschnitt der letzten 5 (Platz 1 = Sieg, 2–4 = Remis)</span><span>Letzte 5: ${last5.map(g => `<span class="fdot" style="background:${OUT[outcome(g)].c}">${outcome(g)}</span>`).join('')}</span></div></div>`;
}
function showBubble(i, rectEl) {
  const g = (formCurve.games || [])[i], card = $('#formcard'), b = $('#fbubble'); if (!g || !card || !b) return;
  const o = outcome(g);
  b.innerHTML = `<div class="bb-d">${D.long(g.date)} ${D.parse(g.date).getFullYear()}${g.type ? ' · ' + esc(g.type) : ''}</div>
    <div class="bb-o">${esc(shortOpp(g.opponent))}${g.ha ? ` <span class="ha ${g.ha}">${g.ha}</span>` : ''}</div>
    <div class="bb-r" style="color:${OUT[o].c}">${esc(resText(g))} · ${OUT[o].l}</div><button class="link" data-a="open" data-h="#/spiele/${encodeURIComponent(g.id)}">Spiel öffnen</button>`;
  b.hidden = false;
  const cr = card.getBoundingClientRect(), rr = rectEl.getBoundingClientRect();
  const cx = rr.left + rr.width / 2 - cr.left, bw = b.offsetWidth;
  b.style.left = Math.max(6, Math.min(cr.width - bw - 6, cx - bw / 2)) + 'px';
  b.style.top = (rr.top - cr.top + 4) + 'px';
  b.style.setProperty('--ax', (cx - Math.max(6, Math.min(cr.width - bw - 6, cx - bw / 2))) + 'px');
  $$('#formcard .hit').forEach(h => h.classList.toggle('on', h === rectEl));
}
document.addEventListener('pointerover', e => { const h = e.target.closest && e.target.closest('#formcard .hit'); if (h && e.pointerType === 'mouse') showBubble(+h.dataset.fi, h); });
document.addEventListener('click', e => {
  const h = e.target.closest && e.target.closest('#formcard .hit');
  if (h) { showBubble(+h.dataset.fi, h); return; }
  if (!e.target.closest || !e.target.closest('#fbubble')) { const b = $('#fbubble'); if (b) b.hidden = true; }
}, true);
// Platzierung per Drehrad (wie iOS-Wecker)
function placeSheet(g) {
  const cur = +g.place || 1, IH = 40;
  Sheet.open(`Platzierung · ${shortOpp(g.opponent)}`, `<div class="small mute" style="margin-bottom:10px">${D.long(g.date)} · ${esc(g.type)} – auf welchem Platz seid ihr gelandet?</div>
    <div class="wheelwrap"><div class="wheel" id="wheel">${Array.from({ length: 30 }, (_, i) => `<div class="wi" data-v="${i + 1}">${i + 1}. Platz</div>`).join('')}</div><div class="wheel-band"></div></div>
    <div class="small mute" style="margin-top:10px;text-align:center">Platz 1 zählt als Sieg, 2–4 als Unentschieden, ab 5 als Niederlage.</div>
    <label class="toggle" style="margin-top:14px"><input type="checkbox" id="pcx" ${g.cancelled ? 'checked' : ''}>Ist ausgefallen / abgesagt</label>
    <button class="link" data-a="resultScore" data-id="${esc(g.id)}" style="margin-top:6px">Stattdessen ein Spielergebnis eintragen</button>`,
    `<button class="btn primary" data-a="placeSave" data-id="${esc(g.id)}">Speichern</button>`,
    el => {
      const w = $('#wheel', el); w.scrollTop = (cur - 1) * IH;
      const mark = () => { const i = Math.round(w.scrollTop / IH); $$('.wi', w).forEach((d, j) => d.classList.toggle('on', j === i)); };
      mark(); w.addEventListener('scroll', () => requestAnimationFrame(mark));
      w.addEventListener('click', e => { const it = e.target.closest('.wi'); if (it) w.scrollTo({ top: (+it.dataset.v - 1) * IH, behavior: 'smooth' }); });
    });
}
function resultForm(g, forceScore) {
  if (!forceScore && PLACE_TYPES.includes(g.type) && !parseResult(g.result)) return placeSheet(g);
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
// Startelf auf dem Spielfeld: Bank unten, Spieler aufs Feld ziehen
const SPOTS = [[50, 90], [16, 70], [38, 75], [62, 75], [84, 70], [50, 58], [30, 45], [70, 45], [16, 24], [50, 16], [84, 24]];
function lineupOf(g) {
  const lu = { ...(g.lineup || {}) };
  for (const id of g.start11 || []) if (!lu[id]) { const s = freeSpot(lu, Store.data(id)); lu[id] = { x: s[0], y: s[1] }; }
  for (const id of Object.keys(lu)) if (!Store.items.has(id)) delete lu[id];
  return lu;
}
function freeSpot(lu, p) {
  const taken = Object.values(lu), free = s => !taken.some(t => Math.hypot(t.x - s[0], t.y - s[1]) < 9);
  if (p && p.group === 'TW' && free(SPOTS[0])) return SPOTS[0];
  return SPOTS.slice(1).find(free) || SPOTS.find(free) || [50, 50];
}
function lineupSheet(gid) {
  const g = Store.get(gid); if (!g) return;
  const lu = lineupOf(g), on = Object.keys(lu);
  const pool = ((g.squad || []).length ? g.squad : players().map(p => p.id)).filter(id => Store.items.has(id));
  const bench = pool.filter(id => !on.includes(id)).map(id => Store.get(id)).sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || tierIdx(a) - tierIdx(b) || byName(a, b));
  const tok = (p, cls, st = '') => `<span class="ltok ${cls}" data-ltok="${esc(p.id)}" style="--tc:${tierOf(p.tier).c};${st}">${esc(p.short || p.name)}${p.number ? `<i>${esc(p.number)}</i>` : ''}</span>`;
  Sheet.open(`Startelf · ${shortOpp(g.opponent)}`, `<div class="row small" style="margin-bottom:8px"><b class="grow">${on.length}/11 auf dem Feld</b><button class="link" data-a="luClear" data-id="${esc(gid)}">Feld leeren</button></div>
    <div class="lpitch" id="lpitch" data-gid="${esc(gid)}"><i class="lp-half"></i><i class="lp-circle"></i><i class="lp-box t"></i><i class="lp-box b"></i>
      ${on.map(id => { const p = Store.get(id); return p ? tok(p, 'onp', `left:${lu[id].x}%;top:${lu[id].y}%`) : ''; }).join('')}</div>
    <div class="benchlab small mute">Bank · ${bench.length} ${(g.squad || []).length ? 'aus dem Kader' : '(noch kein Kader gewählt – alle Spieler)'}</div>
    <div class="bench" id="bench">${bench.map(p => tok(p, 'onb')).join('') || '<span class="tiny mute">Alle Spieler stehen auf dem Feld.</span>'}</div>
    <div class="tiny mute" style="margin-top:8px">Spieler aufs Feld ziehen · antippen setzt ihn automatisch ein · auf dem Feld antippen oder zurück auf die Bank ziehen = raus.</div>`);
}
function saveLineup(gid, lu) {
  Store.patch(gid, 'game', { lineup: lu, start11: Object.keys(lu) });
  lineupSheet(gid); render();
}
const LDrag = { el: null, id: null, start: null, active: false, ghost: null, fromPitch: false };
document.addEventListener('pointerdown', e => {
  const el = e.target.closest && e.target.closest('[data-ltok]'); if (!el) return;
  e.preventDefault();
  Object.assign(LDrag, { el, id: el.dataset.ltok, start: [e.clientX, e.clientY], active: false, fromPitch: el.classList.contains('onp') });
});
document.addEventListener('pointermove', e => {
  if (!LDrag.el) return;
  if (!LDrag.active && Math.hypot(e.clientX - LDrag.start[0], e.clientY - LDrag.start[1]) > 6) {
    LDrag.active = true; LDrag.el.classList.add('lifted');
    const g = LDrag.el.cloneNode(true); g.className = 'ltok ghost'; document.body.appendChild(g); LDrag.ghost = g;
  }
  if (LDrag.active) { e.preventDefault(); LDrag.ghost.style.left = e.clientX + 'px'; LDrag.ghost.style.top = e.clientY + 'px'; }
});
document.addEventListener('pointerup', e => {
  if (!LDrag.el) return;
  const { id, active, fromPitch } = LDrag, pitch = $('#lpitch');
  if (LDrag.ghost) LDrag.ghost.remove();
  LDrag.el.classList.remove('lifted');
  Object.assign(LDrag, { el: null, ghost: null, active: false });
  if (!pitch) return;
  const gid = pitch.dataset.gid, g = Store.get(gid), lu = lineupOf(g);
  if (!active) { // Antippen
    if (fromPitch) delete lu[id];
    else { if (Object.keys(lu).length >= 11) return toast('Es stehen schon 11 auf dem Feld'); const s = freeSpot(lu, Store.data(id)); lu[id] = { x: s[0], y: s[1] }; }
    return saveLineup(gid, lu);
  }
  const r = pitch.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (inside) {
    if (!lu[id] && Object.keys(lu).length >= 11) return toast('Es stehen schon 11 auf dem Feld');
    lu[id] = { x: Math.round(Math.max(6, Math.min(94, (e.clientX - r.left) / r.width * 100))), y: Math.round(Math.max(4, Math.min(96, (e.clientY - r.top) / r.height * 100))) };
  } else if (fromPitch) delete lu[id];
  else return;
  saveLineup(gid, lu);
});
document.addEventListener('pointercancel', () => { if (LDrag.ghost) LDrag.ghost.remove(); if (LDrag.el) LDrag.el.classList.remove('lifted'); Object.assign(LDrag, { el: null, ghost: null, active: false }); });
function gameTile(g) {
  const o = outcome(g), open = openItems(g), up = !g.cancelled && g.date >= D.today();
  const days = up ? D.diff(D.today(), g.date) : null;
  return `<div class="gtile ${o ? 'o' + o : ''} ${g.cancelled ? 'cx' : ''} ${up ? 'up' : ''}" data-a="open" data-h="#/spiele/${encodeURIComponent(g.id)}">
    ${open ? `<span class="nbadge">${open}</span>` : ''}
    <div class="gd">${D.wd(g.date)} ${D.parse(g.date).getDate()}.${g.ha ? ` <span class="ha ${g.ha}">${g.ha}</span>` : ''}</div>
    <div class="go">${esc(shortOpp(g.opponent))}</div>
    <div class="gr">${g.cancelled ? 'abgesagt' : o ? esc(resText(g)) : up ? (g.kickoff ? esc(g.kickoff) : days === 0 ? 'heute' : 'in ' + days + ' T.') : 'Ergebnis?'}</div>
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
  h += `<div class="chips"><button class="chip blank ${f.type ? '' : 'on'}" data-a="gType" data-v="" aria-label="Alle Spielarten" title="Alle"></button>${GTYPES.map(x => `<button class="chip ${f.type === x ? 'on' : ''}" data-a="gType" data-v="${x}">${x}</button>`).join('')}</div>`;
  h += formCurve(all.filter(g => g.date < t));
  { const cl = Store.all('club'), cb = cl.filter(c => clubStatus(c) === 'pending').length, dn = cl.filter(c => clubStatus(c) === 'fix').length;
    h += `<div class="linkrow" data-a="open" data-h="#/tests">${icon('tests', 'mini')}<span class="grow">Testspielplanung${cb ? ` · <b>${cb} ohne Rückmeldung</b>` : ''} · ${dn} fix</span>${icon('chev', 'chev')}</div>`; }
  if (todo.length) h += `<div class="card alert"><h3><span class="grow">Ergebnis eintragen</span><span class="nbadge static">${todo.length}</span></h3>
    <div class="list">${todo.map(g => `<div class="li" data-a="quickResult" data-id="${esc(g.id)}"><div class="grow"><div class="t ell">${esc(g.opponent)}</div><div class="s">${D.long(g.date)} · ${esc(g.type || 'Spiel')}</div></div><span class="link">Eintragen</span></div>`).join('')}</div></div>`;
  if (!games.length) h += '<div class="empty">Keine Spiele für diese Auswahl.</div>';
  let month = null;
  const qs = f.when === 'past' || (f.type && f.type !== 'Test') ? [] : slots().filter(x => x.date >= t);
  const items = [...games.map(g => ({ d: g.date, g })), ...qs.map(q => ({ d: q.date, q }))];
  if (f.when !== 'past') items.sort((a, b) => a.d.localeCompare(b.d));
  for (const it of items) {
    const m = D.month(it.d);
    if (m !== month) { if (month) h += '</div>'; h += sec(m) + '<div class="gtiles">'; month = m; }
    h += it.g ? gameTile(it.g) : `<div class="gtile up qtile" data-a="open" data-h="#/tests/termine"><div class="gd">${D.wd(it.d)} ${D.parse(it.d).getDate()}.</div><div class="go">???</div><div class="gr">Gegner?</div><div class="gt">offen</div></div>`;
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
    <div class="small mute">${g.tentative ? 'KW ' + D.week(g.date).week + ' · Tag noch offen' : D.long(g.date) + ' ' + D.parse(g.date).getFullYear()}${g.alt ? ' · evtl. ' + D.long(g.alt) : ''}</div></div>
    ${g.ha ? `<span class="ha ${g.ha}" style="font-size:14px">${g.ha === 'H' ? 'Heim' : 'Auswärts'}</span>` : ''}</div>
    ${o ? `<div class="bigres" style="color:${OUT[o].c}">${esc(resText(g))} <span>${OUT[o].l}</span></div>` : ''}
    <div class="badges">${g.cancelled ? badge('abgesagt', '#64748b') : ''}${g.type ? badge(g.type) : ''}${g.important ? badge('wichtiges Spiel', '#d97706') : ''}${club && club.level ? badge(LEVELS.find(l => l.k === club.level)?.l || club.level) : ''}${g.source ? badge('fussball.de') : ''}</div>
    <dl class="kv" style="margin-top:12px">${g.meet ? `<dt>Treffen</dt><dd>${esc(g.meet)} Uhr</dd>` : ''}${g.kickoff ? `<dt>Anstoß</dt><dd>${esc(g.kickoff)} Uhr</dd>` : ''}${g.venue ? `<dt>Ort</dt><dd>${esc(g.venue)}</dd>` : ''}${g.note ? `<dt>Notiz</dt><dd>${esc(g.note)}</dd>` : ''}</dl>
    <div class="kitrow"><span class="small mute">Trikots</span>${[['rot', '#c62828'], ['schwarz', '#1d1a29']].map(([k, c]) => `<button class="kit ${g.kit === k ? 'on' : ''}" style="--kc:${c}" data-a="setKit" data-id="${esc(id)}" data-v="${k}"><i></i>${k}</button>`).join('')}</div>
    <div class="row" style="margin-top:10px;gap:6px"><button class="btn sm" data-a="editGame" data-id="${esc(id)}">${icon('edit')} Spieldaten</button>
    ${!g.cancelled && g.date <= D.today() ? `<button class="btn sm primary" data-a="quickResult" data-id="${esc(id)}">${PLACE_TYPES.includes(g.type) && !parseResult(g.result) ? (o ? 'Platzierung ändern' : 'Platzierung eintragen') : o ? 'Ergebnis ändern' : 'Ergebnis eintragen'}</button>` : ''}</div></div>`;
  if (needsResult(g)) h += `<div class="warnbox">Das Spiel ist vorbei – bitte noch das Ergebnis eintragen.</div>`;

  const squad = g.squad || [], start = g.start11 || [], warn = startWarnings(g);
  h += sec('Kader & Startelf');
  h += `<div class="card"><div class="row"><b class="grow">Kader ${squad.length}/${s.squadMax || 17}</b><button class="btn sm" data-a="pickSquad" data-id="${esc(id)}">Kader wählen</button></div>
    <div style="margin-top:6px">${squad.map(p => `<span class="pill">${esc(playerName(p))}</span>`).join('') || '<span class="mute small">Noch kein Kader.</span>'}</div>
    <div class="row" style="margin-top:14px"><b class="grow">Startelf ${start.length}/11</b><button class="btn sm" data-a="pickStart" data-id="${esc(id)}">Aufstellen</button></div>
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
function gameForm(g = {}, isNew) {
  openForm({
    title: isNew ? 'Neues Spiel' : 'Spieldaten', value: g,
    fields: [
      { k: 'opponent', l: 'Gegner', auto: isNew },
      [{ k: 'date', l: 'Datum', t: 'date' }, { k: 'kickoff', l: 'Anstoß', t: 'time' }],
      [{ k: 'meet', l: 'Treffen', t: 'time' }, { k: 'result', l: 'Ergebnis (wir : Gegner)', ph: 'z. B. 3:1' }],
      { k: 'ha', l: 'Heim / Auswärts', t: 'seg', opts: [['H', 'Heim'], ['A', 'Auswärts'], ['', 'offen']] },
      { k: 'type', l: 'Art', t: 'seg', opts: GTYPES.map(x => [x, x]) },
      [{ k: 'venue', l: 'Ort / Platz' }, { k: 'place', l: 'Platzierung (LV/Turnier)', t: 'number' }],
      { k: 'kit', l: 'Trikots', t: 'seg', opts: [['rot', 'rot'], ['schwarz', 'schwarz'], ['', 'offen']] },
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
// Mannschaftsteil aus der Stammposition: ★ beste Position > meiste Stammpositionen > eingetragener Mannschaftsteil
const PGRP = { Tor: 'TW', Abwehr: 'Abwehr', Mittelfeld: 'Mittelfeld', Angriff: 'Sturm' };
function pgroup(p) {
  if (p.best && posvOf(p.best) && (p.posv || {})[p.best]) return PGRP[posvOf(p.best).g];
  const st = POSV.filter(P => (p.posv || {})[P.k] === 1); if (!st.length) return p.group || '';
  const cnt = {}; st.forEach(P => { const g = PGRP[P.g]; cnt[g] = (cnt[g] || 0) + 1; });
  const mx = Math.max(...Object.values(cnt)), c = GROUPS.filter(g => cnt[g] === mx);
  return c.includes(p.group) ? p.group : c[0];
}
const tierIdx = p => { const i = TIER_RANK.indexOf(p.tier || ''); return i < 0 ? 9 : i; };
function posChips(p, max = 6) {
  const e = Object.entries(p.posv || {}).sort((a, b) => a[1] - b[1] || POSV.findIndex(x => x.k === a[0]) - POSV.findIndex(x => x.k === b[0]));
  return e.slice(0, max).map(([k, l]) => `<span class="pos l${l}">${posvOf(k)?.l || k}</span>`).join(' ') + (e.length > max ? ` <span class="tiny mute">+${e.length - max}</span>` : '');
}
const stammChips = p => POSV.filter(P => (p.posv || {})[P.k] === 1).sort((a, b) => (b.k === p.best) - (a.k === p.best)).map(P => `<span class="pos l1">${P.k === p.best ? '★ ' : ''}${esc(P.l)}</span>`).join(' ');
const posText = p => Object.entries(p.posv || {}).sort((a, b) => a[1] - b[1]).map(([k, l]) => (posvOf(k)?.l || k) + (l === 2 ? '?' : '')).join(' ');
function viewKader(parts) {
  const sub = parts[0] || 'tiers';
  let h = `<div class="seg">${[['tiers', 'Tiers'], ['positionen', 'Positionen'], ['feld', 'Feld'], ['liste', 'Liste']].map(([v, l]) => `<button class="${sub === v ? 'on' : ''}" data-a="open" data-h="#/kader/${v}">${l}</button>`).join('')}</div>`;
  if (sub === 'feld') h += pitchView();
  else if (sub === 'positionen') h += posMatrix();
  else if (sub === 'liste') h += kaderListe();
  else h += tierBoard();
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
  const half = (rows, cls) => `<div class="phalf ${cls}">${rows.map(row => row.map(([k, a, b]) => {
    const P = posvOf(k), list = eligible(k), wide = b - a >= 3;
    return `<div class="pbox" style="grid-column:${a}/${b}" data-a="posSheet" data-k="${k}" title="${esc(P.f)}">
      <div class="pl2"><b>${esc(P.l)}</b><em>${list.length || ''}</em></div>${wide ? `<div class="pfull">${esc(P.f.replace(/ \(.*\)$/, ''))}</div>` : ''}
      <div class="pchips">${list.map(x => pchip(x.p, x.e)).join('') || '<span class="pnone">–</span>'}</div></div>`;
  }).join('')).join('')}</div>`;
  h += half(PITCH_TOP, 'top') + `<div class="halfway"><i class="hl"></i><i class="cc"></i><i class="cs"></i></div>` + half(PITCH_BOT, 'bot');
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
    <div class="board"><div></div>${GROUPS.map(g => `<div class="h">${GROUPL[g]} <span>${ps.filter(p => pgroup(p) === g).length}</span></div>`).join('')}`;
  for (const t of TIERS) {
    const row = ps.filter(p => (p.tier || '') === t.k);
    if (!t.k && !row.length) continue;
    h += `<div class="rl" style="background:${t.c}">${esc(t.s)}</div>`;
    for (const g of GROUPS) h += `<div class="cell" data-drop="1" data-tier="${t.k}" data-group="${g}" style="--tb:${t.bg}">${row.filter(p => pgroup(p) === g).map(p => `<div class="nm" data-drag="${esc(p.id)}">${p.best ? '<b class="nst">★</b>' : ''}${esc(p.short || p.name)}${p.number ? `<i>${esc(p.number)}</i>` : ''}</div>`).join('')}</div>`;
  }
  const noGroup = ps.filter(p => !pgroup(p));
  h += `</div>${noGroup.length ? `<div class="small mute" style="margin-top:10px">Ohne Mannschaftsteil: ${noGroup.map(p => `<a class="link" data-a="quickTier" data-id="${esc(p.id)}">${esc(p.name)}</a>`).join(', ')}</div>` : ''}`;
  h += depthView();
  return h;
}
// Tiefe einer Position (1–5): 5 = 2 Top + 2 Gut · 4 = 1 Top + 2 Gut · 3 = 3 Gute · 2 = 2 Gute + 1 Okay · sonst 1 (0 = niemand). „In Frage“ zählt eine Stufe tiefer. 8,5 wird nicht bewertet.
const DEPTH = { 5: { c: '#16a34a', s: '✓' }, 4: { c: '#16a34a', s: '✓' }, 3: { c: '#ea8a0c', s: '!' }, 2: { c: '#dc2626', s: '!' }, 1: { c: '#dc2626', s: '!' }, 0: { c: '#dc2626', s: '!' } };
function depthInfo(k) {
  const el = eligible(k), T = el.filter(x => x.e.rank === 0).length, G = el.filter(x => x.e.rank === 1).length, O = el.filter(x => x.e.rank === 2).length, TG = T + G;
  if (k === 'ACHTFUENF') return { T, G, O, sc: -1, st: 'skip', msg: 'wird nicht bewertet' };
  const sc = T >= 2 && TG >= 4 ? 5 : T >= 1 && TG >= 3 ? 4 : TG >= 3 ? 3 : TG >= 2 && TG + O >= 3 ? 2 : TG + O ? 1 : 0;
  const next = { 4: 'für 5/5: 2 Top + 2 Gut', 3: 'für 4/5: 1 Top dazu', 2: 'für 3/5: noch 1 Guter', 1: 'für 2/5: 2 Gute + 1 Okay', 0: 'niemand eingeplant' }[sc] || 'top besetzt';
  return { T, G, O, sc, st: sc >= 4 ? 'top' : sc === 3 ? 'ok' : 'thin', msg: next };
}
function depthView() {
  const all = POSV.map(P => ({ P, ...depthInfo(P.k) })).sort((a, b) => a.sc - b.sc), grp = st => all.filter(x => x.st === st);
  const pips = sc => `<span class="pips">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= sc ? 'on' : ''}"></i>`).join('')}</span>`;
  const tile = x => { const d = DEPTH[x.sc] || { c: 'var(--mute)', s: '–' };
    return `<div class="dtile ${x.st}" style="--dc:${d.c}" data-a="posSheet" data-k="${x.P.k}"><div class="dt-h"><b>${esc(x.P.l)}</b><span class="dt-st">${d.s}</span></div>
    ${x.sc >= 0 ? `<div class="dt-sc">${pips(x.sc)}<span>${x.sc}/5</span></div>` : ''}
    <div class="dt-n">${[['T', 0, 'Top'], ['G', 1, 'Gut'], ['O', 2, 'Okay']].map(([f, r, l]) => `<span style="--tc:${TIERS[r].c}" class="${x[f] ? '' : 'zero'}"><b>${x[f]}</b>${l}</span>`).join('')}</div>
    <div class="dt-m">${esc(x.msg)}</div></div>`; };
  const thin = grp('thin'), ok = grp('ok'), top = grp('top'), skip = grp('skip');
  let h = sec('Tiefe pro Position', `<span class="tiny">${thin.length ? `<b style="color:#dc2626">${thin.length} zu dünn</b>` : '<b style="color:#16a34a">nichts zu dünn</b>'}</span>`);
  h += `<div class="card"><div class="tiny mute" style="margin-bottom:10px"><b>5/5</b> 2 Top + 2 Gut · <b>4/5</b> 1 Top + 2 Gut · <b>3/5</b> 3 Gute · <b>2/5</b> 2 Gute + 1 Okay · darunter 1/5. „In Frage“ zählt eine Stufe tiefer.</div>`;
  if (thin.length) h += `<div class="dgrp" style="color:#dc2626">Zu dünn · ${thin.length}</div><div class="dgrid">${thin.map(tile).join('')}</div>`;
  if (ok.length) h += `<div class="dgrp" style="color:#ea8a0c">Ausreichend · ${ok.length}</div><div class="dgrid">${ok.map(tile).join('')}</div>`;
  if (top.length) h += `<div class="dgrp" style="color:#16a34a">Sehr gut besetzt · ${top.length}</div><div class="dgrid">${top.map(tile).join('')}</div>`;
  if (skip.length) h += `<div class="dgrp">Ohne Bewertung</div><div class="dgrid">${skip.map(tile).join('')}</div>`;
  return h + '</div>';
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
  return `<div class="matrix"><table><thead><tr><th></th>${POSV.map(P => `<th title="${esc(P.f)}">${esc(P.l)}</th>`).join('')}</tr></thead><tbody>
    ${ps.map(p => `<tr><th><span class="dot" style="background:${tierOf(p.tier).c};width:8px;height:8px"></span> ${esc(p.short || p.name)}</th>${POSV.map(P => {
      const lv = (p.posv || {})[P.k] || 0, e = effTier(p, P.k), t = e && e.tier ? tierOf(e.tier) : null;
      return `<td class="mx l${lv}" data-a="mxCycle" data-id="${esc(p.id)}" data-k="${P.k}" style="${t ? `--tc:${t.c};--tb:${t.bg}` : ''}" title="${esc(P.f)}${lv ? ' · ' + POSVLV[lv] : ''}"></td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function kaderListe() {
  const f = UI.kader;
  let ps = players();
  if (f.grp) ps = ps.filter(p => pgroup(p) === f.grp);
  if (f.q) ps = ps.filter(p => (p.name + ' ' + (p.short || '') + ' ' + (p.number || '')).toLowerCase().includes(f.q));
  let h = `<input class="search" type="search" placeholder="Spieler suchen…" value="${esc(f.q)}" data-a="kQ"><div id="results">`;
  h += chips([['', `Alle (${players().length})`], ...GROUPS.map(g => [g, GROUPL[g]])], f.grp, 'kGrp');
  for (const t of TIERS) {
    const list = ps.filter(p => (p.tier || '') === t.k).sort((a, b) => GROUPS.indexOf(pgroup(a)) - GROUPS.indexOf(pgroup(b)) || byName(a, b)); if (!list.length) continue;
    h += `<div class="sec"><span class="dot" style="background:${t.c}"></span><span class="grow">${esc(t.l)} · ${list.length}</span></div><div class="card list">`;
    h += list.map(p => `<div class="pl" data-a="editPlayer" data-id="${esc(p.id)}"><span class="num" style="background:${t.c}">${esc(p.number || '?')}</span>
      <div class="grow"><div class="t ell">${esc(p.name)}</div><div class="tiny mute" style="margin-top:2px">${esc(GROUPL[pgroup(p)] || 'keine Gruppe')}${p.stp ? ' · <b class="stp">Stützpunkt</b>' : ''}${p.note ? ' · ' + esc(p.note) : ''}</div>
      <div style="margin-top:5px">${stammChips(p) || '<span class="tiny mute">keine Stammposition</span>'}</div></div>
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
      { k: 'group', l: 'Mannschaftsteil (nur wenn keine Stammposition)', t: 'seg', opts: [...GROUPS.map(g => [g, GROUPL[g]]), ['', 'keiner']] },
      { k: 'posv', l: 'Positionen', t: 'posv', best: p.best || '' },
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
  const pg = pgroup(p), stamm = POSV.some(P => (p.posv || {})[P.k] === 1);
  if ((p.tier || '') === t.dataset.tier && pg === t.dataset.group) return;
  Store.patch(id, 'player', stamm ? { tier: t.dataset.tier } : { tier: t.dataset.tier, group: t.dataset.group });
  toast(stamm && pg !== t.dataset.group ? `${p.short || p.name} → ${tierOf(t.dataset.tier).l} · Spalte kommt aus der Stammposition` : `${p.short || p.name} → ${tierOf(t.dataset.tier).l}`); render();
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
// ───────────── Training: Trainingsphasen, Zeitplan, Periodisierung, Lexikon (Version 1.3) ─────────────
const TPH = [{ k: 'akt', l: 'Aktivierung', c: '#db2777' }, { k: 'uebung', l: 'Übungsform', c: '#2563eb' }, { k: 'spiel', l: 'Spielform', c: '#16a34a' }, { k: 'abschluss', l: 'Abschluss', c: '#ea580c' }];
const TPH_OPT = [{ k: 'ath', l: 'Athletik', c: '#0891b2' }, { k: 'extra', l: 'Extra-Training', c: '#7c3aed' }, { k: 'video', l: 'Videoanalyse', c: '#64748b' }];
const tphOf = k => [...TPH, ...TPH_OPT].find(x => x.k === k) || { k, l: k, c: '#94a3b8' };
// Schwerpunkt einer Übung: Spielphasen + Aktivierung
const FOCUS = { ...Object.fromEntries(GP5.map(k => [k, GP[k]])), AKT: { s: 'AKT', l: 'Aktivierung', c: '#db2777' } };
const focusBadge = k => FOCUS[k] ? badge(FOCUS[k].s, FOCUS[k].c) : '';
function dayBlocks(dd) {
  if (Array.isArray(dd.blocks)) return dd.blocks;
  const b = TPH.map(t => ({ k: t.k, items: [] }));
  if ((dd.exercises || []).length) b[1].items = dd.exercises.map(id => ({ id, min: '' }));
  if ((dd.athletics || []).length) b.push({ k: 'ath', items: dd.athletics.map(id => ({ id, min: '' })) });
  return b;
}
const blockMin = b => (b.items || []).reduce((s, it) => s + (+it.min || 0), 0) + (+b.min || 0);
const blocksCopy = (k, d) => JSON.parse(JSON.stringify(dayBlocks(((weekData(k).days || {})[d]) || {})));
function saveBlocks(key, d, blocks) {
  const ex = [], ath = [];
  for (const b of blocks) for (const it of b.items || []) (b.k === 'ath' ? ath : ex).push(it.id);
  setDay(key, d, { blocks, exercises: [...new Set(ex)], athletics: [...new Set(ath)] });
}
function trainingDur(dd) { return +dd.duration || +setting().trainDuration || 90; }
function dayPlan(key, d, dd) {
  const blocks = dayBlocks(dd), total = blocks.reduce((s, b) => s + blockMin(b), 0), dur = trainingDur(dd);
  const st = total < dur ? 'under' : total === dur ? 'exact' : 'over';
  let h = '';
  blocks.forEach((b, i) => {
    const T = tphOf(b.k), opt = TPH_OPT.some(x => x.k === b.k);
    const attrs = `data-week="${key}" data-day="${d}" data-b="${i}"`;
    h += `<div class="blk" style="--bc:${T.c}"><div class="blk-h">
      <span class="blk-t">${esc(T.l)}</span><span class="blk-m">${blockMin(b) ? blockMin(b) + ' Min' : ''}</span>
      <button class="iconbtn" data-a="blkMove" ${attrs} data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Nach oben">${icon('up')}</button>
      <button class="iconbtn" data-a="blkMove" ${attrs} data-d="1" ${i === blocks.length - 1 ? 'disabled' : ''} aria-label="Nach unten">${icon('down')}</button>
      ${opt ? `<button class="iconbtn" data-a="blkDel" ${attrs} aria-label="Phase entfernen">${icon('trash')}</button>` : ''}</div>`;
    if (b.k === 'video') {
      h += `<div class="blk-row"><input type="text" class="blk-text" data-a="blkText" ${attrs} value="${esc(b.text || '')}" placeholder="Was schauen wir uns an?"><label class="minf"><input type="number" min="0" inputmode="numeric" data-a="blkMin" ${attrs} value="${esc(b.min || '')}"><span>Min</span></label></div>`;
    } else {
      for (const [j, it] of (b.items || []).entries()) {
        const x = Store.get(it.id); if (!x) continue;
        h += `<div class="blk-row"><span class="blk-n" data-a="${b.k === 'ath' ? 'athOpen' : 'exOpen'}" data-id="${esc(it.id)}">${esc(b.k === 'ath' ? x.name : exName(x))}</span>
          <label class="minf"><input type="number" min="0" inputmode="numeric" data-a="itemMin" ${attrs} data-i="${j}" value="${esc(it.min || '')}"><span>Min</span></label>
          <button class="iconbtn x" data-a="itemDel" ${attrs} data-i="${j}" aria-label="Entfernen">×</button></div>`;
      }
      h += `<button class="link blk-add" data-a="blkPick" ${attrs}>+ ${b.k === 'ath' ? 'Athletikübung' : 'Übung'}</button>`;
    }
    h += `</div>`;
  });
  const missing = TPH_OPT.filter(o => !blocks.some(b => b.k === o.k));
  if (missing.length) h += `<div class="blk-opt">${missing.map(o => `<button class="chip" data-a="blkAdd" data-week="${key}" data-day="${d}" data-k="${o.k}">+ ${esc(o.l)}</button>`).join('')}</div>`;
  h += `<div class="timebar ${st}"><span>Zeit</span><b>${total}</b><span>von</span><label class="minf"><input type="number" min="0" inputmode="numeric" data-a="dayDur" data-week="${key}" data-day="${d}" value="${dur}"><span>Min</span></label>
    <span class="grow tb-msg">${st === 'exact' ? 'passt genau' : st === 'over' ? (total - dur) + ' Min zu viel' : (dur - total) + ' Min frei'}</span></div>`;
  return h;
}
function blockPick(key, d, i) {
  const blocks = blocksCopy(key, d), b = blocks[i], sel = (b.items || []).map(x => x.id);
  const w = weekData(key), n = UI.ex.n || setting().exPlayers || 16, ph = w.phase;
  let opts;
  if (b.k === 'ath') opts = Store.all('athletic').sort(byOrder).map(a => ({ v: a.id, l: a.name, g: a.cat + (a.sub ? ' · ' + a.sub : ''), s: [a.area, a.dist, a.reps].filter(Boolean).join(' · ') }));
  else {
    const match = e => b.k === 'extra' || (e.tphases || []).includes(b.k);
    const rank = e => match(e) ? 0 : !(e.tphases || []).length ? 1 : 2;
    opts = Store.all('exercise').filter(e => rank(e) < 2 || sel.includes(e.id))
      .sort((a, c) => rank(a) - rank(c) || ((c.phases || []).includes(ph) - (a.phases || []).includes(ph)) || (((c.fit || {})[n] || 0) - ((a.fit || {})[n] || 0)) || byName(a, c))
      .map(e => ({ v: e.id, l: exName(e), g: rank(e) === 0 ? (b.k === 'extra' ? 'Alle Übungen' : tphOf(b.k).l) : 'Noch keiner Trainingsphase zugeordnet', s: [(e.phases || []).map(k => FOCUS[k]?.s).filter(Boolean).join(' '), e.intensity && 'Intensität ' + e.intensity, fitRange(e)].filter(Boolean).join(' · '), r: `<span class="fitb fit${(e.fit || {})[n] || 0}">${n}: ${FITL[(e.fit || {})[n] || 0]}</span>` }));
  }
  openForm({
    title: `${tphOf(b.k).l} · Übungen`, value: { sel }, fields: [{ k: 'sel', t: 'multi', opts }], saveLabel: 'Übernehmen',
    onSave: async v => {
      const old = Object.fromEntries((b.items || []).map(x => [x.id, x]));
      blocks[i] = { ...b, items: v.sel.map(id => old[id] || { id, min: '' }) };
      saveBlocks(key, d, blocks); await Sheet.close(); render();
    },
  });
}
// Periodisierung: alle Wochen der Saison, Schwerpunkt je Woche, Spiele daneben
function distBar(keys) {
  const cnt = {}; let total = 0;
  for (const k of keys) { const ph = weekData(k).phase; if (GP[ph] && ph !== 'FREI') { cnt[ph] = (cnt[ph] || 0) + 1; total++; } }
  if (!total) return `<div class="tiny mute">Noch keine Woche mit Schwerpunkt.</div>`;
  const ks = Object.keys(GP).filter(k => cnt[k]);
  return `<div class="distbar">${ks.map(k => `<i style="width:${cnt[k] / total * 100}%;background:${GP[k].c}"></i>`).join('')}</div>
    <div class="legend">${ks.map(k => `<span><span class="dot" style="background:${GP[k].c};width:8px;height:8px"></span> ${esc(GP[k].s)} ${cnt[k]}× · ${Math.round(cnt[k] / total * 100)}%</span>`).join('')}</div>`;
}
function periodView() {
  const ps = phases(), curKey = D.week(D.today()).key;
  if (!ps.length) return '<div class="empty">Noch keine Saisonphasen angelegt.</div>';
  const allKeys = [...new Set(ps.flatMap(p => weeksOf(p).map(w => w.key)))];
  let h = `<div class="card"><h3>Schwerpunkte der ganzen Saison</h3>${distBar(allKeys)}
    <div class="tiny mute" style="margin-top:6px">Schwerpunkt antippen, um ihn für die Woche festzulegen. Die Woche selbst antippen, um das Training zu planen.</div></div>`;
  for (const p of ps) {
    const ws = weeksOf(p);
    h += `<div class="pmeso" style="--pc:${PHC[p.type]}"><div class="pm-h"><b>${esc(p.label)}</b> <span>${MAKRO[p.makro]} · ${D.short(p.start)}–${D.short(p.end)}</span></div>${distBar(ws.map(w => w.key))}</div>`;
    h += `<div class="card list pweeks">`;
    for (const w of ws) {
      const ph = GP[weekData(w.key).phase], games = weekGames(w.key), wdd = weekData(w.key).days || {}, qs = slots().filter(x => x.date >= w.monday && x.date <= D.add(w.monday, 6));
      const sq = (setting().trainingDays || [2, 4, 5]).map(d => { const date = D.add(w.monday, d - 1), r = RATE[(wdd[d] || {}).rating];
        return `<i class="pw-sq ${r ? 'r' : date < D.today() ? 'past' : ''}" style="${r ? `--rc:${r.c}` : ''}" title="${WD[d]} ${D.short(date)}${r ? ' · Bewertung ' + wdd[d].rating + '/5' : ''}">${WD[d].slice(0, 2)}</i>`; }).join('');
      h += `<div class="pw ${w.key === curKey ? 'now' : ''}" ${w.key === curKey ? 'id="pw-now"' : ''}>
        <button class="pw-ph ${ph ? 'set' : ''}" style="--c:${ph ? ph.c : 'var(--line)'}" data-a="phasePick" data-week="${w.key}" aria-label="Schwerpunkt wählen">${ph ? esc(ph.s) : '+'}</button>
        <div class="grow pw-mid" data-a="open" data-h="#/training/woche/${w.key}"><div class="pw-kw">KW ${w.week}</div><div class="tiny mute">${D.short(w.monday)}–${D.short(D.add(w.monday, 6))}</div></div>
        <div class="pw-sqs" data-a="open" data-h="#/training/woche/${w.key}">${sq}</div>
        <div class="pw-games">${[...games.map(g => ({ d: g.date, g })), ...qs.map(q => ({ d: q.date, q }))].sort((a, b) => a.d.localeCompare(b.d)).map(x => { if (x.q) return `<span class="pwg q" data-a="open" data-h="#/tests/termine" title="Offener Testspieltermin ${D.short(x.d)}">???</span>`;
          const g = x.g, o = outcome(g); return `<span class="pwg ${o ? 'o' + o : ''} ${g.cancelled ? 'cx' : ''}" data-a="open" data-h="#/spiele/${encodeURIComponent(g.id)}" title="${esc(g.opponent)} · ${D.long(g.date)}">${esc(shortOpp(g.opponent))}</span>`; }).join('')}</div></div>`;
    }
    h += `</div>`;
  }
  return h;
}
// Lexikon: Mannschaftstaktik · Individualtaktik & -technik · Athletik
const TEAMCATS = ['Gruppentaktik', 'Mannschaftstaktik'];
const topicArea = t => TEAMCATS.includes(t.cat) ? 'team' : 'indiv';
const LEXAREAS = [['team', 'Mannschaftstaktik'], ['indiv', 'Individualtaktik & -technik'], ['athletik', 'Athletik']];
function lexikonView(area) {
  area = LEXAREAS.some(a => a[0] === area) ? area : 'team';
  let h = `<div class="seg sub3">${LEXAREAS.map(([v, l]) => `<button class="${area === v ? 'on' : ''}" data-a="open" data-h="#/training/lexikon/${v}">${l}</button>`).join('')}</div>`;
  if (area === 'athletik') return h + athleticList();
  const f = UI.topics, use = topicUse();
  let ts = Store.all('topic').filter(t => topicArea(t) === area).sort(byOrder);
  if (f.ph) ts = ts.filter(t => (t.phases || []).includes(f.ph) || (t.phases || []).includes('ALL'));
  h += chips([['', 'Alle'], ...GP5.map(k => [k, gpS(k)])], f.ph, 'topPh');
  const cats = area === 'team' ? TEAMCATS : TOPICCATS.filter(c => !TEAMCATS.includes(c));
  for (const cat of cats) {
    const list = ts.filter(t => t.cat === cat); if (!list.length) continue;
    h += sec(cat) + `<div class="card">${list.map(t => `<span class="topicchip" data-a="editTopic" data-id="${esc(t.id)}">${(t.phases || []).filter(p => p !== 'ALL').map(p => `<span class="dot" style="background:${GP[p]?.c};width:7px;height:7px"></span>`).join('')}${esc(t.title)}${use[t.id] ? ` <span class="n">${use[t.id]}×</span>` : ''}</span>`).join('')}</div>`;
  }
  if (!ts.length) h += '<div class="empty">Keine Themen in dieser Auswahl.</div>';
  return h;
}
function viewTraining(parts) {
  let sub = parts[0] || 'woche';
  if (sub === 'athletik') { parts = ['lexikon', 'athletik']; sub = 'lexikon'; }
  if (sub === 'themen') { parts = ['lexikon', 'team']; sub = 'lexikon'; }
  let h = `<div class="seg">${[['woche', 'Woche'], ['periodisierung', 'Periodisierung'], ['uebungen', 'Übungen'], ['lexikon', 'Lexikon']].map(([v, l]) => `<button class="${sub === v ? 'on' : ''}" data-a="open" data-h="#/training/${v}">${l}</button>`).join('')}</div>`;
  let fab = null;
  if (sub === 'uebungen') { h += exerciseList(); fab = 'newExercise'; }
  else if (sub === 'periodisierung') { h += periodView(); setTimeout(() => { const n = document.getElementById('pw-now'); if (n && !periodView._done) { periodView._done = true; n.scrollIntoView({ block: 'center' }); } }, 30); }
  else if (sub === 'lexikon') { h += lexikonView(parts[1]); fab = parts[1] === 'athletik' ? 'newAthletic' : 'newTopic'; UI.lexArea = parts[1] || 'team'; }
  else h += trainingWeek(parts[1] || D.week(D.today()).key);
  return { title: 'Training', html: h, fab };
}
function mesoDistribution(p) {
  const cnt = {}; let total = 0;
  for (const w of weeksOf(p)) { const ph = weekData(w.key).phase; if (GP[ph] && ph !== 'FREI') { cnt[ph] = (cnt[ph] || 0) + 1; total++; } }
  if (!total) return `<div class="tiny mute">In dieser Phase hat noch keine Woche einen Schwerpunkt.</div>`;
  const keys = Object.keys(GP).filter(k => cnt[k]);
  return `<div class="distbar">${keys.map(k => `<i style="width:${cnt[k] / total * 100}%;background:${GP[k].c}"></i>`).join('')}</div>
    <div class="legend">${keys.map(k => `<span><span class="dot" style="background:${GP[k].c};width:8px;height:8px"></span> ${gpS(k)} ${cnt[k]}×</span>`).join('')}</div>`;
}
function rateRow(key, d, dd) {
  return `<div class="rate"><span>Wie war das Training?</span>${[1, 2, 3, 4, 5].map(n => `<button class="${dd.rating === n ? 'on' : ''}" style="--rc:${RATE[n].c}" data-a="rate" data-week="${key}" data-day="${d}" data-v="${n}" aria-label="${n} von 5 – ${RATE[n].l}">${n}</button>`).join('')}</div>`;
}
function trainingWeek(key) {
  const mon = D.fromKey(key), p = phaseAt(mon) || phaseAt(D.add(mon, 6)), w = weekData(key), days = setting().trainingDays || [2, 4, 5];
  const prev = D.week(D.add(mon, -7)).key, next = D.week(D.add(mon, 7)).key, wp = GP[w.phase];
  let h = `<div class="weekhead"><div class="wh-nav"><button class="iconbtn" data-a="open" data-h="#/training/woche/${prev}" aria-label="Vorherige Woche">${icon('left')}</button>
    <div class="grow"><div class="wh-kw">KW ${D.week(mon).week} <span class="wh-dates">${D.short(mon)}–${D.short(D.add(mon, 6))}</span></div><div class="wh-sub">${p ? esc(phaseName(p)) : 'keine Saisonphase'}</div></div>
    <button class="iconbtn" data-a="open" data-h="#/training/woche/${next}" aria-label="Nächste Woche">${icon('right')}</button></div>
    <button class="phpick wk ${wp ? 'set' : ''}" style="--c:${wp ? wp.c : 'var(--mute)'}" data-a="phasePick" data-week="${key}">
      <span class="wk-main">${wp ? `<span class="phcode">${esc(wp.s)}</span> ${esc(wp.l)}` : 'Schwerpunkt der Woche wählen'}</span><small>${wp ? 'Schwerpunkt der Woche · antippen zum Ändern' : 'Spielphase, die diese Woche im Mittelpunkt steht'}</small></button>
    ${p ? `<div class="wh-dist"><div class="tiny mute">Wochenschwerpunkte in der ${esc(p.label)} bisher</div>${mesoDistribution(p)}</div>` : ''}</div>`;
  let past = '';
  UI.pastOpen = UI.pastOpen || {};
  for (const d of days) {
    const date = D.add(mon, d - 1), dd = (w.days || {})[d] || {}, ph = wp;
    if (date < D.today() && !UI.pastOpen[key + d]) {
      const gs = gamesBetween(date, date), r = RATE[dd.rating];
      past += `<div class="pastday"><div class="pd-h" data-a="togglePast" data-k="${key}${d}"><span class="pd-ok">✓</span><b>${WD[d].slice(0, 2)} ${D.short(date)}</b>
        <span class="grow tiny mute ell">${gs.length ? 'Spiel: ' + esc(shortOpp(gs[0].opponent)) : (dd.topics || []).length ? esc((dd.topics || []).map(id => Store.data(id)?.title).filter(Boolean).join(', ')) : 'Training'}</span>
        ${r ? `<span class="ratechip" style="--rc:${r.c}">${dd.rating}/5</span>` : ''}${icon('down', 'chev')}</div>${rateRow(key, d, dd)}</div>`;
      continue;
    }
    const tops = (dd.topics || []).map(id => Store.get(id)).filter(Boolean);
    const exs = (dd.exercises || []).map(id => Store.get(id)).filter(Boolean);
    const aths = (dd.athletics || []).map(id => Store.get(id)).filter(Boolean);
    const games = gamesBetween(date, date);
    const isToday = date === D.today();
    h += `<div class="card day ${isToday ? 'today' : ''}" style="--dc:${ph ? ph.c : 'var(--line)'}"><h3><span class="grow">${WD[d]} ${D.short(date)}${isToday ? ' <span class="todaytag">heute</span>' : ''}</span></h3>
      ${games.map(g => `<div class="gamelink" data-a="open" data-h="#/spiele/${encodeURIComponent(g.id)}">${icon('spiele', 'mini')} Spiel: <b>${esc(g.opponent)}</b>${g.kickoff ? ' · ' + esc(g.kickoff) : ''}${icon('chev', 'chev')}</div>`).join('')}
      ${'' + `
      <div class="sub"><span class="grow">Schwerpunkte</span><button class="link" data-a="pickDay" data-what="topics" data-week="${key}" data-day="${d}">+ wählen</button></div>
      <div>${tops.map(t => `<span class="topicchip">${esc(t.title)}</span>`).join('') || '<span class="tiny mute">Aus dem Periodisierungsplan wählen</span>'}</div>
      <div class="sub"><span class="grow">Ablauf</span></div>${dayPlan(key, d, dd)}`}
      <div class="f" style="margin:10px 0 0"><textarea data-a="dayNote" data-week="${key}" data-day="${d}" placeholder="Notiz zum Training…" style="min-height:52px">${esc(dd.note || '')}</textarea></div>
      ${date <= D.today() ? rateRow(key, d, dd) : ''}${date < D.today() ? `<button class="link" data-a="togglePast" data-k="${key}${d}" style="margin-top:6px">Einklappen</button>` : ''}</div>`;
  }
  if (past) h += sec('Schon vorbei') + `<div class="card pastlist">${past}</div>`;
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
  if (f.tph) ex = ex.filter(e => f.tph === '-' ? !(e.tphases || []).length : (e.tphases || []).includes(f.tph));
  if (f.q) ex = ex.filter(e => (exName(e) + ' ' + (e.expl || '')).toLowerCase().includes(f.q));
  const fit = e => (e.fit || {})[f.n] || 0;
  const sorts = { fit: (a, b) => fit(b) - fit(a) || byName(a, b), name: byName, diff: (a, b) => lv(a.diff) - lv(b.diff), int: (a, b) => lv(b.intensity) - lv(a.intensity), rating: (a, b) => (b.rating || 0) - (a.rating || 0) };
  ex.sort(sorts[f.sort] || sorts.fit);
  if (f.sort === 'fit' && f.onlyFit) ex = ex.filter(e => fit(e) > 0);
  let h = `<input class="search" type="search" placeholder="Übung suchen…" value="${esc(f.q)}" data-a="exQ"><div id="results">
    <div class="filters"><div class="stepper" title="Feldspieler" aria-label="Feldspieler"><button data-a="exN" data-d="-1" aria-label="Weniger Feldspieler">−</button><b>${f.n}</b><button data-a="exN" data-d="1" aria-label="Mehr Feldspieler">+</button></div>
    <select data-a="exSel" data-f="sort"><option value="fit" ${f.sort === 'fit' ? 'selected' : ''}>Passend zuerst</option><option value="name" ${f.sort === 'name' ? 'selected' : ''}>Name</option><option value="diff" ${f.sort === 'diff' ? 'selected' : ''}>Schwierigkeit ↑</option><option value="int" ${f.sort === 'int' ? 'selected' : ''}>Intensität ↓</option><option value="rating" ${f.sort === 'rating' ? 'selected' : ''}>Bewertung</option></select></div>
    <div class="filters"><select data-a="exSel" data-f="diff"><option value="">Schwierigkeit: alle</option>${LVL3.map(x => `<option ${f.diff === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <select data-a="exSel" data-f="int"><option value="">Intensität: alle</option>${LVL3.map(x => `<option ${f.int === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <select data-a="exSel" data-f="ph"><option value="">Schwerpunkt: alle</option>${Object.entries(FOCUS).map(([k, v]) => `<option value="${k}" ${f.ph === k ? 'selected' : ''}>${v.s} · ${v.l}</option>`).join('')}</select>
    <select data-a="exSel" data-f="tph"><option value="">Trainingsphase: alle</option>${TPH.map(t => `<option value="${t.k}" ${f.tph === t.k ? 'selected' : ''}>${t.l}</option>`).join('')}<option value="-" ${f.tph === '-' ? 'selected' : ''}>noch nicht zugeordnet</option></select></div>`;
  h += `<div class="card list">${ex.map(e => { const s = fit(e); return `<div class="li" data-a="exOpen" data-id="${esc(e.id)}"><div class="grow"><div class="t">${esc(exName(e))}</div>
    <div class="badges">${(e.tphases || []).map(k => badge(tphOf(k).l, tphOf(k).c)).join('')}${(e.phases || []).map(focusBadge).join('')}${e.diff ? badge('Schwierigkeit ' + e.diff) : ''}${e.intensity ? badge('Intensität ' + e.intensity) : ''}${e.rating ? badge('★'.repeat(e.rating)) : ''}</div>
    <div class="tiny mute" style="margin-top:4px">${esc(fitRange(e) || 'Spielerzahl nicht hinterlegt')}</div></div><span class="fitb fit${s}">${FITL[s]}</span></div>`; }).join('') || '<div class="empty">Keine Übungen gefunden.</div>'}</div></div>`;
  return h;
}
function exerciseDetail(id) {
  const e = Store.get(id); if (!e) return;
  const rows = [['Erklärung', e.expl], ['Aufbau', e.setup], ['Material', e.material], ['Vorteile', e.pros], ['Nachteile', e.cons], ['Variationen', e.variations], ['Vorteile der Variation', e.varPros], ['Nachteile der Variation', e.varCons]].filter(x => x[1]);
  let fitg = ''; for (let n = 1; n <= 21; n++) { const s = (e.fit || {})[n] || 0; fitg += `<span class="fitb fit${s}" style="text-align:center">${n}</span>`; }
  const plannedIn = Store.all('week').filter(w => Object.values(w.days || {}).some(d => (d.exercises || []).includes(id))).length;
  void plannedIn;
  Sheet.open(exName(e), `<div class="badges" style="margin-top:0">${e.diff ? badge('Schwierigkeit ' + e.diff) : ''}${e.intensity ? badge('Intensität ' + e.intensity) : ''}${(e.tphases || []).map(k => badge(tphOf(k).l, tphOf(k).c)).join('')}${(e.phases || []).filter(k => FOCUS[k]).map(k => badge(FOCUS[k].s + ' · ' + FOCUS[k].l, FOCUS[k].c)).join('')}${e.rating ? badge('★'.repeat(e.rating)) : ''}</div>
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
      { k: 'tphases', l: 'Trainingsphase (wo wird die Übung eingesetzt?)', t: 'chips', opts: TPH.map(t => [t.k, t.l]) },
      { k: 'phases', l: 'Schwerpunkt (was trainiert die Übung?)', t: 'chips', opts: Object.entries(FOCUS).map(([k, v]) => [k, v.s + ' · ' + v.l]) },
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
    title: isNew ? 'Neues Thema' : 'Thema', value: { cat: UI.lexArea === 'indiv' ? 'Individualtaktik & Technik' : 'Gruppentaktik', phases: UI.topics.ph ? [UI.topics.ph] : [], ...t },
    fields: [{ k: 'title', l: 'Thema', auto: isNew }, { k: 'cat', l: 'Kategorie', t: 'select', opts: TOPICCATS.map(c => [c, (TEAMCATS.includes(c) ? 'Mannschaftstaktik · ' : 'Individualtaktik & -technik · ') + c]) },
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
    const ph = w.phase || dd.phase, rank = t => (t.phases || []).includes(ph) ? 0 : (t.phases || []).includes('ALL') ? 1 : 2;
    opts = Store.all('topic').sort((a, b) => rank(a) - rank(b) || TOPICCATS.indexOf(a.cat) - TOPICCATS.indexOf(b.cat) || byOrder(a, b))
      .map(t => ({ v: t.id, l: t.title, g: rank(t) === 0 ? `${GP[ph].l} · ${t.cat}` : rank(t) === 1 ? 'Für alle Phasen' : `Andere Phasen · ${t.cat}`, s: (t.phases || []).filter(x => x !== 'ALL').map(gpS).join(', ') }));
  } else if (what === 'exercises') {
    title = 'Übungen'; const n = UI.ex.n || setting().exPlayers || 16, ph = w.phase || dd.phase;
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
const clubStatus = c => c.status || (c.done ? 'fix' : (c.requested || c.callback) ? 'pending' : 'none');
const TSTATUS = [
  { k: 'none', l: 'Nicht angefragt', s: 'offen', d: 'Kandidaten für die nächste Anfrage', c: '#5b4a8f' },
  { k: 'pending', l: 'Keine Rückmeldung', s: 'wartet', d: 'Angefragt – Antwort steht noch aus', c: '#d97706' },
  { k: 'fix', l: 'Fix', s: 'fix', d: 'Testspiel steht', c: '#15803d' }];
const LVC = { NLZ: '#312e81', Regio: '#7c3aed', VL: '#0e7490', BZL: '#15803d', SDL: '#a16207', '': '#94a3b8' };
const lvlRank = k => { const i = LEVELS.findIndex(l => l.k === (k || '')); return i < 0 ? 99 : i; };
function viewTests(parts = []) {
  const sub = parts[0] === 'pool' ? 'pool' : 'termine', nq = slots().filter(x => x.date >= D.today()).length;
  const seg = `<div class="seg">${[['termine', `Offene Termine${nq ? ` (${nq})` : ''}`], ['pool', 'Gegnerpool']].map(([v, l]) => `<button class="${sub === v ? 'on' : ''}" data-a="open" data-h="#/tests/${v}">${l}</button>`).join('')}</div>`;
  if (sub === 'termine') return { title: 'Testspielplanung', html: seg + termineView(), fab: 'newSlot' };
  const r = poolView(); r.html = seg + r.html; return r;
}
function slotCands(q) {
  const want = q.levels || [];
  return Store.all('club').filter(c => clubStatus(c) !== 'fix' && (!want.length || want.includes(c.level || '')))
    .sort((a, b) => (clubStatus(a) === 'pending' ? 0 : 1) - (clubStatus(b) === 'pending' ? 0 : 1) || lvlRank(a.level) - lvlRank(b.level) || byName(a, b));
}
function slotCard(q) {
  const p = phaseAt(q.date), n = D.diff(D.today(), q.date);
  return `<div class="card qslot ${q.wip ? 'wip' : ''}"><div class="sl-h"><button class="sl-q" data-a="slotWip" data-id="${esc(q.id)}" aria-label="${q.wip ? 'In Bearbeitung – antippen zum Zurücksetzen' : 'Als in Bearbeitung markieren'}">???</button>
      <div class="grow"><div class="sl-d">${D.long(q.date)}${q.kickoff ? ' · ' + esc(q.kickoff) + ' Uhr' : ''}</div>
      <div class="tiny mute">${relDay(q.date)}${p ? ' · ' + esc(phaseName(p)) : ''}${q.ha ? ' · ' + (q.ha === 'H' ? 'Heim' : 'Auswärts') : ''}</div></div>
      <span class="sl-days ${n <= 21 && !q.wip ? 'soon' : ''}">${n} T.</span><button class="iconbtn" data-a="editSlot" data-id="${esc(q.id)}" aria-label="Bearbeiten">${icon('edit')}</button></div>
    <div class="sl-body">${q.note ? `<div class="small" style="margin:8px 0 0">${esc(q.note)}</div>` : ''}
    <button class="btn primary sm" style="margin-top:10px" data-a="slotFound" data-id="${esc(q.id)}">Gegner gefunden → als Spiel eintragen</button>
    ${q.wip ? `<div class="sl-wip" data-a="slotWip" data-id="${esc(q.id)}"><b>In Bearbeitung</b><small>antippen, um es wieder zu öffnen</small></div>` : ''}</div></div>`;
}
function termineView() {
  const t = D.today(), all = slots(), up = all.filter(x => x.date >= t).sort((a, b) => (a.wip ? 1 : 0) - (b.wip ? 1 : 0) || byDate(a, b)), past = all.filter(x => x.date < t);
  let h = up.length ? `<div class="tiny mute" style="margin:0 4px 10px">Tipp: <b>???</b> antippen = in Bearbeitung (rutscht nach unten).</div>` + up.map(slotCard).join('')
    : `<div class="cleanbox"><div class="cb-i">✓</div><b>Alle Termine vergeben.</b><span>Kein ??? mehr – hier ist alles clean.</span></div>`;
  if (past.length) h += sec('Vorbei, ohne Gegner') + `<div class="card list">${past.map(x => `<div class="li" data-a="editSlot" data-id="${esc(x.id)}"><div class="grow"><div class="t">${D.long(x.date)}</div><div class="s">${esc(x.note || 'kein Spiel eingetragen')}</div></div>${icon('edit', 'chev')}</div>`).join('')}</div>`;
  return h;
}
function slotForm(q = {}, isNew) {
  openForm({
    title: isNew ? 'Offener Termin' : 'Termin bearbeiten', value: { ha: '', levels: [], ...q },
    fields: [{ k: 'date', l: 'Datum', t: 'date' }, { k: 'kickoff', l: 'Uhrzeit (optional)', t: 'time' },
      { k: 'ha', l: 'Heim / Auswärts', t: 'seg', opts: [['', 'egal'], ['H', 'Heim'], ['A', 'Auswärts']] },
      { k: 'levels', l: 'Gesuchtes Niveau', t: 'chips', opts: LEVELS.filter(l => l.k).map(l => [l.k, l.k]) },
      { k: 'note', l: 'Notiz', t: 'textarea', ph: 'z. B. starker Gegner, ab 13 Uhr' }],
    onSave: async v => { if (!v.date) return toast('Bitte ein Datum wählen'); Store.put(q.id || 'slot:' + v.date + ':' + uid('s').slice(-4), 'slot', { ...(q.id ? Store.data(q.id) : {}), ...v }); await Sheet.close(); render(); },
    onDelete: isNew ? null : async () => { if (!confirmDel('Termin')) return; Store.remove(q.id); await Sheet.close(); render(); },
  });
}
function poolView() {
  const f = UI.tests; if (!(f.lvls instanceof Set)) f.lvls = new Set();
  if (!['', 'none', 'pending', 'fix'].includes(f.st)) f.st = '';
  let cl = Store.all('club');
  if (f.q) cl = cl.filter(c => (c.name + ' ' + c.stadt + ' ' + c.kreis + ' ' + c.trainer).toLowerCase().includes(f.q));
  if (f.lvls.size) cl = cl.filter(c => f.lvls.has(c.level || ''));
  cl.sort((a, b) => lvlRank(a.level) - lvlRank(b.level) || byName(a, b));
  const tg = Store.all('game').filter(g => g.type === 'Test' && !g.cancelled && g.date >= D.today()).sort(byDate);
  let h = `<div class="linkrow" data-a="gTest">${icon('spiele', 'mini')}<span class="grow">Testspiele im Spielplan${tg.length ? ` · nächstes: <b>${esc(shortOpp(tg[0].opponent))}</b> ${D.short(tg[0].date)}` : ' · keins geplant'}</span>${icon('chev', 'chev')}</div>
    <input class="search" type="search" placeholder="Verein, Stadt, Kreis suchen…" value="${esc(f.q)}" data-a="tQ"><div id="results">`;
  h += `<div class="chips wrapchips"><button class="chip blank ${f.lvls.size ? '' : 'on'}" data-a="tLvl" data-v="*" aria-label="Alle Niveaus" title="Alle Niveaus"></button>${LEVELS.filter(l => l.k).map(l => `<button class="chip ${f.lvls.has(l.k) ? 'on' : ''}" data-a="tLvl" data-v="${l.k}">${esc(l.k)}</button>`).join('')}</div>`;
  h += `<div class="chips wrapchips"><button class="chip blank ${f.st ? '' : 'on'}" data-a="tSt" data-v="" aria-label="Jeder Status" title="Jeder Status"></button>${TSTATUS.map(s => `<button class="chip ${f.st === s.k ? 'on' : ''}" data-a="tSt" data-v="${s.k}">${esc(s.l)}</button>`).join('')}</div>`;
  for (const S of TSTATUS) {
    if (f.st && f.st !== S.k) continue;
    const list = cl.filter(c => clubStatus(c) === S.k); if (!list.length) continue;
    h += `<div class="sec"><span class="dot" style="background:${S.c}"></span><span class="grow">${esc(S.l)} · ${list.length}</span></div><div class="tiny mute" style="margin:-4px 4px 6px">${esc(S.d)}</div>
      <div class="ctiles">${list.map(clubTile).join('')}</div>`;
  }
  if (!cl.length) h += '<div class="empty">Keine Vereine für diese Auswahl.</div>';
  h += '</div>';
  return { title: 'Testspielplanung', html: h, fab: 'newClub' };
}
function clubTile(c) {
  const n = contactsFor(c.name).length, L = LEVELS.find(l => l.k === (c.level || '')), st = clubStatus(c);
  const g = Store.all('game').filter(x => !x.cancelled && x.date >= D.today() && sameClub(x.opponent, c.name)).sort(byDate)[0];
  return `<div class="ctile" data-a="openClub" data-id="${esc(c.id)}" style="--lc:${LVC[c.level || '']}">
    <div class="row" style="gap:6px"><span class="lvb">${esc(c.level || '–')}</span>${n ? `<span class="tiny mute">${icon('phone', 'mini')}${n}</span>` : ''}${c.result ? `<span class="tiny" style="margin-left:auto;font-weight:700">${esc(c.result)}</span>` : ''}</div>
    <div class="cn">${esc(c.name)}</div><div class="cp">${g ? `<b class="cgame">${icon('spiele', 'mini')}${D.short(g.date)}</b> ` : ''}${esc(c.stadt || c.kreis || L?.l || '')}</div>
    <div class="cflags">${TSTATUS.map(S => `<button class="flagbtn st-${S.k} ${st === S.k ? 'on' : ''}" style="--sc:${S.c}" data-a="clubSt" data-id="${esc(c.id)}" data-v="${S.k}">${esc(S.s)}</button>`).join('')}</div></div>`;
}
// Vollständigkeit eines Vereins
function clubMissing(c) {
  const m = [], cs = contactsFor(c.name);
  if (!c.level) m.push('Niveau'); if (!cs.some(x => x.phone)) m.push('Nummer'); if (!c.trainer && !cs.length) m.push('Trainer');
  if (!c.bundesland) m.push('Bundesland'); if (!c.verband) m.push('Verband'); if (!c.kreis) m.push('Kreis'); if (!c.stadt) m.push('Stadt');
  return m;
}
function viewVereine() {
  const f = UI.vereine || (UI.vereine = { q: '', inc: false });
  let cl = Store.all('club').sort(byName);
  const incAll = cl.filter(c => clubMissing(c).length).length;
  if (f.q) cl = cl.filter(c => (c.name + ' ' + c.stadt + ' ' + c.kreis).toLowerCase().includes(f.q));
  if (f.inc) cl = cl.filter(c => clubMissing(c).length);
  let h = `<input class="search" type="search" placeholder="Verein suchen…" value="${esc(f.q)}" data-a="vQ"><div id="results">
    <div class="chips"><button class="chip ${f.inc ? '' : 'on'}" data-a="vInc" data-v="0">Alle (${Store.all('club').length})</button><button class="chip ${f.inc ? 'on' : ''}" data-a="vInc" data-v="1">Unvollständig (${incAll})</button></div>`;
  let letter = null, open = false;
  for (const c of cl) {
    let nm = c.name || '?'; for (let k = 0; k < 3; k++) nm = nm.replace(/^(1\.|FC|SC|SV|TuS|VfL|VfB|SG|TSV|JSG|JFS|SSV|SpVgg\.?|Spfr|CfB|SuS|DSC|FV|JFV|TSC|SpVg)\s+/i, '');
    const L = nm[0].toUpperCase();
    if (L !== letter) { if (open) h += '</div>'; h += sec(L) + '<div class="card list">'; letter = L; open = true; }
    const miss = clubMissing(c);
    h += `<div class="li" data-a="openClub" data-id="${esc(c.id)}"><span class="lvb" style="--lc:${LVC[c.level || '']};background:${LVC[c.level || '']}">${esc(c.level || '–')}</span>
      <div class="grow"><div class="t ell">${esc(c.name)}</div><div class="s ell">${esc([c.stadt, c.kreis, c.verband].filter(Boolean).join(' · ') || '–')}</div>
      ${miss.length ? `<div class="missing">fehlt: ${esc(miss.join(', '))}</div>` : ''}</div>${miss.length ? `<span class="nbadge static" title="${miss.length} Angaben fehlen">${miss.length}</span>` : `<span class="okmark">✓</span>`}</div>`;
  }
  if (open) h += '</div>';
  if (!cl.length) h += '<div class="empty">Keine Vereine gefunden.</div>';
  return { title: 'Vereine', back: true, html: h + '</div>', fab: 'newClub' };
}
// Rückgängig: merkt sich die letzten Änderungen gruppiert pro Aktion
const Undo = {
  stack: [], cur: null, off: 0,
  record(id, prev) {
    if (this.off) return;
    if (!this.cur) { this.cur = new Map(); this.stack.push(this.cur); if (this.stack.length > 40) this.stack.shift(); setTimeout(() => { this.cur = null; this.btn(); }, 0); }
    if (!this.cur.has(id)) this.cur.set(id, prev ? JSON.parse(JSON.stringify(prev)) : null);
  },
  async undo() {
    const g = this.stack.pop(); this.btn();
    if (!g) return toast('Nichts zum Rückgängigmachen');
    this.off++;
    for (const [id, prev] of g) { if (prev) Store.put(id, prev.kind, prev.data); else Store.remove(id); }
    this.off--;
    if (!$('#sheet').hidden) await Sheet.close();
    toast(g.size > 1 ? `Rückgängig: ${g.size} Änderungen` : 'Rückgängig gemacht'); render(); this.btn();
  },
  btn() { const b = $('#undo'); if (b) b.disabled = !this.stack.length; },
};
function clubDetail(id) {
  const c = Store.get(id); if (!c) return;
  const contacts = contactsFor(c.name), games = Store.all('game').filter(g => sameClub(g.opponent, c.name) || normC(g.opponent) === normC(c.name)).sort(byDate);
  const miss = clubMissing(c);
  const rows = [['Status', TSTATUS.find(x => x.k === clubStatus(c))?.l], ['Fehlt noch', miss.join(', ')], ['Niveau', LEVELS.find(l => l.k === c.level)?.l], ['Jahrgang', c.jahrgang], ['Stadt', c.stadt], ['Kreis', c.kreis], ['Verband', c.verband], ['Bundesland', c.bundesland], ['Trainer', c.trainer], ['Ergebnis / Termin', c.result], ['Notiz', c.note]].filter(x => x[1]);
  Sheet.open(c.name, `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="sub" style="margin-top:14px">Kontakte</div>${contacts.length ? `<div class="card list" style="margin:0">${contacts.map(contactRow).join('')}</div>` : '<div class="tiny mute">Kein Kontakt zu diesem Verein gespeichert.</div>'}
    <div class="sub" style="margin-top:14px">Spiele gegen diesen Verein</div>${games.length ? `<div class="card list" style="margin:0">${games.map(gameLine).join('')}</div>` : '<div class="tiny mute">Noch keins eingetragen.</div>'}`,
    `<button class="btn" data-a="editClub" data-id="${esc(id)}">${icon('edit')} Bearbeiten</button><button class="btn primary" data-a="clubToGame" data-id="${esc(id)}">Als Spiel eintragen</button>`);
}
function clubForm(c = {}, isNew) {
  openForm({
    title: isNew ? 'Neuer Verein' : 'Verein bearbeiten', value: { jahrgang: '2013', ...c, status: clubStatus(c) },
    fields: [{ k: 'name', l: 'Verein', auto: isNew }, { k: 'level', l: 'Niveau', t: 'seg', opts: LEVELS.map(l => [l.k, l.l]) },
      [{ k: 'stadt', l: 'Stadt' }, { k: 'kreis', l: 'Kreis' }], [{ k: 'verband', l: 'Verband' }, { k: 'bundesland', l: 'Bundesland' }],
      [{ k: 'jahrgang', l: 'Jahrgang (Team)' }, { k: 'result', l: 'Ergebnis / Termin' }], { k: 'trainer', l: 'Trainer' },
      { k: 'status', l: 'Status', t: 'seg', opts: TSTATUS.map(x => [x.k, x.l]) },
      { k: 'note', l: 'Notiz', t: 'textarea' }],
    onSave: async v => { if (!v.name) return toast('Bitte einen Namen eingeben'); Object.assign(v, { done: v.status === 'fix', requested: v.status !== 'none', callback: false }); Store.put(c.id || uid('club'), 'club', { ...(c.id ? Store.data(c.id) : {}), ...v }); await Sheet.close(); render(); },
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

// ───────────────────────── Ziele (Kompass) ─────────────────────────
const ZAREAS = [
  { k: 'training', l: 'Training', d: 'Was wir im Training erreichen wollen' },
  { k: 'spiel', l: 'Spiel', d: 'Was man am Wochenende sehen soll' },
  { k: 'platz', l: 'Neben dem Platz', s: 'Umfeld', d: 'Team, Kultur, Rituale, Eltern' },
  { k: 'entw', l: 'Entwicklung', d: 'Spieler und Trainer werden besser' },
  { k: 'ideen', l: 'Ideen', d: 'Multisport & Teamevents' }];
const ZPULSE = {
  more: { l: 'Mehr davon', s: 'läuft – weiter reingehen', c: '#16a34a' },
  ok: { l: 'Passt', s: 'auf Kurs', c: '#7c74a8' },
  new: { l: 'Neuer Impuls', s: 'braucht frische Ideen', c: '#d97706' }};
const IDEA_SUBS = ['Multisportiv', 'Teamevent'];
const goals = area => Store.all('goal').filter(g => !area || g.area === area).sort((a, b) => (a.ord ?? 99) - (b.ord ?? 99) || byName(a, b));
const goalTasks = g => { const kw = (g.kw || []).map(x => x.toLowerCase()).filter(Boolean); if (!kw.length) return []; const m = new Map(); for (const t of Store.all('ptask')) { const ti = (t.title || '').trim(); if (!kw.some(k => ti.toLowerCase().includes(k))) continue; const o = m.get(ti); m.set(ti, { title: ti, done: o ? o.done && !!t.done : !!t.done }); } return [...m.values()].slice(0, 5); };
const lastReview = () => Store.data('setting:zreview')?.date || '';
function goalCard(g) {
  const pu = ZPULSE[g.pulse], tk = goalTasks(g);
  return `<div class="card goal" style="--gc:${pu ? pu.c : 'var(--line)'}" data-a="editGoal" data-id="${esc(g.id)}">
    <div class="gl-h"><b class="grow">${esc(g.title)}</b>${pu ? `<span class="gl-p" style="--gc:${pu.c}">${esc(pu.l)}</span>` : ''}</div>
    ${g.text ? `<div class="gl-t">${esc(g.text)}</div>` : ''}
    ${g.impulse ? `<div class="gl-i">${icon('right')}<span>${esc(g.impulse)}</span></div>` : ''}
    ${tk.length ? `<div class="gl-k">${tk.map(t => `<span class="${t.done ? 'done' : ''}">${t.done ? '✓' : '○'} ${esc(t.title)}</span>`).join('')}</div>` : ''}
    ${g.href ? `<button class="link sm" data-a="open" data-h="${esc(g.href)}">${esc(g.hrefL || 'öffnen')} ›</button>` : ''}</div>`;
}
function viewZiele(parts) {
  const area = ZAREAS.some(a => a.k === parts[1]) ? parts[1] : (UI.ziele || 'training'); UI.ziele = area;
  const A0 = ZAREAS.find(a => a.k === area), all = Store.all('goal').filter(g => g.area !== 'ideen');
  let h = `<div class="seg sub3">${ZAREAS.map(a => `<button class="${area === a.k ? 'on' : ''}" data-a="open" data-h="#/mehr/ziele/${a.k}">${esc(a.s || a.l)}</button>`).join('')}</div>`;
  const lr = lastReview(), cnt = k => all.filter(g => g.pulse === k).length;
  h += `<div class="card kompass"><div class="km-h"><div class="grow"><b>Kompass</b><small>${lr ? `zuletzt durchgegangen ${relDay(lr)}` : 'noch nie durchgegangen'}</small></div>
      <button class="btn primary sm" data-a="zReview">Durchgehen</button></div>
    <div class="km-p">${Object.entries(ZPULSE).map(([k, p]) => `<span style="--gc:${p.c}"><b>${cnt(k)}</b>${esc(p.l)}</span>`).join('')}<span style="--gc:var(--mute)"><b>${all.filter(g => !ZPULSE[g.pulse]).length}</b>offen</span></div></div>`;
  h += `<div class="tiny mute" style="margin:2px 4px 10px">${esc(A0.d)}</div>`;
  if (area === 'ideen') {
    for (const sub of IDEA_SUBS) {
      const list = goals('ideen').filter(g => (g.sub || 'Multisportiv') === sub), open = list.filter(g => !g.done), done = list.filter(g => g.done);
      h += sec(`${sub} · ${open.length} offen`) + `<div class="card list">${[...open, ...done].map(g => `<div class="idea ${g.done ? 'done' : ''}">
        <label class="ib"><input type="checkbox" ${g.done ? 'checked' : ''} data-a="ideaDone" data-id="${esc(g.id)}"><span class="box"></span></label>
        <div class="grow" data-a="editGoal" data-id="${esc(g.id)}"><div class="t">${esc(g.title)}</div>${g.text || g.doneAt ? `<div class="s">${g.done && g.doneAt ? 'gemacht ' + esc(D.short(g.doneAt)) + (g.text ? ' · ' : '') : ''}${esc(g.text || '')}</div>` : ''}</div></div>`).join('') || '<div class="empty">Noch keine Ideen.</div>'}</div>`;
    }
    return { title: 'Ziele', back: true, html: h, fab: 'newGoal' };
  }
  const list = goals(area), subs = [...new Set(list.map(g => g.sub || ''))];
  for (const sub of subs) { if (sub) h += sec(sub); h += list.filter(g => (g.sub || '') === sub).map(goalCard).join(''); }
  if (!list.length) h += '<div class="empty">Noch keine Ziele. Mit + anlegen.</div>';
  return { title: 'Ziele', back: true, html: h, fab: 'newGoal' };
}
function goalForm(g = {}, isNew) {
  const idea = (g.area || UI.ziele) === 'ideen';
  openForm({
    title: isNew ? (idea ? 'Neue Idee' : 'Neues Ziel') : (idea ? 'Idee' : 'Ziel'), value: { area: UI.ziele || 'training', ...g, kw: (g.kw || []).join(', ') },
    fields: idea ? [
      { k: 'title', l: 'Idee', t: 'text', ph: 'z. B. Bouldern' },
      { k: 'sub', l: 'Art', t: 'seg', opts: IDEA_SUBS.map(x => [x, x]) },
      { k: 'text', l: 'Notiz', t: 'textarea', ph: 'Wo, wer organisiert, Kosten …' },
      { k: 'done', l: 'Schon gemacht', t: 'toggle' }] : [
      { k: 'title', l: 'Ziel', t: 'text' },
      { k: 'area', l: 'Bereich', t: 'select', opts: ZAREAS.filter(a => a.k !== 'ideen').map(a => [a.k, a.l]) },
      { k: 'sub', l: 'Gruppe (optional)', t: 'text', ph: 'z. B. Spieler · Gesundheit' },
      { k: 'text', l: 'Worum geht es?', t: 'textarea' },
      { k: 'pulse', l: 'Wie läuft es?', t: 'seg', opts: [...Object.entries(ZPULSE).map(([k, p]) => [k, p.l]), ['', 'offen']] },
      { k: 'impulse', l: 'Nächster Impuls', t: 'textarea', ph: 'Was probieren wir als Nächstes?' },
      { k: 'kw', l: 'Aufgaben verknüpfen (Stichworte)', t: 'text', ph: 'z. B. Blutbild, Ernährung', hint: 'Saisonaufgaben mit diesen Wörtern erscheinen beim Ziel.' }],
    onSave: async v => {
      if (!v.title) return toast('Bitte einen Titel eingeben');
      const prev = g.id ? Store.data(g.id) : {}, d = { ...prev, ...v, kw: String(v.kw || '').split(',').map(x => x.trim()).filter(Boolean) };
      if (idea) { d.area = 'ideen'; if (d.done && !prev.done) d.doneAt = D.today(); if (!d.done) d.doneAt = ''; }
      Store.put(g.id || uid('goal'), 'goal', d); await Sheet.close(); render();
    },
    onDelete: isNew ? null : async () => { if (!confirmDel(idea ? 'Idee' : 'Ziel')) return; Store.remove(g.id); await Sheet.close(); render(); },
  });
}
// Durchgehen: ein Ziel nach dem anderen bewerten
function zReviewStep() {
  const R = UI.zrev, g = R && Store.get(R.ids[R.i]);
  if (!g) { Store.put('setting:zreview', 'setting', { date: D.today() }); UI.zrev = null; Sheet.close().then(() => { toast('Durchgang fertig ✓'); render(); }); return; }
  const ar = ZAREAS.find(a => a.k === g.area), tk = goalTasks(g);
  Sheet.open('Ziele durchgehen', `<div class="zr">
    <div class="zr-p"><span>${R.i + 1} / ${R.ids.length}</span><span class="grow"><i style="width:${Math.round((R.i + 1) / R.ids.length * 100)}%"></i></span></div>
    <div class="tiny mute" style="text-transform:uppercase;font-weight:800;letter-spacing:.4px">${esc(ar ? ar.l : '')}${g.sub ? ' · ' + esc(g.sub) : ''}</div>
    <h3>${esc(g.title)}</h3>${g.text ? `<p>${esc(g.text)}</p>` : ''}
    ${tk.length ? `<div class="gl-k">${tk.map(t => `<span class="${t.done ? 'done' : ''}">${t.done ? '✓' : '○'} ${esc(t.title)}</span>`).join('')}</div>` : ''}
    <div class="zr-b">${Object.entries(ZPULSE).map(([k, p]) => `<button class="${g.pulse === k ? 'on' : ''}" style="--gc:${p.c}" data-a="zRate" data-v="${k}"><b>${esc(p.l)}</b><small>${esc(p.s)}</small></button>`).join('')}</div>
    <div class="f"><label for="zr-imp">Nächster Impuls (optional)</label><textarea id="zr-imp" placeholder="Was probieren wir als Nächstes?">${esc(g.impulse || '')}</textarea></div>
    </div>`, `<button class="btn" data-a="zRate" data-v="skip">Überspringen</button>`);
}
const ZIELE_SEED = [
  ['training', '', 'Spielprinzipien einstudieren', 'Die Prinzipien aus der Spielidee sind das, was wir im Training einüben: jede Woche ein Schwerpunkt, Übungen danach auswählen.', ['spielidee'], '#/training/lexikon/team', 'Lexikon Mannschaftstaktik'],
  ['training', '', 'Spaß haben', 'Die Jungs kommen gerne – Wettbewerb, Lachen, Erfolgserlebnisse. Wenn die Stimmung kippt: Spielform statt Übung.', ['spaß']],
  ['training', '', 'Hohe Intensität', 'Viele Ballkontakte, viele Zweikämpfe, wenig Warten. Spielformen mit Zählen und Gewinnern.'],
  ['training', '', 'Abwechslung & Multisport', 'Nicht immer das Gleiche: ab und zu andere Sportarten für Koordination, Athletik und Motivation.', ['multisport'], '#/mehr/ziele/ideen', 'Ideenliste'],
  ['training', '', 'Athletik als fester Baustein', 'Laufschule, Stabilität, Schnelligkeit – kurz, regelmäßig, altersgerecht.', ['athletik'], '#/training/lexikon/athletik', 'Lexikon Athletik'],
  ['spiel', '', 'Mutig & offensiv denken', 'Kreativität über Sicherheit in der Kreativzone, Effizienz über Schönheit in der Angriffszone.'],
  ['spiel', '', 'Aus dem Druck heraus spielen', 'Offene Stellung, Pass in den offenen Fuß, jeder Ball bekommt ein Kommando, kein 1 gegen 1 im eigenen Drittel.'],
  ['spiel', '', 'Sofort umschalten', '6-Sekunden-Regel nach Ballverlust, auf direktem Weg hinter den Ball. Nach Ballgewinn schnell in die Tiefe.'],
  ['spiel', '', 'Kompakt gegen den Ball', 'Mittelfeldpressing als Grundordnung, Angriffspressing als Waffe.'],
  ['spiel', '', 'Standards als Waffe', 'Ecken, Freistöße, Einwürfe einstudiert – einfache Abläufe, die jeder kennt.'],
  ['spiel', '', 'Gut vorbereitet in jedes Spiel', 'Treffpunkt, Kader, Formation, Prematch-Routine – damit die Jungs sich nur aufs Spiel konzentrieren.', ['spielvorbereitung']],
  ['platz', '', 'Rituale', 'Gemeinsame Abläufe geben Halt: Stutzen gemeinsam in der Kabine, Kreis vor dem Spiel, Abklatschen danach.', ['ritual']],
  ['platz', '', 'Regeln & Verantwortung', 'Regelkatalog, Kapitän und Mannschaftsrat – die Jungs übernehmen selbst Verantwortung.', ['regel', 'kapitän', 'mannschaftsrat']],
  ['platz', '', 'Teamgeist durch Events', 'Regelmäßig etwas zusammen erleben – nicht nur Fußball.', ['teamevent', 'teambuilding'], '#/mehr/ziele/ideen', 'Ideenliste'],
  ['platz', '', 'Eltern mitnehmen', 'Elternabend, Elterngespräche, klare Infos – Eltern als Unterstützer, nicht als Zuschauer am Rand.', ['eltern']],
  ['platz', '', 'Spielergespräche', 'Jeder Spieler weiß, wo er steht und woran er arbeitet.', ['spielergespräch']],
  ['entw', 'Spieler', 'Laufstil verbessern', 'Lauf-ABC, Armeinsatz, Fußaufsatz – sauber laufen ist schneller laufen.', ['lauf']],
  ['entw', 'Spieler', 'Kräftiger werden', 'Rumpf und Stabilität zuerst, mit Körpergewicht – Grundlage für Zweikämpfe und Verletzungsschutz.', ['kraft']],
  ['entw', 'Spieler', 'Ausdauer & Schnelligkeit', 'Spielnahe Intervalle, Antritt, Richtungswechsel.'],
  ['entw', 'Spieler', 'Technisch besser', 'Ballgefühl, beidfüßig, erster Kontakt – viele Wiederholungen mit Ball.'],
  ['entw', 'Spieler', 'Mental stärker', 'Mut, Umgang mit Fehlern, Selbstvertrauen, Konzentration über 70 Minuten.', ['mental']],
  ['entw', 'Spieler', 'Gesundheit, Ernährung & Schlaf', 'Die Gesundheit jedes Spielers ist wichtig: Blutbild, bessere Ernährung, genug Schlaf.', ['blutbild', 'ernährung', 'schlaf']],
  ['entw', 'Trainer', 'Spielidee überprüfen & schärfen', 'Regelmäßig reflektieren: Passt die Spielidee noch zur Mannschaft? Saisonfazit ziehen.', ['spielidee', 'reflexion', 'fazit']],
  ['entw', 'Trainer', 'Neue Impulse holen', 'Hospitieren (z. B. im NLZ), Fortbildungen, Bücher, Podcasts, Austausch mit anderen Trainern.', ['fortbildung']],
  ['entw', 'Trainer', 'Trainerteam stärken', 'Aufgaben im Trainerteam klar verteilen, Feedback untereinander.', ['trainerteam']]];
const IDEEN_SEED = [
  ['Multisportiv', 'Bouldern / Klettern'], ['Multisportiv', 'Basketball'], ['Multisportiv', 'Handball'], ['Multisportiv', 'Hockey'], ['Multisportiv', 'Rugby / Tag-Rugby'],
  ['Multisportiv', 'Ringen & Raufen (Zweikampf)'], ['Multisportiv', 'Leichtathletik: Sprint & Sprung'], ['Multisportiv', 'Schwimmen / Wassertraining'], ['Multisportiv', 'Tanz / Rhythmus-Koordination'],
  ['Multisportiv', 'Yoga / Mobility'], ['Multisportiv', 'Badminton / Tischtennis (Reaktion)'], ['Multisportiv', 'Frisbee / Ultimate'], ['Multisportiv', 'Trampolinhalle'],
  ['Teamevent', 'Stadionbesuch'], ['Teamevent', 'Grillen mit Eltern'], ['Teamevent', 'Weihnachtsfeier'], ['Teamevent', 'Kinoabend'], ['Teamevent', 'Kanu- oder Fahrradtour'],
  ['Teamevent', 'Escape Room / Lasertag'], ['Teamevent', 'Kochabend: Ernährung für Fußballer'], ['Teamevent', 'Übernachtung im Vereinsheim'], ['Teamevent', 'Elternteam vs. Mannschaft'],
  ['Teamevent', 'Training bei den Kleinen helfen'], ['Teamevent', 'Schiri-Workshop'], ['Teamevent', 'NLZ-Training anschauen'], ['Teamevent', 'Saisonabschluss']];
function seedZiele() {
  if (Store.data('setting:migr15')) return;
  ZIELE_SEED.forEach(([area, sub, title, text, kw, href, hrefL], i) => Store.put('goal:s' + String(i + 1).padStart(2, '0'), 'goal', { area, sub, title, text, kw: kw || [], href: href || '', hrefL: hrefL || '', pulse: '', impulse: '', ord: i }, true));
  IDEEN_SEED.forEach(([sub, title], i) => Store.put('goal:i' + String(i + 1).padStart(2, '0'), 'goal', { area: 'ideen', sub, title, text: '', done: false, ord: i }, true));
  Store.put('setting:migr15', 'setting', { done: D.today() }, true);
}

// ───────────────────────── Mehr: Material, Scouting, Einstellungen ─────────────────────────
function viewMehr(parts) {
  const sub = parts[0];
  if (sub === 'kontakte') return viewKontakte();
  if (sub === 'vereine') return viewVereine();
  if (sub === 'ziele') return viewZiele(parts);
  if (sub === 'material') return viewMaterial();
  if (sub === 'scouting') return viewScouting();
  if (sub === 'einstellungen') return viewSettings();
  const n = k => Store.all(k).length;
  const need = Store.all('material').filter(m => m.list !== 'have' && !m.done).length;
  const item = (h, ic, t, s) => `<div class="li" data-a="open" data-h="${h}"><span class="actions"><a>${icon(ic)}</a></span><div class="grow"><div class="t">${t}</div><div class="s">${s}</div></div>${icon('chev', 'chev')}</div>`;
  const gz = Store.all('goal').filter(g => g.area !== 'ideen'), lr = lastReview();
  const html = `<div class="card list">
    ${item('#/mehr/ziele', 'star', 'Ziele', `${cap(gz.length, 'Ziel', 'Ziele')} · ${gz.filter(g => g.pulse === 'new').length} brauchen neue Impulse${lr ? ' · durchgegangen ' + relDay(lr) : ''}`)}
    ${item('#/mehr/kontakte', 'phone', 'Kontakte', cap(n('contact'), 'Kontakt', 'Kontakte'))}
    ${item('#/mehr/vereine', 'tests', 'Vereine', `${cap(n('club'), 'Verein', 'Vereine')} · ${Store.all('club').filter(c => clubMissing(c).length).length} unvollständig`)}
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
  h += sec('Spieltag-Checkliste', '<button class="link" data-a="newCheck">+ Punkt</button>') + `<div class="card"><div class="clgrid">${Store.all('checkitem').sort(byOrder).map(c => `<div class="cli" data-a="editCheck" data-id="${c.id}"><span class="t">${esc(c.title)}</span>${c.group ? `<small>${esc(c.group)}</small>` : ''}</div>`).join('')}</div></div>`;
  const cur = phaseAt(D.today());
  h += sec('Checklisten der Zyklen', '<span class="tiny">alle Aufgaben je Phase</span>') + phases().map(p => {
    const meso = tasksOf(p.id, 'meso'), mikro = tasksOf(p.id, 'mikro'), done = meso.filter(x => x.done).length;
    return `<details class="cyc" ${cur && cur.id === p.id ? 'open' : ''} style="--pc:${PHC[p.type]}"><summary><span class="dot" style="background:${PHC[p.type]}"></span><span class="grow"><b>${esc(p.label)}</b> <span class="tiny mute">${MAKRO[p.makro]} · ${D.short(p.start)}–${D.short(p.end)}</span></span><span class="cyc-n">${done}/${meso.length}</span></summary>
      <div class="cyc-b"><div class="sub"><span class="grow">Zyklusaufgaben</span><button class="link" data-a="addPtask" data-phase="${p.id}" data-mode="meso">+ Aufgabe</button></div>
      ${meso.length ? `<div class="list checks">${meso.map(x => check(x.done, x.title, `data-a="ptask" data-id="${esc(x.id)}"`)).join('')}</div>` : '<div class="tiny mute">Keine.</div>'}
      <div class="sub"><span class="grow">Wochenaufgaben</span><button class="link" data-a="addPtask" data-phase="${p.id}" data-mode="mikro">+ Aufgabe</button></div>
      ${mikro.length ? `<div class="clgrid">${mikro.map(x => `<div class="cli" data-a="editPtask" data-id="${esc(x.id)}"><span class="t">${esc(x.title)}</span></div>`).join('')}</div>` : '<div class="tiny mute">Keine.</div>'}
      <button class="link" data-a="open" data-h="#/saison/phase/${p.id}" style="margin-top:8px">Phase öffnen · Aufgaben bearbeiten</button></div></details>`;
  }).join('');
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
  todoSheet: () => todoSheet(),
  newGoal: () => goalForm({ area: UI.ziele || 'training', sub: UI.ziele === 'ideen' ? 'Multisportiv' : '' }, true),
  editGoal: el => { const g = Store.get(el.dataset.id); if (g) goalForm(g); },
  ideaDone: el => { const g = Store.data(el.dataset.id); if (!g) return; Store.put(el.dataset.id, 'goal', { ...g, done: !g.done, doneAt: !g.done ? D.today() : '' }); if (!g.done) toast('Gemacht ✓'); render(); },
  zReview: () => { const ids = ZAREAS.filter(a => a.k !== 'ideen').flatMap(a => goals(a.k).map(g => g.id)); if (!ids.length) return toast('Noch keine Ziele'); UI.zrev = { ids, i: 0 }; zReviewStep(); },
  zRate: el => {
    const R = UI.zrev; if (!R) return; const id = R.ids[R.i], g = Store.data(id), imp = $('#zr-imp')?.value ?? '';
    if (g && el.dataset.v !== 'skip') Store.put(id, 'goal', { ...g, pulse: el.dataset.v, impulse: imp, reviewed: D.today() });
    else if (g && imp !== (g.impulse || '')) Store.put(id, 'goal', { ...g, impulse: imp });
    R.i++; zReviewStep();
  },
  todoGo: async el => { await Sheet.close(); go(el.dataset.h); },
  todoTests: async el => { await Sheet.close(); UI.tests.st = el.dataset.v; go('#/tests/pool'); },
  slotWip: el => { const q = Store.data(el.dataset.id); if (!q) return; Store.put(el.dataset.id, 'slot', { ...q, wip: !q.wip }); toast(q.wip ? 'Wieder offen' : 'In Bearbeitung'); render(); },
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
  testsStatus: el => { UI.tests.st = el.dataset.v; go('#/tests/pool'); render(); },
  newSlot: () => slotForm({ date: D.add(D.today(), 14) }, true),
  editSlot: el => slotForm(Store.get(el.dataset.id)),
  slotPool: el => { const q = Store.data(el.dataset.id); UI.tests.lvls = new Set(q.levels || []); UI.tests.st = ''; go('#/tests/pool'); },
  slotFound: el => { const q = Store.data(el.dataset.id); gameForm({ date: q.date, kickoff: q.kickoff || '', ha: q.ha || '', type: 'Test' }, true); },
  rate: el => { const { week: k, day: d } = el.dataset, v = +el.dataset.v, cur = ((weekData(k).days || {})[d] || {}).rating; setDay(k, d, { rating: cur === v ? 0 : v }); if (cur !== v) toast(`Training bewertet: ${v}/5`); render(); },
  togglePast: el => { UI.pastOpen = UI.pastOpen || {}; UI.pastOpen[el.dataset.k] = !UI.pastOpen[el.dataset.k]; render(); },
  gTest: () => { UI.games.type = 'Test'; UI.games.when = 'all'; go('#/spiele'); render(); },
  formSave: () => FORM && FORM.onSave(readForm()),
  formDelete: () => FORM && FORM.onDelete && FORM.onDelete(),
  fitCycle: el => { const g = el.closest('[data-fit]'), v = JSON.parse(g.dataset.val), n = el.dataset.n, s = ((v[n] || 0) + 1) % 4; if (s) v[n] = s; else delete v[n]; g.dataset.val = JSON.stringify(v); el.className = 'fit' + s; },
  posvCycle: el => { const g = el.closest('[data-posv]'), v = JSON.parse(g.dataset.val), p = el.dataset.p, s = ((v[p] || 0) + 1) % 3; if (s) v[p] = s; else delete v[p]; g.dataset.val = JSON.stringify(v); el.className = s ? 'l' + s : ''; el.querySelector('span').textContent = s ? POSVLV[s] : '–'; if (!s && g.dataset.best === p) { g.dataset.best = ''; el.querySelector('.pstar').classList.remove('on'); } },
  posvStar: el => { const g = el.closest('[data-posv]'), v = JSON.parse(g.dataset.val), p = el.dataset.p; if (!v[p]) { v[p] = 1; g.dataset.val = JSON.stringify(v); const b = el.closest('button'); b.className = 'l1'; b.querySelector('span').textContent = POSVLV[1]; }
    const on = g.dataset.best !== p; g.dataset.best = on ? p : ''; $$('.pstar', g).forEach(x => x.classList.toggle('on', on && x.dataset.p === p)); },
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
      fields: [{ k: 'sq', t: 'multi', max, opts: players().sort((a, b) => tierIdx(a) - tierIdx(b) || byName(a, b)).map(p => ({ v: p.id, l: p.name, s: posChips(p, 5), inline: true, dot: tierOf(p.tier).c, g: tierOf(p.tier).l, r: p.number ? `<span class="tiny mute">#${esc(p.number)}</span>` : '' })) }],
      onSave: async v => { Store.patch(g.id, 'game', { squad: v.sq, start11: (g.start11 || []).filter(x => v.sq.includes(x)) }); await Sheet.close(); render(); },
    });
  },
  pickStart: el => lineupSheet(el.dataset.id),
  luClear: el => saveLineup(el.dataset.id, {}),
  setKit: el => { const g = Store.data(el.dataset.id); Store.patch(el.dataset.id, 'game', { kit: g.kit === el.dataset.v ? '' : el.dataset.v }); render(); },
  placeSave: async el => {
    const w = $('#wheel'), place = Math.round(w.scrollTop / 40) + 1, cx = $('#pcx').checked;
    Store.patch(el.dataset.id, 'game', cx ? { cancelled: true } : { place, cancelled: false }); await Sheet.close(); toast(cx ? 'Als abgesagt markiert' : `Platz ${place} gespeichert`); render();
  },
  resultScore: el => resultForm(Store.get(el.dataset.id), true),
  undo: () => Undo.undo(),
  clubSt: (el, ev) => { ev.stopPropagation(); const v = el.dataset.v; Store.patch(el.dataset.id, 'club', { status: v, done: v === 'fix', requested: v !== 'none', callback: false }); render(); },
  vInc: el => { UI.vereine.inc = el.dataset.v === '1'; render(); },
  blkMove: el => { const { week: k, day: d } = el.dataset, i = +el.dataset.b, j = i + +el.dataset.d, bl = blocksCopy(k, d); if (j < 0 || j >= bl.length) return; [bl[i], bl[j]] = [bl[j], bl[i]]; saveBlocks(k, d, bl); render(); },
  blkDel: el => { const { week: k, day: d } = el.dataset, bl = blocksCopy(k, d); bl.splice(+el.dataset.b, 1); saveBlocks(k, d, bl); render(); },
  blkAdd: el => { const { week: k, day: d, k: bk } = el.dataset, bl = blocksCopy(k, d), nb = { k: bk, items: [] }; if (bk === 'video') bl.unshift(nb); else bl.push(nb); saveBlocks(k, d, bl); render(); },
  blkPick: el => blockPick(el.dataset.week, el.dataset.day, +el.dataset.b),
  itemDel: el => { const { week: k, day: d } = el.dataset, bl = blocksCopy(k, d), b = bl[+el.dataset.b]; b.items = b.items.filter((_, j) => j !== +el.dataset.i); saveBlocks(k, d, bl); render(); },
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
    const k = el.dataset.week, d = el.dataset.day, wk = !d, cur = (wk ? weekData(k).phase : ((weekData(k).days || {})[d] || {}).phase) || '';
    const opts = [...Object.entries(GP).filter(([x]) => !wk || x !== 'FREI'), ['', { s: '–', l: 'Keine Auswahl', c: 'var(--mute)' }]];
    Sheet.open(wk ? `KW ${D.week(D.fromKey(k)).week} · Schwerpunkt der Woche` : `${WD[d]} ${D.short(D.add(D.fromKey(k), d - 1))} · Spielphase`, `<div class="phlist">${opts.map(([key, v]) =>
      `<button class="${cur === key ? 'on' : ''}" style="--c:${v.c}" data-a="dayPhase" data-week="${k}" ${wk ? '' : `data-day="${d}"`} data-ph="${key}"><span class="phcode">${esc(v.s)}</span><span class="grow">${esc(v.l)}</span>${cur === key ? '✓' : ''}</button>`).join('')}</div>`);
  },
  dayPhase: async el => {
    const k = el.dataset.week;
    if (el.dataset.day) setDay(k, el.dataset.day, { phase: el.dataset.ph }); else Store.put('week:' + k, 'week', { ...weekData(k), phase: el.dataset.ph });
    await Sheet.close(); render();
  },
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
    title: isNew ? (t.mode === 'mikro' ? 'Neue Wochenaufgabe' : 'Neue Zyklusaufgabe') : 'Aufgabe', value: t,
    fields: [{ k: 'title', l: 'Aufgabe', auto: isNew }, { k: 'mode', l: 'Art', t: 'seg', opts: [['meso', 'Zyklusaufgabe (einmal)'], ['mikro', 'Wochenaufgabe']] },
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
const Q = { kQ: 'kader', exQ: 'ex', athQ: 'ath', tQ: 'tests', cQ: 'contacts', sQ: 'scout', vQ: 'vereine' };
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
  if (['ptask', 'wtask', 'gcheck', 'matDone', 'ideaDone'].includes(a)) return A[a](el, e);
  if (a === 'exSel') { UI.ex[el.dataset.f] = el.value; return render(); }
  if (a === 'weekField') { const k = el.dataset.week, w = { ...weekData(k), [el.dataset.f]: el.value }; Store.put('week:' + k, 'week', w); return toast('Gespeichert'); }
  if (a === 'dayNote') { setDay(el.dataset.week, el.dataset.day, { note: el.value }); return toast('Gespeichert'); }
  if (a === 'gameField') { Store.patch(el.dataset.id, 'game', { [el.dataset.f]: el.value }); return toast('Gespeichert'); }
  if (a === 'matNotes') { Store.put('setting:material-notes', 'setting', { text: el.value }); return toast('Gespeichert'); }
  if (a === 'tDay') { const days = $$('[data-a="tDay"]:checked').map(i => +i.value); Store.patch('setting:main', 'setting', { trainingDays: days }); return toast('Gespeichert'); }
  if (a === 'setNum') { Store.patch('setting:main', 'setting', { [el.dataset.f]: +el.value || '' }); if (el.dataset.f === 'exPlayers') UI.ex.n = null; return toast('Gespeichert'); }
  if (a === 'importFile') return importFile(el.files[0]);
  if (a === 'itemMin' || a === 'blkMin' || a === 'blkText') {
    const k = el.dataset.week, d = el.dataset.day, bl = blocksCopy(k, d), b = bl[+el.dataset.b], num = el.value === '' ? '' : Math.max(0, +el.value);
    if (a === 'itemMin') b.items[+el.dataset.i].min = num; else if (a === 'blkMin') b.min = num; else b.text = el.value;
    saveBlocks(k, d, bl); return render();
  }
  if (a === 'dayDur') { setDay(el.dataset.week, el.dataset.day, { duration: +el.value || '' }); return render(); }
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
    Undo.off++; migratePositions(); Undo.off--; migrate13(); toast(`${data.items.length} Einträge importiert`);
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
// Einmalige Umstellung auf Version 1.3
const ABSCHLUSS = [11, 10, 9, 8, 7];
function migrate13() {
  Undo.off++;
  for (const g of Store.all('game')) { const t = g.type === 'Leistungsvergleich' ? 'LV' : g.type === 'Sonstiges' ? '' : g.type; if (t !== g.type) Store.put(g.id, 'game', { ...Store.data(g.id), type: t }, true); }
  for (const c of Store.all('club')) if (!c.status) Store.put(c.id, 'club', { ...Store.data(c.id), status: clubStatus(c) }, true);
  if (!Store.data('setting:migr13')) {
    for (const N of ABSCHLUSS) {
      const id = `ex:abschluss-${N}v${N}`, fp = 2 * (N - 1); if (Store.items.has(id)) continue;
      const fit = { [fp]: 3 }; if (fp - 1 >= 1) fit[fp - 1] = 2; if (fp + 1 <= 21) fit[fp + 1] = 2; if (fp - 2 >= 1) fit[fp - 2] = 1;
      Store.put(id, 'exercise', { name: `${N} gegen ${N}`, variant: '', expl: `Abschlussspiel ${N} gegen ${N} mit Torhütern.`, fit, tphases: ['abschluss'], phases: [], diff: '', intensity: 'hoch', rating: 0 }, true);
    }
    Store.put('setting:migr13', 'setting', { done: D.today() }, true);
  }
  seedZiele();
  if (!Store.data('setting:migr16') && phases().length) {
    for (const p of phases().filter(p => p.type === 'nachb'))
      if (!tasksOf(p.id, 'meso').some(x => /material/i.test(x.title || '') && /prüf|check|kontroll/i.test(x.title || '')))
        Store.put('ptask:mat-' + p.id.replace(/[^a-z0-9]/gi, ''), 'ptask', { phase: p.id, mode: 'meso', title: 'Material überprüfen', done: false, order: 9e6 }, true);
    for (const g of Store.all('game')) {
      if (!/^\d+\. Spieltag/.test(g.opponent || '') || g.date < D.today()) continue;
      const wd = dayIdx(g.date), sat = wd === 7 ? D.add(g.date, -1) : g.date;
      if (dayIdx(sat) === 6) Store.put(g.id, 'game', { ...Store.data(g.id), date: sat, alt: D.add(sat, 1) }, true);
    }
    Store.put('setting:migr16', 'setting', { done: D.today() }, true);
  }
  Undo.off--; if (Object.keys(Store.pending).length) Store.flushSoon();
}
async function startApp(user) {
  Store.user = user || null; $('#top').style.display = '';
  Store.restore(); Undo.off++; migratePositions(); Undo.off--; migrate13(); render();
  if (REMOTE) {
    try { await Store.fetchAll(); Store.error = ''; Undo.off++; migratePositions(); Undo.off--; migrate13(); } catch (e) { Store.error = e.message; }
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
