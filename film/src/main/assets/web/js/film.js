/* CINÉ-GENESIS — Film : pipeline en sept étapes (genre, synopsis, personnages, scènes, plans, vidéos, montage 4K).
   Portage de la page HTML d'origine : mêmes prompts, même file vidéo Agnès (paliers d'attente), mêmes sessions.
   Seule globale définie : FILM. Les actions vont dans ACT (préfixe « f »), les saisies dans ON_INPUT / ON_CHANGE. */
'use strict';

const FILM = (() => {
  /* ═════════════════════════════════════════════════════════════════════
     CONSTANTES
     ═════════════════════════════════════════════════════════════════════ */
  const S_GENRE = 0, S_SYN = 1, S_CHARS = 2, S_SCENES = 3, S_SHOTS = 4, S_VIDEOS = 5, S_MONTAGE = 6;
  const STEPS = ['Genre', 'Synopsis', 'Personnages', 'Scènes', 'Plans', 'Vidéos', 'Montage 4K'];
  const NSTEP = STEPS.length;
  const G = [['Fiction', [
    "Court-métrage d'auteur|contemplative arthouse short film, natural light, 35mm grain",
    'Drame|naturalistic drama, muted palette, intimate framing',
    'Comédie|bright warm comedy, lively colors, wide lenses',
    'Thriller|tense thriller, low-key lighting, cold teal tones',
    'Horreur|atmospheric horror, deep shadows, desaturated',
    'Science-fiction|visionary sci-fi, vast futuristic scale, clean cold light',
    'Fantasy|epic fantasy, painterly landscapes, golden hour',
    'Western|dusty western, anamorphic wide, sun-baked tones',
    'Film noir|black and white film noir, hard shadows, rain',
    'Romance|soft romantic cinema, warm bokeh, pastel light',
    'Aventure|adventure blockbuster, dynamic wide shots, saturated',
    'Action|kinetic action, high contrast, motion energy',
    'Guerre|gritty war film, desaturated, handheld',
    'Historique|period drama, authentic costumes, candlelight',
    'Policier|crime investigation, neon night city, moody',
    'Cyberpunk|cyberpunk neon rain, dense city, magenta and cyan',
    'Post-apocalyptique|post-apocalyptic wasteland, rusted ruins, dusty light',
    'Conte merveilleux|fairy tale storybook cinema, magical glow',
  ]], ['Réel', [
    'Documentaire|observational documentary, natural light, real locations',
    'Docu-fiction|docu-fiction hybrid, handheld, authentic',
    'Biopic|biographical drama, period accurate, intimate close-ups',
    'Reportage|journalistic report, handheld, available light',
    'Film nature|nature documentary, telephoto wildlife, majestic landscapes',
    "Film d'archives|archival footage look, grainy, faded colors",
  ]], ['Animation', [
    'Animation 2D|hand-drawn 2D animation, flat colors, ink outlines',
    'Anime|japanese anime cinematic, detailed backgrounds, dramatic lighting',
    'Stop-motion|stop-motion puppets, handmade textures, tabletop sets',
    'Dessin animé enfants|colorful kids cartoon, rounded shapes, cheerful',
    'Style Moebius|Moebius ligne claire comic art, pastel desert colors, flat non-3D drawing',
  ]], ['Expérimental', [
    'Poème visuel|poetic visual essay, abstract imagery, slow',
    'Film contemplatif|slow cinema, long takes, static framing',
    'Film muet|silent film look, expressive acting, grain',
    'Vidéo-art|video art, surreal, bold color fields',
    'Plan-séquence|single continuous take, tracking camera, seamless',
  ]], ['Formats courts', [
    'Bande-annonce|movie trailer, epic cuts, dramatic lighting',
    'Publicité|premium commercial, glossy, product hero shots',
    'Clip musical|music video, stylized, rhythmic visuals',
    'Teaser|teaser, mysterious, minimal reveals',
  ]]];
  const RATIOS = [['16:9', 'Paysage 16:9', 'cinéma'], ['9:16', 'Portrait 9:16', 'mobile'], ['1:1', 'Carré 1:1', 'réseaux']];
  const NSC = [[3, 'Court', '3 scènes'], [5, 'Moyen', '5 scènes'], [8, 'Long', '8 scènes'], [12, 'Très long', '12 scènes']];
  const OUT4K = { '16:9': [3840, 2160], '9:16': [2160, 3840], '1:1': [2160, 2160] };
  const LBL = { wait: 'en attente', run: 'en cours', ok: 'prête', er: 'échec' };
  const OK_DURING = { fstoptask: 1, fretrytask: 1, fcanceltask: 1, fsess: 1, fsclose: 1, fplay: 1, fexport: 1 };

  /* ═════════════════════════════════════════════════════════════════════
     ÉTAT
     ═════════════════════════════════════════════════════════════════════ */
  let P = null, Q = null, page = 0, TASK = null;
  let playing = false, plWake = null, plCloser = null;
  let EXP = null;            // export natif en cours / dernier résultat : {pid, req, active, state, …}
  let lastImgErr = '';
  let awakeOn = false;
  let dev = undefined;
  const LIVE = new Map();     // films ouverts dans cette session (id → projet) : leur production continue en arrière-plan
  const gone = new Set();     // films supprimés : jamais réenregistrés, même si une tâche se termine plus tard
  const RESUMED = new WeakSet();

  const newP = () => ({
    id: uid() + uid(), v: 2,
    created: Date.now(), upd: Date.now(),
    page: 0, last: 0, max: 0,
    genre: null, ratio: '16:9',
    synRaw: '', syn: null, final: '', title: '',
    nsc: 5,
    chars: [], scenes: [],
    sub: {},
    q: { step: 0, next: 0, st: 'idle', on: false, cur: -1 },
    imodel: '', vmodel: '', vdur: 0,
    exports: [],
  });

  const shots = (p) => {
    p = p || P;
    const out = [];
    if (!p) return out;
    (p.scenes || []).forEach(s => (s.shots || []).forEach(h => out.push({ h, s })));
    return out;
  };
  const allObjs = () => {
    const arr = [].concat(P.chars, P.scenes);
    P.scenes.forEach(s => (s.shots || []).forEach(h => arr.push(h)));
    return arr;
  };
  const anyBusy = () => !!P && allObjs().some(o => o.busy);
  function find(id) {
    if (!P) return null;
    if (id === 'P') return { t: 'p', o: P };
    for (const c of P.chars) if (c.id === id) return { t: 'c', o: c };
    for (const s of P.scenes) {
      if (s.id === id) return { t: 's', o: s };
      for (const h of (s.shots || [])) if (h.id === id) return { t: 'h', o: h, s };
    }
    return null;
  }

  /* Normalise une image (ancien format {u,d} de la page d'origine ou nouveau {u,t,w,h,m}) */
  function normImg(i) {
    if (!i || typeof i !== 'object') return null;
    const u = i.u || i.d || i.t || '';
    if (!u) return null;
    const o = { u: String(u), t: String(i.t || (i.d && String(i.d).startsWith('data:') && String(i.d).length < 400000 ? i.d : '') || u), w: +i.w || 0, h: +i.h || 0, m: i.m || '' };
    return o;
  }

  function migrate(p) {
    if (p.v === 2) return p;
    // Ancienne page : étape 0 = clés, 1 = genre… 6 = vidéos → on décale d'un cran.
    const sub = {};
    Object.keys(p.sub || {}).forEach(k => { if (+k >= 1) sub[+k - 1] = p.sub[k]; });
    p.sub = sub;
    p.page = Math.max(0, (+p.page || 1) - 1);
    p.max = Math.max(0, (+p.max || 0) - 1);
    p.last = Math.max(0, (+p.last || 1) - 1);
    p.v = 2;
    return p;
  }

  /* Prépare un projet lu en base (une seule fois) et le garde en mémoire : un film déjà ouvert n'est
     jamais rechargé en double, ses tâches en cours continuent d'écrire dans le même objet. */
  function live(p) {
    const cur = LIVE.get(p && p.id);
    if (cur) return cur;
    p = migrate(p);
    p.sub = p.sub || {};
    const q = p.q = p.q || { step: 0, next: 0, st: 'idle', on: false, cur: -1 };
    q.busy = false;
    if (q.cur == null) q.cur = -1;
    p.chars = Array.isArray(p.chars) ? p.chars : [];
    p.scenes = Array.isArray(p.scenes) ? p.scenes : [];
    p.exports = Array.isArray(p.exports) ? p.exports : [];
    p.imodel = p.imodel || '';
    p.vmodel = p.vmodel || '';
    p.vdur = +p.vdur || 0;
    p.ratio = OUT4K[p.ratio] ? p.ratio : '16:9';
    p.chars.forEach(c => { c.busy = false; c.img = normImg(c.img); });
    p.scenes.forEach(s => {
      s.busy = false;
      s.img = normImg(s.img);
      s.chars = Array.isArray(s.chars) ? s.chars : [];
      s.shots = Array.isArray(s.shots) ? s.shots : [];
      s.shots.forEach(h => {
        h.busy = false;
        h.img = normImg(h.img);
        h.chars = Array.isArray(h.chars) ? h.chars : [];
        if (!h.vst) h.vst = 'wait';
        if (h.vst === 'run' && !h.task && !h.video0) h.vst = 'wait';
      });
    });
    LIVE.set(p.id, p);
    return p;
  }
  function setP(p) {
    P = live(p);
    Q = P.q;
    DB.put('config', { key: 'last', v: P.id }).catch(e => log('wr', 'projet courant : ' + e.message));
  }
  const nameOf = p => p.title || (p.genre && p.genre.name) || 'Sans titre';
  // Rien ne tourne pour ce film : il peut quitter la mémoire (il sera relu en base s'il est rouvert).
  const idle = p => !(p.q && p.q.on) && !shots(p).some(x => x.h.vst === 'run') &&
    ![].concat(p.chars, p.scenes).some(o => o && o.busy) && !shots(p).some(x => x.h.busy) && !(EXP && EXP.active && EXP.p === p);

  /* ═════════════════════════════════════════════════════════════════════
     SAUVEGARDE (différée, sans champs transitoires)
     ═════════════════════════════════════════════════════════════════════ */
  const clean = p => JSON.parse(JSON.stringify(p, (k, v) => (k === 'busy' || k === '_conv' ? undefined : v)));
  const pristine = p => !p.genre && !String(p.synRaw || '').trim() && !p.final && !p.chars.length && !p.scenes.length;
  const svT = new Map();
  function persist(p) {
    p = p || P;
    if (!p || !p.id || gone.has(p.id)) return;
    clearTimeout(svT.get(p.id));
    svT.set(p.id, setTimeout(() => {
      svT.delete(p.id);
      if (gone.has(p.id) || pristine(p)) return;
      p.upd = Date.now();
      let snap;
      try { snap = clean(p); } catch (e) { log('er', 'sauvegarde : ' + e.message); return; }
      DB.put('sessions', snap).catch(e => log('er', 'sauvegarde : ' + e.message));
    }, 350));
  }

  function awake() {
    const v = !!(TASK && !TASK.err) || Array.from(LIVE.values()).some(p => p.q && p.q.on) || !!(EXP && EXP.active);
    if (v !== awakeOn) { awakeOn = v; keepAwake(v); }
  }

  /* ═════════════════════════════════════════════════════════════════════
     AIDES MÉTIER (prompts d'origine)
     ═════════════════════════════════════════════════════════════════════ */
  const AR = () => (P ? P.ratio : '16:9').replace(':', '/');
  const imSrc = i => (i ? i.t || i.u || '' : '');
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const has = (list, name) => !!name && (list || []).some(x => norm(x) === norm(name));
  const st = p => { p = p || P; return p.genre && p.genre.style ? p.genre.style : 'cinematic'; };
  const sheet = n => P.chars.filter(c => has(n, c.name)).map(c => c.name + ': ' + c.desc + (c.outfit ? ', wearing ' + c.outfit : '')).join('; ');
  const cImgs = n => P.chars.filter(c => has(n, c.name) && c.img).map(c => c.img.u).slice(0, 3);
  const imodel = () => pickImage(P && P.imodel);
  const vmodel = () => pickVideo(P && P.vmodel);
  const charRatio = () => { const m = imodel(); return m && IMODELS[m] && IMODELS[m].prov === 'agnes' ? '9:16' : '3:4'; };
  const vdur = (vm, p) => {
    p = p || P;
    const ds = (VMODELS[vm] && VMODELS[vm].durs) || [5];
    return ds.indexOf(+p.vdur) >= 0 ? +p.vdur : ds[0];
  };
  const stopped = () => !!(TASK && TASK.stop);
  const CTX = () => 'Genre : ' + (P.genre ? P.genre.name + ' (' + P.genre.style + ')' : 'libre') + '.';

  function promptFor(f) {
    const o = f.o;
    if (f.t === 'c') {
      return {
        p: 'Full-body character reference, plain neutral background, ' + st() + '. ' + o.name + ': ' + o.desc + '. ' + (o.outfit ? 'Wearing: ' + o.outfit + '.' : '') + ' No text, no watermark.',
        refs: [],
        ratio: charRatio(),
      };
    }
    if (f.t === 's') {
      const sh = sheet(o.chars);
      return {
        p: 'Cinematic establishing frame. ' + st() + '. Setting: ' + o.decor + '. Mood: ' + o.mood + '. ' + (sh ? 'Characters present (identical to references): ' + sh + '.' : '') + ' No text, no watermark.',
        refs: cImgs(o.chars),
        ratio: P.ratio,
      };
    }
    const sh = sheet(o.chars);
    return {
      p: 'Cinematic film still, ' + (o.size || 'medium') + ' shot. ' + st() + '. Setting: ' + f.s.decor + '. Action: ' + o.action + '. Camera: ' + o.camera + '. Characters (identical face, hair and outfit as the reference images): ' + (sh || 'none') + '. No text, no watermark.',
      refs: cImgs(o.chars).concat(f.s.img ? [f.s.img.u] : []),
      ratio: P.ratio,
    };
  }

  /* Prompt vidéo d'origine, enrichi pour les modèles 4K */
  const vp = (h, s, p) => san(st(p) + '. Cinematic 4K footage, ultra-detailed, natural fluid motion, film-grade color. ' + h.action + '. Camera: ' + h.camera + '. Setting: ' + s.decor + '. ' +
    (h.line ? (h.who || 'The character') + ' says in French, lips in sync: "' + h.line + '".' : 'No speech.') +
    ' Realistic ambient sound effects only, no music, no subtitles, no on-screen text. Keep the identity, outfit and visual style of the first frame identical throughout.');

  /* ═════════════════════════════════════════════════════════════════════
     FICHIERS IMPORTÉS (photo → JPEG 2048 px + miniature 640 px)
     ═════════════════════════════════════════════════════════════════════ */
  function readFile(f, maxSide) {
    return new Promise(res => {
      let url = null;
      try { url = URL.createObjectURL(f); } catch (e) { return res(null); }
      const im = new Image();
      const fin = v => { try { URL.revokeObjectURL(url); } catch (e) { /* déjà libérée */ } res(v); };
      im.onload = () => {
        try {
          const W = im.naturalWidth || im.width, H = im.naturalHeight || im.height;
          const draw = (side, q) => {
            const s = Math.min(1, side / Math.max(W, H));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(W * s));
            c.height = Math.max(1, Math.round(H * s));
            c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
            return { d: c.toDataURL('image/jpeg', q), w: c.width, h: c.height };
          };
          const big = draw(maxSide, 0.9), small = draw(640, 0.82);
          fin({ u: big.d, t: small.d, w: big.w, h: big.h, m: 'photo' });
        } catch (e) { fin(null); }
      };
      im.onerror = () => fin(null);
      im.src = url;
    });
  }

  /* ═════════════════════════════════════════════════════════════════════
     GÉNÉRATION D'IMAGE
     ═════════════════════════════════════════════════════════════════════ */
  async function gen(id, opt) {
    opt = opt || {};
    const f = find(id);
    if (!f || f.o.busy) return;
    const o = f.o, p = P;
    o.busy = true; o.err = ''; refresh(id);
    try {
      const q = promptFor(f);
      let pr = q.p;
      let refs = q.refs.filter(Boolean);
      if (opt.edit && o.img) {
        refs = [o.img.u].concat(refs);
        pr += ' Edit the first reference image: ' + opt.extra + '. Keep everything else identical.';
      } else if (opt.extra) {
        pr += ' ' + opt.extra + '.';
      }
      const r = await genImage({ prompt: pr, refs, ratio: q.ratio, model: p.imodel || undefined, kind: f.t === 'c' ? 'personnage' : f.t === 's' ? 'scène' : 'plan', isStopped: stopped });
      o.img = { u: r.u, t: r.t || r.u, w: r.w || 0, h: r.h || 0, m: r.m || '' };
    } catch (e) {
      if (e.message !== 'stop') {
        o.err = 'Échec : ' + String(e.message).slice(0, 140);
        lastImgErr = e.message;
        log('er', 'image : ' + e.message);
      }
    }
    o.busy = false;
    if (P === p) refresh(id);
    persist(p);
  }

  async function pool(list, n, fn) {
    let i = 0;
    const run = async () => { while (i < list.length) { const x = list[i++]; await fn(x); } };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(n, list.length)) }, run));
  }
  const conc = n => { const m = imodel(); return m && IMODELS[m].prov === 'fal' ? 6 : Math.max(1, n); };

  async function imgPass(list, label) {
    const todo = list.filter(o => !o.img);
    if (!todo.length) return;
    setTiles(list);
    const it = fd('Création des ' + label + ' (0/' + todo.length + ')');
    setPg(0, todo.length);
    let n = 0;
    lastImgErr = '';
    await pool(todo, conc(todo.length), async o => {
      if (stopped()) return;
      await gen(o.id);
      n++;
      setPg(n, todo.length);
      it.t = 'Création des ' + label + ' (' + n + '/' + todo.length + ')';
      paintFeed();
    });
    chk();
    const miss = list.filter(o => !o.img);
    if (miss.length) {
      it.t = 'Nouvel essai pour ' + miss.length + ' image(s)…';
      paintFeed();
      await pool(miss, conc(miss.length), async o => { if (!stopped()) await gen(o.id); });
      chk();
    }
    const ok = list.filter(o => o.img).length;
    if (!ok) throw new Error(lastImgErr || 'aucune image créée');
    fdDone(it, ok + '/' + list.length + ' ' + label + ' prêt(e)s');
  }

  /* ═════════════════════════════════════════════════════════════════════
     IA — FONCTIONS (prompts d'origine)
     ═════════════════════════════════════════════════════════════════════ */
  async function aiSyn() {
    const j = await llmJSON("Script doctor et scénariste de films d'auteur. Tu respectes l'idée de départ.",
      CTX() + '\nSynopsis de l\'auteur :\n"""' + P.synRaw + '"""\nRéponds : {"title":"titre du film","base":"le synopsis de l\'auteur réécrit avec soin, fidèle à ses idées, en français, 5 à 8 phrases","suggestions":["10 synopsis alternatifs, chacun 3 à 5 phrases en français, avec un angle, un enjeu ou un retournement plus puissant, tous différents"]}',
      4500, 0.8);
    if (!j.base || !Array.isArray(j.suggestions)) throw new Error('format inattendu');
    P.title = P.title || String(j.title || '');
    P.syn = { base: String(j.base), sugg: j.suggestions.map(String).slice(0, 10), sel: [] };
  }
  async function aiMerge() {
    const s = P.syn.sel.map(i => P.syn.sugg[i]).filter(Boolean);
    const j = await llmJSON('Scénariste. Tu fusionnes sans perdre la cohérence.',
      'Version de base :\n' + P.syn.base + '\n\nIdées à intégrer :\n' + s.map((x, i) => (i + 1) + '. ' + x).join('\n') + '\n\nÉcris UN synopsis final cohérent en français (8 à 12 phrases). {"final":"..."}',
      3000, 0.6);
    P.final = String(j.final || P.syn.base);
  }
  async function aiChars() {
    const j = await llmJSON('Directeur de casting et chef costumier.',
      CTX() + '\nSynopsis :\n' + P.final + '\nPropose 3 à 6 personnages principaux. {"characters":[{"name":"","role":"rôle en français","desc":"precise English physical description: age, face, hair, skin, build, distinctive details","outfit":"precise English costume with colors"}]}',
      3500, 0.7);
    const cs = Array.isArray(j.characters) ? j.characters : [];
    if (!cs.length) throw new Error('aucun personnage reçu');
    cs.forEach(c => P.chars.push({ id: uid(), name: String(c.name || '?'), role: String(c.role || ''), desc: String(c.desc || ''), outfit: String(c.outfit || ''), img: null, busy: false }));
  }
  async function aiScenes(n) {
    const j = await llmJSON("Scénariste de cinéma d'auteur. Dialogues naturels en français, jamais de musique.",
      CTX() + '\nTitre : ' + P.title + '\nSynopsis :\n' + P.final + '\nPersonnages :\n' + P.chars.map(c => c.name + ' : ' + c.role + '. ' + c.desc).join('\n') + '\nÉcris exactement ' + n + ' scènes qui racontent tout le film. {"scenes":[{"title":"","summary":"2-3 phrases en français","decor":"precise English place description","mood":"English mood and lighting","chars":["noms exacts"],"dialogue":[{"who":"","line":"réplique courte en français"}]}]}',
      7000, 0.75);
    const sc = Array.isArray(j.scenes) ? j.scenes : [];
    if (!sc.length) throw new Error('aucune scène reçue');
    P.scenes = sc.map(s => ({
      id: uid(), title: String(s.title || ''), summary: String(s.summary || ''), decor: String(s.decor || ''), mood: String(s.mood || ''),
      chars: Array.isArray(s.chars) ? s.chars.map(String) : [],
      dialogue: (Array.isArray(s.dialogue) ? s.dialogue : []).map(d => (d && typeof d === 'object' ? (d.who || '') + ': ' + (d.line || '') : String(d))).join('\n'),
      img: null, busy: false, shots: [],
    }));
  }
  async function aiShots(s) {
    const j = await llmJSON('Réalisateur et chef opérateur.',
      CTX() + '\nScène : ' + s.title + '. ' + s.summary + '\nDécor : ' + s.decor + '. Ambiance : ' + s.mood + '.\nPersonnages : ' + (s.chars || []).join(', ') + '\nDialogues :\n' + s.dialogue + '\nDécoupe en 3 à 5 plans de 8 à 10 secondes. Répartis les répliques dans les plans. {"shots":[{"size":"wide|medium|close-up|over-the-shoulder","camera":"English camera movement","action":"English visual description, 1-2 sentences","chars":["noms"],"who":"","line":"réplique en français ou vide"}]}',
      3500, 0.7);
    const a = Array.isArray(j.shots) ? j.shots : [];
    if (!a.length) throw new Error('aucun plan reçu');
    s.shots = a.map(h => ({ id: uid(), size: String(h.size || 'medium'), camera: String(h.camera || 'static'), action: String(h.action || ''), chars: Array.isArray(h.chars) ? h.chars.map(String) : [], who: String(h.who || ''), line: String(h.line || ''), img: null, busy: false, vst: 'wait' }));
  }
  async function aiDescribe(c) {
    if (!c.img) return;
    const ref = (await refData(c.img.u, 1024)) || c.img.u;
    const j = await llmJSON('Directeur de casting.', 'Décris cette personne. {"desc":"precise English physical description: age, face, hair, skin, build","outfit":"precise English clothing with colors"}', 500, 0.2, [ref]);
    c.desc = String(j.desc || c.desc);
    c.outfit = String(j.outfit || c.outfit);
  }

  /* ═════════════════════════════════════════════════════════════════════
     TÂCHES (vue d'attente + activité en direct)
     ═════════════════════════════════════════════════════════════════════ */
  function fd(t) { const it = { t, s: 'run', at: Date.now() }; TASK.items.push(it); paintFeed(); return it; }
  function fdDone(it, t) { it.s = 'ok'; if (t) it.t = t; it.end = Date.now(); paintFeed(); }
  function paintFeed() {
    const e = document.getElementById('fiFeed');
    if (!e || !TASK) return;
    const n = Date.now();
    e.innerHTML = TASK.items.map(i => '<div class="fi ' + i.s + '"><span>' + esc(i.t) + '</span>' +
      (i.s === 'run' ? '<em>' + Math.round((n - i.at) / 1000) + ' s</em>' : i.end ? '<em>' + Math.max(1, Math.round((i.end - i.at) / 1000)) + ' s</em>' : '') + '</div>').join('');
  }
  function setPg(d, t) { if (!TASK) return; TASK.pg = [d, t]; pgb(); }
  function pgb() {
    const b = document.getElementById('fiPg');
    if (b && TASK && TASK.pg) b.style.width = Math.round(TASK.pg[0] / Math.max(1, TASK.pg[1]) * 100) + '%';
  }
  function setTiles(l) {
    if (!TASK) return;
    TASK.tiles = l;
    const e = document.getElementById('fiMinis');
    if (e) e.innerHTML = l.map(mini).join('');
  }
  const chk = () => { if (TASK && TASK.stop) throw new Error('stop'); };

  async function task(step, title, fn, after) {
    if (TASK) return;
    TASK = { step, title, fn, after, items: [], start: Date.now(), stop: false, err: null, pg: null, tiles: null };
    page = step;
    render();
    awake();
    try {
      await fn();
      chk();
    } catch (e) {
      const T = TASK;
      if (!T) return;
      if (e.message === 'stop' || T.stop) {
        TASK = null;
        awake();
        toast('Arrêté');
        render();
        return;
      }
      T.items.forEach(i => { if (i.s === 'run') i.s = 'er'; });
      T.err = String(e.message || e);
      log('er', title + ' : ' + T.err);
      haptic('reject');
      awake();
      render();
      return;
    }
    TASK = null;
    awake();
    haptic('confirm');
    after();
  }
  function retryTask() {
    const T = TASK;
    if (!T || !T.err) return;
    TASK = null;
    task(T.step, T.title, T.fn, T.after);
  }

  /* ═════════════════════════════════════════════════════════════════════
     PIPELINES
     ═════════════════════════════════════════════════════════════════════ */
  function done(step, sub) { P.sub[step] = sub; persist(); render(); }

  function runSyn() {
    task(S_SYN, 'Analyse de votre synopsis', async () => {
      const a = fd('Lecture de votre idée et du genre choisi'); fdDone(a);
      const b = fd('L’IA réécrit votre synopsis et imagine 10 propositions plus puissantes…');
      await aiSyn();
      chk();
      fdDone(b, 'Synopsis réécrit + 10 propositions prêtes');
    }, () => done(S_SYN, 'pick'));
  }
  function runMerge() {
    task(S_SYN, 'Fusion de vos choix', async () => {
      const a = fd('L’IA fusionne ' + P.syn.sel.length + ' suggestion(s) avec votre synopsis…');
      await aiMerge();
      chk();
      fdDone(a, 'Synopsis final écrit');
    }, () => done(S_SYN, 'fin'));
  }
  function runChars(m) {
    let ai = m === 'ai';
    task(S_CHARS, 'Création des personnages', async () => {
      if (ai) {
        const a = fd('L’IA lit votre synopsis et imagine les personnages…');
        await aiChars();
        ai = false;
        chk();
        fdDone(a, P.chars.length + ' personnages imaginés : ' + P.chars.map(c => c.name).join(', '));
      }
      if (!P.chars.length) throw new Error('Ajoutez au moins un personnage');
      for (const c of P.chars.filter(x => x.img && !x.desc)) {
        const d = fd('Analyse de la photo de ' + c.name + '…');
        try { await aiDescribe(c); } catch (e) { if (e.message === 'stop') throw e; log('wr', 'analyse photo : ' + e.message); }
        fdDone(d, 'Photo de ' + c.name + ' analysée');
      }
      await imgPass(P.chars, 'portraits');
    }, () => done(S_CHARS, 'rev'));
  }
  function runScenes(n) {
    let w = true;
    task(S_SCENES, 'Écriture du scénario', async () => {
      if (w) {
        const a = fd('L’IA écrit le scénario : ' + n + ' scènes, avec décors, ambiances et dialogues…');
        await aiScenes(n);
        w = false;
        chk();
        fdDone(a, P.scenes.length + ' scènes écrites');
      }
      await imgPass(P.scenes, 'images de scènes');
    }, () => done(S_SCENES, 'rev'));
  }
  function runShots() {
    task(S_SHOTS, 'Découpage en plans et images', async () => {
      const todo = P.scenes.filter(s => !(s.shots || []).length);
      if (todo.length) {
        const a = fd('Découpage de ' + todo.length + ' scène(s) en plans…');
        let k = 0;
        const cut = async s => {
          try { await aiShots(s); } catch (e) { if (e.message === 'stop' || e.fatal) throw e; log('wr', s.title + ' : ' + e.message); }
          k++;
          a.t = 'Découpage des scènes (' + k + '/' + todo.length + ')…';
          paintFeed();
        };
        await Promise.all(todo.map(cut));
        chk();
        for (const s of P.scenes.filter(x => !(x.shots || []).length)) await cut(s);
        fdDone(a, 'Scènes découpées en ' + shots().length + ' plans');
      }
      if (!shots().length) throw new Error('Aucun plan créé');
      await imgPass(shots().map(x => x.h), 'images de plans');
    }, () => done(S_SHOTS, 'rev'));
  }

  /* ═════════════════════════════════════════════════════════════════════
     FRAGMENTS D'INTERFACE
     ═════════════════════════════════════════════════════════════════════ */
  const hd = (n, t) => '<div class="lab">ÉTAPE ' + n + ' / ' + NSTEP + '</div><div class="h1">' + t + '</div>';
  const note = (h, c) => '<div class="note' + (c ? ' ' + c : '') + '">' + h + '</div>';
  const btn = (a, l, c, x) => '<button type="button" class="btn' + (c ? ' ' + c : '') + '" data-a="' + a + '"' + (x ? ' ' + x : '') + '>' + l + '</button>';
  const foot = (prev, next) => '<div class="row" style="margin-top:6px">' + (prev || '') + '<span class="sp"></span>' + (next || '') + '</div>';
  const prevBtn = n => btn('fgo', '← Précédent', 'ghost', 'data-n="' + n + '"');
  const nextBtn = (a, l, x) => '<button type="button" class="btn pri" id="fiNext" data-a="' + a + '" data-lbl="' + esc(l) + '"' + (x ? ' ' + x : '') + '>' + esc(l) + ' →</button>';
  function syncNext() {
    const b = document.getElementById('fiNext');
    if (!b) return;
    const bz = anyBusy();
    b.disabled = bz || b.dataset.off === '1';
    b.textContent = bz ? 'Images en cours…' : b.dataset.lbl + ' →';
  }

  function imgBadge(i) {
    if (!i) return '';
    const l = Math.max(+i.w || 0, +i.h || 0);
    if (!l) return '';
    if (l >= 3800) return '<span class="badge b4k">4K</span>';
    return '<span class="badge bdim">' + (l >= 1900 ? '2K' : l >= 1000 ? '1K' : i.w + '×' + i.h) + '</span>';
  }
  const imBox = (o, r) => '<div class="media' + (o.busy ? ' run' : '') + '" style="aspect-ratio:' + (r || AR()) + '">' +
    (o.img ? '<img src="' + esc(imSrc(o.img)) + '" alt="" loading="lazy" decoding="async">' : '<span>' + (o.busy ? '<i class="spin"></i> création…' : 'pas d’image') + '</span>') +
    (o.img ? '<div class="tr">' + imgBadge(o.img) + '</div>' : '') + '</div>';
  const upLabel = (o, l) => '<label class="btn sm"' + (o.busy ? ' aria-disabled="true" style="opacity:.4;pointer-events:none"' : '') + '>' + l + '<input type="file" accept="image/*" data-fup="' + o.id + '"></label>';
  const imgPanel = o => '<div class="stack" style="gap:8px">' +
    '<input type="text" data-fmod="' + o.id + '" placeholder="Votre demande : ex. cheveux roux, ajoute un chapeau…" aria-label="Modification de l’image"' + (o.busy ? ' disabled' : '') + '>' +
    '<div class="row">' +
      btn('fmod', '✎ Modifier', 'sm', 'data-id="' + o.id + '"' + (o.busy || !o.img ? ' disabled' : '')) +
      btn('fgen', '↻ Nouvelle image', 'sm', 'data-id="' + o.id + '"' + (o.busy ? ' disabled' : '')) +
      upLabel(o, '⬆ Ma photo') +
      (o.img ? btn('fsave', '⬇', 'sm ghost', 'data-id="' + o.id + '" aria-label="Enregistrer l’image dans la galerie" title="Enregistrer dans la galerie"' + (o.busy ? ' disabled' : '')) : '') +
    '</div>' +
    (o.err ? '<p class="sub" style="color:var(--er)">' + esc(o.err) + '</p>' : '') + '</div>';
  const fld = (o, f, l, ta) => '<label class="field"><span class="lab">' + l + '</span>' +
    (ta ? '<textarea data-ff="' + f + '" data-id="' + o.id + '" rows="' + ta + '">' + esc(o[f]) + '</textarea>'
      : '<input type="text" data-ff="' + f + '" data-id="' + o.id + '" value="' + esc(o[f]) + '">') + '</label>';
  const csv = (o, l) => '<label class="field"><span class="lab">' + l + '</span><input type="text" data-ff="chars" data-farr="1" data-id="' + o.id + '" value="' + esc((o.chars || []).join(', ')) + '"></label>';
  const delBtn = (o, l) => '<div class="row">' + btn('fdel', l, 'sm ghost', 'data-id="' + o.id + '"' + (o.busy ? ' disabled' : '')) + '</div>';

  const charCard = c => '<div class="card stack" id="fic-' + c.id + '">' + imBox(c, '3/4') + imgPanel(c) +
    fld(c, 'name', 'Nom') + fld(c, 'role', 'Rôle') + fld(c, 'desc', 'Fiche physique (anglais)', 3) + fld(c, 'outfit', 'Costume (anglais)', 2) +
    delBtn(c, '🗑 Supprimer') + '</div>';
  const charIn = c => '<div class="card stack" id="fii-' + c.id + '">' + imBox(c, '3/4') +
    fld(c, 'name', 'Nom') + fld(c, 'desc', 'Description (ou importez une photo : l’IA la décrit)', 3) +
    '<div class="row">' + upLabel(c, '⬆ Importer une photo') + btn('fdel', '🗑', 'sm ghost', 'data-id="' + c.id + '" aria-label="Supprimer ce personnage"') + '</div>' +
    (c.err ? '<p class="sub" style="color:var(--er)">' + esc(c.err) + '</p>' : '') + '</div>';
  const sceneCard = (s, i) => '<div class="card stack" id="fic-' + s.id + '"><div class="lab">Scène ' + (i + 1) + '</div>' + imBox(s) + imgPanel(s) +
    fld(s, 'title', 'Titre') + fld(s, 'summary', 'Résumé', 3) + fld(s, 'decor', 'Décor (anglais)', 2) + fld(s, 'mood', 'Ambiance (anglais)') +
    csv(s, 'Personnages présents (séparés par des virgules)') + fld(s, 'dialogue', 'Dialogues (NOM: réplique)', 4) +
    delBtn(s, '🗑 Supprimer la scène') + '</div>';
  const shotCard = (h, i) => '<div class="card stack" id="fic-' + h.id + '"><div class="lab">Plan ' + i + '</div>' + imBox(h) + imgPanel(h) +
    fld(h, 'size', 'Type de plan (wide, medium, close-up…)') + fld(h, 'action', 'Action visuelle (anglais)', 3) + fld(h, 'camera', 'Caméra (anglais)') +
    csv(h, 'Personnages dans le plan') + fld(h, 'who', 'Qui parle') + fld(h, 'line', 'Réplique dite (français)', 2) +
    delBtn(h, '🗑 Supprimer le plan') + '</div>';
  const mini = o => '<div class="card pad0" id="fim-' + o.id + '"><div class="media' + (o.busy ? ' run' : '') + '" style="aspect-ratio:' + (o.role !== undefined ? '3/4' : AR()) + '">' +
    (o.img ? '<img src="' + esc(imSrc(o.img)) + '" alt="" loading="lazy" decoding="async">' : '<span>' + (o.err ? '✕' : o.busy ? '<i class="spin"></i>' : '…') + '</span>') +
    '</div><div class="sub" style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(o.name || o.title || o.size || '') + '</div></div>';

  const shotIndex = h => shots().findIndex(x => x.h === h) + 1;
  function tile(h, i) {
    const run = h.vst === 'run';
    const poster = imSrc(h.img);
    const pct = run && /(\d{1,3})\s*%/.exec(h.msg || '');
    const res = h.video ? (is4k(h) ? '<span class="badge b4k">4K</span>' : resLabel(h.vw, h.vh) ? '<span class="badge bdim">' + esc(resLabel(h.vw, h.vh)) + '</span>' : '') : '';
    const stb = h.vst === 'ok' ? '' : '<span class="badge ' + (h.vst === 'er' ? 'ber' : run ? 'bwr' : 'bdim') + '">' + (h.img ? LBL[h.vst] || '' : 'image manquante') + '</span>';
    const meta = [h.img ? LBL[h.vst] || '' : 'image manquante'];
    if (h.vst === 'wait' && h.img && Q && Q.on && Q.st === 'full') meta.push('Agnès saturée — nouvel essai à ' + hhmm(Q.next));
    if (h.vm && VMODELS[h.vm]) meta.push(VMODELS[h.vm].name);
    if (run && h.msg) meta.push(h.msg);
    if (h.err) meta.push(h.err);
    return '<div class="card pad0" id="fit-' + h.id + '">' +
      '<div class="media' + (run ? ' run' : '') + '" style="aspect-ratio:' + AR() + '">' +
        (h.video ? '<video src="' + esc(h.video) + '"' + (poster ? ' poster="' + esc(poster) + '"' : '') + ' preload="none" controls playsinline data-fv="' + h.id + '"></video>'
          : poster ? '<img src="' + esc(poster) + '" alt="" loading="lazy" decoding="async">' : '<span>image manquante</span>') +
        '<div class="tl"><span class="badge bdim">' + i + '</span>' + (h.video && !h.seen ? '<span class="badge bok" data-fnew="1">NOUVEAU</span>' : '') + '</div>' +
        '<div class="tr">' + res + stb + '</div>' +
        (pct ? '<div class="prog"><i style="width:' + clamp(+pct[1], 0, 100) + '%"></i></div>' : '') +
      '</div>' +
      '<div class="sub" style="font-size:13px">' + esc(h.line ? (h.who ? h.who + ' : ' : '') + h.line : h.action || '') + '</div>' +
      '<div class="row" style="justify-content:space-between"><span class="lab" style="text-transform:none;letter-spacing:0">' + esc(meta.filter(Boolean).join(' · ')) + '</span>' +
        (h.vst === 'er' && h.img ? btn('fretry', 'Relancer', 'sm', 'data-id="' + h.id + '"') : '') +
        (h.vst === 'ok' ? '<span class="row" style="gap:6px">' + btn('fsavev', '⬇', 'sm ghost', 'data-id="' + h.id + '" aria-label="Enregistrer la vidéo dans la galerie" title="Enregistrer dans la galerie"') +
          btn('fretry', '↻', 'sm ghost', 'data-id="' + h.id + '" aria-label="Refaire la vidéo de ce plan" title="Refaire la vidéo"') + '</span>' : '') +
      '</div></div>';
  }

  /* Rafraîchit uniquement les éléments d'un objet (carte, miniature, tuile) */
  function refresh(id) {
    const f = find(id);
    if (!f) return;
    const set = (pre, h) => {
      const a = document.getElementById(pre + id);
      if (!a) return;
      const t = document.createElement('div');
      t.innerHTML = h;
      if (t.firstElementChild) a.replaceWith(t.firstElementChild);
    };
    if (f.t === 'c') { set('fic-', charCard(f.o)); set('fii-', charIn(f.o)); }
    else if (f.t === 's') set('fic-', sceneCard(f.o, P.scenes.indexOf(f.o)));
    else if (f.t === 'h') { const i = shotIndex(f.o); set('fic-', shotCard(f.o, i)); set('fit-', tile(f.o, i)); }
    if (TASK) set('fim-', mini(f.o));
    syncNext();
    if (page === S_VIDEOS) stats();
  }

  /* ═════════════════════════════════════════════════════════════════════
     CARTES DE MODÈLES (étape 0)
     ═════════════════════════════════════════════════════════════════════ */
  const byProv = cat => Object.keys(cat).sort((a, b) => (cat[a].prov === 'fal' ? 0 : 1) - (cat[b].prov === 'fal' ? 0 : 1));
  function mcard(kind, id, m, on) {
    const ok = m.prov === 'fal' ? hasFal() : hasAgnes();
    const badges = '<span class="badge ' + (/4K/.test(m.tag) ? 'b4k' : 'bdim') + '">' + esc(m.tag) + '</span>' +
      (m.audio ? '<span class="badge baud">Son</span>' : '') +
      '<span class="badge bdim">' + (m.prov === 'fal' ? 'fal.ai' : 'Agnès') + '</span>';
    const price = m.prov === 'agnes' ? 'inclus avec vos clés' : m.usd != null ? fmtUSD(m.usd) + (kind === 'v' ? ' / s' : ' / image') : '';
    return '<button type="button" class="mcard' + (on ? ' on' : '') + (ok ? '' : ' dis') + '" data-a="' + (kind === 'v' ? 'fvmodel' : 'fimodel') + '" data-m="' + id + '" aria-pressed="' + on + '">' +
      '<span class="mname">' + esc(m.name) + '</span><span class="mbadges">' + badges + '</span>' +
      '<span class="mdesc">' + esc(m.desc || '') + (price ? ' · ' + esc(price) : '') + (ok ? '' : ' · clé ' + (m.prov === 'fal' ? 'fal.ai' : 'Agnès') + ' requise') + '</span></button>';
  }

  /* ═════════════════════════════════════════════════════════════════════
     VUES
     ═════════════════════════════════════════════════════════════════════ */
  const V = { 0: {}, 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };

  V[S_GENRE].cfg = () => {
    const sel = P.genre && P.genre.name;
    const im = imodel(), vm = vmodel();
    const noKey = !hasFal() && !hasAgnes();
    const dur = vm ? vdur(vm) : 0;
    const est = vm ? estimateVideoUSD(vm, dur) : null;
    return '<div class="hero">' + hd(1, 'Quel <span class="gt">film</span> voulez-vous créer ?') +
      note('👉 Choisissez un genre, un format et vos moteurs, puis continuez. L’IA écrit, dessine et filme le reste.') + '</div>' +
      (noKey ? note('<b>Aucune clé configurée.</b> Ajoutez une clé fal.ai (recommandé : images et vidéos 4K natives) ou vos clés Agnès dans Réglages.<div class="row" style="margin-top:10px">' +
        '<button type="button" class="btn sm" data-a="tab" data-tab="settings">Ouvrir les Réglages</button></div>', 'wr') : '') +
      '<div class="card"><div class="h3">1 · Genre</div>' +
        G.map(([c, l], ci) => '<div class="lab" style="margin-top:12px">' + esc(c) + '</div><div class="row" style="margin-top:8px">' +
          l.map((x, i) => { const n = x.split('|')[0]; const on = sel === n; return '<button type="button" class="pill' + (on ? ' on' : '') + '" data-a="fgenre" data-c="' + ci + '" data-i="' + i + '" aria-pressed="' + on + '">' + esc(n) + '</button>'; }).join('') + '</div>').join('') +
        (P.genre ? '<label class="field" style="margin-top:14px"><span class="lab">Style visuel (anglais, modifiable)</span><input type="text" data-fstyle="1" value="' + esc(P.genre.style) + '"></label>' : '') +
      '</div>' +
      '<div class="card"><div class="h3">2 · Format de l’image</div><div class="row" style="margin-top:10px">' +
        RATIOS.map(r => '<button type="button" class="pill' + (P.ratio === r[0] ? ' on' : '') + '" data-a="fratio" data-n="' + r[0] + '" aria-pressed="' + (P.ratio === r[0]) + '">' + esc(r[1]) + ' <span class="sub" style="font-size:12px">· ' + esc(r[2]) + '</span></button>').join('') +
      '</div><p class="sub" style="margin-top:8px">Montage final : ' + OUT4K[P.ratio].join(' × ') + ' (4K UHD).</p></div>' +
      '<div class="card"><div class="h3">3 · Moteur d’image</div><div class="hscroll" style="margin-top:10px">' +
        byProv(IMODELS).map(id => mcard('i', id, IMODELS[id], id === im)).join('') + '</div>' +
        (im ? '' : '<p class="sub">Aucun moteur d’image disponible avec vos clés.</p>') + '</div>' +
      '<div class="card"><div class="h3">4 · Moteur vidéo</div><div class="hscroll" style="margin-top:10px">' +
        byProv(VMODELS).map(id => mcard('v', id, VMODELS[id], id === vm)).join('') + '</div>' +
        (vm ? '<div class="lab" style="margin-top:12px">Durée de chaque plan</div><div class="row" style="margin-top:8px">' +
          VMODELS[vm].durs.map(d => '<button type="button" class="pill' + (d === dur ? ' on' : '') + '" data-a="fvdur" data-n="' + d + '" aria-pressed="' + (d === dur) + '">' + d + ' s</button>').join('') + '</div>' +
          '<p class="sub" style="margin-top:8px">' + (VMODELS[vm].prov === 'agnes' ? 'Vidéos incluses avec vos clés Agnès.' : est != null ? 'Coût estimé : ' + esc(fmtUSD(est)) + ' par plan (fal.ai).' : 'Coût selon le tarif fal.ai.') +
          (!VMODELS[vm].native ? (CFG.up4k !== false && hasFal() ? ' Upscale Topaz 4K automatique.' : ' 4K obtenue au montage sur le téléphone.') : ' 4K native.') + '</p>'
          : '<p class="sub">Aucun moteur vidéo disponible avec vos clés.</p>') + '</div>' +
      foot('', nextBtn('fgo', 'Continuer', sel ? 'data-n="1"' : 'disabled data-off="1" data-n="1"'));
  };

  V[S_SYN].in = () => '<div class="hero">' + hd(2, 'Votre <span class="gt">idée</span> de film') +
    note('👉 Écrivez votre idée, même en deux lignes. L’IA la réécrit et vous propose dix variantes plus fortes.') + '</div>' +
    (!P.genre ? note('Choisissez d’abord un genre à l’étape 1.', 'wr') : '') +
    '<div class="card"><label class="field"><span class="lab">Votre idée</span><textarea rows="8" data-ff="synRaw" data-id="P" placeholder="Ex. Un vieux projectionniste découvre une bobine qui montre l’avenir de son village…">' + esc(P.synRaw) + '</textarea></label></div>' +
    foot(prevBtn(S_GENRE), '<span class="row">' + btn('fsynasis', 'Garder mon texte tel quel', 'ghost') + nextBtn('fsynai', '✦ Analyser avec l’IA') + '</span>');

  V[S_SYN].pick = () => '<div class="hero">' + hd(2, 'Choisissez votre <span class="gt">synopsis</span>') +
    note('👉 La version de base est toujours retenue. Cochez les suggestions à y intégrer (ou aucune), puis validez.') + '</div>' +
    '<div class="card sel"><div class="lab">Votre synopsis, bien réécrit</div>' + (P.title ? '<div class="h3">' + esc(P.title) + '</div>' : '') + '<p>' + esc(P.syn.base) + '</p></div>' +
    '<div class="grid2">' + P.syn.sugg.map((s, i) => '<label class="card stack" style="cursor:pointer;gap:8px"><span class="lab">Suggestion ' + (i + 1) + '</span><p>' + esc(s) + '</p>' +
      '<span class="row" style="gap:8px"><input type="checkbox" data-fsg="' + i + '"' + ((P.syn.sel || []).indexOf(i) >= 0 ? ' checked' : '') + '> <span class="sub">Intégrer à ma version</span></span></label>').join('') + '</div>' +
    foot(btn('fsynedit', '← Modifier mon texte', 'ghost'), nextBtn('fsynok', 'Valider ce choix'));

  V[S_SYN].fin = () => '<div class="hero">' + hd(2, 'Votre <span class="gt">synopsis</span> final') +
    note('✓ Synopsis prêt. 👉 Relisez-le, modifiez-le si besoin, puis continuez : il guidera tout le film.', 'ok') + '</div>' +
    '<div class="card stack"><label class="field"><span class="lab">Titre du film</span><input type="text" data-ff="title" data-id="P" value="' + esc(P.title) + '"></label>' +
    '<label class="field"><span class="lab">Synopsis</span><textarea data-ff="final" data-id="P" rows="10">' + esc(P.final) + '</textarea></label></div>' +
    foot(btn('fsynback', '← ' + (P.syn ? 'Revoir les propositions' : 'Modifier mon texte'), 'ghost'), nextBtn('fgo', 'Continuer vers les personnages', 'data-n="' + S_CHARS + '"'));

  const needSyn = () => (String(P.final || '').trim() ? '' : note('<b>Il manque le synopsis.</b> Écrivez-le d’abord à l’étape 2.<div class="row" style="margin-top:10px">' + btn('fgo', 'Aller au synopsis', 'sm', 'data-n="' + S_SYN + '"') + '</div>', 'wr'));

  V[S_CHARS].cfg = () => '<div class="hero">' + hd(3, 'Les <span class="gt">personnages</span>') +
    note('👉 Choisissez comment créer vos personnages. Leurs portraits sont ensuite générés automatiquement.') + '</div>' + needSyn() +
    '<div class="card sel stack" data-a="fchai" role="button" tabindex="0" style="cursor:pointer"><div class="h3">✦ L’IA crée les personnages</div>' +
      '<p class="sub">Elle lit votre synopsis, imagine 3 à 6 personnages (fiche physique, costume) et crée leurs portraits. Recommandé.</p></div>' +
    '<div class="card stack"><div class="h3">Ou utilisez vos propres personnages</div>' +
      '<p class="sub">Ajoutez vos photos ou vos descriptions. L’IA analyse les photos et crée les portraits manquants.</p>' +
      (P.chars.length ? '<div class="grid2">' + P.chars.map(charIn).join('') + '</div>' : '') +
      '<div class="row">' + btn('faddchar', '+ Ajouter un personnage') + (P.chars.length ? btn('fchown', 'Utiliser mes personnages →', 'pri') : '') + '</div></div>' +
    foot(prevBtn(S_SYN), '');

  V[S_CHARS].rev = () => '<div class="hero">' + hd(3, 'Vos <span class="gt">personnages</span>') +
    note('✓ Portraits créés. 👉 Vérifiez-les. Sous chaque image : <b>Modifier</b> = part de l’image actuelle avec votre demande · <b>Nouvelle image</b> = repart de la fiche · <b>Ma photo</b> = importe votre image.', 'ok') + '</div>' +
    '<div class="grid2">' + (P.chars.map(charCard).join('') || '<p class="sub">Aucun personnage.</p>') + '</div>' +
    '<div class="row">' + btn('faddchar', '+ Ajouter un personnage') + btn('fredo', '↺ Refaire avec l’IA', 'ghost', 'data-n="' + S_CHARS + '"') + '</div>' +
    foot(prevBtn(S_SYN), nextBtn('fgo', 'Continuer vers les scènes', 'data-n="' + S_SCENES + '"'));

  V[S_SCENES].cfg = () => '<div class="hero">' + hd(4, 'Les <span class="gt">scènes</span>') +
    note('👉 Choisissez la longueur du film, puis lancez. L’IA écrit le scénario et les dialogues, puis crée l’image de chaque scène.') + '</div>' + needSyn() +
    '<div class="card"><div class="h3">Longueur du film</div><div class="row" style="margin-top:10px">' +
      NSC.map(n => '<button type="button" class="pill' + ((P.nsc || 5) === n[0] ? ' on' : '') + '" data-a="fnsc" data-n="' + n[0] + '" aria-pressed="' + ((P.nsc || 5) === n[0]) + '">' + n[1] + ' · ' + n[2] + '</button>').join('') +
    '</div><p class="sub" style="margin-top:8px">Environ ' + (P.nsc || 5) * 4 + ' plans vidéo au total.</p></div>' +
    foot(prevBtn(S_CHARS), nextBtn('fscgo', '✦ Écrire le scénario', String(P.final || '').trim() ? '' : 'disabled data-off="1"'));

  V[S_SCENES].rev = () => '<div class="hero">' + hd(4, 'Vos <span class="gt">scènes</span>') +
    note('✓ Scénario et images prêts. 👉 Relisez les dialogues, modifiez ce que vous voulez, puis continuez.', 'ok') + '</div>' +
    '<div class="grid2">' + (P.scenes.map(sceneCard).join('') || '<p class="sub">Aucune scène.</p>') + '</div>' +
    '<div class="row">' + btn('faddscene', '+ Ajouter une scène') + btn('fredo', '↺ Refaire avec l’IA', 'ghost', 'data-n="' + S_SCENES + '"') + '</div>' +
    foot(prevBtn(S_CHARS), nextBtn('fgo', 'Continuer vers les plans', 'data-n="' + S_SHOTS + '"'));

  V[S_SHOTS].cfg = () => '<div class="hero">' + hd(5, 'Les <span class="gt">plans</span>') +
    note('👉 L’IA découpe chaque scène en 3 à 5 plans, puis crée l’image de départ de chaque plan.') + '</div>' +
    (P.scenes.length ? '' : note('<b>Aucune scène.</b> Écrivez d’abord le scénario à l’étape 4.<div class="row" style="margin-top:10px">' + btn('fgo', 'Aller aux scènes', 'sm', 'data-n="' + S_SCENES + '"') + '</div>', 'wr')) +
    foot(prevBtn(S_SCENES), nextBtn('fplgo', '✦ Découper et créer les images', P.scenes.length ? '' : 'disabled data-off="1"'));

  V[S_SHOTS].rev = () => {
    let k = 0;
    return '<div class="hero">' + hd(5, 'Vos <span class="gt">plans</span>') +
      note('✓ Plans et images prêts. 👉 Chaque image deviendra une vidéo. Modifiez les images ou les répliques si besoin, puis continuez.', 'ok') + '</div>' +
      P.scenes.map((s, i) => '<div class="stack"><div class="h3">Scène ' + (i + 1) + ' — ' + esc(s.title) + '</div><div class="grid2">' +
        ((s.shots || []).map(h => shotCard(h, ++k)).join('') || '<p class="sub">Pas de plan.</p>') + '</div>' +
        '<div class="row">' + btn('faddshot', '+ Ajouter un plan', 'sm', 'data-id="' + s.id + '"') + '</div></div>').join('') +
      '<div class="row">' + btn('fredo', '↺ Refaire avec l’IA', 'ghost', 'data-n="' + S_SHOTS + '"') + '</div>' +
      foot(prevBtn(S_SCENES), nextBtn('fgo', 'Continuer vers les vidéos', 'data-n="' + S_VIDEOS + '"'));
  };

  V[S_VIDEOS].cfg = () => {
    const vm = vmodel();
    const a = shots();
    const m = vm && VMODELS[vm];
    return '<div class="hero">' + hd(6, 'Les <span class="gt">vidéos</span>') +
      '<p class="sub">Chaque image de plan devient une vidéo' + (m ? ' avec <b>' + esc(m.name) + '</b> (' + vdur(vm) + ' s par plan)' : '') + '. ' +
      (m && m.prov === 'agnes'
        ? 'La file vidéo Agnès est souvent saturée : l’app envoie les plans un par un et, si c’est plein, attend toute seule (' + LADDER.slice(0, 4).join(', ') + '… minutes) avant de réessayer. <b>Gardez l’application ouverte.</b>' +
          (hasFal() ? ' Pour ne pas attendre, choisissez Kling ou LTX (fal.ai).' : '')
        : 'Les plans sont envoyés à fal.ai jusqu’à ' + CFG.falPar + ' en parallèle. <b>Vous pouvez quitter cet écran</b> : le suivi continue et reprend au prochain lancement.') +
      ' En attendant, regardez le film en « animatic » (images + voix).</p>' +
      '<div class="row">' + btn('fgo', 'Changer de moteur', 'sm ghost', 'data-n="' + S_GENRE + '"') + '<span class="sub" id="fiCost"></span></div></div>' +
      (a.some(x => x.h.img) ? '' : note('<b>Aucune image de plan.</b> Créez d’abord les plans à l’étape 5.<div class="row" style="margin-top:10px">' + btn('fgo', 'Aller aux plans', 'sm', 'data-n="' + S_SHOTS + '"') + '</div>', 'wr')) +
      '<div class="card stack" id="fiQ"></div>' +
      '<div class="row">' + btn('fplay', '🎬 Voir le film maintenant', 'gold') + btn('fexport', 'Exporter le projet', 'sm ghost') + '</div>' +
      '<div class="kpis" id="fiKpi"></div>' +
      '<div class="grid2" id="fiTiles">' + a.map((x, i) => tile(x.h, i + 1)).join('') + '</div>' +
      foot(prevBtn(S_SHOTS), nextBtn('fgo', 'Passer au montage 4K', 'data-n="' + S_MONTAGE + '"'));
  };

  /* ───────────── Montage 4K ───────────── */
  function devInfo() {
    if (dev !== undefined) return dev;
    dev = null;
    if (IS_APP && N && typeof N.deviceInfo === 'function') { try { dev = JSON.parse(N.deviceInfo()); } catch (e) { dev = null; } }
    return dev;
  }
  const codecName = c => (/hevc|265/i.test(c || '') ? 'HEVC (H.265)' : /avc|264/i.test(c || '') ? 'H.264' : String(c || ''));
  function devHtml() {
    if (!IS_APP) return note('Le montage 4K s’effectue sur le téléphone : il est disponible dans l’application Android.', 'wr');
    const d = devInfo();
    if (!d) return '<p class="sub">Capacités de l’appareil inconnues : l’export choisira automatiquement la meilleure résolution possible.</p>';
    const yes = (b, t) => '<span class="badge ' + (b ? 'bok' : 'ber') + '">' + (b ? '✓ ' : '✕ ') + esc(t) + '</span>';
    return '<div class="row"><span class="sub">' + esc(d.model || 'Appareil') + ' · Android SDK ' + esc(d.sdk) + '</span>' + yes(d.hevc4k, 'HEVC 4K') + yes(d.avc4k, 'H.264 4K') + '</div>' +
      (!d.hevc4k && !d.avc4k ? note('Cet appareil n’encode pas la 4K : l’export se fera dans la meilleure résolution prise en charge (' + esc(d.hevcMax || d.avcMax || '1080p') + '), même cadrage.', 'wr') : '');
  }
  function expPct() {
    if (!EXP) return 0;
    const p = clamp(+EXP.progress || 0, 0, 100);
    if (EXP.state === 'download') return Math.round(((EXP.index || 0) + p / 100) / Math.max(1, EXP.count || 1) * 20);
    if (EXP.state === 'render') return Math.round(20 + p * 0.77);
    if (EXP.state === 'save') return 98;
    return 0;
  }
  function expPhase() {
    if (!EXP) return '';
    if (EXP.state === 'busy') return 'En attente de la fin d’un autre export…';
    if (EXP.state === 'download') return 'Téléchargement des plans (' + Math.min((EXP.index || 0) + 1, EXP.count || 1) + '/' + (EXP.count || 1) + ') · ' + Math.round(EXP.progress || 0) + ' %';
    if (EXP.state === 'render') return 'Rendu 4K' + (EXP.width ? ' ' + EXP.width + ' × ' + EXP.height : '') + (EXP.codec ? ' · ' + codecName(EXP.codec) : '') + ' · ' + Math.round(EXP.progress || 0) + ' %';
    if (EXP.state === 'save') return 'Enregistrement dans la galerie…';
    if (EXP.state === 'cancelling') return 'Annulation…';
    return 'Préparation…';
  }
  function resCard(x, i, big) {
    const b = '<span class="badge ' + (Math.min(+x.width || 0, +x.height || 0) >= 2160 ? 'b4k' : 'bdim') + '">' + esc(resLabel(x.width, x.height) || '?') + '</span>' +
      (x.width ? '<span class="badge bdim">' + x.width + ' × ' + x.height + '</span>' : '') +
      (x.durationMs ? '<span class="badge bdim">' + fmtTime(x.durationMs / 1000) + '</span>' : '') +
      (x.bytes ? '<span class="badge bdim">' + esc(fmtBytes(x.bytes)) + '</span>' : '') +
      (x.codec ? '<span class="badge bdim">' + esc(codecName(x.codec)) + '</span>' : '');
    let when = '';
    try { when = new Date(x.created).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { when = ''; }
    return '<div class="card' + (big ? ' sel' : '') + ' stack" style="gap:10px">' +
      (big ? '<div class="h3">✓ Film exporté dans la galerie</div>' : '<div class="row"><b class="grow" style="overflow-wrap:anywhere">' + esc(x.name || 'Film') + '</b><span class="sub">' + esc(when) + '</span></div>') +
      (big ? '<p class="sub">' + esc(x.name || '') + ' · dossier Movies/CineGenesis</p>' : '') +
      '<div class="row">' + b + '</div>' +
      '<div class="row">' + btn('fexpopen', '▶ Ouvrir', big ? 'pri' : 'sm', 'data-i="' + i + '"') + btn('fexpshare', 'Partager', big ? '' : 'sm', 'data-i="' + i + '"') + '</div></div>';
  }
  function expHtml() {
    const clips = shots().filter(x => x.h.video).length;
    if (EXP && EXP.active && EXP.pid === P.id) {
      return '<div class="card stack"><div class="row"><i class="spin"></i><b class="grow">' + esc(expPhase()) + '</b><span class="sub" id="fiExpEl">' + fmtTime((Date.now() - EXP.start) / 1000) + '</span></div>' +
        '<div class="prog"><i style="width:' + expPct() + '%"></i></div>' +
        '<p class="sub">Laissez l’application ouverte : l’écran reste allumé pendant le rendu.</p>' +
        '<div class="row">' + btn('fexpcancel', '✕ Annuler l’export', 'sm ghost', EXP.state === 'cancelling' ? 'disabled' : '') + '</div></div>';
    }
    let h = '';
    if (EXP && EXP.active) h += note('Un export est en cours pour un autre film : patientez avant d’en lancer un nouveau.', 'wr');
    if (EXP && !EXP.active && EXP.pid === P.id) {
      if (EXP.state === 'error') h += note('<b>L’export a échoué :</b> ' + esc(EXP.err || 'erreur inconnue'), 'er');
      else if (EXP.state === 'done' && P.exports[0] && P.exports[0].id === EXP.rid) h += resCard(P.exports[0], 0, true);
    }
    h += '<button type="button" class="btn pri xl" data-a="fexp4k"' + (!clips || (EXP && EXP.active) ? ' disabled' : '') + '>⬆ Exporter le film en 4K</button>';
    return h;
  }

  V[S_MONTAGE].cfg = () => {
    const a = shots(), ready = a.filter(x => x.h.video), miss = a.length - ready.length;
    const sz = OUT4K[P.ratio] || OUT4K['16:9'];
    const ex = CFG.exp;
    const past = P.exports.filter((x, i) => !(i === 0 && EXP && EXP.state === 'done' && EXP.pid === P.id && x.id === EXP.rid));
    return '<div class="hero">' + hd(7, 'Montage <span class="gt">4K</span>') +
      '<p class="sub">Tous les plans sont assemblés dans l’ordre en un seul film ' + sz.join(' × ') + ', mis à l’échelle et affinés sur votre téléphone, puis enregistrés dans la galerie.</p></div>' +
      '<div class="card stack"><div class="lab">Votre appareil</div>' + devHtml() + '</div>' +
      '<div class="card stack"><div class="row"><div class="h3 grow">Plans prêts</div><span class="badge ' + (ready.length && !miss ? 'bok' : 'bdim') + '">' + ready.length + ' / ' + a.length + '</span></div>' +
        (ready.length ? '<div class="hscroll">' + ready.map(x => '<div class="media" style="width:120px;aspect-ratio:' + AR() + '">' +
          (x.h.img ? '<img src="' + esc(imSrc(x.h.img)) + '" alt="" loading="lazy" decoding="async">' : '') +
          '<div class="tl"><span class="badge bdim">' + shotIndex(x.h) + '</span></div><div class="tr">' + (is4k(x.h) ? '<span class="badge b4k">4K</span>' : '') + '</div></div>').join('') + '</div>'
          : '<p class="sub">Aucune vidéo prête pour l’instant : lancez la production à l’étape 6.</p>') +
        (miss && ready.length ? note(miss + ' plan(s) sans vidéo seront ignorés dans le montage.', 'wr') : '') + '</div>' +
      '<div class="card stack"><div class="h3">Réglages d’export</div>' +
        '<div class="lab">Codec</div><div class="seg" role="group" aria-label="Codec">' +
          [['auto', 'Auto'], ['hevc', 'HEVC (H.265)'], ['avc', 'H.264']].map(c => '<button type="button" class="' + (ex.codec === c[0] ? 'on' : '') + '" data-a="fexpc" data-v="' + c[0] + '" aria-pressed="' + (ex.codec === c[0]) + '">' + c[1] + '</button>').join('') + '</div>' +
        '<div class="lab">Débit</div><div class="row">' +
          [40, 60, 80].map(b => '<button type="button" class="pill' + (ex.mbps === b ? ' on' : '') + '" data-a="fexpb" data-v="' + b + '" aria-pressed="' + (ex.mbps === b) + '">' + b + ' Mbit/s</button>').join('') + '</div>' +
        '<label class="field"><span class="lab">Netteté · <span id="fiSharpV">' + ex.sharpen + '</span> %</span><input type="range" min="0" max="100" step="5" value="' + ex.sharpen + '" data-fexp="sharpen" aria-label="Netteté"></label>' +
        '<p class="sub">Sortie : ' + sz.join(' × ') + ' (4K UHD) · ' + (ex.codec === 'avc' ? 'H.264' : ex.codec === 'hevc' ? 'HEVC' : 'HEVC si possible, sinon H.264') + ' · ' + ex.mbps + ' Mbit/s.</p></div>' +
      '<div id="fiExp" class="stack">' + expHtml() + '</div>' +
      (past.length ? '<div class="stack"><div class="h3">Exports précédents</div>' + past.map(x => resCard(x, P.exports.indexOf(x), false)).join('') + '</div>' : '') +
      foot(btn('fgo', '← Vidéos', 'ghost', 'data-n="' + S_VIDEOS + '"'), '');
  };

  function paintExp() {
    const el = document.getElementById('fiExp');
    if (el && P && page === S_MONTAGE && !TASK) el.innerHTML = expHtml();
  }

  /* ───────────── Vue de tâche ───────────── */
  function workView() {
    const T = TASK;
    return '<div class="hero"><div class="lab">ÉTAPE ' + (T.step + 1) + ' / ' + NSTEP + ' · EN COURS</div><div class="h1">' + esc(T.title) + '</div>' +
      (T.err
        ? note('<b>Un problème est survenu :</b> ' + esc(T.err) + '<div class="row" style="margin-top:10px">' + btn('fretrytask', 'Réessayer', 'pri') + btn('fcanceltask', '← Revenir à l’étape', 'ghost') +
            (/Réglages|clé|key/i.test(T.err) ? '<button type="button" class="btn ghost" data-a="tab" data-tab="settings">Réglages</button>' : '') + '</div>', 'er')
        : note('<i class="spin"></i><b>L’IA travaille pour vous.</b> Les résultats s’affichent tout seuls ; vous pouvez changer d’onglet, le travail continue. <span class="sub">Temps écoulé : <b id="fiEl">' + fmtTime((Date.now() - T.start) / 1000) + '</b></span>')) +
      '</div>' +
      '<div class="prog"><i id="fiPg"></i></div>' +
      '<div class="card"><div class="feed" id="fiFeed"></div></div>' +
      '<div class="grid3" id="fiMinis">' + (T.tiles || []).map(mini).join('') + '</div>' +
      (T.err ? '' : foot('', btn('fstoptask', '■ Arrêter', 'ghost')));
  }

  function view() {
    if (TASK) return workView();
    let s = P.sub[page] || (page === S_SYN ? 'in' : 'cfg');
    if (page === S_SYN && s === 'pick' && !(P.syn && Array.isArray(P.syn.sugg))) s = P.sub[S_SYN] = 'in';
    const v = V[page] || V[S_GENRE];
    return (v[s] || v.cfg || v.in)();
  }

  const stepDone = i => {
    if (i === S_GENRE) return !!P.genre;
    if (i === S_SYN) return !!String(P.final || '').trim();
    if (i === S_CHARS) return P.chars.some(c => c.img);
    if (i === S_SCENES) return P.scenes.some(s => s.img);
    const a = shots();
    if (i === S_SHOTS) return a.some(x => x.h.img);
    if (i === S_VIDEOS) return a.length > 0 && a.every(x => x.h.vst === 'ok');
    return P.exports.length > 0;
  };

  function render(keep) {
    const scr = document.getElementById('scr-film');
    if (!scr) return;
    if (!P) setP(newP());
    page = clamp(page | 0, 0, NSTEP - 1);
    P.max = Math.max(P.max || 0, page);
    P.page = page;
    const title = P.title || (P.genre && P.genre.name) || 'Nouveau film';
    let body;
    try { body = view(); } catch (e) {
      log('er', 'affichage film : ' + e.message);
      body = note('Affichage impossible : ' + esc(e.message), 'er');
    }
    scr.innerHTML = '<div class="wrap stack">' +
      '<div class="row"><div class="grow" style="min-width:0"><div class="lab">FILM · ' + NSTEP + ' ÉTAPES</div>' +
        '<div class="h2" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(title) + '</div></div>' +
        '<span id="fiQchip"></span>' + btn('fsess', '🎞 Mes films', 'sm') + '</div>' +
      '<nav class="steps" aria-label="Étapes du film">' + STEPS.map((s, i) => {
        const can = !TASK && i !== page && (i === 0 || i <= P.max);
        return '<button type="button" class="step' + (i === page ? ' on' : '') + (stepDone(i) ? ' done' : '') + '"' + (can ? ' data-a="fgo" data-n="' + i + '"' : ' disabled') +
          (i === page ? ' aria-current="step"' : '') + '><b>' + (i + 1) + '</b>' + esc(s) + '</button>';
      }).join('') + '</nav>' +
      '<div class="stack" id="fiMain">' + body + '</div></div>';
    if (TASK) { paintFeed(); pgb(); }
    else if (page === S_VIDEOS) { stats(); qui(true); }
    else syncNext();
    qchip();
    const on = document.querySelector('#scr-film .step.on');
    if (on && on.scrollIntoView) { try { on.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { /* ancien moteur */ } }
    if (!keep && scr.classList.contains('on')) { try { window.scrollTo(0, 0); } catch (e) { /* sans effet */ } }
    persist();
  }

  function go(n) {
    if (TASK) { toast('Une opération est en cours : patientez ou touchez Arrêter', 'wr'); return; }
    n = clamp(+n | 0, 0, NSTEP - 1);
    if (page > 0) P.last = page;
    page = n;
    render();
    onEnter();
  }
  /* Pas d'avance automatique : seul le découpage en plans démarre dès l'arrivée sur l'étape (comme l'original) */
  function onEnter() {
    if (TASK || !P) return;
    const s = P.sub[page] || (page === S_SYN ? 'in' : 'cfg');
    if (s !== 'cfg') return;
    if (page === S_SHOTS && P.scenes.length) runShots();
  }

  /* ═════════════════════════════════════════════════════════════════════
     FILE D'ATTENTE VIDÉO
     ═════════════════════════════════════════════════════════════════════ */
  const hhmm = t => { try { return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return new Date(t).toTimeString().slice(0, 5); } };
  const unsat = q => { q.st = 'run'; q.next = 0; q.step = 0; q.cur = -1; };
  // Modèle fal.ai proposé quand Agnès est saturée : celui des Réglages s'il est fal.ai, sinon Kling 3.0 · 4K.
  const falVm = () => { const e = CFG.eng && CFG.eng.video; return e && VMODELS[e] && VMODELS[e].prov === 'fal' ? e : 'kling4k'; };
  // Relance ciblée : production en pause → seuls ces plans partent ; production en cours → rien ne change.
  function only(q, ids) {
    if (!q.on) q.only = ids.slice();
    else if (q.only) ids.forEach(id => { if (q.only.indexOf(id) < 0) q.only.push(id); });
  }

  function updFor(p, h) {
    return s => {
      if (P === p) { refresh(h.id); if (page === S_VIDEOS) qui(); }
      if (s) persist(p);
    };
  }

  function qHtml(ok, left, run, er, vm) {
    const a = shots();
    if (!vm) return note('<b>Aucun moteur vidéo.</b> Ajoutez une clé fal.ai ou Agnès dans Réglages.<div class="row" style="margin-top:10px"><button type="button" class="btn sm" data-a="tab" data-tab="settings">Ouvrir les Réglages</button></div>', 'wr');
    if (a.length && ok === a.length) return note('<b>🎉 Toutes les vidéos sont prêtes !</b> Regardez le film ou passez au montage 4K.', 'ok') + '<div class="row">' + btn('fgo', 'Passer au montage 4K →', 'pri', 'data-n="' + S_MONTAGE + '"') + '</div>';
    const fal = VMODELS[vm].prov === 'fal';
    const erRow = er && !Q.on ? note(er + ' vidéo(s) en échec.', 'er') + '<div class="row">' + btn('fretryall', '↻ Relancer les échecs', 'sm') + '</div>' : '';
    if (!Q.on && Q.st === 'idle' && !ok && !er) return note('<b>Prêt à créer les vidéos.</b> Vos images de plans sont validées. 👉 Touchez le bouton : tout se passe ensuite automatiquement.') + '<div class="row">' + btn('fqstart', '▶ Lancer la production des vidéos', 'pri xl') + '</div>';
    if (!Q.on) return note('<b>Production en pause.</b> ' + ok + ' vidéo(s) prête(s), ' + left + ' restante(s)' + (run ? ', ' + run + ' encore en cours' : '') + '.', 'wr') + erRow + (left - er > 0 || !er ? '<div class="row">' + btn('fqstart', '▶ Reprendre la production', 'pri') + '</div>' : '');
    if (Q.st === 'full') {
      const fm = falVm(), usd = estimateVideoUSD(fm, vdur(fm));
      return note('<b>⏳ Agnès saturée — nouvel essai à ' + hhmm(Q.next) + '.</b> Aucune requête n’est envoyée pendant l’attente. Prochain test dans <b id="fiCd" class="mono" style="font-size:18px">' + fmtTime((Q.next - Date.now()) / 1000) + '</b>', 'wr') +
        '<div class="lab">Paliers d’attente</div><div class="row">' + LADDER.map((m, i) => '<span class="badge ' + (i === Q.cur ? 'bwr' : i < Q.cur ? 'bok' : 'bdim') + '">' + m + ' min</span>').join('') + '</div>' +
        (hasFal()
          ? note('⚡ Pour ne plus attendre, passez ce film sur <b>' + esc(VMODELS[fm].name) + '</b> (fal.ai' + (usd != null ? ', ' + esc(fmtUSD(usd)) + ' par plan' : '') + ') : les plans en attente partent tout de suite.') +
            '<div class="row">' + btn('fvmodel', '⚡ Passer sur ' + esc(VMODELS[fm].name), 'pri', 'data-m="' + fm + '"') + '</div>'
          : note('⚡ Pour générer tout de suite, ajoutez une clé <b>fal.ai</b> (Kling 3.0, LTX-2.3 en 4K natif).') +
            '<div class="row"><button type="button" class="btn sm" data-a="tab" data-tab="settings">Ajouter une clé fal.ai</button></div>') +
        '<div class="row">' + btn('fqnow', 'Tester maintenant', 'sm') + btn('fqpause', '❚❚ Mettre en pause', 'sm ghost') + '</div>';
    }
    return note('<b>⚙ Production en cours.</b> Les vidéos sont envoyées à ' + (fal ? 'fal.ai (jusqu’à ' + CFG.falPar + ' en parallèle)' : 'Agnès') + ' et apparaissent ci-dessous dès qu’elles sont prêtes (' + ok + ' prête(s), ' + run + ' en cours, ' + Math.max(0, left - run) + ' en attente).' +
      (Q.only ? ' Relance ciblée : ' + Q.only.length + ' plan(s), les autres restent en pause.' : '')) +
      '<div class="row">' + btn('fqpause', '❚❚ Mettre en pause', 'sm ghost') + '</div>';
  }

  function counts(p) {
    const a = shots(p);
    const n = s => a.filter(x => x.h.vst === s && x.h.img).length;
    return { a, ok: a.filter(x => x.h.vst === 'ok').length, run: n('run'), wait: n('wait'), er: n('er'), left: a.filter(x => x.h.vst !== 'ok' && x.h.img).length, nv: a.filter(x => x.h.video && !x.h.seen).length, k4: a.filter(x => x.h.video && is4k(x.h)).length };
  }

  function qchip() {
    const c = document.getElementById('fiQchip');
    if (!c || !P) return;
    const k = counts();
    if (!k.a.some(x => x.h.img) || (!Q.on && !k.ok && !k.run)) { c.innerHTML = ''; return; }
    const t = Q.st === 'full' && Q.on ? 'Agnès saturée · ' + fmtTime((Q.next - Date.now()) / 1000)
      : !Q.on ? (k.ok === k.a.length ? 'vidéos prêtes' : 'en pause') : 'vidéos ' + k.ok + '/' + k.a.length;
    const cls = Q.st === 'full' && Q.on ? 'bwr' : !Q.on ? (k.ok === k.a.length ? 'bok' : 'bdim') : 'baud';
    c.innerHTML = '<span class="badge ' + cls + '">' + esc(t) + '</span>';
  }

  function qui(force) {
    qchip();
    const e = document.getElementById('fiQ');
    if (!e || page !== S_VIDEOS || TASK || !P) return;
    const k = counts(), vm = vmodel();
    const full = Q.on && Q.st === 'full' ? Q.next : 0;
    const sig = [Q.st, Q.on, Q.cur, k.ok, k.left, k.run, k.er, k.a.length, vm, CFG.falPar, Q.only ? Q.only.length : 0, hasFal(), full].join();
    if (force || e.dataset.sig !== sig) {
      // Les tuiles en attente affichent l'heure du prochain essai Agnès.
      if (!force && String(full) !== e.dataset.full) k.a.forEach(x => { if (x.h.vst === 'wait' && x.h.img) refresh(x.h.id); });
      e.dataset.sig = sig;
      e.dataset.full = String(full);
      e.innerHTML = qHtml(k.ok, k.left, k.run, k.er, vm);
    }
    const cd = document.getElementById('fiCd');
    if (cd) cd.textContent = fmtTime((Q.next - Date.now()) / 1000);
  }

  function stats() {
    const el = document.getElementById('fiKpi');
    if (!el || !P) return;
    const k = counts();
    const kp = (l, v) => '<div class="kpi"><span class="lab">' + l + '</span><b>' + v + '</b></div>';
    el.innerHTML = kp('Plans', k.a.length) + kp('Vidéos prêtes', k.ok) + kp('En cours', k.run) + kp('En attente', k.wait) + kp('Échecs', k.er) + kp('Non vues', k.nv) + kp('En 4K', k.k4);
    const c = document.getElementById('fiCost');
    if (c) {
      const vm = vmodel();
      if (!vm) { c.textContent = ''; return; }
      const m = VMODELS[vm], d = vdur(vm), per = estimateVideoUSD(vm, d), todo = k.left;
      c.textContent = m.prov === 'agnes' ? 'Inclus avec vos clés Agnès'
        : per == null ? 'Coût selon le tarif fal.ai'
        : 'Reste à produire : ' + todo + ' plan(s) · ' + fmtUSD(per * todo) + (!m.native && CFG.up4k !== false && hasFal() ? ' + upscale Topaz 4K' : '');
    }
  }

  function sat(p) {
    const q = p.q;
    const i = clamp(q.step | 0, 0, LADDER.length - 1);
    q.st = 'full';
    q.cur = i;
    q.next = Date.now() + LADDER[i] * 60000;
    log('wr', 'file vidéo saturée → nouveau test dans ' + LADDER[i] + ' min');
    toast('Agnès saturée — nouvel essai à ' + hhmm(q.next) + (p === P ? '' : ' (« ' + nameOf(p) + ' »)'), 'wr');
    q.step = Math.min(i + 1, LADDER.length - 1);
    persist(p);
    if (p === P) qui();
  }

  async function launch(p, h, s, vm) {
    const q = p.q;
    const r = await startVideo(h, { model: vm, prompt: vp(h, s, p), image: h.img.u, dur: vdur(vm, p), ratio: p.ratio, audio: CFG.audio !== false }, updFor(p, h));
    if (gone.has(p.id)) return;
    if (r === 'full') return sat(p);
    if (r === 'ok') {
      q.st = 'run'; q.step = 0; q.cur = -1;
      persist(p);
    } else if (r === 'later') {
      q.next = Date.now() + 20000;
    } else if (r === 'err' && VMODELS[vm].prov === 'agnes' && !hasAgnes()) {
      q.on = false; q.st = 'paused';
      toast('Aucune clé Agnès active', 'er');
      awake();
      persist(p);
    }
    if (p === P) qui();
  }

  /* Une file par film : celle d'un film quitté continue en arrière-plan. */
  function qtick(p) {
    const q = p && p.q;
    if (!q || !q.on || q.busy || gone.has(p.id)) return;
    const vm = pickVideo(p.vmodel);
    // Attente Agnès alors que le film est passé sur fal.ai : inutile d'attendre la fin du palier.
    if (q.st === 'full' && vm && VMODELS[vm].prov !== 'agnes') unsat(q);
    if (Date.now() < q.next) return;
    const a = shots(p), sel = q.only ? new Set(q.only) : null;
    const todo = a.filter(x => x.h.vst === 'wait' && x.h.img && (!sel || sel.has(x.h.id))), run = a.filter(x => x.h.vst === 'run').length;
    if (!todo.length) {
      if (!run) {
        q.on = false; q.only = null;
        q.st = a.some(x => x.h.vst === 'wait' && x.h.img) ? 'paused' : 'idle';
        const k = counts(p);
        if (k.ok && k.ok === k.a.length) { toast(p === P ? '🎬 Toutes les vidéos sont prêtes' : '🎬 « ' + nameOf(p) + ' » : toutes les vidéos sont prêtes', 'ok'); log('ok', 'production vidéo terminée'); }
        awake(); persist(p); if (p === P) qui();
      }
      return;
    }
    if (!vm) { q.on = false; q.st = 'paused'; toast('Aucun moteur vidéo : ajoutez une clé dans Réglages', 'er'); awake(); persist(p); if (p === P) qui(); return; }
    const max = VMODELS[vm].prov === 'fal' ? clamp(+CFG.falPar || 3, 1, 8) : Math.max(2, KEYS.list.filter(k => !k.off).length * 3);
    if (run >= max) return;
    q.busy = true;
    const next = todo[0];
    launch(p, next.h, next.s, vm)
      .catch(e => { log('er', 'file : ' + e.message); q.on = false; q.st = 'paused'; awake(); if (p === P) qui(); })
      .then(() => { q.busy = false; });
  }

  function qstart(ids) {
    if (!shots().some(x => x.h.img)) { toast('Il faut d’abord des images de plans', 'wr'); return; }
    if (!vmodel()) { toast('Aucun moteur vidéo : ajoutez une clé dans Réglages', 'er'); return; }
    if (ids) only(Q, ids); else Q.only = null;
    Q.on = true;
    if (Q.st === 'paused' || Q.st === 'idle') Q.st = 'run';
    if (Q.st !== 'full') Q.next = 0;
    awake(); persist(); qui();
    log('in', 'production vidéo lancée');
  }

  /* ═════════════════════════════════════════════════════════════════════
     LECTEUR (animatic : vidéos prêtes + images avec voix)
     ═════════════════════════════════════════════════════════════════════ */
  async function play() {
    if (playing) return;
    const a = shots().filter(x => x.h.video || x.h.img);
    if (!a.length) { toast('Rien à lire pour l’instant', 'wr'); return; }
    const pl = document.getElementById('player'), v = document.getElementById('pv'), im = document.getElementById('pi'), sub = document.getElementById('sub');
    if (!pl || !v || !im) return;
    playing = true;
    pl.classList.add('on');
    plCloser = () => { stopPlay(); return true; };
    BACK.push(plCloser);
    const p = P;
    for (let i = 0; i < a.length; i++) {
      if (!playing) break;
      const h = a[i].h;
      if (sub) sub.textContent = h.line ? (h.who ? h.who + ' : ' : '') + h.line : '';
      if (h.video) {
        im.removeAttribute('src');
        v.poster = imSrc(h.img);
        v.src = h.video;
        await new Promise(r => {
          plWake = r;
          v.onended = r;
          v.onerror = r;
          try { const pp = v.play(); if (pp && pp.catch) pp.catch(r); } catch (e) { r(); }
        });
        plWake = null;
        if (playing && !h.seen) { h.seen = true; persist(p); }
      } else {
        try { v.pause(); } catch (e) { /* déjà arrêtée */ }
        v.onended = v.onerror = null;
        v.removeAttribute('src');
        v.removeAttribute('poster');
        try { v.load(); } catch (e) { /* sans effet */ }
        im.src = imSrc(h.img);
        // Image plein écran en 1920 px (jamais la 4K complète en mémoire)
        thumb(h.img.u, 1920).then(u => { if (playing && u && a[i] && im.getAttribute('src') === imSrc(h.img)) im.src = u; }).catch(() => {});
        speak(h.line);
        await new Promise(r => { plWake = r; setTimeout(r, Math.max(3500, (h.line || '').length * 75)); });
        plWake = null;
      }
    }
    stopPlay();
  }

  function stopPlay() {
    const was = playing;
    playing = false;
    const pl = document.getElementById('player'), v = document.getElementById('pv'), im = document.getElementById('pi'), sub = document.getElementById('sub');
    if (v) {
      try { v.pause(); } catch (e) { /* déjà arrêtée */ }
      v.onended = v.onerror = null;
      v.removeAttribute('src');
      v.removeAttribute('poster');
      try { v.load(); } catch (e) { /* sans effet */ }
    }
    if (im) im.removeAttribute('src');
    if (sub) sub.textContent = '';
    stopSpeak();
    if (pl) pl.classList.remove('on');
    if (plCloser) { const i = BACK.indexOf(plCloser); if (i >= 0) BACK.splice(i, 1); plCloser = null; }
    const w = plWake;
    plWake = null;
    if (w) w();
    if (was && page === S_VIDEOS && !TASK) render(true);
    return was;
  }

  /* ═════════════════════════════════════════════════════════════════════
     MONTAGE 4K NATIF
     ═════════════════════════════════════════════════════════════════════ */
  function expStart() {
    if (EXP && EXP.active) { toast('Un export est déjà en cours', 'wr'); return; }
    if (!IS_APP) { toast('Disponible dans l’application Android', 'wr'); return; }
    const clips = shots().filter(x => x.h.video).map(x => x.h.video);
    if (!clips.length) { toast('Aucune vidéo prête à monter', 'wr'); return; }
    const miss = shots().length - clips.length;
    if (miss) toast(miss + ' plan(s) sans vidéo ignoré(s)', 'wr');
    const sz = OUT4K[P.ratio] || OUT4K['16:9'];
    const name = String(P.title || (P.genre && P.genre.name) || 'Mon film').trim().slice(0, 70) + ' 4K';
    const req = { clips, width: sz[0], height: sz[1], codec: CFG.exp.codec, mbps: CFG.exp.mbps, sharpen: Math.round(clamp(+CFG.exp.sharpen || 0, 0, 100)) / 100, name };
    EXP = { pid: P.id, p: P, req, active: true, state: 'download', progress: 0, index: 0, count: clips.length, width: 0, height: 0, codec: '', start: Date.now(), tries: 0, cancel: false, timer: 0, id: '' };
    log('in', 'montage 4K : ' + clips.length + ' plan(s) → ' + sz.join('×') + ' · ' + req.codec + ' · ' + req.mbps + ' Mbit/s');
    awake();
    paintExp();
    expRun(EXP);
  }
  function expRun(E) {
    E.id = nativeListen('exportFilm', E.req, ev => expEvent(E, ev));
  }
  function expEvent(E, ev) {
    if (EXP !== E) return;
    const s = ev && ev.state;
    if (s === 'download' || s === 'render' || s === 'save') {
      if (E.state === 'cancelling') return;
      E.state = s;
      E.progress = clamp(+ev.progress || 0, 0, 100);
      if (s === 'download') { E.index = +ev.index || 0; E.count = +ev.count || E.count; }
      if (s === 'render') { E.width = +ev.width || E.width; E.height = +ev.height || E.height; E.codec = ev.codec || E.codec; }
      paintExp();
      return;
    }
    // Un autre export natif (Studio) occupe l'encodeur : on attend notre tour.
    if (s === 'error' && /déjà en cours/i.test(String(ev.error || '')) && !E.cancel && E.tries++ < 120) {
      E.state = 'busy';
      paintExp();
      E.timer = setTimeout(() => { if (EXP === E && !E.cancel) expRun(E); }, 5000);
      return;
    }
    E.active = false;
    const p = E.p;
    if (s === 'done') {
      const x = { id: uid(), uri: String(ev.uri || ''), width: +ev.width || E.req.width, height: +ev.height || E.req.height, durationMs: +ev.durationMs || 0, bytes: +ev.bytes || 0, codec: String(ev.codec || E.codec || ''), name: String(ev.name || E.req.name + '.mp4'), created: Date.now(), clips: E.req.clips.length };
      E.state = 'done';
      E.rid = x.id;
      p.exports = Array.isArray(p.exports) ? p.exports : [];
      p.exports.unshift(x);
      persist(p);
      haptic('confirm');
      toast('Film ' + (resLabel(x.width, x.height) || '') + ' enregistré dans la galerie', 'ok');
      log('ok', 'montage terminé : ' + x.name + ' · ' + x.width + '×' + x.height + (x.bytes ? ' · ' + fmtBytes(x.bytes) : ''));
      if (typeof GAL !== 'undefined' && GAL && typeof GAL.add === 'function') {
        const first = shots(p).find(y => y.h.img);
        const item = {
          id: 'film_' + x.id, kind: 'film', src: 'film', title: p.title || '', prompt: p.title || p.final || '', style: p.genre ? p.genre.name : '',
          model: 'montage', ratio: p.ratio, created: x.created, st: 'ok', err: '', uri: x.uri, u: x.uri, video: x.uri,
          t: first ? imSrc(first.h.img) : '', w: x.width, h: x.height, vw: x.width, vh: x.height, vd: x.durationMs ? Math.round(x.durationMs / 100) / 10 : 0,
          bytes: x.bytes, codec: x.codec, name: x.name, project: p.id, seen: false,
        };
        try { Promise.resolve(GAL.add(item)).catch(e => log('wr', 'galerie : ' + e.message)); } catch (e) { log('wr', 'galerie : ' + e.message); }
      }
    } else if (s === 'cancelled') {
      E.state = 'cancelled';
      toast('Export annulé');
      log('wr', 'montage annulé');
    } else {
      E.state = 'error';
      E.err = String((ev && ev.error) || 'erreur inconnue');
      haptic('reject');
      toast('Export impossible : ' + E.err, 'er');
      log('er', 'montage : ' + E.err);
    }
    awake();
    if (P === p && page === S_MONTAGE && !TASK) render(true);
  }
  function expCancel() {
    const E = EXP;
    if (!E || !E.active) return;
    E.cancel = true;
    if (E.state === 'busy') {
      clearTimeout(E.timer);
      E.active = false;
      E.state = 'cancelled';
      awake();
      paintExp();
      return;
    }
    E.state = 'cancelling';
    paintExp();
    try { if (N && typeof N.cancelExport === 'function') N.cancelExport(); } catch (e) { log('wr', 'annulation : ' + e.message); }
  }

  /* ═════════════════════════════════════════════════════════════════════
     SESSIONS (« Mes films »)
     ═════════════════════════════════════════════════════════════════════ */
  async function sessions() {
    let l = [];
    try { l = await DB.all('sessions'); } catch (e) { log('er', 'sessions : ' + e.message); }
    l = (l || []).filter(p => p && p.id && Array.isArray(p.scenes) && !gone.has(p.id)).map(p => LIVE.get(p.id) || p).sort((a, b) => (b.upd || 0) - (a.upd || 0));
    if (P && !l.some(p => p.id === P.id)) l.unshift(P);
    const cover = p => {
      const pick = arr => arr.find(o => o && o.img && (o.img.t || o.img.u || o.img.d));
      const sh = [];
      (p.scenes || []).forEach(s => (s.shots || []).forEach(h => sh.push(h)));
      const o = pick(sh) || pick(p.scenes || []) || pick(p.chars || []);
      return o ? (o.img.t || o.img.d || o.img.u) : '';
    };
    const html = '<div class="stack">' +
      '<div class="row"><div class="h2 grow">Mes films</div>' + btn('fsclose', '✕', 'icon ghost', 'aria-label="Fermer"') + '</div>' +
      '<p class="sub">Tout est enregistré automatiquement sur cet appareil : textes, images et vidéos générées.</p>' +
      btn('fsnew', '+ Nouveau film', 'pri') +
      l.map(p => {
        const sh = [];
        (p.scenes || []).forEach(s => (s.shots || []).forEach(h => sh.push(h)));
        const nv = sh.filter(h => h.video && !h.seen).length;
        const cur = P && p.id === P.id;
        const cv = cover(p);
        let when = '';
        try { when = new Date(p.upd || p.created || Date.now()).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { when = ''; }
        return '<div class="card' + (cur ? ' sel' : '') + ' stack" style="gap:10px"><div class="row" style="flex-wrap:nowrap;align-items:flex-start">' +
          '<div class="media" style="width:72px;flex:none;aspect-ratio:1">' + (cv ? '<img src="' + esc(cv) + '" alt="" loading="lazy" decoding="async">' : '<span>🎬</span>') + '</div>' +
          '<div class="grow" style="min-width:0"><b style="overflow-wrap:anywhere">' + esc(p.title || (p.genre && p.genre.name) || 'Sans titre') + '</b>' + (cur ? ' <span class="badge bok">en cours</span>' : '') +
          (nv ? ' <span class="badge bok">' + nv + ' NOUVEAU</span>' : '') +
          (p.q && p.q.on ? ' <span class="badge baud">vidéos en production</span>' : p.q && p.q.st === 'paused' && sh.some(h => h.vst === 'wait' && h.img) ? ' <span class="badge bdim">production en pause</span>' : '') +
          '<div class="sub" style="font-size:12.5px">' + esc(when) + ' · ' + (p.scenes || []).length + ' scènes · ' + sh.filter(h => h.img).length + ' images · ' + sh.filter(h => h.video).length + ' vidéos' +
          ((p.exports || []).length ? ' · ' + p.exports.length + ' export(s) 4K' : '') + '</div></div></div>' +
          '<div class="row">' + (cur ? '' : btn('fsopen', 'Ouvrir', 'sm', 'data-id="' + esc(p.id) + '"')) + btn('fsdel', 'Supprimer', 'sm ghost', 'data-id="' + esc(p.id) + '"') + '</div></div>';
      }).join('') + '</div>';
    openSheet(html);
  }

  /* Film quitté : sauvegardé ; sa production (file + suivi) continue en arrière-plan. */
  function leave(id) {
    if (!P || P.id === id) return;
    persist(P);
    const k = counts(P);
    if ((Q && Q.on) || k.run) toast('« ' + nameOf(P) + ' » : la production des vidéos continue en arrière-plan (' + k.ok + '/' + k.a.length + ')', 'ok');
  }

  function newProject() {
    if (TASK) { toast('Une opération est en cours : patientez ou touchez Arrêter', 'wr'); return false; }
    if (playing) stopPlay();
    leave('');
    setP(newP());
    page = S_GENRE;
    closeSheet();
    render();
    return true;
  }

  async function open(id) {
    if (TASK) { toast('Une opération est en cours : patientez ou touchez Arrêter', 'wr'); return false; }
    let p = LIVE.get(id) || null;
    const fresh = !p;   // déjà en mémoire : son suivi tourne, on ne le relance surtout pas
    if (!p) { try { p = await DB.get('sessions', id); } catch (e) { log('er', 'ouverture : ' + e.message); } }
    if (!p || gone.has(id)) { toast('Film introuvable', 'er'); return false; }
    if (playing) stopPlay();
    leave(id);
    setP(p);
    page = clamp(+P.page || 0, 0, Math.min(NSTEP - 1, P.max || 0));
    closeSheet();
    render();
    if (fresh) resume(P);
    return true;
  }

  async function delSession(id) {
    const ok = await confirmSheet('Supprimer ce film ?', 'Le projet (textes, images, liens des vidéos) sera effacé de cet appareil. Les fichiers déjà enregistrés dans la galerie sont conservés.', 'Supprimer');
    if (!ok) return;
    gone.add(id);
    clearTimeout(svT.get(id));
    svT.delete(id);
    const lp = LIVE.get(id);
    if (lp && lp.q) lp.q.on = false;
    LIVE.delete(id);
    try { await DB.del('sessions', id); } catch (e) { log('er', 'suppression : ' + e.message); }
    if (P && P.id === id) {
      if (TASK) { TASK.stop = true; TASK = null; }
      if (playing) stopPlay();
      setP(newP());
      page = S_GENRE;
      render();
    }
    awake();
    toast('Film supprimé');
    sessions();
  }

  /* ═════════════════════════════════════════════════════════════════════
     ACTIONS (préfixe f)
     ═════════════════════════════════════════════════════════════════════ */
  const A = (name, fn) => {
    ACT[name] = (el, e) => {
      if (!P) setP(newP());
      if (TASK && !OK_DURING[name]) { toast('Une opération est en cours : patientez ou touchez Arrêter', 'wr'); return; }
      return fn(el, e);
    };
  };
  const idOf = el => (el && el.dataset ? el.dataset.id : '') || '';

  A('fgo', el => go(+el.dataset.n));
  A('fgenre', el => {
    const g = G[+el.dataset.c], x = g && g[1][+el.dataset.i];
    if (!x) return;
    const p = x.split('|');
    P.genre = { name: p[0], style: p[1] };
    haptic('tap');
    render(true);
  });
  A('fratio', el => { if (OUT4K[el.dataset.n]) { P.ratio = el.dataset.n; render(true); } });
  A('fimodel', el => {
    const m = IMODELS[el.dataset.m];
    if (!m) return;
    if (!(m.prov === 'fal' ? hasFal() : hasAgnes())) { toast('Ajoutez une clé ' + (m.prov === 'fal' ? 'fal.ai' : 'Agnès') + ' dans Réglages pour utiliser ' + m.name, 'wr'); return; }
    P.imodel = el.dataset.m;
    render(true);
  });
  A('fvmodel', el => {
    const m = VMODELS[el.dataset.m];
    if (!m) return;
    if (!(m.prov === 'fal' ? hasFal() : hasAgnes())) { toast('Ajoutez une clé ' + (m.prov === 'fal' ? 'fal.ai' : 'Agnès') + ' dans Réglages pour utiliser ' + m.name, 'wr'); return; }
    P.vmodel = el.dataset.m;
    if (m.durs.indexOf(+P.vdur) < 0) P.vdur = m.durs[0];
    // File Agnès saturée : avec un modèle fal.ai, les plans en attente partent tout de suite.
    if (Q.st === 'full' && m.prov !== 'agnes') {
      unsat(Q);
      if (Q.on) toast('Moteur vidéo : ' + m.name + ' — les plans en attente partent maintenant', 'ok');
    }
    render(true);
  });
  A('fvdur', el => { P.vdur = +el.dataset.n || 0; render(true); });

  A('fsynai', () => {
    if (String(P.synRaw || '').trim().length < 10) { toast('Écrivez au moins une phrase', 'wr'); return; }
    runSyn();
  });
  A('fsynasis', () => {
    if (String(P.synRaw || '').trim().length < 10) { toast('Écrivez au moins une phrase', 'wr'); return; }
    P.final = P.synRaw;
    P.syn = null;
    done(S_SYN, 'fin');
  });
  A('fsynedit', () => { P.syn = null; P.final = ''; P.sub[S_SYN] = 'in'; render(); });
  A('fsynback', () => { P.sub[S_SYN] = P.syn ? 'pick' : 'in'; render(); });
  A('fsynok', () => {
    if (!P.syn) { P.sub[S_SYN] = 'in'; render(); return; }
    if ((P.syn.sel || []).length) runMerge();
    else { P.final = P.syn.base; P.sub[S_SYN] = 'fin'; render(); }
  });

  A('fchai', () => {
    if (!String(P.final || '').trim()) { toast('Écrivez d’abord le synopsis', 'wr'); return; }
    runChars('ai');
  });
  A('fchown', () => {
    if (!P.chars.length) { toast('Ajoutez au moins un personnage', 'wr'); return; }
    runChars('own');
  });
  A('faddchar', () => {
    const c = { id: uid(), name: 'Nouveau personnage', role: '', desc: '', outfit: '', img: null, busy: false };
    P.chars.push(c);
    render(true);
    const el = document.getElementById('fii-' + c.id) || document.getElementById('fic-' + c.id);
    if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); } }
  });
  A('fnsc', el => { P.nsc = +el.dataset.n || 5; render(true); });
  A('fscgo', async () => {
    if (!String(P.final || '').trim()) { toast('Écrivez d’abord le synopsis', 'wr'); return; }
    if (P.scenes.length && !(await confirmSheet('Remplacer les scènes existantes ?', 'Le scénario actuel, ses images et ses plans seront remplacés.', 'Remplacer'))) return;
    runScenes(P.nsc || 5);
  });
  A('fplgo', () => {
    if (!P.scenes.length) { toast('Écrivez d’abord le scénario', 'wr'); return; }
    runShots();
  });
  A('faddscene', () => {
    const s = { id: uid(), title: 'Nouvelle scène', summary: '', decor: '', mood: '', chars: [], dialogue: '', img: null, busy: false, shots: [] };
    P.scenes.push(s);
    render(true);
    const el = document.getElementById('fic-' + s.id);
    if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); } }
  });
  A('faddshot', el => {
    const f = find(idOf(el));
    if (!f || f.t !== 's') return;
    const h = { id: uid(), size: 'medium', camera: 'static', action: '', chars: [], who: '', line: '', img: null, busy: false, vst: 'wait' };
    (f.o.shots = f.o.shots || []).push(h);
    render(true);
    const c = document.getElementById('fic-' + h.id);
    if (c && c.scrollIntoView) { try { c.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { c.scrollIntoView(); } }
  });
  A('fredo', async el => {
    const n = +el.dataset.n;
    if (!(await confirmSheet('Refaire cette étape avec l’IA ?', 'Le contenu actuel de l’étape sera remplacé.', 'Refaire'))) return;
    if (TASK) return;
    if (n === S_CHARS) P.chars = [];
    if (n === S_SCENES) P.scenes = [];
    if (n === S_SHOTS) P.scenes.forEach(s => { s.shots = []; });
    P.sub[n] = 'cfg';
    page = n;
    render();
    if (n === S_CHARS) runChars('ai');
    else if (n === S_SCENES) runScenes(P.nsc || 5);
    else if (n === S_SHOTS) runShots();
  });

  A('fgen', el => {
    const id = idOf(el);
    const i = document.querySelector('[data-fmod="' + id + '"]');
    gen(id, { extra: i ? i.value.trim() : '' });
  });
  A('fmod', el => {
    const id = idOf(el);
    const i = document.querySelector('[data-fmod="' + id + '"]');
    if (i && i.value.trim()) gen(id, { edit: true, extra: i.value.trim() });
    else { toast('Écrivez d’abord ce que vous voulez changer', 'wr'); if (i) i.focus(); }
  });
  A('fsave', el => {
    const f = find(idOf(el));
    if (!f || !f.o.img) return;
    const nm = (P.title || 'CineGenesis') + ' - ' + (f.o.name || f.o.title || ('plan ' + shotIndex(f.o)));
    return saveToGallery(f.o.img.u, 'image', nm);
  });
  A('fsavev', el => {
    const f = find(idOf(el));
    if (!f || !f.o.video) return;
    return saveToGallery(f.o.video, 'video', (P.title || 'CineGenesis') + ' - plan ' + shotIndex(f.o));
  });
  A('fdel', async el => {
    const id = idOf(el);
    const f = find(id);
    if (!f) return;
    const what = f.t === 'c' ? 'ce personnage' : f.t === 's' ? 'cette scène et ses plans' : 'ce plan';
    if (!(await confirmSheet('Supprimer ' + what + ' ?', f.o.name || f.o.title || f.o.action || '', 'Supprimer'))) return;
    const g = find(id);
    if (!g) return;
    if (g.t === 'c') P.chars = P.chars.filter(c => c.id !== id);
    else if (g.t === 's') P.scenes = P.scenes.filter(s => s.id !== id);
    else g.s.shots = g.s.shots.filter(h => h.id !== id);
    render(true);
  });

  A('fstoptask', () => { if (TASK && !TASK.err) { TASK.stop = true; toast('Arrêt en cours…'); } });
  A('fretrytask', () => retryTask());
  A('fcanceltask', () => { TASK = null; awake(); render(); });

  A('fqstart', () => qstart());
  A('fqpause', () => { Q.on = false; Q.st = 'paused'; Q.only = null; awake(); persist(); qui(); log('in', 'production vidéo en pause'); });
  A('fqnow', () => { Q.on = true; Q.next = 0; Q.st = 'run'; log('in', 'test manuel de la file vidéo'); awake(); persist(); qui(); });
  A('fretry', async el => {
    const f = find(idOf(el));
    if (!f || f.t !== 'h' || f.o.vst === 'run') return;
    if (!f.o.img) { toast('Ce plan n’a pas d’image', 'wr'); return; }
    if (f.o.vst === 'ok' && !(await confirmSheet('Refaire la vidéo de ce plan ?', 'Une nouvelle vidéo sera générée à partir de l’image du plan.', 'Refaire'))) return;
    f.o.vst = 'wait'; f.o.err = ''; f.o.msg = '';
    // En pause, seul ce plan repart : le reste de la production (payante) reste en pause.
    only(Q, [f.o.id]);
    Q.on = true;
    if (Q.st === 'paused' || Q.st === 'idle') { Q.st = 'run'; Q.next = 0; }
    awake(); persist(); refresh(f.o.id); qui();
  });
  A('fretryall', () => {
    const ids = [];
    shots().forEach(x => { if (x.h.vst === 'er' && x.h.img) { x.h.vst = 'wait'; x.h.err = ''; ids.push(x.h.id); } });
    if (!ids.length) return;
    qstart(ids);
    render(true);
  });
  A('fplay', () => play());
  A('fexport', () => saveTextFile(String(P.title || 'film').replace(/\s+/g, '_') + '.json', 'application/json', JSON.stringify(clean(P), null, 2)));

  A('fsess', () => sessions());
  A('fsclose', () => closeSheet());
  A('fsnew', () => newProject());
  A('fsopen', el => open(idOf(el)));
  A('fsdel', el => delSession(idOf(el)));

  A('fexpc', el => { if (['auto', 'hevc', 'avc'].indexOf(el.dataset.v) >= 0) { CFG.exp.codec = el.dataset.v; saveCfg(); render(true); } });
  A('fexpb', el => { const b = +el.dataset.v; if (b) { CFG.exp.mbps = b; saveCfg(); render(true); } });
  A('fexp4k', () => expStart());
  A('fexpcancel', () => expCancel());
  const expUri = el => { const x = P.exports[+el.dataset.i]; return x && x.uri ? x.uri : ''; };
  A('fexpopen', el => {
    const u = expUri(el);
    if (!u) return;
    if (!IS_APP || !N || typeof N.openUri !== 'function') { toast('Disponible dans l’application Android', 'wr'); return; }
    try { N.openUri(u, 'video/mp4'); } catch (e) { toast('Ouverture impossible : ' + e.message, 'er'); }
  });
  A('fexpshare', el => {
    const u = expUri(el);
    if (!u) return;
    if (!IS_APP || !N || typeof N.shareUri !== 'function') { toast('Disponible dans l’application Android', 'wr'); return; }
    try { N.shareUri(u, 'video/mp4'); } catch (e) { toast('Partage impossible : ' + e.message, 'er'); }
  });

  // Bouton « Quitter » du lecteur plein écran (défini dans index.html)
  const prevStop = ACT.stopplay;
  ACT.stopplay = (el, e) => {
    if (playing) { stopPlay(); return; }
    if (typeof prevStop === 'function') return prevStop(el, e);
    const pl = document.getElementById('player');
    if (pl) pl.classList.remove('on');
  };

  /* ═════════════════════════════════════════════════════════════════════
     SAISIES
     ═════════════════════════════════════════════════════════════════════ */
  const inFilm = el => !!(el && el.closest && el.closest('#scr-film'));

  ON_INPUT.push(el => {
    if (!inFilm(el) || !P) return false;
    const d = el.dataset || {};
    if (d.ff) {
      const o = d.id === 'P' ? P : (find(d.id) || {}).o;
      if (!o) return true;
      o[d.ff] = d.farr ? el.value.split(',').map(s => s.trim()).filter(Boolean) : el.value;
      persist();
      return true;
    }
    if (d.fstyle) {
      if (P.genre) { P.genre.style = el.value; persist(); }
      return true;
    }
    if (d.fexp === 'sharpen') {
      CFG.exp.sharpen = clamp(Math.round(+el.value || 0), 0, 100);
      const v = document.getElementById('fiSharpV');
      if (v) v.textContent = CFG.exp.sharpen;
      saveCfg();
      return true;
    }
    return d.fmod !== undefined;
  });

  ON_CHANGE.push(el => {
    if (!inFilm(el) || !P) return false;
    const d = el.dataset || {};
    if (d.fsg !== undefined) {
      if (!P.syn) return true;
      const i = +d.fsg;
      const s = P.syn.sel = P.syn.sel || [];
      if (el.checked) { if (s.indexOf(i) < 0) s.push(i); } else P.syn.sel = s.filter(x => x !== i);
      persist();
      const b = document.getElementById('fiNext');
      if (b && page === S_SYN) {
        const n = P.syn.sel.length;
        b.dataset.lbl = n ? 'Fusionner ' + n + ' suggestion' + (n > 1 ? 's' : '') : 'Valider ce choix';
        syncNext();
      }
      return true;
    }
    if (d.fup) {
      const file = el.files && el.files[0];
      const id = d.fup;
      el.value = '';
      if (!file) return true;
      const p = P;
      (async () => {
        const f = find(id);
        if (!f) return;
        const im = await readFile(file, 2048);
        if (!im) { toast('Image illisible', 'er'); return; }
        f.o.img = im;
        f.o.err = '';
        if (f.t === 'c') {
          f.o.busy = true;
          refresh(id);
          try { await aiDescribe(f.o); toast('Photo analysée : fiche du personnage remplie', 'ok'); }
          catch (er) { log('wr', 'analyse photo : ' + er.message); toast('Photo importée (analyse IA indisponible)', 'wr'); }
          f.o.busy = false;
        }
        if (P === p) refresh(id);
        persist(p);
      })().catch(er => { log('er', 'import : ' + er.message); toast('Import impossible : ' + er.message, 'er'); });
      return true;
    }
    return !!(d.ff || d.fstyle || d.fexp);
  });

  /* Vidéo regardée : retire le badge NOUVEAU */
  document.addEventListener('play', e => {
    const v = e.target;
    if (!v || !v.dataset || !v.dataset.fv || !P) return;
    const f = find(v.dataset.fv);
    if (!f || f.o.seen) return;
    f.o.seen = true;
    const card = v.closest('.card');
    const b = card && card.querySelector('[data-fnew]');
    if (b) b.remove();
    persist();
    stats();
  }, true);

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && playing) stopPlay(); });

  /* Horloge : temps écoulé, flux d'activité, file vidéo, compte à rebours, export */
  setInterval(() => {
    try {
      if (TASK && !TASK.err) {
        const e = document.getElementById('fiEl');
        if (e) e.textContent = fmtTime((Date.now() - TASK.start) / 1000);
        paintFeed();
      }
      LIVE.forEach(p => { try { qtick(p); } catch (e) { log('er', 'file : ' + e.message); } });
      if (P) qui();
      // Films quittés dont plus rien ne tourne : libérés de la mémoire.
      LIVE.forEach((p, id) => { if (p !== P && idle(p)) LIVE.delete(id); });
      if (EXP && EXP.active) {
        const el = document.getElementById('fiExpEl');
        if (el) el.textContent = fmtTime((Date.now() - EXP.start) / 1000);
      }
    } catch (e) { log('er', 'film : ' + e.message); }
  }, 1000);

  /* ═════════════════════════════════════════════════════════════════════
     REPRISE / RESTAURATION / RETOUR
     ═════════════════════════════════════════════════════════════════════ */
  /* Reprise du suivi d'un film relu en base (une seule fois : un film déjà suivi n'est jamais relancé). */
  function resume(p) {
    if (!p || RESUMED.has(p)) return;
    RESUMED.add(p);
    shots(p).forEach(x => {
      if (x.h.vst === 'run') {
        try { Promise.resolve(resumeVideo(x.h, updFor(p, x.h))).catch(e => log('er', 'reprise vidéo : ' + e.message)); }
        catch (e) { log('er', 'reprise vidéo : ' + e.message); }
      }
    });
    awake();
    if (p === P) qui();
  }
  function resumeAll() { LIVE.forEach(resume); }

  async function restore() {
    let p = null, bg = [];
    try {
      const last = await DB.get('config', 'last');
      if (last && last.v) p = await DB.get('sessions', last.v);
    } catch (e) { log('wr', 'dernier projet : ' + e.message); }
    // Films quittés pendant leur production : leur file et leur suivi reprennent aussi.
    // (Lu avant setP : plus aucune attente ensuite, la file ne part pas avant resumeAll.)
    try {
      bg = (await DB.all('sessions')).filter(x => x && x.id && Array.isArray(x.scenes) && !(p && x.id === p.id) &&
        ((x.q && x.q.on) || shots(x).some(y => y.h.vst === 'run')));
    } catch (e) { log('wr', 'films en arrière-plan : ' + e.message); }
    try { setP(p && typeof p === 'object' && p.id ? p : newP()); }
    catch (e) { log('er', 'projet illisible : ' + e.message); setP(newP()); }
    page = clamp(+P.page || 0, 0, Math.min(NSTEP - 1, P.max || 0));
    bg.forEach(x => {
      if (LIVE.has(x.id)) return;
      try { live(x); log('in', 'production en arrière-plan : « ' + nameOf(x) + ' »'); } catch (e) { log('wr', 'film illisible : ' + e.message); }
    });
    const scr = document.getElementById('scr-film');
    if (scr && scr.classList.contains('on')) render(true);
    return P;
  }

  function back() {
    if (playing) { stopPlay(); return true; }
    if (TASK) {
      if (TASK.err) { TASK = null; awake(); render(); return true; }
      return false;
    }
    if (!P) return false;
    const s = P.sub[page];
    if (page === S_SYN && (s === 'pick' || s === 'fin')) { P.sub[S_SYN] = s === 'fin' && P.syn ? 'pick' : 'in'; render(); return true; }
    if (page > 0) { go(page - 1); return true; }
    return false;
  }

  return {
    get P() { return P; },
    get Q() { return Q; },
    get page() { return page; },
    get TASK() { return TASK; },
    get playing() { return playing; },
    STEPS: STEPS.slice(),
    render: () => render(true),
    go,
    open,
    newProject,
    sessions,
    resumeAll,
    restore,
    back,
    play,
    stopPlay,
  };
})();
