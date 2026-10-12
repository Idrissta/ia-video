/* CINÉ-GENESIS — moteurs IA : Agnès (logique d'origine), fal.ai (file d'attente, images 4K, vidéos 4K,
   upscale Topaz), API texte compatible OpenAI. Tout le réseau passe par xfetch() (core.js). */
'use strict';

/* ═════════════════════════════════════════════════════════════════════
   CATALOGUES
   ═════════════════════════════════════════════════════════════════════ */
const IMODELS = {
  seedream: { name: 'Seedream 4.5', tag: '4K natif', prov: 'fal', t2i: 'fal-ai/bytedance/seedream/v4.5/text-to-image', edit: 'fal-ai/bytedance/seedream/v4.5/edit', usd: 0.04, desc: 'Photoréalisme extrême, jusqu’à 4096 px' },
  nanopro: { name: 'Nano Banana Pro', tag: '4K', prov: 'fal', t2i: 'fal-ai/nano-banana-pro', edit: 'fal-ai/nano-banana-pro/edit', desc: 'Google · cohérence parfaite des personnages' },
  agnes: { name: 'Agnès Image 2.5', tag: '2K', prov: 'agnes', desc: 'Inclus avec vos clés Agnès' },
};

const VMODELS = {
  kling4k: { name: 'Kling 3.0 · 4K', tag: '4K natif', prov: 'fal', ep: 'fal-ai/kling-video/v3/4k/image-to-video', native: true, audio: true, durs: [5, 10], usd: 0.42, desc: 'Rendu Kling en 3840×2160 natif, son inclus' },
  ltx4k: { name: 'LTX-2.3 Pro · 2160p', tag: '4K natif', prov: 'fal', ep: 'fal-ai/ltx-2.3/image-to-video', native: true, audio: true, durs: [6, 8, 10], usd: 0.24, desc: '4K natif avec audio, le plus économique' },
  klingpro: { name: 'Kling 3.0 Pro', tag: '1080p → 4K', prov: 'fal', ep: 'fal-ai/kling-video/v3/pro/image-to-video', audio: true, durs: [5, 10], usd: 0.168, desc: 'Mouvements Kling + upscale Topaz 4K' },
  veo31: { name: 'Veo 3.1', tag: '1080p → 4K', prov: 'fal', ep: 'fal-ai/veo3.1/image-to-video', audio: true, durs: [8], desc: 'Google · dialogues parlés synchronisés + upscale 4K' },
  agnes: { name: 'Agnès Vidéo', tag: '720p → 4K', prov: 'agnes', durs: [10], desc: 'Inclus avec vos clés Agnès · 4K via Topaz ou export local' },
};

const STYLES = [
  { id: 'cine', name: 'Cinématique', p: 'cinematic film still, anamorphic lens, dramatic lighting, rich color grading, ultra detailed, 8k texture detail' },
  { id: 'photo', name: 'Photoréaliste', p: 'photorealistic photograph, full-frame camera, 85mm prime lens, natural light, true-to-life skin texture, crisp micro detail' },
  { id: 'anime', name: 'Anime', p: 'japanese anime key visual, detailed painted backgrounds, dramatic lighting, vibrant cel shading, clean line art' },
  { id: 'noir', name: 'Film noir', p: 'black and white film noir, hard chiaroscuro shadows, venetian blind light, rain-slick streets, 35mm film grain' },
  { id: 'cyber', name: 'Cyberpunk', p: 'cyberpunk neon night, rain reflections, holographic signs, magenta and cyan glow, dense futuristic megacity' },
  { id: 'fantasy', name: 'Fantasy épique', p: 'epic high fantasy, majestic landscapes, volumetric god rays, painterly golden hour light, intricate armor and costumes' },
  { id: 'luxe', name: 'Pub luxe', p: 'luxury commercial photography, glossy studio lighting, elegant reflections, minimal premium set, flawless product detail' },
  { id: 'docu', name: 'Documentaire', p: 'observational documentary, natural available light, handheld 35mm, authentic real locations, candid moment' },
  { id: 'anim3d', name: 'Animation 3D', p: 'high-end 3D animated feature film style, soft global illumination, expressive stylized characters, subsurface scattering' },
  { id: 'aqua', name: 'Aquarelle', p: 'delicate watercolor painting, soft bleeding pigments, textured cold-press paper, luminous pastel washes' },
  { id: 'retro70', name: 'Rétro 70s', p: '1970s retro film look, warm faded Kodachrome colors, soft halation, visible film grain, vintage wardrobe and decor' },
  { id: 'scifi', name: 'Science-fiction', p: 'visionary science fiction, vast futuristic architecture, clean cold light, sleek spacecraft, epic cinematic scale' },
];

const EP = { topazVideo: 'fal-ai/topaz/upscale/video', topazImage: 'fal-ai/topaz/upscale/image', anyLlm: 'fal-ai/any-llm', anyLlmVision: 'fal-ai/any-llm/vision' };

/* ═════════════════════════════════════════════════════════════════════
   AGNÈS — CONFIGURATION D'ORIGINE
   ═════════════════════════════════════════════════════════════════════ */
const API = 'https://apihub.agnes-ai.com/v1', POLL = 'https://apihub.agnes-ai.com/agnesapi';
const TXT = ['agnes-3.0-flash', 'agnes-2.5-flash'], IMG = 'agnes-image-2.5-flash', VID = { free: 'agnes-video-v2.0', plan: 'agnes-video-2.5-flash' };
const RPM = { free: { img: 10, vid: 1, txt: 10 }, plan: { img: 100, vid: 5, txt: 600 } };
/* Paliers d'attente (minutes) quand la file vidéo Agnès est saturée (« BACK » de l'original ;
   ce nom désigne ici la pile du bouton retour, définie dans core.js). */
const LADDER = [3, 6, 12, 24, 48, 96];
/* Clés Agnès et facteur de ralentissement global F de l'original */
const KEYS = { list: [], plan: 'free', F: 1 };

const _en_mkKey = k => ({ k, img: 0, vid: 0, txt: 0, cool: 0, bad: 0, off: false });
const _en_U = upd => s => { try { if (upd) upd(!!s); } catch (e) { log('er', 'affichage : ' + e.message); } };
const _en_err = (msg, extra) => Object.assign(new Error(msg), extra || {});
const _en_unthink = t => String(t == null ? '' : t).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
const _en_stopped = () => { try { return typeof FILM !== 'undefined' && !!(FILM && FILM.TASK && FILM.TASK.stop); } catch (e) { return false; } };

function syncKeys() {
  const raw = Array.isArray(CFG.agnes.keys) ? CFG.agnes.keys : String(CFG.agnes.keys || '').split(/[\s,;]+/);
  const ks = Array.from(new Set(raw.map(s => String(s).trim()).filter(s => s.length >= 8)));
  KEYS.plan = CFG.agnes.plan === 'plan' ? 'plan' : 'free';
  KEYS.list = ks.map(k => KEYS.list.find(o => o.k === k) || _en_mkKey(k));
  return KEYS.list.length;
}

/* ═════════════════════════════════════════════════════════════════════
   CHOIX DES MOTEURS
   ═════════════════════════════════════════════════════════════════════ */
function hasFal() { return !!String((CFG.fal && CFG.fal.key) || '').trim(); }
function hasAgnes() {
  if (!KEYS.list.length && CFG.agnes && CFG.agnes.keys && CFG.agnes.keys.length) syncKeys();
  return KEYS.list.some(o => !o.off);
}
const _en_hasOai = () => !!(CFG.oai && String(CFG.oai.url || '').trim() && String(CFG.oai.model || '').trim());
const _en_textOk = p => (p === 'agnes' ? hasAgnes() : p === 'oai' ? _en_hasOai() : p === 'fal' ? hasFal() : false);
const _en_TXTNAME = { agnes: 'Agnès', oai: 'API compatible OpenAI', fal: 'fal.ai' };

function pickText() {
  const e = CFG.eng && CFG.eng.text;
  if (e && e !== 'auto' && _en_textOk(e)) return e;
  for (const p of ['oai', 'agnes', 'fal']) if (_en_textOk(p)) return p;
  return null;
}
function hasText() { return pickText() !== null; }

const _en_provOk = p => (p === 'fal' ? hasFal() : p === 'agnes' ? hasAgnes() : false);
function _en_pick(cat, pref, eng, best) {
  for (const id of [pref, eng]) if (id && id !== 'auto' && cat[id] && _en_provOk(cat[id].prov)) return id;
  if (hasFal()) return best;
  if (hasAgnes() && cat.agnes) return 'agnes';
  return null;
}
function pickImage(pref) { return _en_pick(IMODELS, pref, CFG.eng && CFG.eng.image, 'seedream'); }
function pickVideo(pref) { return _en_pick(VMODELS, pref, CFG.eng && CFG.eng.video, 'kling4k'); }

const _en_cleanEp = s => String(s || '').trim().replace(/^https?:\/\/(queue\.)?fal\.run\//i, '').replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '');
function epOf(id, field) {
  field = field || 'ep';
  const ov = CFG.ovr && CFG.ovr[id];
  const o = ov && (ov[field] || ((field === 'ep' || field === 't2i') && ov.ep));
  if (o && _en_cleanEp(o)) return _en_cleanEp(o);
  const c = VMODELS[id] || IMODELS[id];
  if (c && c[field]) return c[field];
  if (field === 'ep' && EP[id]) return EP[id];
  return '';
}
function extraOf(id) {
  const ov = CFG.ovr && CFG.ovr[id];
  const x = ov && ov.extra;
  if (!x) return {};
  if (typeof x === 'object') return Array.isArray(x) ? {} : Object.assign({}, x);
  try {
    const v = JSON.parse(String(x));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) { return {}; }
}

/* ═════════════════════════════════════════════════════════════════════
   AGNÈS — PLANIFICATEUR MULTI-CLÉS (original)
   ═════════════════════════════════════════════════════════════════════ */
async function slot(kind) {
  for (;;) {
    if (_en_stopped()) throw new Error('stop');
    const live = KEYS.list.filter(o => !o.off);
    if (!live.length) throw _en_err('Aucune clé Agnès active', { fatal: true });
    const iv = 60000 / (RPM[KEYS.plan] || RPM.free)[kind] * 1.15 * KEYS.F, now = Date.now();
    let best = null, bt = 1e18;
    for (const o of live) {
      const t = Math.max(o[kind] || 0, o.cool || 0, now);
      if (t < bt) { bt = t; best = o; }
    }
    if (bt > now) {
      await sleep(Math.min(bt - now, 400));
      continue;
    }
    if (best.cool > Date.now()) continue;
    best[kind] = now + iv;
    return best;
  }
}

async function call(kind, url, body, tries) {
  let err;
  tries = tries || 3;
  for (let a = 0; a < tries; a++) {
    const o = await slot(kind);
    try {
      const r = await xfetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + o.k }, body: JSON.stringify(body) });
      if (r.ok) { o.bad = 0; KEYS.F = Math.max(1, KEYS.F * 0.97); return r; }
      const t = (await r.text().catch(() => '')).slice(0, 200);
      log('er', kind + ' HTTP ' + r.status + ' ' + t);
      if (r.status === 429) {
        o.cool = Date.now() + (parseInt(r.headers.get('Retry-After'), 10) || 25) * 1000;
        KEYS.F = Math.min(4, KEYS.F * 1.5);
        err = _en_err('HTTP 429 (quota Agnès)', { status: 429 });
        continue;
      }
      if (r.status === 401 || r.status === 402 || r.status === 403) {
        if (++o.bad >= 2) { o.off = true; log('wr', 'clé …' + o.k.slice(-4) + ' désactivée'); }
        err = _en_err('HTTP ' + r.status, { status: r.status });
        continue;
      }
      if (r.status >= 500 || r.status === 408) {
        err = _en_err('HTTP ' + r.status, { status: r.status });
        await sleep(2000 * Math.pow(2, a));
        continue;
      }
      throw _en_err('HTTP ' + r.status + ' ' + t, { fatal: true, status: r.status });
    } catch (e) {
      if (e.fatal || e.message === 'stop') throw e;
      err = e;
      await sleep(1500 * (a + 1));
    }
  }
  throw err || new Error('échec');
}

/* ═════════════════════════════════════════════════════════════════════
   JSON TOLÉRANT (original)
   ═════════════════════════════════════════════════════════════════════ */
function J(t) {
  if (!t) return null;
  let c = String(t).replace(/```json|```/g, '');
  const a = c.indexOf('{'), b = c.lastIndexOf('}');
  if (a < 0 || b < 0) return null;
  c = c.slice(a, b + 1);
  try { return JSON.parse(c); } catch (e) { /* réparation ci-dessous */ }
  let o = '', s = false, x = false;
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (x) { o += ch; x = false; continue; }
    if (ch === '\\') { o += ch; x = true; continue; }
    if (ch === '"') { s = !s; o += ch; continue; }
    if (s && ch === '\n') { o += '\\n'; continue; }
    if (s && ch === '\r') continue;
    if (s && ch.charCodeAt(0) < 32) { o += ' '; continue; }
    o += ch;
  }
  try { return JSON.parse(o.replace(/,\s*([}\]])/g, '$1')); } catch (e) { return null; }
}

/* ═════════════════════════════════════════════════════════════════════
   IA TEXTE — Agnès, API compatible OpenAI, fal any-llm
   ═════════════════════════════════════════════════════════════════════ */
const _en_content = (user, imgs) => (imgs && imgs.length
  ? [{ type: 'text', text: user }].concat(imgs.map(u => ({ type: 'image_url', image_url: { url: u } })))
  : user);

async function _en_agnesChat(sys, user, max, temp, imgs) {
  for (let i = 0; i < TXT.length; i++) {
    const m = TXT[i];
    try {
      const r = await call('txt', API + '/chat/completions', { model: m, messages: [{ role: 'system', content: sys }, { role: 'user', content: _en_content(user, imgs) }], temperature: temp, max_tokens: max, chat_template_kwargs: { enable_thinking: false } }, 3);
      const d = await r.json();
      const t = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      if (t) return _en_unthink(t);
    } catch (e) {
      if (e.fatal || e.message === 'stop') throw e;
      log('wr', 'texte ' + m + ' : ' + e.message);
    }
  }
  throw new Error('IA texte Agnès indisponible');
}

async function _en_oaiChat(sys, user, max, temp, imgs) {
  const base = String(CFG.oai.url || '').trim().replace(/\/+$/, '');
  const url = /\/chat\/completions$/i.test(base) ? base : base + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (CFG.oai.key) headers.Authorization = 'Bearer ' + String(CFG.oai.key).trim();
  let mx = max, err = null;
  for (let a = 0; a < 3; a++) {
    if (_en_stopped()) throw new Error('stop');
    let r;
    try {
      r = await xfetch(url, { method: 'POST', headers, body: JSON.stringify({ model: CFG.oai.model, messages: [{ role: 'system', content: sys }, { role: 'user', content: _en_content(user, imgs) }], temperature: temp, max_tokens: mx }) });
    } catch (e) { err = e; await sleep(1500 * (a + 1)); continue; }
    if (r.ok) {
      const d = await r.json();
      const msg = d && d.choices && d.choices[0] && d.choices[0].message;
      let t = msg && msg.content;
      if (Array.isArray(t)) t = t.map(p => (p && (p.text || '')) || '').join('');
      t = _en_unthink(t);
      if (t) return t;
      err = new Error('réponse vide');
      continue;
    }
    const tx = (await r.text().catch(() => '')).slice(0, 200);
    log('er', 'texte ' + CFG.oai.model + ' HTTP ' + r.status + ' ' + tx);
    if (r.status === 429) { err = _en_err('HTTP 429', { status: 429 }); await sleep((parseInt(r.headers.get('Retry-After'), 10) || 8) * 1000); continue; }
    if (r.status >= 500 || r.status === 408) { err = _en_err('HTTP ' + r.status, { status: r.status }); await sleep(2000 * Math.pow(2, a)); continue; }
    if (r.status === 400 && mx > 4096 && /max_tokens|max_completion|context|maximum|too large/i.test(tx)) { mx = 4096; continue; }
    if (r.status === 401 || r.status === 403) throw _en_err('clé de l’API texte refusée (HTTP ' + r.status + ')', { fatal: true, status: r.status });
    if (r.status === 404) throw _en_err('API texte introuvable : vérifiez l’URL et le modèle', { fatal: true, status: 404 });
    throw _en_err('API texte HTTP ' + r.status + ' ' + tx, { fatal: true, status: r.status });
  }
  throw err || new Error('API texte indisponible');
}

async function _en_falChat(sys, user, max, temp, imgs) {
  const vision = !!(imgs && imgs.length);
  const om = String(CFG.oai.model || '').trim();
  // any-llm attend un identifiant « fournisseur/modèle » ; sinon modèle par défaut.
  const body = { model: om.indexOf('/') > 0 ? om : 'google/gemini-2.5-flash', system_prompt: sys, prompt: user };
  if (vision) body.image_urls = imgs.slice(0, 4);
  const ep = epOf(vision ? 'anyLlmVision' : 'anyLlm');
  if (_en_stopped()) throw new Error('stop');
  const d = await _en_falReq('POST', 'https://fal.run/' + ep, body, ep);
  if (d && d.error) throw new Error('fal any-llm : ' + String(d.error).slice(0, 160));
  const t = _en_unthink(d && (d.output || d.text));
  if (!t) throw new Error('réponse vide');
  return t;
}

async function chat(sys, user, max, temp, imgs) {
  const first = pickText();
  if (!first) throw _en_err('Aucune IA texte : ajoutez une clé fal.ai, Agnès ou une API compatible OpenAI dans Réglages', { fatal: true });
  const order = [first].concat(['oai', 'agnes', 'fal'].filter(p => p !== first && _en_textOk(p)));
  let err0 = null, allFatal = true;
  for (const p of order) {
    try {
      if (p === 'agnes') {
        const im = imgs && imgs.length ? (await Promise.all(imgs.map(u => (/^data:/i.test(u) ? u : refData(u, 1024))))).filter(Boolean) : imgs;
        return await _en_agnesChat(sys, user, max, temp, im);
      }
      if (p === 'oai') return await _en_oaiChat(sys, user, max, temp, imgs);
      return await _en_falChat(sys, user, max, temp, imgs);
    } catch (e) {
      if (e.message === 'stop') throw e;
      if (!e.fatal) allFatal = false;
      if (!err0) err0 = e;
      log('wr', 'IA texte ' + _en_TXTNAME[p] + ' : ' + e.message);
    }
  }
  const fatal = allFatal && !!(err0 && err0.fatal);
  throw _en_err(fatal ? err0.message : 'IA texte indisponible (' + (err0 ? err0.message : 'erreur') + ')', { fatal });
}

async function llmJSON(sys, user, max, temp, imgs) {
  for (let a = 0; a < 2; a++) {
    const j = J(await chat(sys + ' Réponds UNIQUEMENT par un objet JSON valide, sans texte autour.', user, max, temp, imgs));
    if (j) return j;
  }
  throw new Error('Réponse IA illisible (JSON)');
}

/* ═════════════════════════════════════════════════════════════════════
   FAL.AI — FILE D'ATTENTE
   ═════════════════════════════════════════════════════════════════════ */
const _en_falH = json => {
  const h = { Authorization: 'Key ' + String(CFG.fal.key || '').trim(), Accept: 'application/json' };
  if (json) h['Content-Type'] = 'application/json';
  return h;
};

function _en_falDetail(t) {
  let j = null;
  try { j = JSON.parse(t); } catch (e) { j = null; }
  let d = j && (j.detail != null ? j.detail : j.error != null ? j.error : j.message);
  if (Array.isArray(d)) {
    d = d.map(x => (x && typeof x === 'object'
      ? (Array.isArray(x.loc) && x.loc.length ? x.loc.filter(p => p !== 'body').join('.') + ' : ' : '') + (x.msg || x.message || JSON.stringify(x))
      : String(x))).join(' ; ');
  } else if (d && typeof d === 'object') d = d.message || d.msg || JSON.stringify(d);
  return String(d || (j ? '' : t) || '').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function _en_falErr(status, text, ctx) {
  const det = _en_falDetail(text);
  const fatal = status >= 400 && status < 500 && status !== 429 && status !== 408;
  let m;
  if (status === 401) m = 'clé fal.ai refusée — vérifiez-la dans Réglages';
  else if (status === 402 || (status === 403 && /balance|locked|credit|crédit|exhausted|insufficient|billing|payment/i.test(String(text)))) m = 'crédit fal.ai insuffisant — rechargez votre compte sur fal.ai';
  else if (status === 403) m = 'clé fal.ai refusée — vérifiez-la dans Réglages';
  else if (status === 422) m = 'paramètres refusés par fal.ai : ' + (det || 'requête invalide');
  else if (status === 404) m = 'introuvable sur fal.ai' + (ctx ? ' (' + ctx + ')' : '') + (det ? ' : ' + det : '');
  else m = 'fal.ai HTTP ' + status + (det ? ' : ' + det : '');
  return _en_err(m, { fatal, status });
}

async function _en_falReq(method, url, body, ctx, tries) {
  if (!hasFal()) throw _en_err('clé fal.ai manquante : ajoutez-la dans Réglages', { fatal: true });
  tries = tries || 3;
  let err = null;
  for (let a = 0; a < tries; a++) {
    let r;
    try {
      r = await xfetch(url, { method, headers: _en_falH(body != null), body: body == null ? undefined : JSON.stringify(body) });
    } catch (e) { err = e; await sleep(1500 * (a + 1)); continue; }
    if (r.ok) return await r.json();
    const t = await r.text().catch(() => '');
    err = _en_falErr(r.status, t, ctx);
    log(err.fatal ? 'er' : 'wr', 'fal ' + (ctx || '') + ' HTTP ' + r.status + ' ' + String(t).slice(0, 160));
    if (err.fatal) throw err;
    await sleep(r.status === 429 ? (parseInt(r.headers.get('Retry-After'), 10) || 5) * 1000 : 2000 * Math.pow(2, a));
  }
  throw err || new Error('fal.ai indisponible');
}

const _en_falBase = (ep, id) => 'https://queue.fal.run/' + _en_cleanEp(ep).split('/').slice(0, 2).join('/') + '/requests/' + id;

async function falSubmit(ep, body) {
  ep = _en_cleanEp(ep);
  if (!ep) throw _en_err('point d’accès fal.ai vide', { fatal: true });
  const d = await _en_falReq('POST', 'https://queue.fal.run/' + ep, body || {}, ep);
  const id = d && (d.request_id || d.requestId);
  if (!id) throw new Error('fal.ai : identifiant de requête absent');
  const base = _en_falBase(ep, id);
  return { prov: 'fal', ep, id: String(id), st: d.status_url || base + '/status', res: d.response_url || base };
}

async function falWait(task, onMsg, isStopped) {
  if (!task || !task.id) throw _en_err('tâche fal.ai invalide', { fatal: true });
  const base = _en_falBase(task.ep || '', task.id);
  const st = task.st || base + '/status', res = task.res || base;
  const say = m => { if (onMsg) { try { onMsg(m); } catch (e) { /* affichage seulement */ } } };
  const end = Date.now() + 90 * 60000;
  let n = 0, fails = 0, lost = 0;
  while (Date.now() < end) {
    if (isStopped && isStopped()) throw new Error('stop');
    let d = null;
    try {
      const r = await xfetch(st, { headers: _en_falH(false) });
      if (r.ok) { d = await r.json(); fails = 0; lost = 0; }
      else {
        const t = await r.text().catch(() => '');
        const e = _en_falErr(r.status, t, task.ep);
        if (r.status === 404) { if (++lost > 6) throw _en_err('requête fal.ai introuvable (expirée ?)', { fatal: true, status: 404 }); }
        else if (e.fatal) throw e;
        else if (++fails > 40) throw new Error('suivi fal.ai impossible : ' + e.message);
      }
    } catch (e) {
      if (e.fatal || e.message === 'stop' || /^suivi fal\.ai/.test(e.message)) throw e;
      if (++fails > 40) throw new Error('suivi fal.ai impossible : ' + e.message);
    }
    if (d) {
      const s = String(d.status || '').toUpperCase();
      if (s === 'IN_QUEUE') {
        const p = +d.queue_position;
        say('file d’attente' + (isFinite(p) && p >= 0 ? ' · position ' + (p + 1) : ''));
      } else if (s === 'IN_PROGRESS') {
        say('génération…');
      } else if (s === 'COMPLETED') {
        if (d.error) throw _en_err('fal.ai : ' + String(d.error).slice(0, 200), { fatal: true });
        say('récupération du résultat…');
        return await _en_falReq('GET', d.response_url || res, null, task.ep);
      } else if (/^(FAILED|ERROR|CANCELLED|CANCELED)$/.test(s)) {
        throw _en_err('fal.ai : ' + String(d.error || d.detail || 'génération échouée').slice(0, 200), { fatal: true });
      }
    }
    await sleep(Math.min(8000, 1500 + n * 500));
    n++;
  }
  throw new Error('délai dépassé (fal.ai)');
}

async function falRun(ep, body, onMsg, isStopped) {
  return falWait(await falSubmit(ep, body), onMsg, isStopped);
}

/* ═════════════════════════════════════════════════════════════════════
   IMAGES
   ═════════════════════════════════════════════════════════════════════ */
const _en_SEED = { '16:9': [3840, 2160], '9:16': [2160, 3840], '1:1': [4096, 4096], '4:3': [4096, 3072], '3:4': [3072, 4096] };
const _en_BOOST = ', masterpiece, ultra-detailed, sharp focus, high dynamic range, professional color grading';
const _en_boost = p => {
  p = String(p == null ? '' : p).trim();
  return /masterpiece, ultra-detailed/i.test(p) ? p : p.replace(/[\s.,;]+$/, '') + _en_BOOST;
};

function _en_imgUrl(d) {
  if (!d) return '';
  const a = d.images && d.images[0];
  if (a) return typeof a === 'string' ? a : (a.url || '');
  if (d.image) return typeof d.image === 'string' ? d.image : (d.image.url || '');
  const b = d.data && d.data[0];
  if (b) return b.url || (b.b64_json ? 'data:image/png;base64,' + b.b64_json : '');
  return '';
}
function _en_imgDims(d) {
  const a = d && ((d.images && d.images[0]) || d.image);
  return a && typeof a === 'object' && +a.width > 0 && +a.height > 0 ? { w: +a.width, h: +a.height } : null;
}
function _en_imgSize(url) {
  const m = thumb.meta(url);
  if (m) return Promise.resolve(m);
  if (typeof Image === 'undefined' || !url) return Promise.resolve({ w: 0, h: 0 });
  return new Promise(res => {
    const im = new Image();
    let done = false, to = 0;
    const fin = r => { if (done) return; done = true; clearTimeout(to); im.onload = im.onerror = null; res(r); };
    to = setTimeout(() => fin({ w: 0, h: 0 }), 15000);
    im.onload = () => fin({ w: im.naturalWidth || im.width || 0, h: im.naturalHeight || im.height || 0 });
    im.onerror = () => fin({ w: 0, h: 0 });
    im.src = url;
  });
}
/* Référence lisible par fal.ai : URL http(s) ou data URI */
async function _en_refUrl(u) {
  u = String(u || '');
  if (!u) return null;
  if (/^(https?:|data:)/i.test(u)) return u;
  return refData(u, 2048);
}

async function _en_agnesImg(prompt, refs, ratio) {
  const imgs = (await Promise.all(refs.slice(0, 4).map(r => refData(r, 1024)))).filter(Boolean);
  const mk = size => {
    const body = { model: IMG, prompt: san(prompt), n: 1, size, ratio, extra_body: { response_format: 'url' } };
    if (imgs.length) body.extra_body.image = imgs;
    return call('img', API + '/images/generations', body, 3);
  };
  const size = CFG.agnes.imgSize || '2K';
  let r;
  try { r = await mk(size); } catch (e) {
    if (e.status !== 400 || size === '1K') throw e;
    log('wr', 'taille ' + size + ' refusée par Agnès → 1K');
    CFG.agnes.imgSize = '1K';
    saveCfg();
    r = await mk('1K');
  }
  const d = await r.json();
  const it = d && d.data && d.data[0];
  const u = it && (it.url || (it.b64_json && 'data:image/png;base64,' + it.b64_json));
  if (!u) throw new Error('pas d’image reçue');
  return u;
}

async function genImage(o) {
  o = o || {};
  const m = pickImage(o.model);
  if (!m) throw _en_err('Aucun moteur d’image : ajoutez une clé fal.ai ou Agnès dans Réglages', { fatal: true });
  const ratio = o.ratio || '16:9';
  const refs = (o.refs || []).filter(Boolean);
  const cat = IMODELS[m];
  let u = '', dims = null;
  if (cat.prov === 'fal') {
    const urls = (await Promise.all(refs.slice(0, 6).map(_en_refUrl))).filter(Boolean);
    const prompt = _en_boost(o.prompt);
    let body;
    if (m === 'seedream') {
      const s = _en_SEED[ratio] || _en_SEED['16:9'];
      body = { prompt, image_size: { width: s[0], height: s[1] }, num_images: 1 };
    } else if (m === 'nanopro') {
      body = { prompt, aspect_ratio: ratio, resolution: '4K', num_images: 1, output_format: 'png' };
    } else {
      body = { prompt, aspect_ratio: ratio, num_images: 1 };
    }
    if (urls.length) body.image_urls = urls;
    Object.assign(body, extraOf(m));
    const ep = epOf(m, urls.length && cat.edit ? 'edit' : 't2i');
    log('in', 'image ' + cat.name + (o.kind ? ' (' + o.kind + ')' : '') + ' → ' + ep);
    const d = await falRun(ep, body, o.onMsg, o.isStopped);
    u = _en_imgUrl(d);
    if (!u) throw new Error('pas d’image reçue');
    dims = _en_imgDims(d);
    if (!dims && m === 'seedream' && body.image_size && !extraOf(m).image_size) dims = { w: body.image_size.width, h: body.image_size.height };
  } else {
    log('in', 'image Agnès' + (o.kind ? ' (' + o.kind + ')' : ''));
    u = await _en_agnesImg(o.prompt, refs, ratio);
  }
  const t = await thumb(u);
  if (!dims) dims = thumb.meta(u) || await _en_imgSize(u);
  return { u, w: dims.w || 0, h: dims.h || 0, m, t };
}

async function upscaleImage(url, opt) {
  opt = opt || {};
  if (!url) throw new Error('image manquante');
  if (!hasFal()) throw _en_err('L’upscale 4K nécessite une clé fal.ai (Réglages)', { fatal: true });
  let w = +opt.w || 0, h = +opt.h || 0;
  if (!(w > 0 && h > 0)) {
    await thumb(url);
    const s = await _en_imgSize(url);
    w = s.w; h = s.h;
  }
  const long = Math.max(w, h) || 1920;
  const f = Math.round(clamp(3840 / long, 1.5, 4) * 100) / 100;
  const src = await _en_refUrl(url);
  if (!src) throw new Error('image illisible');
  const body = Object.assign({ image_url: src, upscale_factor: f }, extraOf('topazImage'));
  log('in', 'upscale Topaz ×' + f + ' (' + (w && h ? w + '×' + h : 'taille inconnue') + ')');
  const d = await falRun(epOf('topazImage'), body, opt.onMsg, opt.isStopped);
  const u = _en_imgUrl(d);
  if (!u) throw new Error('pas d’image reçue (upscale)');
  let dims = _en_imgDims(d) || (w && h ? { w: Math.round(w * f), h: Math.round(h * f) } : null);
  const t = await thumb(u);
  if (!dims) dims = thumb.meta(u) || { w: 0, h: 0 };
  return { u, w: dims.w, h: dims.h, t };
}

/* ═════════════════════════════════════════════════════════════════════
   VIDÉOS — corps, lancement, suivi, upscale Topaz, reprise
   ═════════════════════════════════════════════════════════════════════ */
const _en_NEG = 'blur, distortion, low quality, watermark, text, subtitles';
const _en_dims = r => (r === '9:16' ? [480, 854] : r === '1:1' ? [640, 640] : [854, 480]);
function _en_dur(id, dur) {
  const ds = (VMODELS[id] && VMODELS[id].durs) || [5];
  const d = +dur || ds[0];
  return ds.reduce((b, x) => (Math.abs(x - d) < Math.abs(b - d) ? x : b), ds[0]);
}

function videoBody(id, s) {
  s = s || {};
  const audio = s.audio == null ? CFG.audio !== false : !!s.audio;
  const ratio = s.ratio || '16:9';
  const dur = _en_dur(id, s.dur);
  let b;
  if (id === 'kling4k' || id === 'klingpro') {
    b = { prompt: s.prompt, start_image_url: s.image, duration: String(dur), generate_audio: audio, negative_prompt: _en_NEG };
  } else if (id === 'ltx4k') {
    b = { prompt: s.prompt, image_url: s.image, resolution: '2160p', duration: dur, fps: 25, generate_audio: audio };
  } else if (id === 'veo31') {
    b = { prompt: s.prompt, image_url: s.image, duration: '8s', resolution: '1080p', generate_audio: audio, aspect_ratio: ratio === '9:16' ? '9:16' : ratio === '16:9' ? '16:9' : 'auto' };
  } else if (id === 'agnes') {
    const D = _en_dims(ratio);
    b = KEYS.plan === 'plan'
      ? { model: VID.plan, prompt: san(s.prompt), seconds: '10', mode: 'keyframe', size: '720P', aspect_ratio: ratio, first_frame: s.image }
      : { model: VID.free, prompt: san(s.prompt), num_frames: 97, frame_rate: 12, width: D[0], height: D[1], image: s.image };
  } else {
    b = { prompt: s.prompt, image_url: s.image, duration: dur, generate_audio: audio };
  }
  return Object.assign(b, extraOf(id));
}

function _en_videoUrl(d) {
  if (!d) return '';
  const v = d.video;
  if (v) return typeof v === 'string' ? v : (v.url || '');
  if (d.video_url) return d.video_url;
  const a = d.videos && d.videos[0];
  if (a) return typeof a === 'string' ? a : (a.url || '');
  if (d.output) return typeof d.output === 'string' ? d.output : (d.output.url || d.output.video_url || '');
  return d.url || '';
}

/* Un même travail distant n'est suivi qu'une fois, même si plusieurs objets le réclament. */
const _en_jobs = new Map();
function _en_shared(key, run, onMsg) {
  let j = _en_jobs.get(key);
  if (!j) {
    const subs = new Set();
    j = { subs };
    j.p = Promise.resolve().then(() => run(m => subs.forEach(f => { try { f(m); } catch (e) { /* affichage */ } })));
    j.p.then(() => _en_jobs.delete(key), () => _en_jobs.delete(key));
    _en_jobs.set(key, j);
  }
  if (onMsg) j.subs.add(onMsg);
  return j.p;
}
const _en_following = new WeakSet();

function _en_inner(id) {
  try {
    if (id.indexOf('video_') === 0) {
      let b = id.slice(6).replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      const m = atob(b).match(/video_id:([^;]+)/);
      if (m) return m[1].trim();
    }
  } catch (e) { /* identifiant opaque */ }
  return null;
}

/* Suivi Agnès (poll d'origine) → URL de la vidéo */
async function _en_agnesPoll(t, say) {
  const plan = t.plan === 'plan' || t.plan === 'free' ? t.plan : KEYS.plan;
  const model = VID[plan] || VID.free, key = t.k;
  const first = (plan === 'free' ? 30000 : 8000) - (Date.now() - (+t.t0 || 0));
  if (first > 0) { say('en file Agnès…'); await sleep(first); }
  const end = Date.now() + 30 * 60000;
  let n = 0, miss = 0;
  while (Date.now() < end) {
    const ids = [t.id];
    if (t.inner && t.inner !== t.id) ids.push(t.inner);
    const iv = Math.min(20000, 6000 + n * 1500);
    n++;
    let d = null;
    for (let i = 0; i < ids.length; i++) {
      try {
        const r = await xfetch(POLL + '?video_id=' + encodeURIComponent(ids[i]) + '&model_name=' + encodeURIComponent(model), { headers: { Authorization: 'Bearer ' + key } });
        if (r.status === 429) { await sleep(8000); continue; }
        if (!r.ok) { miss++; continue; }
        d = await r.json();
        break;
      } catch (e) { miss++; }
    }
    if (d) {
      const s = String(d.status || d.state || '').toLowerCase();
      say(d.progress ? d.progress + '%' : s);
      if (['completed', 'succeeded', 'done', 'success', 'finished', 'ready'].indexOf(s) >= 0) {
        const u = (d.metadata && (d.metadata.url || d.metadata.video_url)) || (d.output && (d.output.url || d.output.video_url)) || (d.data && (d.data.url || d.data.video_url)) || d.url || d.video_url;
        if (!u) throw new Error('terminé sans URL');
        return u;
      }
      if (['failed', 'error', 'cancelled', 'canceled', 'rejected'].indexOf(s) >= 0) {
        throw new Error(String((d.error && d.error.message) || d.error || 'échec génération').slice(0, 100));
      }
    } else if (miss > 20) throw new Error('suivi impossible');
    await sleep(iv);
  }
  throw new Error('délai dépassé');
}

function _en_guess(t, up) {
  const r = (t && t.ratio) || '16:9';
  const k = up ? [3840, 2160] : null;
  if (t && VMODELS[t.model] && VMODELS[t.model].native && !up) {
    return r === '9:16' ? { w: 2160, h: 3840, d: 0 } : r === '1:1' ? { w: 2160, h: 2160, d: 0 } : { w: 3840, h: 2160, d: 0 };
  }
  if (up && t && t.src && t.f) return { w: Math.round(t.src[0] * t.f), h: Math.round(t.src[1] * t.f), d: 0 };
  return k && t && t.f ? { w: 0, h: 0, d: 0 } : { w: 0, h: 0, d: 0 };
}

async function _en_finish(o, U, url, err, t, dim, up) {
  if (!url) {
    o.vst = 'er'; o.msg = ''; o.err = err || 'vidéo introuvable'; o.task = null;
    log('er', 'vidéo : ' + o.err);
    U(true);
    return;
  }
  let p = dim && dim.w > 0 ? dim : await probeVideo(url);
  if (!(p.w > 0 && p.h > 0)) p = _en_guess(t, up);
  o.video = url;
  o.vw = p.w; o.vh = p.h;
  if (p.d > 0) o.vd = Math.round(p.d * 10) / 10;
  o.vst = 'ok'; o.task = null; o.seen = false; o.msg = ''; o.err = err || '';
  const lab = resLabel(o.vw, o.vh);
  if (err) { log('wr', 'vidéo prête sans upscale (' + err + ')'); toast('Vidéo prête · ' + (lab || 'résolution d’origine'), 'wr'); }
  else { log('ok', 'vidéo prête' + (lab ? ' · ' + lab : '')); toast('Nouvelle vidéo prête' + (lab ? ' · ' + lab : ''), 'ok'); }
  U(true);
}

async function followVideo(o, upd) {
  const U = _en_U(upd);
  if (!o || !o.task || _en_following.has(o)) return;
  _en_following.add(o);
  try {
    let t = o.task;
    if (t.stage !== 'up') {
      const say = m => { o.msg = m; U(false); };
      const url = await _en_shared(t.prov + ':' + t.id, b => (t.prov === 'fal'
        ? falWait(t, b).then(d => { const u = _en_videoUrl(d); if (!u) throw new Error('terminé sans URL'); return u; })
        : _en_agnesPoll(t, b)), say);
      o.video0 = url;
      const cat = VMODELS[t.model] || {};
      let need = !cat.native && CFG.up4k !== false && hasFal();
      let dim = null;
      if (need) {
        o.msg = 'analyse de la vidéo…';
        U(true);
        dim = await probeVideo(url);
        if (dim.w > 0 && dim.h > 0 && Math.min(dim.w, dim.h) >= 2160) need = false;
      }
      if (!need) { await _en_finish(o, U, url, '', t, dim, false); return; }
      const f = dim && dim.w > 0 && dim.h > 0
        ? Math.round(clamp(2160 / Math.min(dim.w, dim.h), 1.01, 4) * 100) / 100
        : (t.prov === 'agnes' ? 3 : 2);
      o.msg = 'upscale 4K · envoi…';
      U(false);
      try {
        const ut = await _en_shared('up:' + t.prov + ':' + t.id, () => falSubmit(epOf('topazVideo'), Object.assign({ video_url: url, upscale_factor: f }, extraOf('topazVideo'))));
        t = o.task = { prov: 'fal', stage: 'up', ep: ut.ep, id: ut.id, st: ut.st, res: ut.res, inner: null, k: null, model: t.model, ratio: t.ratio, f, src: dim && dim.w > 0 ? [dim.w, dim.h] : null, t0: Date.now() };
        o.msg = 'upscale 4K ×' + f + '…';
        log('in', 'upscale Topaz ×' + f + ' envoyé');
        U(true);
      } catch (e) {
        await _en_finish(o, U, url, 'upscale 4K échoué : ' + e.message, t, dim, false);
        return;
      }
    }
    try {
      const say2 = m => { o.msg = 'upscale 4K · ' + m; U(false); };
      const u = await _en_shared('fal:' + t.id, b => falWait(t, b).then(d => { const x = _en_videoUrl(d); if (!x) throw new Error('terminé sans URL'); return x; }), say2);
      await _en_finish(o, U, u, '', t, null, true);
    } catch (e) {
      const src = o.video0 || null;
      await _en_finish(o, U, src, src ? 'upscale 4K échoué : ' + e.message : 'vidéo introuvable : ' + e.message, t, null, false);
    }
  } catch (e) {
    o.vst = 'er'; o.msg = ''; o.task = null;
    o.err = String((e && e.message) || e).slice(0, 200);
    log('er', 'vidéo : ' + o.err);
    U(true);
  } finally {
    _en_following.delete(o);
  }
}

async function _en_agnesLaunch(o, spec, ratio, U, upd) {
  let k;
  o.msg = 'en attente d’un créneau Agnès…';
  U(false);
  try { k = await slot('vid'); } catch (e) {
    if (e.message === 'stop') { o.vst = 'wait'; o.msg = ''; U(true); return 'later'; }
    o.vst = 'er'; o.msg = ''; o.err = e.message; U(true); return 'err';
  }
  let fr = String(spec.image);
  if (!/^(https?:|data:)/i.test(fr)) fr = (await refData(fr, 1024)) || '';
  if (!fr) { o.vst = 'er'; o.msg = ''; o.err = 'image de départ illisible'; U(true); return 'err'; }
  const body = videoBody('agnes', Object.assign({}, spec, { image: fr, ratio }));
  o.msg = 'envoi…';
  U(false);
  let r;
  try {
    r = await xfetch(API + '/videos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + k.k }, body: JSON.stringify(body) });
  } catch (e) {
    o.vst = 'wait'; o.msg = ''; log('wr', e.message); U(true); return 'later';
  }
  if (r.status === 503) {
    const t = await r.text().catch(() => '');
    log('wr', '503 ' + t.slice(0, 120));
    o.vst = 'wait'; o.msg = ''; U(true); return 'full';
  }
  if (r.status === 429) {
    k.cool = Date.now() + (parseInt(r.headers.get('Retry-After'), 10) || 30) * 1000;
    o.vst = 'wait'; o.msg = ''; U(true); return 'later';
  }
  if (!r.ok) {
    const t = (await r.text().catch(() => '')).slice(0, 140);
    if ([401, 402, 403].indexOf(r.status) >= 0 && ++k.bad >= 2) { k.off = true; log('wr', 'clé …' + k.k.slice(-4) + ' désactivée'); }
    o.vst = 'er'; o.msg = ''; o.err = 'HTTP ' + r.status + ' ' + t;
    log('er', 'vidéo ' + o.err);
    U(true);
    return 'err';
  }
  let d = null;
  try { d = await r.json(); } catch (e) { d = null; }
  const id = d && (d.video_id || d.id || d.task_id || (d.data && (d.data.video_id || d.data.id)));
  if (!id) { o.vst = 'er'; o.msg = ''; o.err = 'pas de video_id'; U(true); return 'err'; }
  o.task = { prov: 'agnes', stage: 'gen', ep: null, id: String(id), st: null, res: null, inner: _en_inner(String(id)), k: k.k, model: 'agnes', plan: KEYS.plan, ratio, t0: Date.now() };
  o.msg = 'envoyée';
  log('ok', 'vidéo envoyée (clé …' + k.k.slice(-4) + ')');
  U(true);
  followVideo(o, upd);
  return 'ok';
}

async function startVideo(o, spec, upd) {
  const U = _en_U(upd);
  spec = spec || {};
  const m = pickVideo(spec.model);
  // État « run » posé tout de suite : la file ne relance pas ce plan pendant l'envoi.
  o.vst = 'run'; o.msg = 'envoi…'; o.err = ''; o.task = null;
  o.video = null; o.video0 = null; o.vw = 0; o.vh = 0;
  o.vm = m || spec.model || '';
  if (!m) { o.vst = 'er'; o.msg = ''; o.err = 'Aucun moteur vidéo : ajoutez une clé fal.ai ou Agnès dans Réglages'; U(true); return 'err'; }
  if (!spec.image) { o.vst = 'er'; o.msg = ''; o.err = 'image de départ manquante'; U(true); return 'err'; }
  U(false);
  const ratio = spec.ratio || '16:9';
  if (VMODELS[m].prov !== 'fal') {
    try { return await _en_agnesLaunch(o, spec, ratio, U, upd); } catch (e) {
      o.vst = 'er'; o.msg = ''; o.err = String(e && e.message || e); U(true); return 'err';
    }
  }
  try {
    const img = await _en_refUrl(spec.image);
    if (!img) throw _en_err('image de départ illisible', { fatal: true });
    const body = videoBody(m, Object.assign({}, spec, { image: img, ratio }));
    const t = await falSubmit(epOf(m), body);
    o.task = { prov: 'fal', stage: 'gen', ep: t.ep, id: t.id, st: t.st, res: t.res, inner: null, k: null, model: m, ratio, t0: Date.now() };
    o.msg = 'file d’attente';
    log('ok', 'vidéo envoyée à fal.ai · ' + VMODELS[m].name);
    U(true);
    followVideo(o, upd);
    return 'ok';
  } catch (e) {
    if (e.fatal) {
      o.vst = 'er'; o.msg = ''; o.err = e.message;
      log('er', 'vidéo : ' + e.message);
      U(true);
      return 'err';
    }
    o.vst = 'wait'; o.msg = '';
    log('wr', 'vidéo : ' + e.message + ' → nouvel essai plus tard');
    U(true);
    return 'later';
  }
}

function resumeVideo(o, upd) {
  const U = _en_U(upd);
  if (!o || o.vst !== 'run') return Promise.resolve();
  const t = o.task;
  if (!t) {
    if (o.video0) return _en_finish(o, U, o.video0, '', null, null, false);
    o.vst = 'wait'; o.msg = '';
    U(true);
    return Promise.resolve();
  }
  if (t.prov === 'agnes' && !KEYS.list.some(k => k.k === t.k)) {
    o.vst = 'wait'; o.task = null; o.msg = '';
    U(true);
    return Promise.resolve();
  }
  if (t.prov === 'fal' && !hasFal()) {
    if (t.stage === 'up' && o.video0) return _en_finish(o, U, o.video0, 'upscale 4K interrompu : clé fal.ai absente', t, null, false);
    o.vst = 'wait'; o.task = null; o.msg = '';
    U(true);
    return Promise.resolve();
  }
  o.msg = 'reprise du suivi…';
  return followVideo(o, upd);
}

function is4k(o) { return !!o && Math.min(+o.vw || 0, +o.vh || 0) >= 2160; }

function resLabel(w, h) {
  w = +w || 0; h = +h || 0;
  if (!w || !h) return '';
  const m = Math.min(w, h);
  if (m >= 2160) return '4K UHD';
  if (m >= 1440) return '1440p';
  if (m >= 1080) return '1080p';
  if (m >= 720) return '720p';
  return w + '×' + h;
}

function estimateVideoUSD(id, seconds) {
  const m = VMODELS[id];
  if (!m) return null;
  if (m.prov === 'agnes') return 0;
  if (m.usd == null) return null;
  const s = +seconds > 0 ? +seconds : (m.durs && m.durs[0]) || 5;
  return Math.round(m.usd * s * 1000) / 1000;
}

/* ═════════════════════════════════════════════════════════════════════
   PROMPT MAGIQUE
   ═════════════════════════════════════════════════════════════════════ */
async function enhancePrompt(prompt, kind) {
  const p = String(prompt == null ? '' : prompt).trim();
  if (!p) return '';
  const vid = kind === 'video';
  const sys = 'You are a world-class prompt engineer for state-of-the-art ' +
    (vid ? 'image-to-video models (Kling 3.0, Veo 3.1, LTX-2)' : 'text-to-image models (Seedream 4.5, Nano Banana Pro)') +
    '. Rewrite the user idea (written in any language) as ONE rich, precise English prompt for ' +
    (vid ? 'a single cinematic video shot' : 'a breathtaking, ultra-detailed still image') +
    '. Keep every element of the user intent: subjects, actions, setting, mood and style. Keep any quoted dialogue word for word in its original language. Add concrete visual detail: ' +
    (vid ? 'subject motion, camera movement, shot size and lens, lighting, atmosphere, color palette, ambient sound' : 'composition, shot size and lens, lighting, textures and materials, color palette, atmosphere') +
    '. No lists, no explanations, no preamble, no quotation marks around the answer: output only the prompt, 60 to 120 words.';
  const t = await chat(sys, p, 700, 0.7);
  const r = _en_unthink(t)
    .replace(/```[a-z]*|```/gi, '')
    .trim()
    .replace(/^(enhanced prompt|improved prompt|prompt|here is[^:\n]*)\s*:\s*/i, '')
    .replace(/^["'“«\s]+|["'”»\s]+$/g, '')
    .trim();
  return r.length >= 12 ? r : p;
}
