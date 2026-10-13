#!/usr/bin/env node
/* Tests des moteurs IA de CINÉ-GENESIS (core.js + engines.js), sans dépendance :
   les scripts sont chargés dans un contexte vm avec un DOM minimal et un faux réseau.
   Lancement : node tools/test-film.js */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'film', 'src', 'main', 'assets', 'web', 'js');

/* ───────── Contexte navigateur minimal ───────── */
const realSetTimeout = setTimeout;
let route = () => [404, {}];
const requests = [];

function makeContext() {
  const store = new Map();
  const el = () => ({
    style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, children: [], firstChild: null,
  });
  const document = {
    body: el(), documentElement: el(),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {},
    createElement(tag) {
      if (tag !== 'video') return el();
      // Sonde vidéo : la définition est déduite du nom du fichier de test.
      const v = { muted: true, playsInline: true, removeAttribute() {}, load() {} };
      Object.defineProperty(v, 'src', {
        set(u) {
          const m = String(u).match(/(\d{3,4})p?\.(mp4|webm)/);
          const h = m ? +m[1] : 0;
          v.videoWidth = h ? Math.round(h * 16 / 9) : 0;
          v.videoHeight = h;
          v.duration = 5;
          realSetTimeout(() => (h ? v.onloadedmetadata && v.onloadedmetadata() : v.onerror && v.onerror()), 1);
        },
      });
      return v;
    },
  };
  const fetch = async (url, o) => {
    o = o || {};
    let body = null;
    try { body = o.body ? JSON.parse(o.body) : null; } catch (e) { body = o.body; }
    const req = { url: String(url), method: (o.method || 'GET').toUpperCase(), headers: o.headers || {}, body };
    requests.push(req);
    const [status, data, headers] = route(req) || [404, {}];
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    const h = Object.assign({ 'content-type': 'application/json' }, headers || {});
    return { status, ok: status >= 200 && status < 300, headers: { get: k => h[String(k).toLowerCase()] ?? null },
      text: async () => text, arrayBuffer: async () => Buffer.from(text) };
  };
  const ctx = {
    console, URL, TextEncoder, TextDecoder, Promise, JSON, Math, Date, Map, Set, WeakSet, Array, Object, String, Number, Error,
    // Délais accélérés : les attentes de l'application (files, quotas) passent en quelques millisecondes.
    setTimeout: (f, ms) => realSetTimeout(f, Math.min(+ms || 0, 3)),
    clearTimeout, setInterval: () => 0, clearInterval: () => {},
    atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s, 'binary').toString('base64'),
    fetch, document, navigator: {}, location: { origin: 'http://test' },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), key: i => [...store.keys()][i], get length() { return store.size; } },
    Image: undefined, indexedDB: undefined,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['core.js', 'engines.js']) vm.runInContext(fs.readFileSync(path.join(WEB, f), 'utf8'), ctx, { filename: f });
  return ctx;
}

const ctx = makeContext();
const G = name => vm.runInContext(name, ctx);
const run = code => vm.runInContext(code, ctx);

/* ───────── Mini-cadre de test ───────── */
let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((m || 'valeurs différentes') + ' : ' + A + ' ≠ ' + B); };
const ok = (v, m) => { if (!v) throw new Error(m || 'condition fausse'); };

function resetCfg(over) {
  run(`(() => {
    const d = { agnes:{keys:[],plan:'free',imgSize:'2K',vidRes:'1080'}, fal:{key:''}, oai:{url:'',model:'',key:''},
      eng:{text:'auto',image:'auto',video:'auto'}, up4k:true, local4k:false, audio:true, falPar:3,
      exp:{codec:'auto',mbps:60,sharpen:35}, ovr:{} };
    Object.keys(CFG).forEach(k => delete CFG[k]);
    Object.assign(CFG, JSON.parse(JSON.stringify(d)));
    KEYS.list = []; KEYS.F = 1;
  })()`);
  if (over) run('(o => { for (const k in o) { if (CFG[k] && typeof CFG[k] === "object" && !Array.isArray(CFG[k])) Object.assign(CFG[k], o[k]); else CFG[k] = o[k]; } syncKeys(); })(' + JSON.stringify(over) + ')');
  requests.length = 0;
}

/* Faux fal.ai : file d'attente IN_QUEUE → IN_PROGRESS → COMPLETED */
function falRouter(results, opts) {
  opts = opts || {};
  const jobs = {};
  let seq = 0;
  return req => {
    if (!/^Key \S/.test(req.headers.Authorization || '')) return [401, { detail: 'no key' }];
    if (opts.badKey) return [401, { detail: 'Invalid key' }];
    let m = req.url.match(/^https:\/\/queue\.fal\.run\/(.+?)\/requests\/([^/]+)\/status$/);
    if (m) {
      const j = jobs[m[2]];
      if (!j) return [404, { detail: 'not found' }];
      j.n++;
      return [200, { status: j.n < 2 ? 'IN_QUEUE' : j.n < 3 ? 'IN_PROGRESS' : 'COMPLETED', queue_position: 0 }];
    }
    m = req.url.match(/^https:\/\/queue\.fal\.run\/(.+?)\/requests\/([^/]+)$/);
    if (m) {
      const j = jobs[m[2]];
      const r = results(j.ep, j.body);
      return Array.isArray(r) ? r : [200, r];
    }
    m = req.url.match(/^https:\/\/queue\.fal\.run\/(.+)$/);
    if (m && req.method === 'POST') {
      if (opts.submit422) return [422, { detail: [{ loc: ['body', 'duration'], msg: 'value is not a valid enumeration member' }] }];
      const id = 'r' + (++seq);
      jobs[id] = { ep: m[1], body: req.body, n: 0 };
      const app = m[1].split('/').slice(0, 2).join('/');
      return [200, { request_id: id, status_url: `https://queue.fal.run/${app}/requests/${id}/status`, response_url: `https://queue.fal.run/${app}/requests/${id}` }];
    }
    return [404, { detail: 'route inconnue' }];
  };
}

/* ───────── Tests ───────── */
test('J() lit le JSON entouré de texte, les virgules finales et les retours à la ligne', () => {
  const J = G('J');
  eq(J('Voici :\n```json\n{"a":1,"b":[1,2,],}\n```'), { a: 1, b: [1, 2] });
  eq(J('{"t":"ligne 1\nligne 2"}'), { t: 'ligne 1\nligne 2' });
  eq(J('pas de json'), null);
  eq(J(''), null);
});

test('Corps des vidéos fal.ai (Kling 4K/Pro, LTX 2160p, Veo 3.1) et paramètres avancés', () => {
  resetCfg({ fal: { key: 'k:s' } });
  const vb = G('videoBody');
  const s = { prompt: 'p', image: 'https://x/i.jpg', dur: 10, ratio: '9:16', audio: true };
  const k = vb('kling4k', s);
  eq([k.start_image_url, k.duration, k.generate_audio], ['https://x/i.jpg', '10', true]);
  eq(vb('klingpro', s).duration, '10');
  const l = vb('ltx4k', Object.assign({}, s, { dur: 7 }));
  eq([l.image_url, l.resolution, l.fps], ['https://x/i.jpg', '2160p', 25]);
  ok([6, 8, 10].includes(l.duration), 'durée LTX arrondie aux valeurs permises');
  const v = vb('veo31', s);
  eq([v.duration, v.resolution, v.aspect_ratio], ['8s', '1080p', '9:16']);
  eq(vb('veo31', Object.assign({}, s, { ratio: '1:1' })).aspect_ratio, 'auto');
  run(`CFG.ovr.kling4k = { extra: '{"cfg_scale":0.7}' }`);
  eq(vb('kling4k', s).cfg_scale, 0.7);
  run(`CFG.ovr.kling4k = { extra: '{pas du json' }`);
  eq(vb('kling4k', s).cfg_scale, undefined, 'JSON invalide ignoré');
});

test('Corps des vidéos Agnès : 1080p par défaut, résolution d’origine en repli', () => {
  resetCfg({ agnes: { keys: ['sk-test-0001'] } });
  const vb = G('videoBody');
  const free = vb('agnes', { prompt: 'p', image: 'data:x', ratio: '16:9' });
  eq([free.model, free.width, free.height], ['agnes-video-v2.0', 1920, 1080]);
  eq([vb('agnes', { prompt: 'p', image: 'x', ratio: '9:16', res: '720' }).width], [480]);
  resetCfg({ agnes: { keys: ['sk-test-0001'], plan: 'plan' } });
  const plan = vb('agnes', { prompt: 'p', image: 'x', ratio: '16:9' });
  eq([plan.model, plan.size, plan.first_frame], ['agnes-video-2.5-flash', '1080P', 'x']);
});

test('Choix des moteurs selon les clés', () => {
  resetCfg();
  eq([G('pickImage')(), G('pickVideo')(), G('pickText')()], [null, null, null]);
  resetCfg({ agnes: { keys: ['sk-agnes-0001'] } });
  eq([G('pickImage')(), G('pickVideo')('kling4k'), G('pickText')()], ['agnes', 'agnes', 'agnes']);
  resetCfg({ fal: { key: 'id:secret' } });
  eq([G('pickImage')(), G('pickVideo')(), G('pickText')()], ['seedream', 'kling4k', 'fal']);
  run(`CFG.eng.video = 'veo31'`);
  eq(G('pickVideo')(), 'veo31');
  eq(G('pickVideo')('ltx4k'), 'ltx4k', 'le choix explicite passe avant le défaut');
  resetCfg({ oai: { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: 'sk' }, agnes: { keys: ['sk-agnes-0001'] } });
  eq(G('pickText')(), 'oai');
});

test('Estimations de prix, libellés de définition et 4K', () => {
  const est = G('estimateVideoUSD');
  eq(est('kling4k', 5), 2.1);
  eq(est('ltx4k', 10), 2.4);
  eq(est('agnes', 10), 0);
  eq(est('veo31', 8), 3.2, 'Veo 3.1 : 0,40 $/s avec le son');
  eq(est('veo31', 8, false), 1.6, 'tarif sans son');
  const rl = G('resLabel');
  eq([rl(3840, 2160), rl(2160, 3840), rl(2560, 1440), rl(1920, 1080), rl(1280, 720), rl(854, 480), rl(0, 0)],
    ['4K UHD', '4K UHD', '1440p', '1080p', '720p', '854×480', '']);
  ok(G('is4k')({ vw: 3840, vh: 2160 }) && !G('is4k')({ vw: 1920, vh: 1080 }));
});

test('fal.ai : file d’attente complète et image Seedream 4K', async () => {
  resetCfg({ fal: { key: 'id:secret' } });
  route = falRouter(ep => ({ images: [{ url: 'https://cdn/img.png', width: 2160, height: 3840 }] }));
  const msgs = [];
  ctx.__msgs = msgs;
  const r = await run(`genImage({ prompt: 'un chat', ratio: '9:16', onMsg: m => __msgs.push(m) })`);
  eq([r.u, r.w, r.h, r.m], ['https://cdn/img.png', 2160, 3840, 'seedream']);
  const sub = requests.find(q => q.method === 'POST');
  ok(sub.url.endsWith('fal-ai/bytedance/seedream/v4.5/text-to-image'), 'point d’accès Seedream');
  eq(sub.body.image_size, { width: 2160, height: 3840 });
  ok(/masterpiece/.test(sub.body.prompt), 'prompt enrichi');
  ok(msgs.some(m => /file/.test(m)) && msgs.some(m => /génération/.test(m)), 'messages de progression');
});

test('fal.ai : images de référence → point d’accès « edit »', async () => {
  resetCfg({ fal: { key: 'id:secret' } });
  route = falRouter(() => ({ images: [{ url: 'https://cdn/e.png' }] }));
  await run(`genImage({ prompt: 'x', refs: ['https://cdn/ref.png'], ratio: '16:9', model: 'nanopro' })`);
  const sub = requests.find(q => q.method === 'POST');
  ok(sub.url.endsWith('fal-ai/nano-banana-pro/edit'), sub.url);
  eq([sub.body.resolution, sub.body.aspect_ratio, sub.body.image_urls], ['4K', '16:9', ['https://cdn/ref.png']]);
});

test('fal.ai : erreurs claires (clé refusée, paramètres refusés)', async () => {
  resetCfg({ fal: { key: 'id:secret' } });
  route = falRouter(() => ({}), { badKey: true });
  let e = await run(`falSubmit('fal-ai/x', {}).then(() => null, e => e)`);
  ok(e && e.fatal && /clé fal\.ai refusée/.test(e.message), e && e.message);
  route = falRouter(() => ({}), { submit422: true });
  e = await run(`falSubmit('fal-ai/x', {}).then(() => null, e => e)`);
  ok(e && e.fatal && /paramètres refusés/.test(e.message) && /duration/.test(e.message), e && e.message);
  route = () => [403, { detail: 'User is locked. Reason: Exhausted balance.' }];
  e = await run(`falSubmit('fal-ai/x', {}).then(() => null, e => e)`);
  ok(e && /crédit fal\.ai insuffisant/.test(e.message), e && e.message);
});

test('Vidéo Kling 4K natif : pas d’upscale, définition 4K', async () => {
  resetCfg({ fal: { key: 'id:secret' } });
  route = falRouter(() => ({ video: { url: 'https://cdn/v2160.mp4' } }));
  const o = {};
  const st = await run(`(o => startVideo(o, { model: 'kling4k', prompt: 'p', image: 'https://cdn/i.png', dur: 5, ratio: '16:9' }, () => {}))`)(o);
  eq(st, 'ok');
  await waitFor(() => o.vst === 'ok');
  eq([o.video, o.vw, o.vh, o.task], ['https://cdn/v2160.mp4', 3840, 2160, null]);
  ok(!requests.some(q => /topaz/.test(q.url)), 'aucun appel Topaz');
});

test('Vidéo 1080p (Kling Pro) : upscale Topaz automatique vers la 4K', async () => {
  resetCfg({ fal: { key: 'id:secret' } });
  route = falRouter(ep => (/topaz/.test(ep) ? { video: { url: 'https://cdn/up2160.mp4' } } : { video: { url: 'https://cdn/v1080.mp4' } }));
  const o = {};
  await run(`(o => startVideo(o, { model: 'klingpro', prompt: 'p', image: 'https://cdn/i.png', ratio: '16:9' }, () => {}))`)(o);
  await waitFor(() => o.vst === 'ok');
  const up = requests.find(q => q.method === 'POST' && /topaz/.test(q.url));
  ok(up, 'Topaz appelé');
  eq([up.body.video_url, up.body.upscale_factor], ['https://cdn/v1080.mp4', 2]);
  eq([o.video0, o.video, o.vw, o.vh, o.err], ['https://cdn/v1080.mp4', 'https://cdn/up2160.mp4', 3840, 2160, '']);
});

test('Upscale Topaz en échec : la vidéo d’origine est gardée', async () => {
  resetCfg({ fal: { key: 'id:secret' } });
  route = falRouter(ep => (/topaz/.test(ep) ? [422, { detail: 'video too long' }] : { video: { url: 'https://cdn/v1080.mp4' } }));
  const o = {};
  await run(`(o => startVideo(o, { model: 'veo31', prompt: 'p', image: 'https://cdn/i.png', ratio: '16:9' }, () => {}))`)(o);
  await waitFor(() => o.vst === 'ok' || o.vst === 'er');
  eq([o.vst, o.video, o.vw], ['ok', 'https://cdn/v1080.mp4', 1920]);
  ok(/upscale 4K échoué/.test(o.err), o.err);
});

test('Agnès : image 2K refusée → repli 1K, taille mémorisée après succès', async () => {
  resetCfg({ agnes: { keys: ['sk-agnes-0001'] } });
  route = req => {
    if (/images\/generations$/.test(req.url)) return req.body.size === '1K' ? [200, { data: [{ url: 'https://a/i.jpg' }] }] : [400, { error: 'size' }];
    return [404, {}];
  };
  const r = await run(`genImage({ prompt: 'x', ratio: '16:9' })`);
  eq([r.u, r.m, G('CFG').agnes.imgSize], ['https://a/i.jpg', 'agnes', '1K']);
  eq(requests.filter(q => /images/.test(q.url)).map(q => q.body.size), ['2K', '1K']);
});

test('Agnès : vidéo 1080p refusée → résolution d’origine, puis suivi jusqu’à la vidéo', async () => {
  resetCfg({ agnes: { keys: ['sk-agnes-0001'] }, up4k: false });
  const inner = 'abc123';
  const vid = 'video_' + Buffer.from('task:1;video_id:' + inner + ';x').toString('base64').replace(/=+$/, '');
  route = req => {
    if (/\/videos$/.test(req.url)) return req.body.width === 1920 ? [400, { error: 'bad size' }] : [200, { video_id: vid }];
    if (/agnesapi\?video_id=/.test(req.url)) return [200, { status: 'completed', metadata: { url: 'https://a/v720.mp4' } }];
    return [404, {}];
  };
  const o = {};
  const st = await run(`(o => startVideo(o, { model: 'agnes', prompt: 'p', image: 'data:image/jpeg;base64,AAAA', ratio: '16:9' }, () => {}))`)(o);
  eq(st, 'ok');
  eq(G('CFG').agnes.vidRes, '720');
  eq(o.task && o.task.inner, inner, 'identifiant interne décodé');
  await waitFor(() => o.vst === 'ok' || o.vst === 'er', 8000);
  eq([o.vst, o.video, o.vh], ['ok', 'https://a/v720.mp4', 720]);
});

test('Agnès : quota 429 → pause de la clé puis nouvel essai', async () => {
  resetCfg({ agnes: { keys: ['sk-agnes-0001'] } });
  let n = 0;
  route = req => (/chat\/completions$/.test(req.url)
    ? (++n === 1 ? [429, { error: 'rate' }, { 'retry-after': '1' }] : [200, { choices: [{ message: { content: '{"ok":true}' } }] }])
    : [404, {}]);
  const t0 = Date.now();
  const j = await run(`llmJSON('sys', 'user', 50, 0)`);
  eq(j, { ok: true });
  ok(n === 2, 'deux appels');
  ok(Date.now() - t0 >= 900, 'la clé a bien été mise en pause ~1 s');
});

test('IA texte compatible OpenAI (DeepSeek…)', async () => {
  resetCfg({ oai: { url: 'https://api.deepseek.com/v1/', model: 'deepseek-chat', key: 'sk-x' } });
  route = req => (req.url === 'https://api.deepseek.com/v1/chat/completions' ? [200, { choices: [{ message: { content: '<think>…</think>Bonjour' } }] }] : [404, {}]);
  eq(await run(`chat('s', 'u', 10, 0)`), 'Bonjour');
  eq(requests[0].headers.Authorization, 'Bearer sk-x');
  eq(requests[0].body.model, 'deepseek-chat');
});

test('Sans aucune clé : erreur explicite', async () => {
  resetCfg();
  const e = await run(`chat('s','u',10,0).then(() => null, e => e)`);
  ok(e && e.fatal && /Réglages/.test(e.message), e && e.message);
  const o = {};
  eq(await run(`(o => startVideo(o, { prompt: 'p', image: 'x' }, () => {}))`)(o), 'err');
  ok(/Réglages/.test(o.err), o.err);
});

test('Agnès : un refus sans rapport avec la taille ne la dégrade pas', async () => {
  resetCfg({ agnes: { keys: ['sk-agnes-0001'] } });
  route = req => (/images\/generations$/.test(req.url) ? [400, { error: 'content policy' }] : [404, {}]);
  const e = await run(`genImage({ prompt: 'x', ratio: '16:9' }).then(() => null, e => e)`);
  ok(e, 'erreur attendue');
  eq(G('CFG').agnes.imgSize, '2K', 'taille d’origine conservée');
});

test('fal.ai : coupure réseau pendant le suivi → la tâche payée est gardée et reprise', async () => {
  resetCfg({ fal: { key: 'id:secret' } });
  const base = falRouter(() => ({ video: { url: 'https://cdn/v2160.mp4' } }));
  // Vraie coupure réseau : les 3 premiers suivis de statut échouent.
  const realFetch = ctx.fetch;
  let drops = 3;
  ctx.fetch = async (u, o) => { if (/\/status$/.test(u) && drops-- > 0) throw new Error('Failed to fetch'); return realFetch(u, o); };
  route = base;
  const o = {};
  eq(await run(`(o => startVideo(o, { model: 'kling4k', prompt: 'p', image: 'https://cdn/i.png' }, () => {}))`)(o), 'ok');
  await waitFor(() => o.vst === 'ok' || o.vst === 'er', 8000);
  ctx.fetch = realFetch;
  eq([o.vst, o.video], ['ok', 'https://cdn/v2160.mp4']);
  eq(requests.filter(q => q.method === 'POST').length, 1, 'une seule génération payée');
});

test('fal.ai : soumission coupée en route → pas de second envoi automatique', async () => {
  resetCfg({ fal: { key: 'id:secret' } });
  const realFetch = ctx.fetch;
  let posts = 0;
  ctx.fetch = async (u, o) => { if (o && o.method === 'POST') { posts++; throw new Error('connexion réinitialisée'); } return realFetch(u, o); };
  const e = await run(`falSubmit('fal-ai/kling-video/v3/4k/image-to-video', { prompt: 'p' }).then(() => null, e => e)`);
  ctx.fetch = realFetch;
  ok(e && e.fatal && /historique/.test(e.message), e && e.message);
  eq(posts, 1, 'un seul envoi');
});

test('fal.ai : IA texte via le routeur OpenRouter (any-llm retiré)', async () => {
  resetCfg({ fal: { key: 'id:secret' } });
  route = req => (req.url === 'https://fal.run/openrouter/router' ? [200, { output: '{"ok":1}' }] : [404, {}]);
  eq(await run(`llmJSON('s', 'u', 100, 0.5)`), { ok: 1 });
  const q = requests.find(r => /openrouter/.test(r.url));
  ok(q && /gemini/.test(q.body.model) && q.body.system_prompt && q.body.prompt === 'u', JSON.stringify(q && q.body));
});

test('genImage : tâche fal enregistrée puis reprise sans nouvelle soumission', async () => {
  resetCfg({ fal: { key: 'id:secret' } });
  route = falRouter(() => ({ images: [{ url: 'https://cdn/r.png', width: 3840, height: 2160 }] }));
  let saved = null;
  ctx.__onTask = t => { saved = t; };
  await run(`genImage({ prompt: 'x', onTask: t => __onTask(t) })`);
  ok(saved && saved.id && saved.st, 'tâche transmise');
  const n = requests.filter(q => q.method === 'POST').length;
  ctx.__task = saved;
  const r = await run(`genImage({ prompt: 'x', task: __task })`);
  eq(r.u, 'https://cdn/r.png');
  eq(requests.filter(q => q.method === 'POST').length, n, 'aucune nouvelle soumission');
});

test('Facteur Topaz arrondi au-dessus : toujours ≥ 2160 px', async () => {
  resetCfg({ fal: { key: 'id:secret' } });
  route = falRouter(ep => (/topaz/.test(ep) ? { video: { url: 'https://cdn/up2160.mp4' } } : { video: { url: 'https://cdn/v768.mp4' } }));
  const o = {};
  await run(`(o => startVideo(o, { model: 'klingpro', prompt: 'p', image: 'https://cdn/i.png' }, () => {}))`)(o);
  await waitFor(() => o.vst === 'ok');
  const up = requests.find(q => q.method === 'POST' && /topaz/.test(q.url));
  ok(up.body.upscale_factor * 768 >= 2160, 'facteur ' + up.body.upscale_factor);
});

async function waitFor(fn, ms) {
  const end = Date.now() + (ms || 5000);
  while (Date.now() < end) { if (fn()) return; await new Promise(r => realSetTimeout(r, 10)); }
  throw new Error('délai dépassé en attendant la condition');
}

(async () => {
  for (const t of tests) {
    try { await t.fn(); pass++; console.log('  ✓ ' + t.name); }
    catch (e) { fail++; console.log('  ✕ ' + t.name + '\n      ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join('\n      ')); }
  }
  console.log(`\n${pass} test(s) réussi(s), ${fail} échec(s)`);
  process.exit(fail ? 1 : 0);
})();
