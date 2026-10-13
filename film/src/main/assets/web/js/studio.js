/* CINÉ-GENESIS — Studio (création rapide image / vidéo 4K), Galerie et Visionneuse.
   Script classique : globales définies ici uniquement STUDIO, GAL, VIEW. Aides privées préfixées _st_. */
'use strict';

/* ═════════════════════════════════════════════════════════════════════
   AIDES COMMUNES
   ═════════════════════════════════════════════════════════════════════ */
const _st_newId = p => (p || 's') + Date.now().toString(36) + uid().slice(0, 5);
const _st_isOn = n => { const s = document.getElementById('scr-' + n); return !!(s && s.classList.contains('on')); };
const _st_msg = e => String((e && e.message) || e || 'erreur inconnue').slice(0, 220);
const _st_IR = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const _st_VR = ['16:9', '9:16', '1:1'];
const _st_SEED = { '16:9': '3840×2160', '9:16': '2160×3840', '1:1': '4096×4096', '4:3': '4096×3072', '3:4': '3072×4096' };
const _st_LAD = [1, 3, 6, 12, 24, 48];

function _st_go(tab) {
  try { if (typeof APP !== 'undefined' && APP && typeof APP.go === 'function') { APP.go(tab); return; } } catch (e) { log('er', 'navigation : ' + e.message); }
  ['studio', 'film', 'gallery', 'settings'].forEach(n => { const s = document.getElementById('scr-' + n); if (s) s.classList.toggle('on', n === tab); });
  if (tab === 'studio') STUDIO.render(); else if (tab === 'gallery') GAL.render();
}

function _st_mname(id) {
  if (id === 'topaz') return 'Topaz · upscale 4K';
  if (id === 'montage') return 'Montage 4K (téléphone)';
  return (IMODELS[id] && IMODELS[id].name) || (VMODELS[id] && VMODELS[id].name) || String(id || '—');
}

function _st_hhmm(t) {
  try { return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return new Date(t).toTimeString().slice(0, 5); }
}
function _st_date(t) {
  try { return new Date(t).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return new Date(t).toISOString().slice(0, 16).replace('T', ' '); }
}

function _st_dims(it) {
  if (!it) return { w: 0, h: 0 };
  if (it.kind === 'image') return { w: +it.w || 0, h: +it.h || 0 };
  if (it.kind === 'film') return { w: +(it.vw || it.width || it.w) || 0, h: +(it.vh || it.height || it.h) || 0 };
  return { w: +it.vw || 0, h: +it.vh || 0 };
}
function _st_is4k(it) {
  const d = _st_dims(it);
  if (!d.w || !d.h) return false;
  return it.kind === 'image' ? Math.max(d.w, d.h) >= 3840 : Math.min(d.w, d.h) >= 2160;
}
function _st_imgRes(w, h) {
  const m = Math.max(+w || 0, +h || 0);
  if (!m) return '';
  if (m >= 3840) return '4K';
  if (m >= 2048) return '2K';
  if (m >= 1024) return '1K';
  return w + '×' + h;
}
function _st_resOf(it) {
  const d = _st_dims(it);
  return it.kind === 'image' ? _st_imgRes(d.w, d.h) : resLabel(d.w, d.h);
}
function _st_ar(it) {
  const d = _st_dims(it);
  if (d.w > 0 && d.h > 0) {
    const r = clamp(d.w / d.h, 0.45, 2.4);
    return r.toFixed(4) + ' / 1';
  }
  const p = String(it.ratio || '16:9').split(':');
  return (+p[0] || 16) + ' / ' + (+p[1] || 9);
}
function _st_durOf(it) {
  if (it.kind === 'film') {
    const s = +it.durationMs > 0 ? it.durationMs / 1000 : +it.vd || +it.d || 0;
    return s > 0 ? fmtTime(s) : '';
  }
  const s = +it.vd || +it.dur || 0;
  return s > 0 ? Math.round(s) + ' s' : '';
}
function _st_title(it) {
  if (it.kind === 'film') return String(it.title || it.prompt || it.name || 'Film 4K');
  return String(it.prompt || (it.kind === 'video' ? 'Vidéo' : 'Image'));
}
function _st_fileName(it) {
  const base = san(_st_title(it)).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return 'CineGenesis_' + (base || it.id);
}
/* Source lisible dans la visionneuse : la version 4K locale passe en premier dans l'application. */
function _st_src(it) {
  if (!it) return '';
  if (it.kind === 'film') return String(it.uri || it.u || '');
  if (it.kind === 'video') return String((IS_APP && it.u4k) || it.video || it.video0 || '');
  return String(it.u || '');
}
function _st_vidUrl(d) {
  if (!d) return '';
  const v = d.video;
  if (v) return typeof v === 'string' ? v : (v.url || '');
  if (d.video_url) return d.video_url;
  const a = d.videos && d.videos[0];
  if (a) return typeof a === 'string' ? a : (a.url || '');
  if (d.output) return typeof d.output === 'string' ? d.output : (d.output.url || d.output.video_url || '');
  return d.url || '';
}
function _st_clean(it) {
  const o = {};
  Object.keys(it).forEach(k => { if (k[0] !== '_' && typeof it[k] !== 'function') o[k] = it[k]; });
  try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; }
}
function _st_norm(it) {
  if (!it.kind) it.kind = it.uri && !it.video ? 'film' : (it.video || it.vst || it.task) ? 'video' : 'image';
  if (!it.created) it.created = Date.now();
  if (!it.st) it.st = it.kind === 'film' ? 'ok' : (it.u || it.video) ? 'ok' : 'er';
  if (!it.src) it.src = it.kind === 'film' ? 'film' : 'studio';
  return it;
}

/* ═════════════════════════════════════════════════════════════════════
   RÉFÉRENCES : images importées conservées une seule fois (magasin config)
   ═════════════════════════════════════════════════════════════════════ */
const _st_srefs = new Set();
function _st_refKey(r) {
  if (!r || !r.u) return '';
  if (!/^data:/i.test(r.u)) return r.u;
  const k = 'sref:' + r.id;
  if (!_st_srefs.has(r.id)) {
    _st_srefs.add(r.id);
    DB.put('config', { key: 'sref_' + r.id, v: r.u }).catch(e => { _st_srefs.delete(r.id); log('wr', 'référence non sauvegardée : ' + e.message); });
  }
  return k;
}
async function _st_resolve(k) {
  k = String(k || '');
  if (!k) return null;
  if (k.indexOf('sref:') !== 0) return k;
  const id = k.slice(5);
  const mem = _st_S.refs.find(r => r.id === id);
  if (mem) return mem.u;
  try { const r = await DB.get('config', 'sref_' + id); return (r && r.v) || null; } catch (e) { return null; }
}
function _st_gcRefs(keys) {
  (keys || []).forEach(k => {
    if (!k || String(k).indexOf('sref:') !== 0) return;
    const id = String(k).slice(5);
    if (_st_S.refs.some(r => r.id === id)) return;
    if (GAL.items.some(x => x.ref === k || (Array.isArray(x.refs) && x.refs.indexOf(k) >= 0))) return;
    _st_srefs.delete(id);
    DB.del('config', 'sref_' + id).catch(() => {});
  });
}

/* Import d'une image du téléphone : réduite à 2048 px (JPEG) + miniature légère. */
function _st_readImage(file) {
  return new Promise((resolve, reject) => {
    if (file && file.type && !/^image\//i.test(file.type)) { reject(new Error('format non pris en charge')); return; }
    let url;
    try { url = URL.createObjectURL(file); } catch (e) { reject(e); return; }
    const im = new Image();
    let done = false;
    const fin = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      im.onload = im.onerror = null;
      try { URL.revokeObjectURL(url); } catch (e) { /* déjà libérée */ }
      if (err) reject(err); else resolve(val);
    };
    const to = setTimeout(() => fin(new Error('délai dépassé')), 30000);
    im.onload = () => {
      try {
        const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
        if (!w || !h) throw new Error('image vide');
        const draw = (max, q) => {
          const s = Math.min(1, max / Math.max(w, h));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * s));
          c.height = Math.max(1, Math.round(h * s));
          const g = c.getContext('2d');
          g.fillStyle = '#fff';
          g.fillRect(0, 0, c.width, c.height);
          g.imageSmoothingEnabled = true;
          g.imageSmoothingQuality = 'high';
          g.drawImage(im, 0, 0, c.width, c.height);
          const out = { d: c.toDataURL('image/jpeg', q), w: c.width, h: c.height };
          c.width = c.height = 0;
          return out;
        };
        const big = draw(2048, 0.92);
        const small = draw(360, 0.82);
        fin(null, { u: big.d, t: small.d, w: big.w, h: big.h });
      } catch (e) { fin(e); }
    };
    im.onerror = () => fin(new Error('format non pris en charge'));
    im.src = url;
  });
}

/* ═════════════════════════════════════════════════════════════════════
   FILE D'EXPORT NATIF (un seul export à la fois, partagée Studio / Film)
   ═════════════════════════════════════════════════════════════════════ */
const _st_XQ = { chain: Promise.resolve(), n: 0 };
function _st_exportQueue(req, onEvent) {
  const emit = ev => { try { if (onEvent) onEvent(ev); } catch (e) { log('er', 'export : ' + e.message); } };
  _st_XQ.n++;
  emit({ state: 'queued', ahead: _st_XQ.n - 1 });
  const run = () => new Promise(resolve => {
    let tries = 0;
    const go = () => {
      nativeListen('exportFilm', [req], ev => {
        ev = ev || {};
        // Un export lancé ailleurs occupe l'encodeur : on patiente puis on réessaie.
        if (ev.state === 'error' && /déjà en cours/i.test(String(ev.error || '')) && tries++ < 40) {
          emit({ state: 'queued', ahead: 1 });
          setTimeout(go, 15000);
          return;
        }
        emit(ev);
        if (ev.state === 'done' || ev.state === 'error' || ev.state === 'cancelled') resolve(ev);
      });
    };
    go();
  });
  const p = _st_XQ.chain.then(run, run);
  _st_XQ.chain = p.then(() => { _st_XQ.n--; }, () => { _st_XQ.n--; });
  return p;
}

/* ═════════════════════════════════════════════════════════════════════
   RAFRAÎCHISSEMENT CIBLÉ (une tuile, la visionneuse) ET SAUVEGARDE
   ═════════════════════════════════════════════════════════════════════ */
const _st_pend = new Set();
let _st_flushT = 0;
function _st_touch(it) {
  if (!it || it._del) return;
  _st_pend.add(it);
  if (_st_flushT) return;
  _st_flushT = setTimeout(_st_flush, 60);
}
function _st_flush() {
  _st_flushT = 0;
  const list = Array.from(_st_pend);
  _st_pend.clear();
  list.forEach(it => {
    $$('[data-tile="' + it.id + '"]').forEach(el => {
      const html = _st_tile(it, el.getAttribute('data-ctx') || 'g');
      if (el._h === html) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const n = tmp.firstElementChild;
      if (!n) return;
      n._h = html;
      // Même aperçu : on garde l'image déjà décodée (pas de clignotement).
      const oi = el.querySelector(':scope > img'), ni = n.querySelector(':scope > img');
      if (oi && ni && oi.getAttribute('src') === ni.getAttribute('src')) ni.replaceWith(oi);
      el.replaceWith(n);
    });
    try { if (VIEW.id === it.id) VIEW.refresh(); } catch (e) { log('er', 'visionneuse : ' + e.message); }
  });
  if (list.some(it => it.kind === 'video' || it.st !== 'run')) _st_genHint();
}

const _st_saveT = new Map();
function _st_save(it, now) {
  if (!it || it._del) return;
  clearTimeout(_st_saveT.get(it.id));
  const put = () => {
    _st_saveT.delete(it.id);
    if (it._del) return;
    DB.put('items', _st_clean(it)).catch(e => log('er', 'sauvegarde galerie : ' + e.message));
  };
  if (now) put(); else _st_saveT.set(it.id, setTimeout(put, 300));
}

/* ═════════════════════════════════════════════════════════════════════
   TUILES (fil du Studio, galerie)
   ═════════════════════════════════════════════════════════════════════ */
function _st_tile(it, ctx) {
  const run = it.st === 'run', er = it.st === 'er';
  const tl = [], tr = [];
  const dur = it.kind !== 'image' ? _st_durOf(it) : '';
  if (it.kind === 'film') tl.push('<span class="badge bdim">Film</span>');
  if (!run && !er) {
    if (_st_is4k(it)) tl.unshift('<span class="badge b4k">4K</span>');
    else { const rl = _st_resOf(it); if (rl) tl.push('<span class="badge bdim">' + esc(rl) + '</span>'); }
  }
  if (it.kind !== 'image') tl.push('<span class="badge bdim">▶' + (dur ? ' ' + esc(dur) : '') + '</span>');
  if (it.audio && it.kind === 'video' && !run && !er) tl.push('<span class="badge baud" aria-label="Avec son">♪</span>');
  let prog = '';
  if (it.l4k && it.l4k.st === 'run') {
    tr.push('<span class="badge bwr">4K · ' + (it.l4k.p > 0 ? it.l4k.p + ' %' : 'file') + '</span>');
    prog = '<div class="prog"><i style="width:' + clamp(+it.l4k.p || 2, 2, 100) + '%"></i></div>';
  } else if (it.upv && it.upv.st === 'run') {
    tr.push('<span class="badge bwr">Topaz 4K…</span>');
  }
  if (run) tr.push('<span class="badge bdim" aria-label="En cours">⏳</span>');
  else if (er) tr.push('<span class="badge ber">Échec</span>');
  else if (it.seen === false) tr.push('<span class="badge bok">Nouveau</span>');

  let ov = '';
  if (run) {
    ov = '<div class="ov"><div class="row" style="gap:7px;flex-wrap:nowrap"><i class="spin"></i><span>' + esc(it.msg || 'génération…') + '</span></div></div>';
  } else if (er) {
    ov = '<div class="ov stack" style="gap:8px"><span style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">' + esc(it.err || 'Échec de la génération') + '</span>' +
      '<button type="button" class="btn sm" data-a="sretry" data-id="' + esc(it.id) + '">↻ Réessayer</button></div>';
  } else if (ctx === 'f' || it.kind === 'film') {
    const txt = _st_title(it);
    ov = '<div class="ov"><span style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc(txt) + '</span></div>';
  }
  let pic;
  if (it.t) pic = '<img src="' + esc(it.t) + '" alt="" loading="lazy" decoding="async" draggable="false">';
  else if (run) pic = '<i class="spin lg"></i>';
  else pic = '<span class="sub" style="padding:24px 10px">' + (it.kind === 'film' ? 'Film 4K' : 'Aperçu indisponible') + '</span>';
  const kindTxt = it.kind === 'film' ? 'Film' : it.kind === 'video' ? 'Vidéo' : 'Image';
  return '<div class="media' + (run ? ' run' : '') + '" role="button" tabindex="0" data-a="' + (ctx === 'f' ? 'sopen' : 'gopen') + '" data-id="' + esc(it.id) +
    '" data-tile="' + esc(it.id) + '" data-ctx="' + ctx + '" style="aspect-ratio:' + _st_ar(it) + (it.t ? '' : ';min-height:120px') + '" aria-label="' +
    esc(kindTxt + ' : ' + _st_title(it).slice(0, 90)) + '">' + pic +
    (tl.length ? '<div class="tl">' + tl.join('') + '</div>' : '') +
    (tr.length ? '<div class="tr">' + tr.join('') + '</div>' : '') + ov + prog + '</div>';
}

/* ═════════════════════════════════════════════════════════════════════
   GALERIE
   ═════════════════════════════════════════════════════════════════════ */
const GAL = (() => {
  const items = [];
  const G = { f: 'all', n: 60 };
  try { const f = localStorage.getItem('cg_gal_f'); if (['all', 'image', 'video', 'film'].indexOf(f) >= 0) G.f = f; } catch (e) { /* stockage indisponible */ }

  const match = (it, f) => f === 'all' || it.kind === f;
  const list = () => items.filter(it => match(it, G.f));

  async function load() {
    let all = [];
    try { all = await DB.all('items'); } catch (e) { log('er', 'galerie : ' + e.message); }
    const seen = new Set();
    const ok = (all || []).filter(x => x && x.id && !seen.has(x.id) && seen.add(x.id)).map(_st_norm);
    ok.sort((a, b) => (b.created || 0) - (a.created || 0));
    items.length = 0;
    ok.forEach(x => items.push(x));
    return items;
  }

  function get(id) { return items.find(x => x.id === id) || null; }

  function add(it) {
    if (!it) return null;
    if (!it.id) it.id = _st_newId(it.kind === 'film' ? 'f' : 's');
    _st_norm(it);
    const old = get(it.id);
    if (old) { if (old !== it) Object.assign(old, it); update(old); return old; }
    let i = 0;
    while (i < items.length && (items[i].created || 0) > it.created) i++;
    items.splice(i, 0, it);
    _st_save(it, true);
    if (_st_isOn('gallery')) render();
    if (it.src === 'studio' && _st_isOn('studio')) _st_renderFeed();
    return it;
  }

  function update(it) {
    if (!it || it._del) return;
    if (!get(it.id)) { add(it); return; }
    _st_touch(it);
    _st_save(it);
  }

  async function remove(id) {
    const i = items.findIndex(x => x.id === id);
    if (i < 0) return false;
    const it = items[i];
    it._del = true;
    items.splice(i, 1);
    clearTimeout(_st_saveT.get(id));
    _st_saveT.delete(id);
    clearTimeout(_st_timers.get(id));
    _st_timers.delete(id);
    try { await DB.del('items', id); } catch (e) { log('er', 'suppression : ' + e.message); }
    _st_gcRefs([it.ref].concat(Array.isArray(it.refs) ? it.refs : []));
    try { if (VIEW.id === id) VIEW.close(); } catch (e) { /* visionneuse absente */ }
    if (_st_isOn('gallery')) render();
    if (_st_isOn('studio')) _st_renderFeed();
    return true;
  }

  function filterSeg() {
    const n = f => items.filter(it => match(it, f)).length;
    const F = [['all', 'Tout'], ['image', 'Images'], ['video', 'Vidéos'], ['film', 'Films 4K']];
    return '<div class="seg" role="tablist" aria-label="Filtrer la galerie">' + F.map(([k, l]) =>
      '<button type="button" role="tab" data-a="gfilter" data-f="' + k + '" class="' + (G.f === k ? 'on' : '') + '" aria-selected="' + (G.f === k) + '">' +
      l + ' <span style="opacity:.6;font-weight:500">' + n(k) + '</span></button>').join('') + '</div>';
  }

  function render() {
    const root = document.getElementById('scr-gallery');
    if (!root) return;
    const L = list();
    const n4k = items.filter(_st_is4k).length;
    const nrun = items.filter(x => x.st === 'run').length;
    let body;
    if (!items.length) {
      body = '<div class="hero stack" style="text-align:center;align-items:center">' +
        '<div class="h2">Votre galerie est vide</div>' +
        '<p class="sub">Vos images 4K, vos vidéos et vos films exportés apparaîtront ici, prêts à être enregistrés ou partagés.</p>' +
        '<button type="button" class="btn pri" data-a="tab" data-tab="studio">✦ Créer ma première image</button></div>';
    } else if (!L.length) {
      body = '<div class="card sub" style="text-align:center;padding:28px 16px">Aucune création dans cette catégorie pour l’instant.</div>';
    } else {
      const shown = L.slice(0, G.n);
      body = '<div class="masonry" id="glGrid">' + shown.map(it => _st_tile(it, 'g')).join('') + '</div>' +
        (L.length > shown.length ? '<button type="button" class="btn ghost" data-a="gmore" style="align-self:center">Afficher plus (' + (L.length - shown.length) + ')</button>' : '');
    }
    root.innerHTML = '<div class="wrap stack">' +
      '<div class="row" style="align-items:flex-end"><div class="col" style="gap:2px"><h1 class="h1">Galerie</h1>' +
      '<p class="sub">' + items.length + ' création' + (items.length > 1 ? 's' : '') + (n4k ? ' · ' + n4k + ' en 4K' : '') + (nrun ? ' · ' + nrun + ' en cours' : '') + '</p></div>' +
      '<span class="sp"></span><button type="button" class="btn sm" data-a="tab" data-tab="studio">＋ Créer</button></div>' +
      (items.length ? filterSeg() : '') + body + '</div>';
  }

  ACT.gfilter = el => {
    G.f = el.dataset.f || 'all';
    G.n = 60;
    try { localStorage.setItem('cg_gal_f', G.f); } catch (e) { /* stockage indisponible */ }
    haptic('tap');
    render();
  };
  ACT.gmore = () => { G.n += 60; render(); };
  ACT.gopen = el => VIEW.open(el.dataset.id, list().map(x => x.id));

  return { items, load, get, add, update, remove, render, save: _st_save };
})();

/* ═════════════════════════════════════════════════════════════════════
   STUDIO — état du formulaire (brouillon persistant)
   ═════════════════════════════════════════════════════════════════════ */
const _st_S = {
  mode: 'image', prompt: '', prev: null, refs: [], style: '', imodel: '', vmodel: '',
  ratioI: '16:9', ratioV: '16:9', count: 1, dur: 0, audio: null, line: '',
  magic: false, loading: 0, loaded: false, loadP: null, touched: false,
};
const _st_timers = new Map();

let _st_draftT = 0;
function _st_draft() {
  clearTimeout(_st_draftT);
  _st_draftT = setTimeout(() => {
    const S = _st_S;
    const v = {
      mode: S.mode, prompt: S.prompt, style: S.style, imodel: S.imodel, vmodel: S.vmodel, ratioI: S.ratioI, ratioV: S.ratioV,
      count: S.count, dur: S.dur, audio: S.audio, line: S.line, refs: S.refs.map(r => ({ id: r.id, u: r.u, t: r.t, w: r.w || 0, h: r.h || 0, gid: r.gid || '' })),
    };
    DB.put('config', { key: 'studio', v }).catch(e => log('wr', 'brouillon du Studio : ' + e.message));
  }, 600);
}
function _st_ensureDraft() {
  if (_st_S.loadP) return _st_S.loadP;
  _st_S.loadP = (async () => {
    try {
      const r = await DB.get('config', 'studio');
      const v = r && r.v;
      if (v && typeof v === 'object' && !_st_S.touched) {
        const S = _st_S;
        if (v.mode === 'video' || v.mode === 'image') S.mode = v.mode;
        if (typeof v.prompt === 'string') S.prompt = v.prompt;
        if (typeof v.style === 'string' && (!v.style || STYLES.some(s => s.id === v.style))) S.style = v.style;
        if (IMODELS[v.imodel]) S.imodel = v.imodel;
        if (VMODELS[v.vmodel]) S.vmodel = v.vmodel;
        if (_st_IR.indexOf(v.ratioI) >= 0) S.ratioI = v.ratioI;
        if (_st_VR.indexOf(v.ratioV) >= 0) S.ratioV = v.ratioV;
        if ([1, 2, 4].indexOf(+v.count) >= 0) S.count = +v.count;
        if (+v.dur > 0) S.dur = +v.dur;
        if (typeof v.audio === 'boolean') S.audio = v.audio;
        if (typeof v.line === 'string') S.line = v.line;
        if (Array.isArray(v.refs)) S.refs = v.refs.filter(x => x && x.u && x.id).slice(0, 4);
      }
    } catch (e) { log('wr', 'brouillon du Studio : ' + e.message); }
    _st_S.loaded = true;
  })();
  return _st_S.loadP;
}

/* ═════════════════════════════════════════════════════════════════════
   STUDIO — prompts, coûts, rendu
   ═════════════════════════════════════════════════════════════════════ */
const _st_style = id => STYLES.find(s => s.id === id) || null;
function _st_imgPrompt(p, styleId) {
  const st = _st_style(styleId);
  return san(String(p || '').trim()).replace(/[\s.,;]+$/, '') + (st ? ', ' + st.p : '');
}
function _st_framePrompt(p, styleId) {
  return _st_imgPrompt(p, styleId) + ', cinematic opening frame of the shot, subject clearly visible, no text, no watermark';
}
function _st_vidPrompt(p, styleId, line, audio) {
  const st = _st_style(styleId);
  let s = san(String(p || '').trim()).replace(/[\s.]+$/, '') + '.';
  if (st) s += ' Visual style: ' + st.p + '.';
  if (line) s += ' The character says in French, lips in sync: "' + san(line).replace(/"/g, '\'').trim() + '".';
  s += ' Cinematic 4K quality, smooth natural motion, coherent physics' + (audio ? ', realistic synchronized sound' : '') +
    '. No subtitles, no on-screen text, no watermark. Keep the identity, outfit and visual style of the first frame identical throughout.';
  return s;
}

const _st_order = cat => Object.keys(cat).sort((a, b) => (cat[a].prov === 'fal' ? 0 : 1) - (cat[b].prov === 'fal' ? 0 : 1));
const _st_provOk = p => (p === 'fal' ? hasFal() : p === 'agnes' ? hasAgnes() : false);
function _st_vm() { return pickVideo(_st_S.vmodel); }
function _st_im() { return pickImage(_st_S.imodel); }
function _st_durFor(vm) {
  const ds = (VMODELS[vm] && VMODELS[vm].durs) || [5];
  const d = +_st_S.dur || ds[0];
  return ds.reduce((b, x) => (Math.abs(x - d) < Math.abs(b - d) ? x : b), ds[0]);
}

function _st_cost() {
  const S = _st_S;
  if (S.mode === 'image') {
    const m = _st_im();
    if (!m) return null;
    const c = IMODELS[m];
    const res = m === 'seedream' ? _st_SEED[S.ratioI] : m === 'nanopro' ? '4K' : (CFG.agnes.imgSize || '4K');
    const sum = (S.count > 1 ? S.count + ' × ' : '') + c.name + ' · ' + res + ' · ' + S.ratioI + (S.refs.length ? ' · ' + S.refs.length + ' réf.' : '');
    if (c.prov === 'agnes') return { txt: 'inclus', sum };
    return { txt: c.usd != null ? fmtUSD(c.usd * S.count) : 'tarif fal.ai', sum };
  }
  const vm = _st_vm();
  if (!vm) return null;
  const c = VMODELS[vm];
  const d = _st_durFor(vm);
  let usd = estimateVideoUSD(vm, d);
  const im = S.refs.length ? null : _st_im();
  if (im && IMODELS[im].prov === 'fal') usd = usd == null || IMODELS[im].usd == null ? null : usd + IMODELS[im].usd;
  const topaz = !c.native && CFG.up4k !== false && hasFal();
  const local = !c.native && !topaz && CFG.local4k !== false && IS_APP;
  const audio = c.audio ? _st_S.audio !== false : false;
  const res = c.native ? '2160p natif' : topaz ? 'upscale Topaz 4K' : local ? '4K sur le téléphone' : (c.tag || '');
  const sum = c.name + ' · ' + d + ' s · ' + S.ratioV + ' · ' + res + (audio ? ' · son' : '');
  let txt = usd == null ? 'tarif fal.ai' : usd === 0 ? 'inclus' : fmtUSD(usd);
  if (topaz) txt += ' + Topaz';
  return { txt, sum };
}

function _st_onboardHtml() {
  return '<section class="hero stack" aria-label="Bienvenue">' +
    '<span class="lab">Bienvenue</span>' +
    '<div class="h2">Branchez un moteur pour créer en <span class="gt">4K</span></div>' +
    '<p class="sub">CINÉ-GENESIS utilise vos propres clés : vous payez uniquement ce que vous générez, sans abonnement.</p>' +
    '<div class="card stack" style="gap:8px">' +
      '<div class="row"><b class="h3">fal.ai</b><span class="badge b4k">4K</span><span class="badge bok">Recommandé</span></div>' +
      '<p class="sub">Kling 3.0 en 4K natif, LTX-2.3 2160p, Seedream 4.5, Nano Banana Pro, Veo 3.1 et l’upscale Topaz : la meilleure qualité, payée à l’usage.</p>' +
      '<div class="row"><button type="button" class="btn pri sm" data-a="sfalkey">Obtenir une clé fal.ai ↗</button>' +
      '<button type="button" class="btn sm" data-a="tab" data-tab="settings">Saisir ma clé</button></div>' +
    '</div>' +
    '<div class="card stack" style="gap:8px">' +
      '<div class="row"><b class="h3">Agnès</b><span class="badge bdim">Option</span></div>' +
      '<p class="sub">Réutilisez les clés de l’application d’origine : images jusqu’à 4K, vidéos 1080p converties en 4K sur votre téléphone.</p>' +
      '<div class="row"><button type="button" class="btn sm" data-a="tab" data-tab="settings">Ajouter des clés Agnès</button></div>' +
    '</div>' +
  '</section>';
}

function _st_heroHtml() {
  const S = _st_S;
  return '<section class="hero stack" aria-label="Créer">' +
    '<span class="lab">Studio IA · images &amp; vidéos</span>' +
    '<h1 class="h1">Créez en <span class="gt">4K</span></h1>' +
    '<p class="sub">Photos jusqu’à 4096 px, vidéos 2160p avec son : décrivez, choisissez un modèle, générez.</p>' +
    '<div class="seg" role="tablist" aria-label="Type de création">' +
      '<button type="button" role="tab" data-a="smode" data-m="image" class="' + (S.mode === 'image' ? 'on' : '') + '" aria-selected="' + (S.mode === 'image') + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/></svg>Image</button>' +
      '<button type="button" role="tab" data-a="smode" data-m="video" class="' + (S.mode === 'video' ? 'on' : '') + '" aria-selected="' + (S.mode === 'video') + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="14" height="14" rx="3"/><path d="M16.5 10l5-3v10l-5-3z"/></svg>Vidéo</button>' +
    '</div>' +
  '</section>';
}

function _st_promptHtml() {
  const S = _st_S;
  const ph = S.mode === 'video'
    ? 'Ex. : une louve traverse une forêt enneigée au lever du soleil, la caméra la suit en travelling lent…'
    : 'Ex. : portrait d’une danseuse de flamenco sous une pluie de pétales, lumière dorée, profondeur de champ…';
  return '<div class="card stack" id="stPromptCard">' +
    '<label class="field"><span class="lab">Votre idée</span>' +
    '<textarea id="stPrompt" rows="4" maxlength="2500" placeholder="' + esc(ph) + '" aria-label="Décrivez votre création">' + esc(S.prompt) + '</textarea></label>' +
    '<div class="row" id="stPBar">' + _st_pbarHtml() + '</div></div>';
}
function _st_pbarHtml() {
  const S = _st_S;
  return '<button type="button" class="btn sm" data-a="smagic" id="stMagic"' + (S.magic ? ' disabled' : '') + '>' +
    (S.magic ? '<i class="spin"></i> Amélioration…' : '<span class="gt" style="font-weight:800">✦</span> Prompt magique') + '</button>' +
    (S.prev != null ? '<button type="button" class="btn sm ghost" data-a="sundo">↶ Version précédente</button>' : '') +
    '<span class="sp"></span>' +
    (S.prompt ? '<button type="button" class="btn sm ghost" data-a="sclear">Effacer</button>' : '');
}

function _st_refsHtml() {
  const S = _st_S;
  const vid = S.mode === 'video';
  const tiles = S.refs.map((r, i) =>
    '<div class="media" style="width:86px;aspect-ratio:1">' +
      '<img src="' + esc(r.t || r.u) + '" alt="Référence ' + (i + 1) + '" decoding="async" draggable="false">' +
      (vid && i === 0 ? '<div class="ov" style="padding:18px 6px 5px;font-size:11px;font-weight:700">Départ</div>' : '') +
      '<div class="tr" style="top:4px;right:4px"><button type="button" class="btn icon sm" data-a="srefdel" data-i="' + i + '" aria-label="Retirer la référence ' + (i + 1) + '" ' +
      'style="width:30px;height:30px;min-height:30px;padding:0;border-radius:10px;background:rgba(0,0,0,.66);font-size:13px">✕</button></div>' +
    '</div>').join('');
  const loading = Array.from({ length: S.loading }, () => '<div class="media run" style="width:86px;aspect-ratio:1"><i class="spin"></i></div>').join('');
  const full = S.refs.length + S.loading >= 4;
  const add = full ? '' :
    '<label class="btn" style="width:86px;height:86px;flex-direction:column;gap:4px;padding:6px;font-size:12px" aria-label="Importer des images">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>' +
      '<span>Importer</span><input type="file" id="stFile" accept="image/*" multiple></label>' +
    '<button type="button" class="btn" data-a="sgalref" style="width:86px;height:86px;flex-direction:column;gap:4px;padding:6px;font-size:12px" aria-label="Choisir dans la galerie">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></svg>' +
      '<span>Galerie</span></button>';
  let hint;
  if (vid) {
    const im = _st_im();
    hint = S.refs.length
      ? 'La première référence sert d’image de départ de la vidéo.'
      : 'Sans référence, une image de départ 4K est d’abord créée' + (im ? ' avec ' + esc(IMODELS[im].name) : '') + ', puis animée.';
  } else {
    hint = S.refs.length ? 'Le modèle s’inspire de ces images (visage, produit, style, décor).' : 'Optionnel : jusqu’à 4 images pour guider le visage, le produit ou le style.';
  }
  return '<div class="row"><span class="lab" style="margin:0">Références</span><span class="badge bdim">' + S.refs.length + '/4</span></div>' +
    '<p class="sub" style="font-size:13px;margin:0">' + hint + '</p>' +
    '<div class="hscroll" data-hs="refs">' + tiles + loading + add + '</div>';
}

function _st_modelCard(id, kind, sel) {
  const c = kind === 'video' ? VMODELS[id] : IMODELS[id];
  const ok = _st_provOk(c.prov);
  const b = [];
  b.push('<span class="badge ' + (/4K/.test(c.tag || '') ? 'b4k' : 'bdim') + '">' + esc(c.tag || '') + '</span>');
  if (kind === 'video' && c.audio) b.push('<span class="badge baud">Son</span>');
  if (c.prov === 'agnes') b.push('<span class="badge bdim">Inclus</span>');
  else if (kind === 'video') {
    const d = (() => { const ds = c.durs || [5]; const x = +_st_S.dur || ds[0]; return ds.reduce((p, y) => (Math.abs(y - x) < Math.abs(p - x) ? y : p), ds[0]); })();
    const e = estimateVideoUSD(id, d);
    b.push('<span class="badge bdim">' + (e != null ? esc(fmtUSD(e)) + ' · ' + d + ' s' : 'Tarif fal.ai') + '</span>');
  } else {
    b.push('<span class="badge bdim">' + (c.usd != null ? esc(fmtUSD(c.usd)) + ' / image' : 'Tarif fal.ai') + '</span>');
  }
  const hint = ok ? '' : '<span class="sub" style="color:var(--wr);font-size:12px">' + (c.prov === 'fal' ? 'Clé fal.ai requise' : 'Clés Agnès requises') + '</span>';
  return '<button type="button" class="mcard' + (sel ? ' on' : '') + (ok ? '' : ' dis') + '" data-a="smodel" data-k="' + kind + '" data-id="' + id + '" aria-pressed="' + !!sel + '">' +
    '<span class="mname">' + esc(c.name) + '</span>' +
    '<span class="mdesc">' + esc(c.desc || '') + '</span>' + hint +
    '<span class="mbadges">' + b.join('') + '</span></button>';
}

function _st_optsHtml() {
  const S = _st_S;
  const vid = S.mode === 'video';
  const cat = vid ? VMODELS : IMODELS;
  const cur = vid ? (_st_vm() || S.vmodel || 'kling4k') : (_st_im() || S.imodel || 'seedream');
  const pill = (a, attr, val, on, label) => '<button type="button" class="pill' + (on ? ' on' : '') + '" data-a="' + a + '" data-' + attr + '="' + esc(val) + '" aria-pressed="' + !!on + '">' + label + '</button>';
  let h = '<div class="stack" style="gap:8px"><span class="lab">Style</span><div class="hscroll" data-hs="style">' +
    pill('sstyle', 'id', '', !S.style, 'Libre') +
    STYLES.map(s => pill('sstyle', 'id', s.id, S.style === s.id, esc(s.name))).join('') + '</div></div>';
  h += '<div class="stack" style="gap:8px"><span class="lab">Modèle ' + (vid ? 'vidéo' : 'd’image') + '</span><div class="hscroll" data-hs="model">' +
    _st_order(cat).map(id => _st_modelCard(id, vid ? 'video' : 'image', id === cur)).join('') + '</div></div>';
  const ratios = vid ? _st_VR : _st_IR;
  const rcur = vid ? S.ratioV : S.ratioI;
  h += '<div class="stack" style="gap:8px"><span class="lab">Format</span><div class="row">' +
    ratios.map(r => pill('sratio', 'r', r, r === rcur, r)).join('') + '</div></div>';
  if (!vid) {
    h += '<div class="stack" style="gap:8px"><span class="lab">Nombre d’images</span><div class="row">' +
      [1, 2, 4].map(n => pill('scount', 'n', n, S.count === n, String(n))).join('') + '</div></div>';
  } else {
    const vm = _st_vm() || cur;
    const c = VMODELS[vm] || VMODELS.kling4k;
    const d = _st_durFor(vm);
    h += '<div class="stack" style="gap:8px"><span class="lab">Durée</span><div class="row">' +
      (c.durs || [5]).map(x => pill('sdur', 'd', x, x === d, x + ' s')).join('') + '</div></div>';
    if (c.audio) {
      const on = S.audio !== false;
      h += '<label class="switch"><input type="checkbox" id="stAudio"' + (on ? ' checked' : '') + '><i></i><span>Son natif<small>Ambiance, bruitages et voix générés avec la vidéo</small></span></label>';
      if (on) {
        h += '<label class="field"><span class="lab">Réplique parlée (français, optionnel)</span>' +
          '<input type="text" id="stLine" maxlength="220" value="' + esc(S.line) + '" placeholder="Ex. : « On n’a plus beaucoup de temps. »" autocomplete="off"></label>';
      }
    } else {
      h += '<p class="sub" style="font-size:13px;margin:0">Ce modèle ne génère pas de son.</p>';
    }
    if (!c.native) {
      if (CFG.up4k !== false && hasFal()) h += '<div class="note">Rendu ' + esc(String(c.tag || '').split('→')[0].trim() || 'HD') + ', puis <b>upscale Topaz en 4K</b> automatique.</div>';
      else if (CFG.local4k !== false && IS_APP) h += '<div class="note">Rendu HD, puis <b>conversion 4K sur votre téléphone</b> (enregistrée dans la galerie).</div>';
      else if (CFG.local4k !== false) h += '<div class="note wr">La conversion 4K sur le téléphone n’est disponible que dans l’application Android ; ajoutez une clé fal.ai pour l’upscale Topaz.</div>';
      else h += '<div class="note wr">Cette vidéo restera en HD : activez l’upscale Topaz (clé fal.ai) ou la conversion 4K sur le téléphone dans Réglages.</div>';
    }
  }
  return h;
}

function _st_genHtml() {
  const any = hasFal() || hasAgnes();
  const c = _st_cost();
  const vid = _st_S.mode === 'video';
  return '<button type="button" class="btn pri xl" data-a="sgen" id="stGen"' + (any && c ? '' : ' disabled') + '>' +
    '<span>✦ Générer ' + (vid ? 'la vidéo' : _st_S.count > 1 ? 'les images' : 'l’image') + '</span>' +
    (c ? '<small style="font-weight:600;color:#fff;-webkit-text-fill-color:#fff;opacity:.85;margin-left:8px">' + esc(c.txt) + '</small>' : '') + '</button>' +
    '<p class="sub" id="stGenHint" style="text-align:center;font-size:12.5px;margin:0">' + _st_genHintTxt(c, any) + '</p>';
}
function _st_genHintTxt(c, any) {
  if (!any) return 'Ajoutez une clé fal.ai ou Agnès dans Réglages pour générer.';
  if (!c) return 'Aucun modèle disponible pour ce type de création.';
  const run = GAL.items.filter(x => x.src === 'studio' && x.st === 'run').length;
  return esc(c.sum) + (run ? ' · ' + run + ' en cours' : '');
}
function _st_genHint() {
  const el = document.getElementById('stGenHint');
  if (el) el.innerHTML = _st_genHintTxt(_st_cost(), hasFal() || hasAgnes());
}

function _st_feedHtml() {
  const L = GAL.items.filter(x => x.src === 'studio').slice(0, 12);
  return '<div class="row"><h2 class="h2">Créations récentes</h2><span class="sp"></span>' +
    (GAL.items.length ? '<button type="button" class="btn sm ghost" data-a="sall">Tout voir →</button>' : '') + '</div>' +
    (L.length
      ? '<div class="masonry" id="stFeed">' + L.map(it => _st_tile(it, 'f')).join('') + '</div>'
      : '<div class="card sub" style="text-align:center;padding:26px 16px">Vos créations apparaîtront ici, en direct pendant leur génération.</div>');
}
function _st_renderFeed() {
  const box = document.getElementById('stFeedBox');
  if (box) box.innerHTML = _st_feedHtml();
  _st_genHint();
}

/* Re-rend le formulaire sans toucher au fil (les tuiles gardent leurs images décodées). */
function _st_renderForm() {
  const box = document.getElementById('stForm');
  if (!box) { STUDIO.render(); return; }
  const keep = {};
  $$('[data-hs]', box).forEach(el => { keep[el.getAttribute('data-hs')] = el.scrollLeft; });
  const ta = document.getElementById('stPrompt');
  const focus = ta && document.activeElement === ta ? [ta.selectionStart, ta.selectionEnd] : null;
  box.innerHTML = _st_formHtml();
  $$('[data-hs]', box).forEach(el => { const k = el.getAttribute('data-hs'); if (keep[k]) el.scrollLeft = keep[k]; });
  if (focus) { const t = document.getElementById('stPrompt'); if (t) { try { t.focus({ preventScroll: true }); t.setSelectionRange(focus[0], focus[1]); } catch (e) { /* focus refusé */ } } }
}
function _st_formHtml() {
  const any = hasFal() || hasAgnes();
  return (any ? '' : _st_onboardHtml()) + _st_heroHtml() + _st_promptHtml() +
    '<div class="card stack" id="stRefs">' + _st_refsHtml() + '</div>' +
    '<div class="card stack" id="stOpts">' + _st_optsHtml() + '</div>' +
    '<div class="stack" style="gap:8px" id="stGenBox">' + _st_genHtml() + '</div>';
}
function _st_renderRefs() {
  const el = document.getElementById('stRefs');
  if (el) el.innerHTML = _st_refsHtml(); else _st_renderForm();
}

/* ═════════════════════════════════════════════════════════════════════
   STUDIO — générations
   ═════════════════════════════════════════════════════════════════════ */
function _st_sync(it) {
  if (it.kind !== 'video' || it.phase === 'frame' || !it.vst) return;
  it.st = it.vst === 'ok' ? 'ok' : it.vst === 'er' ? 'er' : 'run';
  if (it.vst === 'wait' && !it.msg) it.msg = 'en attente…';
}

async function _st_runImage(it) {
  it.st = 'run'; it.err = ''; it.msg = 'envoi…';
  GAL.update(it);
  try {
    const refs = (await Promise.all((it.refs || []).map(_st_resolve))).filter(Boolean);
    const r = await genImage({
      prompt: _st_imgPrompt(it.prompt, it.style), refs, ratio: it.ratio, model: it.model, kind: 'studio',
      onMsg: m => { if (it._del) return; it.msg = m; _st_touch(it); },
      isStopped: () => !!it._del,
    });
    if (it._del) return;
    Object.assign(it, { u: r.u, t: r.t || r.u, w: r.w, h: r.h, model: r.m, st: 'ok', msg: '', err: '', seen: false, done: Date.now() });
    const lab = _st_imgRes(r.w, r.h);
    log('ok', 'image prête · ' + _st_mname(r.m) + (r.w ? ' · ' + r.w + '×' + r.h : ''));
    toast('Image prête' + (lab ? ' · ' + lab : ''), 'ok');
  } catch (e) {
    if (it._del) return;
    it.st = 'er'; it.msg = ''; it.err = _st_msg(e);
    log('er', 'image : ' + it.err);
    if (e && e.fatal) toast(it.err, 'er');
  }
  GAL.update(it);
}

async function _st_upscaleImage(src) {
  if (!src || !src.u) return;
  if (!hasFal()) { toast('L’upscale 4K des images nécessite une clé fal.ai (Réglages)', 'wr'); return; }
  const it = {
    id: _st_newId('s'), kind: 'image', src: 'studio', prompt: src.prompt || '', style: src.style || '', model: 'topaz', ratio: src.ratio || '',
    created: Date.now(), st: 'run', msg: 'upscale 4K…', err: '', u: '', t: src.t || '', w: src.w || 0, h: src.h || 0, from: src.id, refs: [],
  };
  GAL.add(it);
  toast('Upscale 4K lancé', 'ok');
  await _st_doUpscale(it, src);
}
async function _st_doUpscale(it, src) {
  it.st = 'run'; it.err = ''; it.msg = 'upscale 4K…';
  GAL.update(it);
  try {
    const r = await upscaleImage(src.u, { w: src.w, h: src.h, onMsg: m => { if (it._del) return; it.msg = 'upscale 4K · ' + m; _st_touch(it); }, isStopped: () => !!it._del });
    if (it._del) return;
    Object.assign(it, { u: r.u, t: r.t || src.t || r.u, w: r.w || 0, h: r.h || 0, st: 'ok', msg: '', err: '', seen: false, done: Date.now() });
    log('ok', 'upscale 4K prêt' + (r.w ? ' · ' + r.w + '×' + r.h : ''));
    toast('Image 4K prête', 'ok');
  } catch (e) {
    if (it._del) return;
    it.st = 'er'; it.msg = ''; it.err = 'Upscale 4K : ' + _st_msg(e);
    log('er', it.err);
  }
  GAL.update(it);
}

const _st_vupd = it => save => {
  if (it._del) return;
  _st_sync(it);
  if (save) GAL.update(it); else _st_touch(it);
  if (it.vst === 'ok') _st_autoL4k(it);
};

async function _st_runVideo(it) {
  it.st = 'run'; it.err = ''; it.tries = 0;
  if (!it.ref) {
    it.phase = 'frame'; it.vst = ''; it.msg = 'image de départ 4K…';
    GAL.update(it);
    try {
      const r = await genImage({
        prompt: _st_framePrompt(it.prompt, it.style), refs: [], ratio: it.ratio, model: it.imodel, kind: 'image de départ',
        onMsg: m => { if (it._del) return; it.msg = 'image de départ · ' + m; _st_touch(it); },
        isStopped: () => !!it._del,
      });
      if (it._del) return;
      it.ref = r.u; it.t = r.t || r.u; it.fw = r.w; it.fh = r.h; it.imodel = r.m;
      log('ok', 'image de départ prête · ' + _st_mname(r.m));
    } catch (e) {
      if (it._del) return;
      it.phase = ''; it.st = 'er'; it.vst = 'er'; it.msg = '';
      it.err = 'Image de départ : ' + _st_msg(e);
      log('er', it.err);
      GAL.update(it);
      return;
    }
  }
  it.phase = 'video';
  await _st_launch(it);
}

async function _st_launch(it) {
  if (it._del) return;
  clearTimeout(_st_timers.get(it.id));
  _st_timers.delete(it.id);
  if (!it.ref) { await _st_runVideo(it); return; }
  it.phase = 'video'; it.st = 'run'; it.msg = 'envoi…';
  _st_touch(it);
  const img = await _st_resolve(it.ref);
  if (it._del) return;
  if (!img) {
    it.st = 'er'; it.vst = 'er'; it.msg = ''; it.err = 'Image de départ introuvable : relancez la création';
    GAL.update(it);
    return;
  }
  if (!it.t) { try { it.t = await thumb(img); } catch (e) { /* aperçu facultatif */ } }
  const sp = it.spec || {};
  let r;
  try {
    r = await startVideo(it, { model: sp.model || it.model, prompt: sp.prompt || it.prompt, image: img, dur: sp.dur || it.dur, ratio: it.ratio, audio: sp.audio }, _st_vupd(it));
  } catch (e) {
    r = 'err';
    it.vst = 'er'; it.err = _st_msg(e);
  }
  if (it._del) return;
  if (it.vm && VMODELS[it.vm]) it.model = it.vm;
  if (r === 'full' || r === 'later') _st_backoff(it, r);
  else if (r === 'ok') it.tries = 0;
  _st_sync(it);
  GAL.update(it);
}

function _st_backoff(it, why) {
  it.tries = (+it.tries || 0) + 1;
  if (it.tries > _st_LAD.length) {
    it.vst = 'er'; it.st = 'er'; it.msg = '';
    it.err = 'Serveurs saturés depuis longtemps : réessayez plus tard';
    GAL.update(it);
    return;
  }
  const min = _st_LAD[it.tries - 1];
  it.retryAt = Date.now() + min * 60000;
  it.vst = 'wait'; it.st = 'run';
  it.msg = (why === 'full' ? 'serveurs saturés' : 'nouvel essai prévu') + ' · reprise à ' + _st_hhmm(it.retryAt);
  log('wr', 'vidéo en attente (' + why + ') → nouvel essai dans ' + min + ' min');
  _st_sched(it);
}
function _st_sched(it) {
  clearTimeout(_st_timers.get(it.id));
  const d = Math.max(1500, (+it.retryAt || 0) - Date.now());
  _st_timers.set(it.id, setTimeout(() => {
    _st_timers.delete(it.id);
    if (!it._del && it.vst === 'wait') _st_launch(it);
  }, d));
}

/* Taille 4K de sortie selon le format de la vidéo */
function _st_size4k(it) {
  let r = it.ratio;
  if (_st_VR.indexOf(r) < 0) {
    const d = _st_dims(it);
    r = d.w && d.h ? (d.w > d.h * 1.2 ? '16:9' : d.h > d.w * 1.2 ? '9:16' : '1:1') : '16:9';
  }
  return r === '9:16' ? [2160, 3840] : r === '1:1' ? [2160, 2160] : [3840, 2160];
}

/* Filet 4K local : export natif d'un seul clip (file partagée, un export à la fois). */
const _st_l4kQ = new Set();
function _st_autoL4k(it) {
  if (!IS_APP || CFG.local4k === false) return;
  if (!it || it.kind !== 'video' || it.vst !== 'ok' || !it.video || it.u4k || _st_is4k(it)) return;
  if (it.upv && it.upv.st === 'run') return;
  if (it.l4k && it.l4k.st !== 'run') return;
  _st_local4k(it, false);
}
function _st_local4k(it, force) {
  if (!it || it.kind !== 'video' || !it.video) { if (force) toast('Vidéo indisponible pour l’instant', 'wr'); return Promise.resolve(false); }
  if (!IS_APP) { if (force) toast('Disponible dans l’application Android', 'wr'); return Promise.resolve(false); }
  if (_st_l4kQ.has(it.id)) { if (force) toast('Export 4K déjà en file d’attente'); return Promise.resolve(false); }
  _st_l4kQ.add(it.id);
  const sz = _st_size4k(it);
  const sharp = clamp(+((CFG.exp && CFG.exp.sharpen) != null ? CFG.exp.sharpen : 35) / 100, 0, 1);
  const req = {
    clips: [it.video], width: sz[0], height: sz[1],
    codec: (CFG.exp && CFG.exp.codec) || 'auto', mbps: (CFG.exp && CFG.exp.mbps) || 60, sharpen: sharp,
    name: 'CineGenesis 4K ' + san(String(it.prompt || it.id)).replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().slice(0, 36),
  };
  it.l4k = { st: 'run', ph: 'queued', p: 0 };
  GAL.update(it);
  log('in', 'conversion 4K locale en file · ' + sz[0] + '×' + sz[1]);
  return _st_exportQueue(req, ev => {
    if (it._del) return;
    const s = ev.state;
    if (s === 'queued') it.l4k = { st: 'run', ph: 'queued', p: 0 };
    else if (s === 'download') it.l4k = { st: 'run', ph: 'download', p: Math.round(clamp(+ev.progress || 0, 0, 100) * 0.2) };
    else if (s === 'render') it.l4k = { st: 'run', ph: 'render', p: 20 + Math.round(clamp(+ev.progress || 0, 0, 100) * 0.75) };
    else if (s === 'save') it.l4k = { st: 'run', ph: 'save', p: 97 };
    else if (s === 'done') {
      if (!it.vw0) { it.vw0 = it.vw || 0; it.vh0 = it.vh || 0; }
      it.u4k = String(ev.uri || '');
      if (+ev.width > 0 && +ev.height > 0) { it.vw = +ev.width; it.vh = +ev.height; }
      if (+ev.durationMs > 0) it.vd = Math.round(ev.durationMs / 100) / 10;
      it.u4kBytes = +ev.bytes || 0;
      it.u4kCodec = String(ev.codec || '');
      it.l4k = { st: 'ok' };
      log('ok', 'conversion 4K locale terminée · ' + resLabel(it.vw, it.vh) + (ev.bytes ? ' · ' + fmtBytes(ev.bytes) : ''));
      toast('Version ' + (resLabel(it.vw, it.vh) || '4K') + ' enregistrée dans la galerie du téléphone', 'ok');
      GAL.update(it);
      return;
    } else if (s === 'error' || s === 'cancelled') {
      it.l4k = { st: 'er', err: s === 'cancelled' ? 'annulé' : String(ev.error || 'échec') };
      log('er', 'conversion 4K locale : ' + it.l4k.err);
      if (force) toast('Export 4K local : ' + it.l4k.err, 'er');
      GAL.update(it);
      return;
    } else return;
    _st_touch(it);
  }).then(ev => { _st_l4kQ.delete(it.id); return !!ev && ev.state === 'done'; },
    e => { _st_l4kQ.delete(it.id); log('er', 'export 4K : ' + _st_msg(e)); return false; });
}

/* Upscale Topaz d'une vidéo existante (reprenable : la tâche fal.ai est mémorisée). */
async function _st_topazVideo(it) {
  if (!it || !it.video) return;
  if (!hasFal()) { it.upv = null; GAL.update(it); return; }
  const d = _st_dims(it);
  const f = it.upv && it.upv.f ? it.upv.f : d.w > 0 && d.h > 0 ? Math.round(clamp(2160 / Math.min(d.w, d.h), 1.01, 4) * 100) / 100 : 2;
  if (!it.upv || !it.upv.task) it.upv = { st: 'run', msg: 'envoi…', f, task: null };
  it.upv.st = 'run';
  GAL.update(it);
  try {
    if (!it.upv.task) {
      const t = await falSubmit(epOf('topazVideo'), Object.assign({ video_url: it.video, upscale_factor: f }, extraOf('topazVideo')));
      it.upv.task = t;
      log('in', 'upscale Topaz vidéo ×' + f + ' envoyé');
      GAL.update(it);
    }
    const r = await falWait(it.upv.task, m => { if (it._del || !it.upv) return; it.upv.msg = m; _st_touch(it); }, () => !!it._del);
    if (it._del) return;
    const u = _st_vidUrl(r);
    if (!u) throw new Error('terminé sans URL');
    const p = await probeVideo(u);
    if (!it.video0) it.video0 = it.video;
    it.video = u;
    if (p.w > 0 && p.h > 0) { it.vw = p.w; it.vh = p.h; } else if (d.w > 0) { it.vw = Math.round(d.w * f); it.vh = Math.round(d.h * f); }
    if (p.d > 0) it.vd = Math.round(p.d * 10) / 10;
    it.upv = null; it.err = ''; it.seen = false;
    log('ok', 'vidéo upscalée · ' + (resLabel(it.vw, it.vh) || '4K'));
    toast('Vidéo ' + (resLabel(it.vw, it.vh) || '4K') + ' prête', 'ok');
  } catch (e) {
    if (it._del) return;
    it.upv = null;
    log('er', 'upscale Topaz vidéo : ' + _st_msg(e));
    toast('Upscale 4K échoué : ' + _st_msg(e), 'er');
  }
  GAL.update(it);
  _st_autoL4k(it);
}

function _st_retry(it) {
  if (!it) return;
  haptic('tap');
  if (it.kind === 'image') {
    if (it.model === 'topaz') {
      const src = GAL.get(it.from);
      if (!src || !src.u) { toast('L’image d’origine a été supprimée', 'wr'); return; }
      _st_doUpscale(it, src);
    } else _st_runImage(it);
    return;
  }
  if (it.kind === 'video') {
    it.tries = 0; it.err = ''; it.retryAt = 0;
    if (it.ref) _st_launch(it); else _st_runVideo(it);
  }
}

async function _st_generate() {
  const S = _st_S;
  const prompt = String(S.prompt || '').trim();
  if (prompt.length < 3) {
    toast('Décrivez d’abord ce que vous voulez créer', 'wr');
    const t = document.getElementById('stPrompt');
    if (t) { try { t.focus(); } catch (e) { /* focus refusé */ } }
    return;
  }
  if (S.loading) { toast('Patientez : import des références en cours', 'wr'); return; }
  const refs = S.refs.map(_st_refKey).filter(Boolean);
  const now = Date.now();
  if (S.mode === 'image') {
    const m = _st_im();
    if (!m) { toast('Ajoutez une clé fal.ai ou Agnès dans Réglages', 'wr'); return; }
    const made = [];
    for (let i = 0; i < S.count; i++) {
      made.push({
        id: _st_newId('s'), kind: 'image', src: 'studio', prompt, style: S.style, model: m, ratio: S.ratioI,
        created: now + (S.count - i), st: 'run', msg: 'envoi…', err: '', u: '', t: '', w: 0, h: 0, refs,
      });
    }
    made.forEach(it => GAL.add(it));
    made.forEach(it => { _st_runImage(it); });
    log('in', 'studio : ' + S.count + ' image(s) · ' + _st_mname(m));
    toast(S.count > 1 ? S.count + ' images en préparation' : 'Image en préparation', 'ok');
  } else {
    const vm = _st_vm();
    if (!vm) { toast('Ajoutez une clé fal.ai ou Agnès dans Réglages', 'wr'); return; }
    const im = S.refs.length ? '' : _st_im();
    if (!S.refs.length && !im) { toast('Importez une image de départ ou ajoutez un moteur d’image', 'wr'); return; }
    const c = VMODELS[vm];
    const dur = _st_durFor(vm);
    const audio = c.audio ? S.audio !== false : false;
    const line = audio ? String(S.line || '').trim() : '';
    const it = {
      id: _st_newId('s'), kind: 'video', src: 'studio', prompt, style: S.style, model: vm, imodel: im, ratio: S.ratioV, dur, audio, line,
      created: now, st: 'run', msg: 'préparation…', err: '', t: S.refs[0] ? (S.refs[0].t || '') : '', ref: refs[0] || '', refs,
      spec: { model: vm, prompt: _st_vidPrompt(prompt, S.style, line, audio), dur, audio },
    };
    GAL.add(it);
    _st_runVideo(it);
    log('in', 'studio : vidéo · ' + c.name + ' · ' + dur + ' s');
    toast('Vidéo en préparation · ' + c.name, 'ok');
  }
  haptic('confirm');
  setTimeout(() => {
    const f = document.getElementById('stFeedBox');
    if (f && f.scrollIntoView) { try { f.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { f.scrollIntoView(); } }
  }, 80);
}

/* ═════════════════════════════════════════════════════════════════════
   STUDIO — espace de noms
   ═════════════════════════════════════════════════════════════════════ */
const STUDIO = (() => {
  function render() {
    const root = document.getElementById('scr-studio');
    if (!root) return;
    if (!_st_S.loaded) _st_ensureDraft().then(() => { if (_st_isOn('studio') && !_st_S.touched) render(); });
    if (_st_S.audio == null) _st_S.audio = CFG.audio !== false;
    const keep = {};
    $$('[data-hs]', root).forEach(el => { keep[el.getAttribute('data-hs')] = el.scrollLeft; });
    root.innerHTML = '<div class="wrap stack"><div class="stack" id="stForm">' + _st_formHtml() + '</div>' +
      '<div class="stack" id="stFeedBox" style="margin-top:8px">' + _st_feedHtml() + '</div></div>';
    $$('[data-hs]', root).forEach(el => { const k = el.getAttribute('data-hs'); if (keep[k]) el.scrollLeft = keep[k]; });
  }

  function resumeAll() {
    _st_ensureDraft().then(() => { if (_st_isOn('studio') && !_st_S.touched) render(); });
    GAL.items.slice().forEach(it => {
      try {
        if (it.kind === 'image') {
          if (it.st === 'run') {
            it.st = 'er'; it.msg = '';
            it.err = 'Génération interrompue (application fermée) : touchez Réessayer';
            GAL.update(it);
          }
          return;
        }
        if (it.kind !== 'video') return;
        const upd = _st_vupd(it);
        if (it.st === 'run' && (it.phase === 'frame' || (!it.vst && !it.task))) {
          it.phase = ''; it.st = 'er'; it.vst = 'er'; it.msg = '';
          it.err = 'Création interrompue (application fermée) : touchez Réessayer';
          GAL.update(it);
        } else if (it.vst === 'run') {
          resumeVideo(it, upd);
          if (it.vst === 'wait') { _st_sync(it); _st_sched(it); }
        } else if (it.vst === 'wait') {
          it.st = 'run';
          _st_sched(it);
          GAL.update(it);
        }
        if (it.upv) {
          if (it.upv.task && hasFal()) _st_topazVideo(it);
          else { it.upv = null; GAL.update(it); }
        }
        if (it.vst === 'ok') { _st_sync(it); _st_autoL4k(it); }
      } catch (e) { log('er', 'reprise ' + it.id + ' : ' + e.message); }
    });
  }

  /* Pré-remplit le formulaire (visionneuse : Animer, Réutiliser, Référence). */
  function prefill(o) {
    o = o || {};
    const S = _st_S;
    S.touched = true;
    if (o.mode === 'image' || o.mode === 'video') S.mode = o.mode;
    if (typeof o.prompt === 'string') { if (S.prompt && S.prompt !== o.prompt) S.prev = S.prompt; S.prompt = o.prompt; }
    if (o.style !== undefined) S.style = STYLES.some(s => s.id === o.style) ? o.style : '';
    if (o.ratio) {
      if (S.mode === 'video') S.ratioV = _st_VR.indexOf(o.ratio) >= 0 ? o.ratio : o.ratio === '3:4' ? '9:16' : '16:9';
      else if (_st_IR.indexOf(o.ratio) >= 0) S.ratioI = o.ratio;
    }
    if (Array.isArray(o.refs)) { const old = S.refs.map(r => 'sref:' + r.id); S.refs = o.refs.filter(r => r && r.u).slice(0, 4).map(r => Object.assign({ id: uid() + uid() }, r)); _st_gcRefs(old); }
    _st_draft();
  }
  function addRef(r) {
    const S = _st_S;
    if (!r || !r.u) return false;
    if (S.refs.some(x => x.u === r.u)) { toast('Cette image est déjà dans vos références'); return false; }
    if (S.refs.length >= 4) { toast('4 références maximum : retirez-en une dans le Studio', 'wr'); return false; }
    S.touched = true;
    S.refs.push(Object.assign({ id: uid() + uid() }, r));
    _st_draft();
    return true;
  }

  /* ── Actions ── */
  ACT.smode = el => {
    const m = el.dataset.m === 'video' ? 'video' : 'image';
    if (_st_S.mode === m) return;
    _st_S.mode = m; _st_S.touched = true;
    haptic('tap');
    _st_draft();
    _st_renderForm();
  };
  ACT.smagic = async el => {
    const S = _st_S;
    const ta = document.getElementById('stPrompt');
    if (ta) S.prompt = ta.value;
    const p = String(S.prompt || '').trim();
    if (!p) { toast('Écrivez d’abord une idée, même courte', 'wr'); if (ta) ta.focus(); return; }
    if (!hasText()) { toast('Le prompt magique utilise une IA texte : ajoutez une clé fal.ai, Agnès ou compatible OpenAI dans Réglages', 'wr'); return; }
    if (S.magic) return;
    S.magic = true;
    const bar = document.getElementById('stPBar');
    if (bar) bar.innerHTML = _st_pbarHtml();
    try {
      const r = await enhancePrompt(p, S.mode);
      if (r && r.trim() && r.trim() !== p) {
        S.prev = S.prompt;
        S.prompt = r.trim();
        S.touched = true;
        toast('Prompt enrichi ✦', 'ok');
        log('ok', 'prompt magique (' + S.mode + ')');
      } else toast('Votre prompt est déjà très complet');
    } catch (e) {
      log('er', 'prompt magique : ' + _st_msg(e));
      toast('Prompt magique indisponible : ' + _st_msg(e), 'er');
    } finally {
      S.magic = false;
      const t = document.getElementById('stPrompt');
      if (t && t.value !== S.prompt) t.value = S.prompt;
      const b = document.getElementById('stPBar');
      if (b) b.innerHTML = _st_pbarHtml();
      _st_draft();
    }
  };
  ACT.sundo = () => {
    const S = _st_S;
    if (S.prev == null) return;
    const cur = S.prompt;
    S.prompt = S.prev;
    S.prev = cur;
    const t = document.getElementById('stPrompt');
    if (t) t.value = S.prompt;
    const b = document.getElementById('stPBar');
    if (b) b.innerHTML = _st_pbarHtml();
    _st_draft();
  };
  ACT.sclear = () => {
    const S = _st_S;
    if (S.prompt) S.prev = S.prompt;
    S.prompt = '';
    S.touched = true;
    const t = document.getElementById('stPrompt');
    if (t) { t.value = ''; try { t.focus(); } catch (e) { /* focus refusé */ } }
    const b = document.getElementById('stPBar');
    if (b) b.innerHTML = _st_pbarHtml();
    _st_draft();
  };
  ACT.srefdel = el => {
    const i = +el.dataset.i;
    const r = _st_S.refs[i];
    if (!r) return;
    _st_S.refs.splice(i, 1);
    _st_S.touched = true;
    _st_gcRefs(['sref:' + r.id]);
    haptic('tap');
    _st_draft();
    _st_renderForm();
  };
  ACT.sgalref = () => {
    const L = GAL.items.filter(x => x.kind === 'image' && x.st === 'ok' && x.u).slice(0, 90);
    openSheet('<div class="stack">' +
      '<div class="row"><h2 class="h2">Choisir une référence</h2><span class="sp"></span><button type="button" class="btn icon ghost" data-a="sxsheet" aria-label="Fermer">✕</button></div>' +
      (L.length
        ? '<p class="sub" style="margin:0">Touchez une image pour l’ajouter (' + _st_S.refs.length + '/4).</p><div class="grid3">' + L.map(it =>
          '<div class="media" role="button" tabindex="0" data-a="spickref" data-id="' + esc(it.id) + '" style="aspect-ratio:1" aria-label="' + esc('Image : ' + _st_title(it).slice(0, 80)) + '">' +
          '<img src="' + esc(it.t || it.u) + '" alt="" loading="lazy" decoding="async">' +
          (_st_is4k(it) ? '<div class="tl"><span class="badge b4k">4K</span></div>' : '') + '</div>').join('') + '</div>'
        : '<div class="card sub" style="text-align:center;padding:24px 14px">Aucune image dans la galerie pour l’instant. Générez une image ou importez une photo.</div>') +
      '</div>');
  };
  ACT.sxsheet = () => closeSheet();
  ACT.spickref = el => {
    const it = GAL.get(el.dataset.id);
    if (!it) return;
    if (addRef({ u: it.u, t: it.t || '', w: it.w || 0, h: it.h || 0, gid: it.id })) {
      haptic('tap');
      toast('Référence ajoutée', 'ok');
      closeSheet();
      if (_st_isOn('studio')) _st_renderForm();
    }
  };
  ACT.sstyle = el => {
    const id = el.dataset.id || '';
    _st_S.style = _st_S.style === id ? '' : id;
    _st_S.touched = true;
    haptic('tap');
    _st_draft();
    _st_renderForm();
  };
  ACT.smodel = el => {
    const id = el.dataset.id, k = el.dataset.k;
    const c = k === 'video' ? VMODELS[id] : IMODELS[id];
    if (!c) return;
    if (!_st_provOk(c.prov)) {
      toast((c.prov === 'fal' ? 'Ajoutez une clé fal.ai' : 'Ajoutez des clés Agnès') + ' dans Réglages pour utiliser ' + c.name, 'wr');
      haptic('reject');
      return;
    }
    if (k === 'video') _st_S.vmodel = id; else _st_S.imodel = id;
    _st_S.touched = true;
    haptic('tap');
    _st_draft();
    _st_renderForm();
  };
  ACT.sratio = el => {
    const r = el.dataset.r;
    if (_st_S.mode === 'video') { if (_st_VR.indexOf(r) >= 0) _st_S.ratioV = r; } else if (_st_IR.indexOf(r) >= 0) _st_S.ratioI = r;
    _st_S.touched = true;
    haptic('tap');
    _st_draft();
    _st_renderForm();
  };
  ACT.scount = el => {
    const n = +el.dataset.n;
    if ([1, 2, 4].indexOf(n) < 0) return;
    _st_S.count = n;
    haptic('tap');
    _st_draft();
    _st_renderForm();
  };
  ACT.sdur = el => {
    const d = +el.dataset.d;
    if (!(d > 0)) return;
    _st_S.dur = d;
    haptic('tap');
    _st_draft();
    _st_renderForm();
  };
  ACT.sgen = () => _st_generate();
  ACT.sretry = (el, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    _st_retry(GAL.get(el.dataset.id));
  };
  ACT.sopen = el => VIEW.open(el.dataset.id, GAL.items.filter(x => x.src === 'studio').slice(0, 12).map(x => x.id));
  ACT.sall = () => _st_go('gallery');
  ACT.sfalkey = () => openExternal('https://fal.ai/dashboard/keys');

  /* Tuiles au clavier (Entrée / Espace) */
  document.addEventListener('keydown', e => {
    const t = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && t && t.matches && t.matches('.media[role=button][data-a]')) { e.preventDefault(); t.click(); }
  });

  /* ── Saisie ── */
  ON_INPUT.push(el => {
    if (el.id === 'stPrompt') {
      const had = !!_st_S.prompt;
      _st_S.prompt = el.value;
      _st_S.touched = true;
      if (had !== !!el.value) { const b = document.getElementById('stPBar'); if (b) b.innerHTML = _st_pbarHtml(); }
      _st_draft();
      return true;
    }
    if (el.id === 'stLine') { _st_S.line = el.value; _st_S.touched = true; _st_draft(); return true; }
    return false;
  });
  ON_CHANGE.push(el => {
    if (el.id === 'stFile') { _st_upload(el); return true; }
    if (el.id === 'stAudio') { _st_S.audio = !!el.checked; _st_S.touched = true; _st_draft(); _st_renderForm(); return true; }
    if (el.id === 'stPrompt' || el.id === 'stLine') return true;
    return false;
  });

  return {
    render, resumeAll, prefill, addRef,
    local4k: (it, force) => _st_local4k(typeof it === 'string' ? GAL.get(it) : it, force !== false),
    exportQueue: _st_exportQueue,
    get busyExports() { return _st_XQ.n; },
    get state() { return _st_S; },
  };
})();

async function _st_upload(input) {
  const S = _st_S;
  const files = Array.from(input.files || []);
  try { input.value = ''; } catch (e) { /* champ en lecture seule */ }
  if (!files.length) return;
  const room = 4 - S.refs.length - S.loading;
  if (room <= 0) { toast('4 références maximum', 'wr'); return; }
  const take = files.slice(0, room);
  if (files.length > room) toast('Seule' + (room > 1 ? 's les ' + room + ' premières images ont été ajoutées' : ' la première image a été ajoutée') + ' (4 maximum)', 'wr');
  S.loading += take.length;
  S.touched = true;
  _st_renderRefs();
  for (const f of take) {
    try {
      const r = await _st_readImage(f);
      S.refs.push(Object.assign({ id: uid() + uid() }, r));
    } catch (e) {
      toast('Image illisible : ' + (f.name || 'fichier') + ' (' + _st_msg(e) + ')', 'er');
      log('er', 'référence : ' + _st_msg(e));
    }
    S.loading = Math.max(0, S.loading - 1);
    _st_renderRefs();
  }
  _st_draft();
  if (_st_isOn('studio')) _st_renderForm();
}

/* ═════════════════════════════════════════════════════════════════════
   VISIONNEUSE
   ═════════════════════════════════════════════════════════════════════ */
const VIEW = (() => {
  const V = { id: null, list: [], closer: null, key: '', zoom: false, keys: false };
  const box = () => document.getElementById('viewer');
  const cur = () => (V.id ? GAL.get(V.id) : null);

  function mediaKey(it) { return [it.id, it.st, _st_src(it), it.t ? 1 : 0].join('|'); }

  function mediaHtml(it) {
    const s = _st_src(it);
    const bg = it.t ? ' style="background:url(&quot;' + esc(it.t) + '&quot;) center/contain no-repeat"' : '';
    if (it.st === 'run') {
      return (it.t ? '<img src="' + esc(it.t) + '" alt="" style="filter:saturate(.6) brightness(.55)">' : '') +
        '<div class="col" style="position:absolute;align-items:center;gap:12px;color:#fff;text-align:center;padding:0 24px"><i class="spin lg"></i><span>' + esc(it.msg || 'génération…') + '</span></div>';
    }
    if (it.st === 'er' || !s) {
      return (it.t ? '<img src="' + esc(it.t) + '" alt="" style="filter:saturate(.4) brightness(.5)">' : '') +
        '<div class="note er" style="position:absolute;max-width:86%">' + esc(it.err || 'Média indisponible') + '</div>';
    }
    if (it.kind === 'image') {
      return '<img id="vImg" src="' + esc(s) + '" alt="' + esc(_st_title(it).slice(0, 160)) + '" decoding="async" draggable="false"' + bg + '>';
    }
    return '<video id="vVid" src="' + esc(s) + '"' + (it.t ? ' poster="' + esc(it.t) + '"' : '') + ' controls autoplay playsinline preload="metadata"></video>';
  }

  function topHtml(it) {
    const kind = it.kind === 'film' ? 'Film' : it.kind === 'video' ? 'Vidéo' : 'Image';
    const b = _st_is4k(it) ? '<span class="badge b4k">4K</span>' : (_st_resOf(it) ? '<span class="badge bdim">' + esc(_st_resOf(it)) + '</span>' : '');
    const n = V.list.length > 1 ? V.list.indexOf(it.id) : -1;
    return '<button type="button" data-a="vclose" aria-label="Fermer la visionneuse">✕</button>' +
      '<div>' + esc(kind + (it.model ? ' · ' + _st_mname(it.model) : '')) + '</div>' + b +
      (n >= 0 ? '<button type="button" data-a="vprev" aria-label="Précédent"' + (n <= 0 ? ' disabled' : '') + '>‹</button>' +
        '<button type="button" data-a="vnext" aria-label="Suivant"' + (n >= V.list.length - 1 ? ' disabled' : '') + '>›</button>' : '');
  }

  function barHtml(it) {
    const B = [];
    const btn = (a, label, cls, dis) => B.push('<button type="button" class="btn sm' + (cls ? ' ' + cls : '') + '" data-a="' + a + '" data-id="' + esc(it.id) + '"' + (dis ? ' disabled' : '') + '>' + label + '</button>');
    if (it.st === 'run') {
      if (it.prompt) btn('vprompt', '↺ Réutiliser le prompt');
      btn('vdel', 'Supprimer');
      return B.join('');
    }
    if (it.st === 'er') {
      btn('sretry', '↻ Réessayer', 'pri');
      if (it.prompt) btn('vprompt', '↺ Réutiliser le prompt');
      btn('vdel', 'Supprimer');
      return B.join('');
    }
    if (it.kind === 'film') {
      if (IS_APP && it.uri) { btn('vopen', '▶ Ouvrir', 'pri'); btn('vshare', '↗ Partager'); }
      else btn('vsave', '⤓ Enregistrer', 'pri');
      btn('vdel', 'Retirer de la galerie');
      return B.join('');
    }
    if (it.kind === 'image') {
      btn('vsave', '⤓ Enregistrer', 'pri');
      btn('vshare', '↗ Partager');
      if (!_st_is4k(it)) btn('vup', 'Upscale 4K', 'gold');
      btn('vanim', '▶ Animer');
      if (it.prompt) btn('vprompt', '↺ Réutiliser le prompt');
      btn('vref', '＋ Référence');
      btn('vdel', 'Supprimer');
      return B.join('');
    }
    // vidéo
    const l4 = it.l4k && it.l4k.st === 'run';
    const up = it.upv && it.upv.st === 'run';
    if (IS_APP && it.u4k) { btn('vopen', '▶ Ouvrir en 4K', 'pri'); btn('vshare', '↗ Partager'); }
    else { btn('vsave', '⤓ Enregistrer', 'pri'); btn('vshare', '↗ Partager'); }
    if (!_st_is4k(it)) {
      if (up) btn('vup', '<i class="spin"></i> Topaz 4K…', 'gold', true);
      else if (hasFal()) btn('vup', 'Upscale 4K', 'gold', l4);
    }
    if (IS_APP) btn('vl4k', l4 ? '<i class="spin"></i> Export 4K · ' + (it.l4k.p > 0 ? it.l4k.p + ' %' : 'en file') : 'Export 4K local', '', l4 || up);
    if (it.prompt) btn('vprompt', '↺ Réutiliser le prompt');
    if (it.ref) btn('vref', '＋ Image de départ en référence');
    btn('vdel', 'Supprimer');
    return B.join('');
  }

  function kv(k, v) {
    return v ? '<div class="row" style="justify-content:space-between;flex-wrap:nowrap;gap:16px;padding:8px 0;border-bottom:1px solid var(--line)">' +
      '<span>' + esc(k) + '</span><b style="color:var(--ink);font-weight:600;text-align:right">' + esc(v) + '</b></div>' : '';
  }

  function infoHtml(it) {
    const d = _st_dims(it);
    const st = _st_style(it.style);
    let h = '';
    if (it.kind === 'film') h += '<span class="lab">Film</span><p>' + esc(_st_title(it)) + '</p>';
    else if (it.prompt) h += '<span class="lab">Prompt</span><p style="white-space:pre-wrap">' + esc(it.prompt) + '</p>';
    if (it.line) h += '<span class="lab">Réplique</span><p>« ' + esc(it.line) + ' »</p>';
    if (it.st === 'ok' && it.err) h += '<div class="note wr">' + esc(it.err) + '</div>';
    if (it.l4k && it.l4k.st === 'er') {
      h += '<div class="note wr">Conversion 4K sur le téléphone : ' + esc(it.l4k.err || 'échec') + '.' + (IS_APP ? ' Vous pouvez relancer « Export 4K local ».' : '') + '</div>';
    }
    if (it.u4k && it.kind === 'video') h += '<div class="note ok">Version ' + esc(resLabel(it.vw, it.vh) || '4K') + ' enregistrée dans la galerie du téléphone (dossier CineGenesis).</div>';
    let rows = '';
    rows += kv('Modèle', it.model ? _st_mname(it.model) : '');
    if (it.kind === 'video' && it.imodel && it.imodel !== it.model && IMODELS[it.imodel]) rows += kv('Image de départ', _st_mname(it.imodel));
    rows += kv('Résolution', d.w && d.h ? (d.w + ' × ' + d.h + (_st_resOf(it) ? ' · ' + _st_resOf(it) : '')) : '');
    if (it.kind === 'video' && it.u4k && it.vw0) rows += kv('Rendu d’origine', it.vw0 + ' × ' + it.vh0);
    rows += kv('Format', it.ratio || '');
    rows += kv(it.kind === 'film' ? 'Genre' : 'Style', st ? st.name : it.kind === 'film' ? String(it.style || '') : '');
    if (it.kind === 'film') rows += kv('Fichier', String(it.name || ''));
    if (it.kind !== 'image') rows += kv('Durée', _st_durOf(it));
    if (it.kind === 'video') rows += kv('Son', it.audio ? 'oui' : 'non');
    if (it.kind === 'film') {
      rows += kv('Taille', +it.bytes > 0 ? fmtBytes(it.bytes) : '');
      rows += kv('Codec', String(it.codec || '').replace('video/', '').toUpperCase());
    }
    if (it.u4kBytes) rows += kv('Fichier 4K', fmtBytes(it.u4kBytes) + (it.u4kCodec ? ' · ' + it.u4kCodec.replace('video/', '').toUpperCase() : ''));
    rows += kv('Créée le', _st_date(it.created));
    h += '<div>' + rows + '</div>';
    return h;
  }

  function render(full) {
    const v = box();
    const it = cur();
    if (!v || !it) return;
    const k = mediaKey(it);
    if (full || k !== V.key || !document.getElementById('vMedia')) {
      unload();
      V.key = k;
      V.zoom = false;
      v.innerHTML = '<div class="vtop" id="vTop">' + topHtml(it) + '</div>' +
        '<div class="vmedia" id="vMedia" style="overflow:hidden">' + mediaHtml(it) + '</div>' +
        '<div class="vbar" id="vBar">' + barHtml(it) + '</div>' +
        '<div class="vinfo stack" id="vInfo">' + infoHtml(it) + '</div>';
      bindMedia(it);
    } else {
      const t = document.getElementById('vTop'), b = document.getElementById('vBar'), i = document.getElementById('vInfo');
      if (t) t.innerHTML = topHtml(it);
      if (b) b.innerHTML = barHtml(it);
      if (i) i.innerHTML = infoHtml(it);
      if (it.st === 'run') {
        const m = document.getElementById('vMedia');
        const sp = m && m.querySelector('.col span');
        if (sp) sp.textContent = it.msg || 'génération…';
      }
    }
  }

  function bindMedia(it) {
    const m = document.getElementById('vMedia');
    if (!m) return;
    const vid = document.getElementById('vVid');
    if (vid) {
      vid.addEventListener('error', () => {
        // La version 4K locale est illisible ici : repli sur le fichier distant.
        const x = cur();
        if (x && x.id === it.id && it.u4k && vid.getAttribute('src') === it.u4k && it.video) { vid.src = it.video; return; }
        if (x && x.id === it.id && x.kind === 'film' && IS_APP) {
          const n = document.getElementById('vInfo');
          if (n && !n.querySelector('[data-vplay]')) n.insertAdjacentHTML('afterbegin', '<div class="note" data-vplay="1">Lecture intégrée impossible : touchez « Ouvrir » pour utiliser le lecteur du téléphone.</div>');
        }
      });
    }
    const img = document.getElementById('vImg');
    if (img) {
      img.addEventListener('load', () => { img.style.background = 'none'; });
      img.addEventListener('dblclick', e => zoomAt(img, e.clientX, e.clientY));
    }
    let x0 = 0, y0 = 0, t0 = 0, ok = false;
    m.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) { ok = false; return; }
      const t = e.touches[0];
      const r = m.getBoundingClientRect();
      // Barre de contrôle de la vidéo : pas de balayage.
      ok = !(vid && t.clientY > r.bottom - 64);
      x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
    }, { passive: true });
    m.addEventListener('touchmove', e => {
      if (!V.zoom || !img || e.touches.length !== 1) return;
      const r = m.getBoundingClientRect();
      const t = e.touches[0];
      img.style.transformOrigin = clamp((t.clientX - r.left) / r.width * 100, 0, 100) + '% ' + clamp((t.clientY - r.top) / r.height * 100, 0, 100) + '%';
    }, { passive: true });
    m.addEventListener('touchend', e => {
      if (!ok || V.zoom) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      if (Date.now() - t0 < 650 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  function zoomAt(img, cx, cy) {
    const r = img.getBoundingClientRect();
    V.zoom = !V.zoom;
    img.style.transition = 'transform .25s ease';
    if (V.zoom) {
      img.style.transformOrigin = clamp((cx - r.left) / r.width * 100, 0, 100) + '% ' + clamp((cy - r.top) / r.height * 100, 0, 100) + '%';
      img.style.transform = 'scale(2.5)';
    } else img.style.transform = '';
  }

  function unload() {
    const v = box();
    if (!v) return;
    v.querySelectorAll('video').forEach(x => { try { x.pause(); x.removeAttribute('src'); x.load(); } catch (e) { /* déjà libérée */ } });
    v.querySelectorAll('img').forEach(x => { try { x.removeAttribute('src'); } catch (e) { /* sans effet */ } });
  }

  function open(id, list) {
    const it = GAL.get(id);
    const v = box();
    if (!it || !v) return;
    V.id = id;
    if (Array.isArray(list)) V.list = list.filter(x => GAL.get(x));
    if (V.list.indexOf(id) < 0) V.list = [id];
    if (it.seen === false && it.st === 'ok') { it.seen = true; GAL.update(it); }
    render(true);
    v.classList.add('on');
    v.setAttribute('aria-hidden', 'false');
    try { v.scrollTop = 0; } catch (e) { /* sans effet */ }
    if (!V.closer) { V.closer = () => { close(); return true; }; BACK.push(V.closer); }
    if (!V.keys) {
      V.keys = true;
      document.addEventListener('keydown', e => {
        if (!V.id) return;
        if (e.key === 'Escape') { if (typeof window.cgBack === 'function') window.cgBack(); else close(); }
        else if (e.key === 'ArrowRight' && !/^(INPUT|TEXTAREA|VIDEO)$/.test((e.target && e.target.tagName) || '')) step(1);
        else if (e.key === 'ArrowLeft' && !/^(INPUT|TEXTAREA|VIDEO)$/.test((e.target && e.target.tagName) || '')) step(-1);
      });
    }
  }

  function close() {
    const v = box();
    if (V.closer) {
      const i = BACK.indexOf(V.closer);
      if (i >= 0) BACK.splice(i, 1);
      V.closer = null;
    }
    V.id = null;
    V.key = '';
    if (!v) return;
    unload();
    v.classList.remove('on');
    v.setAttribute('aria-hidden', 'true');
    setTimeout(() => { if (!v.classList.contains('on')) v.innerHTML = ''; }, 300);
  }

  function step(d) {
    if (!V.id) return;
    V.list = V.list.filter(x => GAL.get(x));
    const i = V.list.indexOf(V.id);
    const n = V.list[i + d];
    if (!n) return;
    haptic('tap');
    open(n);
  }

  function refresh() { if (V.id) { if (!GAL.get(V.id)) close(); else render(false); } }

  /* ── Actions ── */
  const target = el => GAL.get((el && el.dataset.id) || V.id);

  ACT.vclose = () => close();
  ACT.vprev = () => step(-1);
  ACT.vnext = () => step(1);
  ACT.vsave = async el => {
    const it = target(el);
    if (!it) return;
    if (it.kind === 'film') { await saveToGallery(it.uri || it.u, 'video', _st_fileName(it)); return; }
    if (it.kind === 'video' && IS_APP && it.u4k) { toast('La version 4K est déjà dans la galerie du téléphone (dossier CineGenesis)', 'ok'); return; }
    const u = it.kind === 'video' ? it.video : it.u;
    await saveToGallery(u, it.kind === 'video' ? 'video' : 'image', _st_fileName(it));
  };
  ACT.vshare = async el => {
    const it = target(el);
    if (!it) return;
    const local = it.kind === 'film' ? it.uri : it.kind === 'video' ? it.u4k : '';
    if (IS_APP && local && /^content:/i.test(local)) {
      try { N.shareUri(String(local), 'video/mp4'); } catch (e) { toast('Partage impossible : ' + _st_msg(e), 'er'); }
      return;
    }
    const u = it.kind === 'video' ? it.video : it.kind === 'film' ? (it.uri || it.u) : it.u;
    await saveToGallery(u, it.kind === 'image' ? 'image' : 'video', _st_fileName(it), true);
  };
  ACT.vopen = el => {
    const it = target(el);
    if (!it) return;
    const u = it.kind === 'film' ? it.uri : it.u4k;
    if (!u) return;
    if (!IS_APP) { toast('Disponible dans l’application Android', 'wr'); return; }
    try { N.openUri(String(u), 'video/mp4'); } catch (e) { toast('Ouverture impossible : ' + _st_msg(e), 'er'); }
  };
  ACT.vup = el => {
    const it = target(el);
    if (!it) return;
    if (it.kind === 'image') { _st_upscaleImage(it); return; }
    if (it.kind !== 'video' || !it.video) return;
    if (_st_is4k(it)) { toast('Cette vidéo est déjà en 4K'); return; }
    if (hasFal()) { toast('Upscale Topaz 4K lancé', 'ok'); _st_topazVideo(it); return; }
    if (IS_APP) { _st_local4k(it, true); return; }
    toast('L’upscale 4K nécessite une clé fal.ai (ou l’application Android pour la conversion locale)', 'wr');
  };
  ACT.vl4k = el => {
    const it = target(el);
    if (!it) return;
    if (it.l4k && it.l4k.st !== 'run') it.l4k = null;
    _st_local4k(it, true).then(ok => { if (ok) render(false); });
    render(false);
  };
  ACT.vanim = el => {
    const it = target(el);
    if (!it || !it.u) return;
    STUDIO.prefill({ mode: 'video', prompt: it.prompt || '', style: it.style || '', ratio: it.ratio || '16:9', refs: [{ u: it.u, t: it.t || '', w: it.w || 0, h: it.h || 0, gid: it.id }] });
    close();
    _st_go('studio');
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
    toast('Image prête à animer : décrivez le mouvement puis générez', 'ok');
  };
  ACT.vprompt = el => {
    const it = target(el);
    if (!it) return;
    STUDIO.prefill({ mode: it.kind === 'video' ? 'video' : 'image', prompt: it.prompt || '', style: it.style || '', ratio: it.ratio || '' });
    if (it.kind === 'video' && it.line) { _st_S.line = it.line; _st_draft(); }
    close();
    _st_go('studio');
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
    toast('Prompt repris dans le Studio', 'ok');
  };
  ACT.vref = async el => {
    const it = target(el);
    if (!it) return;
    let u = it.kind === 'image' ? it.u : await _st_resolve(it.ref);
    if (!u) { toast('Image introuvable', 'wr'); return; }
    if (STUDIO.addRef({ u, t: it.t || '', w: it.kind === 'image' ? it.w : it.fw || 0, h: it.kind === 'image' ? it.h : it.fh || 0, gid: it.id })) {
      haptic('tap');
      toast('Ajoutée aux références du Studio (' + _st_S.refs.length + '/4)', 'ok');
    }
  };
  ACT.vdel = async el => {
    const it = target(el);
    if (!it) return;
    const what = it.kind === 'film' ? 'ce film' : it.kind === 'video' ? 'cette vidéo' : 'cette image';
    // La feuille de confirmation doit passer au-dessus de la visionneuse plein écran.
    const sh = document.getElementById('sheet');
    if (sh) sh.style.zIndex = '86';
    let ok = false;
    try {
      ok = await confirmSheet('Supprimer ' + what + ' ?',
        it.kind === 'film'
          ? 'Le film disparaît de la galerie de l’application ; le fichier enregistré sur le téléphone est conservé.'
          : 'Elle disparaît de la galerie de l’application. Les copies déjà enregistrées sur le téléphone sont conservées.',
        'Supprimer');
    } finally {
      if (sh) setTimeout(() => { if (!sh.classList.contains('on')) sh.style.zIndex = ''; }, 350);
    }
    if (!ok) return;
    await GAL.remove(it.id);
    toast('Supprimée', 'ok');
  };

  return { open, close, refresh, step, get id() { return V.id; } };
})();
