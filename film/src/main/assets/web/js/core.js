/* CINÉ-GENESIS — socle commun : utilitaires, pont natif, réseau, stockage, réglages, feuilles, retour.
   Script classique (pas de module) : les globales sont partagées avec engines.js, film.js, studio.js, app.js. */
'use strict';

/* ═════════════════════════════════════════════════════════════════════
   UTILITAIRES
   ═════════════════════════════════════════════════════════════════════ */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms || 0)));
const uid = () => { let s = ''; while (s.length < 8) s += Math.random().toString(36).slice(2); return s.slice(0, 8); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const san = t => String(t == null ? '' : t).replace(/[‘’]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[  ]/g, ' ');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtTime = sec => { const s = Math.max(0, Math.round(+sec || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtBytes = n => {
  n = Math.max(0, +n || 0);
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? String(Math.round(n)) : n.toFixed(n < 10 ? 1 : 0).replace('.', ',')) + ' ' + u[i];
};
const fmtUSD = x => (x == null || !isFinite(x)) ? '' : '≈ ' + Number(x).toFixed(2).replace('.', ',') + ' $';

/* Base64 ⇄ texte UTF-8 (réponses du pont natif en mode base64) */
function _co_bufToB64(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
function _co_b64ToText(b64) {
  const bin = atob(String(b64 || ''));
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(b);
}
const _co_textToB64 = t => _co_bufToB64(new TextEncoder().encode(String(t == null ? '' : t)));

/* ═════════════════════════════════════════════════════════════════════
   ÉTAT PARTAGÉ
   ═════════════════════════════════════════════════════════════════════ */
const N = (typeof window !== 'undefined' && window.CGNative) || null;
const IS_APP = !!N;
const ACT = {};
const ON_INPUT = [];
const ON_CHANGE = [];
const BACK = [];

/* ═════════════════════════════════════════════════════════════════════
   PONT NATIF : promesses à usage unique et écouteurs multi-évènements
   ═════════════════════════════════════════════════════════════════════ */
const _co_wait = new Map();
const _co_END = { done: 1, error: 1, cancelled: 1 };

function native(method, ...args) {
  return new Promise((resolve, reject) => {
    if (!N || typeof N[method] !== 'function') return reject(new Error('fonction native indisponible : ' + method));
    const id = 'n_' + uid();
    _co_wait.set(id, { once: true, fn: resolve });
    try { N[method](id, ...args); } catch (e) { _co_wait.delete(id); reject(e); }
  });
}

function nativeListen(method, args, onEvent) {
  const id = 'n_' + uid();
  const fail = msg => setTimeout(() => { try { onEvent({ state: 'error', error: msg }); } catch (e) { log('er', 'écouteur natif : ' + e.message); } }, 0);
  if (!N || typeof N[method] !== 'function') { fail('Disponible dans l’application Android'); return id; }
  const list = (Array.isArray(args) ? args : args === undefined ? [] : [args])
    .map(v => (v !== null && typeof v === 'object') ? JSON.stringify(v) : v);
  _co_wait.set(id, { once: false, fn: onEvent });
  try { N[method](id, ...list); } catch (e) { _co_wait.delete(id); fail(String(e && e.message || e)); }
  return id;
}
nativeListen.off = id => _co_wait.delete(id);

window.__cg = id => {
  let raw = null;
  try { raw = N ? N.take(id) : null; } catch (e) { raw = null; }
  const w = _co_wait.get(id);
  if (!w) return;
  let o;
  try { o = JSON.parse(raw); } catch (e) { o = { status: 0, error: 'réponse native illisible' }; }
  if (!o || typeof o !== 'object') o = { status: 0, error: 'réponse native vide' };
  if (w.once) { _co_wait.delete(id); w.fn(o); return; }
  // Deux évènements livrés coup sur coup : le second avis ne trouve plus rien, on l'ignore.
  if (!o.state && o.status === 0) return;
  if (_co_END[o.state]) _co_wait.delete(id);
  try { w.fn(o); } catch (e) { log('er', 'écouteur natif : ' + e.message); }
};

/* ═════════════════════════════════════════════════════════════════════
   RÉSEAU : même interface via le pont natif (sans CORS) ou fetch()
   ═════════════════════════════════════════════════════════════════════ */
function _co_resp(status, hget, read, type) {
  let raw = null;
  const load = () => raw || (raw = Promise.resolve().then(read));
  const r = {
    ok: status >= 200 && status < 300,
    status,
    type: type || hget('content-type') || '',
    headers: { get: k => { const v = hget(String(k).toLowerCase()); return v == null ? null : String(v); } },
    async text() { const x = await load(); return x.t != null ? x.t : _co_b64ToText(x.b); },
    async base64() { const x = await load(); return x.b != null ? x.b : _co_textToB64(x.t); },
    async json() {
      const t = await r.text();
      try { return JSON.parse(t); } catch (e) { throw new Error('réponse illisible (HTTP ' + status + ')'); }
    },
  };
  return r;
}

async function xfetch(url, o) {
  o = o || {};
  const method = String(o.method || 'GET').toUpperCase();
  const mode = o.mode === 'base64' ? 'base64' : 'text';
  const headers = Object.assign({}, o.headers || {});
  let body = o.body;
  if (body != null && typeof body !== 'string') {
    body = JSON.stringify(body);
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  }
  const noBody = method === 'GET' || method === 'HEAD';
  if (IS_APP) {
    let r;
    try { r = await native('http', method, String(url), JSON.stringify(headers), noBody || body == null ? '' : body, mode); }
    catch (e) { throw new Error('réseau : ' + (e && e.message || e)); }
    if (!r || !r.status) throw new Error('réseau : ' + ((r && r.error) || 'connexion impossible'));
    const h = r.headers || {};
    const b = r.body == null ? '' : String(r.body);
    return _co_resp(+r.status, k => h[k], () => (mode === 'base64' ? { b } : { t: b }), r.type);
  }
  let r;
  try { r = await fetch(url, { method, headers, body: noBody || body == null ? undefined : body }); }
  catch (e) { throw new Error('réseau : ' + (e && e.message || e)); }
  if (!r || !r.status) throw new Error('réseau : réponse vide');
  return _co_resp(r.status, k => (r.headers && r.headers.get ? r.headers.get(k) : null),
    async () => (mode === 'base64' ? { b: _co_bufToB64(await r.arrayBuffer()) } : { t: await r.text() }));
}

/* ═════════════════════════════════════════════════════════════════════
   IMAGES : miniatures et références (natif = décodage hors WebView)
   ═════════════════════════════════════════════════════════════════════ */
const _co_thumbs = new Map();
const _co_refs = new Map();
const _co_meta = new Map();

function _co_lru(map, key, val, max) {
  map.delete(key);
  map.set(key, val);
  while (map.size > max) map.delete(map.keys().next().value);
  return val;
}
function _co_setMeta(url, r) {
  if (r && r.w > 0 && r.h > 0) _co_lru(_co_meta, String(url), { w: +r.w, h: +r.h }, 2000);
}

function thumb(url, maxSide) {
  maxSide = Math.round(maxSide || 640);
  if (!url) return Promise.resolve('');
  url = String(url);
  if (!IS_APP || /^(blob:|content:|file:)/i.test(url)) return Promise.resolve(url);
  if (url.startsWith('data:') && url.length < 300000) return Promise.resolve(url);
  const key = maxSide + '|' + url;
  const hit = _co_thumbs.get(key);
  if (hit) return _co_lru(_co_thumbs, key, hit, 240);
  const p = native('imageData', url, maxSide)
    .then(r => {
      if (r && r.status === 200 && r.body) { _co_setMeta(url, r); return String(r.body); }
      _co_thumbs.delete(key);
      return url;
    })
    .catch(() => { _co_thumbs.delete(key); return url; });
  return _co_lru(_co_thumbs, key, p, 240);
}
thumb.meta = url => (url ? _co_meta.get(String(url)) || null : null);

function _co_canvasData(u, maxSide) {
  return new Promise(resolve => {
    let done = false, obj = null;
    const fin = v => {
      if (done) return;
      done = true;
      clearTimeout(to);
      if (obj) { try { URL.revokeObjectURL(obj); } catch (e) { /* déjà libéré */ } }
      resolve(v);
    };
    const to = setTimeout(() => fin(u.startsWith('data:') ? u : null), 30000);
    const draw = src => {
      const im = new Image();
      im.onload = () => {
        try {
          _co_setMeta(u, { w: im.naturalWidth || im.width, h: im.naturalHeight || im.height });
          const s = Math.min(1, maxSide / Math.max(im.width, im.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.width * s));
          c.height = Math.max(1, Math.round(im.height * s));
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          fin(c.toDataURL('image/jpeg', 0.86));
        } catch (e) { fin(u.startsWith('data:') ? u : null); }
      };
      im.onerror = () => fin(null);
      im.src = src;
    };
    try {
      if (/^(data:|blob:)/i.test(u)) return draw(u);
      fetch(u).then(r => r.blob()).then(b => { obj = URL.createObjectURL(b); draw(obj); }).catch(() => fin(null));
    } catch (e) { fin(null); }
  });
}

function refData(url, maxSide) {
  maxSide = Math.round(maxSide || 1024);
  if (!url) return Promise.resolve(null);
  url = String(url);
  const key = maxSide + '|' + url;
  const hit = _co_refs.get(key);
  if (hit) return _co_lru(_co_refs, key, hit, 48);
  const p = (IS_APP && !/^(blob:|content:|file:)/i.test(url)
    ? native('imageData', url, maxSide).then(r => {
        if (r && r.status === 200 && r.body) { _co_setMeta(url, r); return String(r.body); }
        log('wr', 'référence illisible : ' + ((r && r.error) || 'erreur'));
        return url.startsWith('data:') ? url : null;
      })
    : _co_canvasData(url, maxSide))
    .catch(() => null)
    .then(v => { if (!v) _co_refs.delete(key); return v; });
  return _co_lru(_co_refs, key, p, 48);
}

/* ═════════════════════════════════════════════════════════════════════
   JOURNAL / NOTIFICATIONS
   ═════════════════════════════════════════════════════════════════════ */
function log(level, msg) {
  const b = typeof document !== 'undefined' && document.getElementById ? document.getElementById('lb') : null;
  if (!b) return;
  const d = document.createElement('div');
  d.className = 'lg ' + (level || 'in');
  let t;
  try { t = new Date().toLocaleTimeString('fr-FR'); } catch (e) { t = new Date().toTimeString().slice(0, 8); }
  d.textContent = t + '  ' + String(msg == null ? '' : msg);
  const stick = b.scrollHeight - b.scrollTop - b.clientHeight < 40;
  b.appendChild(d);
  while (b.children.length > 500) b.firstChild.remove();
  if (stick) b.scrollTop = b.scrollHeight;
}

function _co_untoast(d) {
  if (!d || d._gone) return;
  d._gone = true;
  clearTimeout(d._t);
  d.classList.add('out');
  setTimeout(() => d.remove(), 220);
}
function toast(msg, kind) {
  const box = typeof document !== 'undefined' && document.getElementById ? document.getElementById('toast') : null;
  if (!box) return;
  const text = String(msg == null ? '' : msg);
  const life = kind === 'er' ? 6500 : 4200;
  for (const c of Array.from(box.children)) {
    if (!c._gone && c.textContent === text) { clearTimeout(c._t); c._t = setTimeout(() => _co_untoast(c), life); return; }
  }
  const d = document.createElement('div');
  d.className = kind || '';
  d.setAttribute('role', kind === 'er' ? 'alert' : 'status');
  d.textContent = text;
  d.onclick = () => _co_untoast(d);
  box.appendChild(d);
  const live = Array.from(box.children).filter(c => !c._gone);
  if (live.length > 3) _co_untoast(live[0]);
  d._t = setTimeout(() => _co_untoast(d), life);
}

/* ═════════════════════════════════════════════════════════════════════
   SERVICES DE L'APPAREIL (natif, sinon équivalents navigateur)
   ═════════════════════════════════════════════════════════════════════ */
const _co_fname = n => String(n || 'CineGenesis_' + Date.now())
  .replace(/\.(mp4|mov|webm|jpe?g|png|webp)$/i, '')
  .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 90) || 'CineGenesis';

function _co_download(href, file) {
  const a = document.createElement('a');
  a.href = href;
  a.download = file;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 0);
}

async function saveToGallery(url, kind, name, share) {
  kind = kind === 'video' ? 'video' : 'image';
  if (!url) { toast('Rien à enregistrer pour l’instant', 'wr'); return false; }
  const nm = _co_fname(name);
  const what = kind === 'video' ? 'Vidéo' : 'Image';
  if (IS_APP) {
    try {
      const r = await native('saveMedia', String(url), kind, nm, !!share);
      if (r && r.status === 200) {
        haptic('confirm');
        toast(what + ' enregistrée dans la galerie · CineGenesis', 'ok');
        log('ok', 'galerie : ' + (r.name || nm));
        return true;
      }
      if (r && r.error === 'permission') { toast('Autorisez l’accès au stockage, puis réessayez', 'wr'); return false; }
      throw new Error((r && r.error) || 'échec inconnu');
    } catch (e) {
      log('er', 'galerie : ' + e.message);
      toast('Enregistrement impossible : ' + e.message, 'er');
      return false;
    }
  }
  try {
    if (share && navigator.share && /^https?:/i.test(url)) {
      await navigator.share({ title: nm, url: String(url) });
      return true;
    }
    const ext = kind === 'video' ? '.mp4' : /\.png(\?|$)|^data:image\/png/i.test(url) ? '.png' : '.jpg';
    let href = String(url), obj = null;
    if (!/^(data:|blob:)/i.test(href)) {
      try { const b = await (await fetch(href)).blob(); obj = href = URL.createObjectURL(b); } catch (e) { href = String(url); }
    }
    _co_download(href, nm + ext);
    if (obj) setTimeout(() => URL.revokeObjectURL(obj), 60000);
    toast(what + ' téléchargée', 'ok');
    return true;
  } catch (e) {
    if (e && e.name === 'AbortError') return false;
    toast('Enregistrement impossible : ' + (e && e.message || e), 'er');
    return false;
  }
}

async function saveTextFile(name, mime, text) {
  const file = String(name || 'cinegenesis.txt').replace(/[\\/:*?"<>|]+/g, '_');
  mime = mime || 'text/plain';
  if (IS_APP) {
    try {
      const r = await native('saveText', file, mime, String(text == null ? '' : text));
      if (r && r.status === 200) { toast('Fichier enregistré dans Téléchargements · CineGenesis', 'ok'); log('ok', 'fichier : ' + file); return true; }
      if (r && r.error === 'permission') { toast('Autorisez l’accès au stockage, puis réessayez', 'wr'); return false; }
      throw new Error((r && r.error) || 'échec inconnu');
    } catch (e) {
      log('er', 'fichier : ' + e.message);
      toast('Enregistrement impossible : ' + e.message, 'er');
      return false;
    }
  }
  try {
    const u = URL.createObjectURL(new Blob([String(text == null ? '' : text)], { type: mime }));
    _co_download(u, file);
    setTimeout(() => URL.revokeObjectURL(u), 60000);
    toast('Fichier téléchargé', 'ok');
    return true;
  } catch (e) {
    toast('Enregistrement impossible : ' + e.message, 'er');
    return false;
  }
}

function openExternal(url) {
  if (!url) return;
  if (N) { try { N.openUrl(String(url)); return; } catch (e) { log('wr', 'lien : ' + e.message); } }
  try { window.open(String(url), '_blank', 'noopener'); } catch (e) { /* fenêtre bloquée */ }
}

let _co_lock = null;
function keepAwake(on) {
  on = !!on;
  if (N) { try { N.keepAwake(on); } catch (e) { /* sans effet */ } return; }
  try {
    if (on && !_co_lock && navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { _co_lock = l; }).catch(() => {});
    else if (!on && _co_lock) { _co_lock.release().catch(() => {}); _co_lock = null; }
  } catch (e) { /* API absente */ }
}

function speak(text) {
  text = String(text == null ? '' : text).trim();
  if (!text) return;
  if (N) { try { N.speak(text, 'fr-FR'); } catch (e) { log('wr', 'voix : ' + e.message); } return; }
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    speechSynthesis.speak(u);
  } catch (e) { /* synthèse indisponible */ }
}

function stopSpeak() {
  if (N) { try { N.stopSpeak(); } catch (e) { /* sans effet */ } return; }
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) { /* sans effet */ }
}

function haptic(kind) {
  kind = kind || 'tap';
  if (N) { try { N.haptic(kind); } catch (e) { /* sans effet */ } return; }
  try { if (navigator.vibrate) navigator.vibrate(kind === 'long' || kind === 'reject' ? 30 : 8); } catch (e) { /* sans effet */ }
}

/* ═════════════════════════════════════════════════════════════════════
   STOCKAGE : IndexedDB, avec secours localStorage + mémoire
   ═════════════════════════════════════════════════════════════════════ */
const DB = (() => {
  const KP = { sessions: 'id', items: 'id', config: 'key' };
  const mem = { sessions: {}, items: {}, config: {} };
  const lsK = (s, k) => 'cg1_' + s + '_' + k;
  let h = null, mode = 'idb', opening = null, warned = false;

  const ls = {
    get(s, k) { try { const v = localStorage.getItem(lsK(s, k)); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; } },
    set(s, k, v) {
      try { localStorage.setItem(lsK(s, k), JSON.stringify(v)); } catch (e) {
        if (!warned) { warned = true; log('wr', 'stockage de secours plein : données gardées en mémoire'); }
      }
    },
    del(s, k) { try { localStorage.removeItem(lsK(s, k)); } catch (e) { /* inaccessible */ } },
    all(s) {
      const o = {};
      try {
        const pre = lsK(s, '');
        for (let i = 0; i < localStorage.length; i++) {
          const n = localStorage.key(i);
          if (n && n.startsWith(pre)) { try { const v = JSON.parse(localStorage.getItem(n)); if (v) o[v[KP[s]]] = v; } catch (e) { /* entrée abîmée */ } }
        }
      } catch (e) { /* inaccessible */ }
      return o;
    },
  };

  function fall(e) {
    if (mode !== 'idb') return;
    mode = 'ls';
    log('wr', 'IndexedDB indisponible (' + (e && e.message || e) + ') → stockage de secours');
    toast('Stockage limité : sauvegarde de secours activée', 'wr');
  }

  function adopt(d) {
    h = d;
    mode = 'idb';
    h.onversionchange = () => { try { h.close(); } catch (e) { /* déjà fermé */ } h = null; };
    h.onclose = () => { h = null; };
  }

  function open() {
    if (opening) return opening;
    opening = new Promise(resolve => {
      let settled = false;
      const fin = ok => { if (!settled) { settled = true; clearTimeout(to); resolve(ok); } };
      const to = setTimeout(() => { fall(new Error('délai dépassé')); fin(false); }, 3000);
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('IndexedDB absent');
        const r = indexedDB.open('cinegenesis', 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          Object.keys(KP).forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: KP[s] }); });
        };
        r.onsuccess = () => {
          // Ouverture tardive (après le délai) : on adopte quand même la base, le secours reste lisible.
          adopt(r.result);
          fin(true);
        };
        r.onerror = () => { fall(r.error); fin(false); };
        r.onblocked = () => log('wr', 'base locale bloquée par un autre onglet');
      } catch (e) { fall(e); fin(false); }
    });
    return opening;
  }

  const ready = () => open();
  const live = () => h && mode === 'idb';
  const tx = (s, m, f) => new Promise((res, rej) => {
    try {
      const r = f(h.transaction(s, m).objectStore(s));
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  const chk = s => { if (!KP[s]) throw new Error('magasin inconnu : ' + s); };

  async function get(s, k) {
    chk(s);
    await ready();
    if (live()) {
      try { const v = await tx(s, 'readonly', o => o.get(k)); if (v !== undefined) return v; } catch (e) { fall(e); }
    }
    const v = ls.get(s, k);
    return v !== undefined ? v : mem[s][k];
  }

  async function put(s, v) {
    chk(s);
    if (!v || v[KP[s]] == null) throw new Error('clé manquante (' + KP[s] + ')');
    const k = v[KP[s]];
    mem[s][k] = v;
    await ready();
    if (live()) {
      try { await tx(s, 'readwrite', o => o.put(v)); ls.del(s, k); return; } catch (e) {
        if (e && e.name === 'DataCloneError') {
          try { await tx(s, 'readwrite', o => o.put(JSON.parse(JSON.stringify(v)))); ls.del(s, k); return; } catch (e2) { fall(e2); }
        } else fall(e);
      }
    }
    ls.set(s, k, v);
  }

  async function del(s, k) {
    chk(s);
    delete mem[s][k];
    await ready();
    if (live()) { try { await tx(s, 'readwrite', o => o.delete(k)); } catch (e) { fall(e); } }
    ls.del(s, k);
  }

  async function all(s) {
    chk(s);
    await ready();
    const o = ls.all(s);
    if (live()) {
      try {
        const list = await tx(s, 'readonly', st => st.getAll());
        (list || []).forEach(v => { o[v[KP[s]]] = v; });
        return Object.values(o);
      } catch (e) { fall(e); }
    }
    Object.assign(o, mem[s]);
    return Object.values(o);
  }

  return { open, get, put, del, all, get mode() { return live() ? 'idb' : 'ls'; } };
})();

/* ═════════════════════════════════════════════════════════════════════
   RÉGLAGES
   ═════════════════════════════════════════════════════════════════════ */
const _co_cfg0 = () => ({
  agnes: { keys: [], plan: 'free', imgSize: '2K' },
  fal: { key: '' },
  oai: { url: '', model: '', key: '' },
  eng: { text: 'auto', image: 'auto', video: 'auto' },
  up4k: true,
  audio: true,
  falPar: 3,
  exp: { codec: 'auto', mbps: 60, sharpen: 35 },
  ovr: {},
});
const CFG = _co_cfg0();

const _co_plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function _co_merge(dst, src) {
  Object.keys(src).forEach(k => {
    const v = src[k];
    if (v === undefined) return;
    if (_co_plain(dst[k]) && _co_plain(v)) _co_merge(dst[k], v);
    else dst[k] = Array.isArray(v) ? v.slice() : _co_plain(v) ? JSON.parse(JSON.stringify(v)) : v;
  });
  return dst;
}
function _co_normCfg() {
  const d = _co_cfg0();
  ['agnes', 'fal', 'oai', 'eng', 'exp', 'ovr'].forEach(k => { if (!_co_plain(CFG[k])) CFG[k] = d[k]; });
  const keys = Array.isArray(CFG.agnes.keys) ? CFG.agnes.keys : String(CFG.agnes.keys || '').split(/[\s,;]+/);
  CFG.agnes.keys = Array.from(new Set(keys.map(s => String(s).trim()).filter(s => s.length >= 8)));
  if (CFG.agnes.plan !== 'plan') CFG.agnes.plan = 'free';
  if (['1K', '2K', '4K'].indexOf(CFG.agnes.imgSize) < 0) CFG.agnes.imgSize = '2K';
  CFG.fal.key = String(CFG.fal.key || '').trim();
  ['url', 'model', 'key'].forEach(k => { CFG.oai[k] = String(CFG.oai[k] || '').trim(); });
  ['text', 'image', 'video'].forEach(k => { if (!CFG.eng[k]) CFG.eng[k] = 'auto'; });
  CFG.up4k = CFG.up4k !== false;
  CFG.audio = CFG.audio !== false;
  CFG.falPar = clamp(Math.round(+CFG.falPar || 3), 1, 8);
  if (['auto', 'hevc', 'avc'].indexOf(CFG.exp.codec) < 0) CFG.exp.codec = 'auto';
  CFG.exp.mbps = clamp(Math.round(+CFG.exp.mbps || 60), 10, 200);
  CFG.exp.sharpen = clamp(Math.round(CFG.exp.sharpen == null ? 35 : +CFG.exp.sharpen || 0), 0, 100);
}

async function loadCfg() {
  try {
    const r = await DB.get('config', 'cfg');
    if (r && _co_plain(r.v)) _co_merge(CFG, r.v);
    if (!CFG.agnes.keys || !CFG.agnes.keys.length) {
      // Clés de l'ancienne version (une seule page HTML)
      const old = await DB.get('config', 'keys');
      if (old && Array.isArray(old.list) && old.list.length) {
        CFG.agnes.keys = old.list.slice();
        if (old.plan) CFG.agnes.plan = old.plan;
      }
    }
  } catch (e) {
    log('er', 'réglages : ' + e.message);
  }
  _co_normCfg();
  return CFG;
}

let _co_cfgT = 0, _co_cfgP = null, _co_cfgR = null;
function saveCfg() {
  clearTimeout(_co_cfgT);
  if (!_co_cfgP) _co_cfgP = new Promise(r => { _co_cfgR = r; });
  const p = _co_cfgP;
  _co_cfgT = setTimeout(() => {
    const done = _co_cfgR;
    _co_cfgP = _co_cfgR = null;
    let snap;
    try { snap = JSON.parse(JSON.stringify(CFG)); } catch (e) { snap = {}; }
    DB.put('config', { key: 'cfg', v: snap })
      .catch(e => log('er', 'sauvegarde des réglages : ' + e.message))
      .then(() => done(true));
  }, 300);
  return p;
}

/* ═════════════════════════════════════════════════════════════════════
   FEUILLE DU BAS, CONFIRMATION
   ═════════════════════════════════════════════════════════════════════ */
const _co_sh = { closer: null, onClose: null, timer: 0, bound: false };

function _co_bindSheet() {
  if (_co_sh.bound) return;
  const s = document.getElementById('sheet');
  if (!s) return;
  _co_sh.bound = true;
  s.addEventListener('click', e => { if (e.target === s) closeSheet(); });
}

function openSheet(html, onClose) {
  const s = document.getElementById('sheet'), b = document.getElementById('sheetBody');
  if (!s || !b) return;
  _co_bindSheet();
  const prev = _co_sh.onClose;
  _co_sh.onClose = null;
  if (prev) { try { prev(); } catch (e) { log('er', 'feuille : ' + e.message); } }
  clearTimeout(_co_sh.timer);
  b.innerHTML = html;
  b.scrollTop = 0;
  s.classList.add('on');
  s.setAttribute('aria-hidden', 'false');
  _co_sh.onClose = typeof onClose === 'function' ? onClose : null;
  if (!_co_sh.closer) { _co_sh.closer = () => { closeSheet(); return true; }; BACK.push(_co_sh.closer); }
}

function closeSheet() {
  const s = document.getElementById('sheet'), b = document.getElementById('sheetBody');
  if (_co_sh.closer) {
    const i = BACK.indexOf(_co_sh.closer);
    if (i >= 0) BACK.splice(i, 1);
    _co_sh.closer = null;
  }
  if (s) { s.classList.remove('on'); s.setAttribute('aria-hidden', 'true'); }
  const f = _co_sh.onClose;
  _co_sh.onClose = null;
  clearTimeout(_co_sh.timer);
  _co_sh.timer = setTimeout(() => { if (b && !(s && s.classList.contains('on'))) b.innerHTML = ''; }, 320);
  if (f) { try { f(); } catch (e) { log('er', 'feuille : ' + e.message); } }
}

function confirmSheet(title, text, okLabel, danger) {
  okLabel = okLabel || 'Confirmer';
  if (danger === undefined) danger = /supprim|effac|vider|remplac|abandon/i.test(okLabel);
  return new Promise(resolve => {
    const s = document.getElementById('sheet'), b = document.getElementById('sheetBody');
    if (!s || !b) return resolve(false);
    // Une confirmation ouverte par-dessus une autre feuille la restaure ensuite.
    const prev = s.classList.contains('on') && b.innerHTML ? { html: b.innerHTML, onClose: _co_sh.onClose } : null;
    if (prev) _co_sh.onClose = null;
    let done = false;
    const answer = v => {
      if (done) return;
      done = true;
      _co_sh.onClose = null;
      haptic(v ? 'confirm' : 'tap');
      if (prev) openSheet(prev.html, prev.onClose); else closeSheet();
      resolve(v);
    };
    const red = danger ? ' style="background:linear-gradient(120deg,#ef4444,#f87171);border-color:transparent;color:#fff;box-shadow:0 8px 24px -10px rgba(248,113,113,.8)"' : '';
    openSheet(
      '<div class="stack" role="alertdialog" aria-modal="true" aria-labelledby="cfmT">' +
        '<div class="h2" id="cfmT">' + esc(title || 'Confirmer') + '</div>' +
        (text ? '<p class="sub">' + esc(text) + '</p>' : '') +
        '<div class="row" style="margin-top:6px">' +
          '<button type="button" class="btn ghost grow" data-cfm="0">Annuler</button>' +
          '<button type="button" class="btn ' + (danger ? '' : 'pri ') + 'grow" data-cfm="1"' + red + '>' + esc(okLabel) + '</button>' +
        '</div>' +
      '</div>',
      () => {
        // Fermée par le fond ou le bouton retour : réponse négative, la feuille précédente part aussi.
        if (done) return;
        done = true;
        if (prev && prev.onClose) { try { prev.onClose(); } catch (e) { /* sans effet */ } }
        resolve(false);
      });
    b.querySelectorAll('[data-cfm]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); answer(el.getAttribute('data-cfm') === '1'); });
    });
    const ok = b.querySelector('[data-cfm="1"]');
    if (ok && ok.focus) { try { ok.focus({ preventScroll: true }); } catch (e) { /* focus refusé */ } }
  });
}

/* ═════════════════════════════════════════════════════════════════════
   ENCARTS SYSTÈME, RETOUR, VIDÉO
   ═════════════════════════════════════════════════════════════════════ */
function setInsets(o) {
  if (!o || typeof document === 'undefined' || !document.documentElement) return;
  const st = document.documentElement.style;
  const px = v => Math.max(0, Math.round(+v || 0)) + 'px';
  st.setProperty('--st', px(o.top));
  st.setProperty('--sr', px(o.right));
  st.setProperty('--sb', px(o.bottom));
  st.setProperty('--sl', px(o.left));
  st.setProperty('--kb', px(o.kb));
  const kb = (+o.kb || 0) > 30;
  const body = document.body;
  if (!body) return;
  const was = body.classList.contains('kb');
  body.classList.toggle('kb', kb);
  if (kb && !was) {
    // Le clavier vient de s'ouvrir : garder le champ actif visible.
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a !== body && a.scrollIntoView) { try { a.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { a.scrollIntoView(); } }
    }, 80);
  }
}
window.cgInsets = setInsets;

window.cgBack = () => {
  while (BACK.length) {
    const f = BACK.pop();
    let r;
    try { r = f(); } catch (e) { r = true; log('er', 'retour : ' + e.message); }
    if (r !== false) return true;
  }
  try { if (typeof APP !== 'undefined' && APP && typeof APP.back === 'function') return !!APP.back(); } catch (e) { /* app.js absent */ }
  try { if (typeof FILM !== 'undefined' && FILM && typeof FILM.back === 'function' && FILM.back()) return true; } catch (e) { /* film.js absent */ }
  return false;
};

window.cgPermission = ok => {
  if (ok) toast('Accès au stockage autorisé : vous pouvez réessayer', 'ok');
  else toast('Accès au stockage refusé : impossible d’enregistrer dans la galerie', 'er');
};

const _co_probes = new Map();
function probeVideo(url) {
  if (!url) return Promise.resolve({ w: 0, h: 0, d: 0 });
  url = String(url);
  const hit = _co_probes.get(url);
  if (hit) return Promise.resolve(hit);
  return new Promise(resolve => {
    let v = null, done = false, to = 0;
    const fin = r => {
      if (done) return;
      done = true;
      clearTimeout(to);
      if (r.w > 0 && r.h > 0) _co_lru(_co_probes, url, r, 300);
      if (v) { try { v.onloadedmetadata = v.onerror = null; v.removeAttribute('src'); v.load(); } catch (e) { /* déjà libérée */ } }
      resolve(r);
    };
    to = setTimeout(() => fin({ w: 0, h: 0, d: 0 }), 20000);
    try {
      v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.playsInline = true;
      v.onloadedmetadata = () => fin({ w: v.videoWidth || 0, h: v.videoHeight || 0, d: isFinite(v.duration) ? +v.duration || 0 : 0 });
      v.onerror = () => fin({ w: 0, h: 0, d: 0 });
      v.src = url;
    } catch (e) { fin({ w: 0, h: 0, d: 0 }); }
  });
}

/* Encarts initiaux et fermeture de la feuille par le fond */
(() => {
  try { _co_bindSheet(); } catch (e) { /* DOM incomplet */ }
  if (N && typeof N.getInsets === 'function') {
    try { setInsets(JSON.parse(N.getInsets())); } catch (e) { /* encarts par défaut */ }
  }
})();
