/* CINÉ-GENESIS — coque de l'interface : délégation des évènements, onglets et bouton retour,
   écran Réglages, puce des moteurs et démarrage. */
'use strict';

const APP = (() => {
  const TABS = ['studio', 'film', 'gallery', 'settings'];
  const hist = [];
  let tab = '';

  // Les autres écrans (film.js, studio.js) sont des globales lexicales : on les lit sans planter s'ils manquent.
  const NS = {
    FILM: () => (typeof FILM !== 'undefined' ? FILM : null),
    STUDIO: () => (typeof STUDIO !== 'undefined' ? STUDIO : null),
    GAL: () => (typeof GAL !== 'undefined' ? GAL : null),
  };
  const call = (ns, fn, ...a) => {
    try {
      const o = NS[ns] && NS[ns]();
      if (o && typeof o[fn] === 'function') return o[fn](...a);
    } catch (e) {
      log('er', ns + '.' + fn + ' : ' + e.message);
    }
    return undefined;
  };

  /* ───────────────────────── Navigation ───────────────────────── */
  function render(t) {
    if (t === 'studio') call('STUDIO', 'render');
    else if (t === 'film') call('FILM', 'render');
    else if (t === 'gallery') call('GAL', 'render');
    else if (t === 'settings') renderSettings();
  }

  function go(t, opt) {
    opt = opt || {};
    if (TABS.indexOf(t) < 0) t = 'studio';
    if (tab && tab !== t && !opt.noHist) {
      hist.push(tab);
      if (hist.length > 20) hist.shift();
    }
    const same = tab === t;
    tab = t;
    TABS.forEach(n => {
      const s = document.getElementById('scr-' + n);
      if (s) s.classList.toggle('on', n === t);
    });
    $$('#tabs .tab').forEach(b => {
      const on = b.dataset.tab === t;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    render(t);
    if (!same || opt.top) { try { window.scrollTo(0, 0); } catch (e) { /* sans effet */ } }
    updateChip();
  }

  function back() {
    if (tab === 'film' && call('FILM', 'back')) return true;
    while (hist.length) {
      const p = hist.pop();
      if (p !== tab) { go(p, { noHist: true }); return true; }
    }
    if (tab !== 'studio') { go('studio', { noHist: true }); return true; }
    return false;
  }

  /* ───────────────────────── Puce des moteurs ───────────────────────── */
  function updateChip() {
    const c = document.getElementById('engineChip');
    if (!c) return;
    const fal = hasFal(), ag = hasAgnes();
    let txt, cls = '';
    if (fal && ag) txt = 'fal · 4K + Agnès';
    else if (fal) txt = 'fal · 4K';
    else if (ag) txt = 'Agnès ×' + KEYS.list.filter(k => !k.off).length;
    else if (hasText()) { txt = 'Texte seul'; cls = 'wr'; }
    else { txt = 'Configurer'; cls = 'er'; }
    c.textContent = txt;
    c.className = 'chip' + (cls ? ' ' + cls : '');
    c.setAttribute('aria-label', 'Moteurs : ' + txt + ' — ouvrir les réglages');
  }

  /* ───────────────────────── Réglages ───────────────────────── */
  const TXTOPT = [['auto', 'Automatique'], ['agnes', 'Agnès'], ['oai', 'API compatible OpenAI'], ['fal', 'fal.ai (any-llm)']];
  const PRESETS = [
    { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash' },
  ];
  const TXTNAME = { agnes: 'Agnès', oai: 'API compatible OpenAI', fal: 'fal.ai' };
  const OVR = () => [
    ...Object.keys(VMODELS).filter(k => VMODELS[k].prov === 'fal').map(k => ({ id: k, name: VMODELS[k].name, def: VMODELS[k].ep })),
    ...Object.keys(IMODELS).filter(k => IMODELS[k].prov === 'fal').map(k => ({ id: k, name: IMODELS[k].name, def: IMODELS[k].t2i + ' · ' + IMODELS[k].edit })),
    { id: 'topazVideo', name: 'Topaz · upscale vidéo', def: EP.topazVideo },
    { id: 'topazImage', name: 'Topaz · upscale image', def: EP.topazImage },
  ];

  const sel = (path, opts, cur) => '<select data-cfg="' + path + '">' +
    opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
  const sw = (path, on, label, sub) => '<label class="switch"><input type="checkbox" data-cfg="' + path + '"' + (on ? ' checked' : '') + '><i></i><span>' +
    esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></label>';
  const keyMask = k => '…' + esc(String(k).slice(-4));

  function keyChips() {
    if (!KEYS.list.length) return '<span class="sub">Aucune clé Agnès enregistrée.</span>';
    return KEYS.list.map((k, i) => '<span class="badge ' + (k.off ? 'ber' : 'bok') + '">#' + (i + 1) + ' ' + keyMask(k.k) + (k.off ? ' · désactivée' : '') + '</span>').join(' ');
  }

  function mcard(kind, id, m) {
    const on = (CFG.eng[kind] || 'auto') === id;
    const ok = id === 'auto' || (m.prov === 'fal' ? hasFal() : hasAgnes());
    const badges = id === 'auto' ? '<span class="badge bdim">Meilleur disponible</span>'
      : '<span class="badge ' + (/4K/.test(m.tag) ? 'b4k' : 'bdim') + '">' + esc(m.tag) + '</span>' +
        (m.audio ? '<span class="badge baud">Son</span>' : '') +
        (m.prov === 'fal' ? '<span class="badge bdim">fal.ai</span>' : '<span class="badge bdim">Agnès</span>');
    const price = id === 'auto' ? '' : m.usd != null ? (kind === 'video' ? fmtUSD(m.usd) + ' / s' : fmtUSD(m.usd) + ' / image') : '';
    return '<button type="button" class="mcard' + (on ? ' on' : '') + (ok ? '' : ' dis') + '" data-a="cfgEng" data-k="' + kind + '" data-m="' + id + '" aria-pressed="' + on + '">' +
      '<span class="mname">' + esc(id === 'auto' ? 'Automatique' : m.name) + '</span>' +
      '<span class="mbadges">' + badges + '</span>' +
      '<span class="mdesc">' + esc(id === 'auto' ? 'Choisit le meilleur modèle selon vos clés (fal.ai en priorité).' : m.desc || '') +
      (price ? ' · ' + esc(price) : '') + (ok ? '' : ' · clé ' + (m.prov === 'fal' ? 'fal.ai' : 'Agnès') + ' requise') + '</span></button>';
  }

  function deviceHtml() {
    if (!IS_APP) return '<p class="sub">Vous utilisez la version navigateur : l’export 4K et l’enregistrement dans la galerie sont disponibles dans l’application Android.</p>';
    let d = null;
    try { d = JSON.parse(N.deviceInfo()); } catch (e) { d = null; }
    if (!d) return '<p class="sub">Informations indisponibles.</p>';
    const yes = (b, t) => '<span class="badge ' + (b ? 'bok' : 'ber') + '">' + (b ? '✓ ' : '✕ ') + esc(t) + '</span>';
    return '<div class="row">' + yes(d.hevc4k, 'HEVC 4K') + yes(d.avc4k, 'H.264 4K') + '</div>' +
      '<p class="sub">' + esc(d.model || 'Appareil') + ' · Android API ' + esc(d.sdk) +
      (d.hevcMax ? ' · HEVC max ' + esc(d.hevcMax) : '') + (d.avcMax ? ' · H.264 max ' + esc(d.avcMax) : '') + '</p>' +
      (d.hevc4k || d.avc4k ? '' : '<div class="note wr">Ce téléphone ne sait pas encoder la 4K : le montage sera exporté dans la meilleure définition possible.</div>');
  }

  function ovrHtml() {
    return OVR().map(o => {
      const v = (CFG.ovr && CFG.ovr[o.id]) || {};
      let bad = false;
      if (v.extra) { try { const j = JSON.parse(v.extra); bad = !j || typeof j !== 'object' || Array.isArray(j); } catch (e) { bad = true; } }
      return '<div class="card stack" style="padding:12px">' +
        '<div class="h3">' + esc(o.name) + '</div>' +
        '<label class="field"><span class="lab">Point d’accès fal.ai</span><input type="text" spellcheck="false" autocomplete="off" data-ovr="' + o.id + '" data-f="ep" value="' + esc(v.ep || '') + '" placeholder="' + esc(o.def) + '"></label>' +
        '<label class="field"><span class="lab">Paramètres JSON supplémentaires</span><textarea rows="2" spellcheck="false" data-ovr="' + o.id + '" data-f="extra" placeholder=\'{"cfg_scale": 0.5}\'>' + esc(v.extra || '') + '</textarea></label>' +
        '<div class="note er" data-ovrerr="' + o.id + '"' + (bad ? '' : ' hidden') + '>JSON invalide : ce champ sera ignoré.</div>' +
      '</div>';
    }).join('');
  }

  function renderSettings() {
    const el = document.getElementById('scr-settings');
    if (!el) return;
    const fal = hasFal(), ag = hasAgnes(), any = fal || ag;
    const tp = pickText();
    const ver = IS_APP ? (() => { try { return N.version(); } catch (e) { return '?'; } })() : 'navigateur';
    el.innerHTML = '<div class="wrap stack">' +
      '<div class="hero"><div class="lab">Réglages</div><div class="h1">Vos <span class="gt">moteurs IA</span></div>' +
      '<p class="sub">Vos clés restent sur ce téléphone. fal.ai donne accès aux meilleurs modèles du moment, en vraie 4K.</p></div>' +
      (any ? '' : '<div class="note">👋 Bienvenue ! Ajoutez une clé <b>fal.ai</b> (recommandé, qualité 4K) ou vos clés <b>Agnès</b> pour commencer à créer.</div>') +

      /* fal.ai */
      '<div class="card stack">' +
        '<div class="row"><div class="h2 grow">fal.ai <span class="badge b4k">4K</span></div><span class="badge ' + (fal ? 'bok' : 'bdim') + '" id="cfgFalBadge">' + (fal ? 'Connectée' : 'Non configurée') + '</span></div>' +
        '<p class="sub">Recommandé. Kling 3.0 en 4K natif, LTX‑2.3 2160p, Seedream 4.5 et Nano Banana Pro en 4K, Veo 3.1 et l’upscaler Topaz. Facturé à l’usage par fal.ai.</p>' +
        '<label class="field"><span class="lab">Clé API fal.ai</span>' +
          '<div class="row" style="flex-wrap:nowrap"><input id="cfgFal" class="grow" type="password" data-cfg="fal.key" value="' + esc(CFG.fal.key) + '" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Collez votre clé (id:secret)">' +
          '<button type="button" class="btn icon" data-a="cfgShow" data-for="cfgFal" aria-label="Afficher ou masquer la clé">👁</button></div></label>' +
        '<div class="row"><button type="button" class="btn sm" data-a="cfgFalLink">Obtenir une clé ↗</button><button type="button" class="btn sm" data-a="cfgTestFal">Tester la clé</button><span class="sub" id="cfgFalSt"></span></div>' +
      '</div>' +

      /* Agnès */
      '<div class="card stack">' +
        '<div class="row"><div class="h2 grow">Agnès AI</div><span class="badge ' + (ag ? 'bok' : 'bdim') + '" id="cfgAgBadge">' + (ag ? KEYS.list.filter(k => !k.off).length + ' clé(s)' : 'Non configurée') + '</span></div>' +
        '<p class="sub">Les clés de l’application d’origine : texte, images jusqu’en 4K, vidéos 1080p (passées en 4K par Topaz ou sur le téléphone). Plusieurs clés = plus rapide.</p>' +
        '<label class="field"><span class="lab">Clés Agnès (une par ligne)</span><textarea rows="4" data-cfg="agnes.keys" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="sk-…&#10;sk-…">' + esc(CFG.agnes.keys.join('\n')) + '</textarea></label>' +
        '<div class="row" id="cfgKeyList">' + keyChips() + '</div>' +
        '<div class="grid2">' +
          '<label class="field"><span class="lab">Type de clés</span>' + sel('agnes.plan', [['free', 'Gratuites'], ['plan', 'Payantes (Token Plan)']], CFG.agnes.plan) + '</label>' +
          '<label class="field"><span class="lab">Taille des images</span>' + sel('agnes.imgSize', [['4K', '4K (recommandé)'], ['2K', '2K'], ['1K', '1K']], CFG.agnes.imgSize) + '</label>' +
          '<label class="field"><span class="lab">Résolution vidéo</span>' + sel('agnes.vidRes', [['1080', '1080p'], ['720', 'Résolution d’origine']], CFG.agnes.vidRes) + '</label>' +
        '</div>' +
        '<div class="row"><button type="button" class="btn sm" data-a="cfgTestAgnes">Tester mes clés</button><span class="sub" id="cfgAgSt"></span></div>' +
      '</div>' +

      /* IA texte */
      '<div class="card stack">' +
        '<div class="h2">IA texte</div>' +
        '<p class="sub">Écrit les synopsis, personnages, dialogues et « Magic prompt ». Actuellement : <b id="cfgTxtUsed">' + esc(tp ? TXTNAME[tp] : 'aucune') + '</b>.</p>' +
        '<label class="field"><span class="lab">Fournisseur</span>' + sel('eng.text', TXTOPT, CFG.eng.text) + '</label>' +
        '<details><summary>API compatible OpenAI (DeepSeek, OpenAI, OpenRouter…)</summary><div class="stack">' +
          '<div class="row">' + PRESETS.map(p => '<button type="button" class="pill" data-a="cfgPreset" data-p="' + p.id + '">' + esc(p.name) + '</button>').join('') + '</div>' +
          '<label class="field"><span class="lab">URL de base</span><input type="url" data-cfg="oai.url" value="' + esc(CFG.oai.url) + '" spellcheck="false" autocomplete="off" placeholder="https://api.deepseek.com/v1"></label>' +
          '<label class="field"><span class="lab">Modèle</span><input type="text" data-cfg="oai.model" value="' + esc(CFG.oai.model) + '" spellcheck="false" autocomplete="off" placeholder="deepseek-chat"></label>' +
          '<label class="field"><span class="lab">Clé API</span><div class="row" style="flex-wrap:nowrap"><input id="cfgOai" class="grow" type="password" data-cfg="oai.key" value="' + esc(CFG.oai.key) + '" spellcheck="false" autocomplete="off" placeholder="sk-…">' +
          '<button type="button" class="btn icon" data-a="cfgShow" data-for="cfgOai" aria-label="Afficher ou masquer la clé">👁</button></div></label>' +
        '</div></details>' +
      '</div>' +

      /* Moteurs par défaut */
      '<div class="card stack">' +
        '<div class="h2">Moteurs par défaut</div>' +
        '<div class="lab">Images</div><div class="hscroll" id="cfgImg">' + mcard('image', 'auto', {}) + Object.keys(IMODELS).map(k => mcard('image', k, IMODELS[k])).join('') + '</div>' +
        '<div class="lab">Vidéos</div><div class="hscroll" id="cfgVid">' + mcard('video', 'auto', {}) + Object.keys(VMODELS).map(k => mcard('video', k, VMODELS[k])).join('') + '</div>' +
      '</div>' +

      /* Qualité */
      '<div class="card stack">' +
        '<div class="h2">Qualité <span class="badge b4k">4K</span></div>' +
        sw('up4k', CFG.up4k, 'Upscale IA automatique en 4K (Topaz)', 'Pour les modèles 1080p ; nécessite fal.ai.') +
        sw('local4k', CFG.local4k, 'Garantir la 4K sur le téléphone', 'Si une vidéo sort sous la 4K, elle est agrandie en 3840×2160 sur l’appareil.') +
        sw('audio', CFG.audio, 'Son natif des vidéos', 'Ambiance, bruitages et répliques générés avec l’image.') +
        '<div class="grid2">' +
          '<label class="field"><span class="lab">Vidéos fal.ai en parallèle</span>' + sel('falPar', [1, 2, 3, 4, 6, 8].map(n => [n, String(n)]), CFG.falPar) + '</label>' +
          '<label class="field"><span class="lab">Codec du montage 4K</span>' + sel('exp.codec', [['auto', 'Automatique'], ['hevc', 'HEVC (H.265)'], ['avc', 'H.264']], CFG.exp.codec) + '</label>' +
          '<label class="field"><span class="lab">Débit du montage</span>' + sel('exp.mbps', [[40, '40 Mb/s'], [60, '60 Mb/s (recommandé)'], [80, '80 Mb/s'], [100, '100 Mb/s']], CFG.exp.mbps) + '</label>' +
        '</div>' +
        '<label class="field"><span class="lab">Netteté de l’agrandissement : <b id="cfgSharpV">' + CFG.exp.sharpen + '</b> %</span><input type="range" min="0" max="100" step="5" data-cfg="exp.sharpen" value="' + CFG.exp.sharpen + '"></label>' +
      '</div>' +

      /* Appareil */
      '<div class="card stack"><div class="h2">Appareil</div>' + deviceHtml() + '</div>' +

      /* Avancé */
      '<div class="card stack"><details><summary>Avancé · points d’accès fal.ai</summary><div class="stack">' +
        '<p class="sub">Pour suivre une nouvelle version d’un modèle sans attendre une mise à jour : remplacez son point d’accès ou ajoutez des paramètres.</p>' +
        ovrHtml() +
      '</div></details></div>' +

      /* Données */
      '<div class="card stack"><div class="h2">Données</div>' +
        '<p class="sub">Stockage : ' + (DB.mode === 'idb' ? 'base locale' : 'mode de secours') + ' · version ' + esc(ver) + '</p>' +
        '<div class="row">' +
          (IS_APP ? '<button type="button" class="btn sm" data-a="cfgClear">Vider le cache des vidéos</button>' : '') +
          '<button type="button" class="btn sm" data-a="log">Journal technique</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function refreshBits() {
    const fal = hasFal(), ag = hasAgnes(), tp = pickText();
    const fb = document.getElementById('cfgFalBadge');
    if (fb) { fb.className = 'badge ' + (fal ? 'bok' : 'bdim'); fb.textContent = fal ? 'Connectée' : 'Non configurée'; }
    const ab = document.getElementById('cfgAgBadge');
    if (ab) { ab.className = 'badge ' + (ag ? 'bok' : 'bdim'); ab.textContent = ag ? KEYS.list.filter(k => !k.off).length + ' clé(s)' : 'Non configurée'; }
    const kl = document.getElementById('cfgKeyList');
    if (kl) kl.innerHTML = keyChips();
    const tu = document.getElementById('cfgTxtUsed');
    if (tu) tu.textContent = tp ? TXTNAME[tp] : 'aucune';
    updateChip();
  }

  function setPath(path, v) {
    const ks = path.split('.');
    let o = CFG;
    for (let i = 0; i < ks.length - 1; i++) { if (!o[ks[i]] || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = v;
  }

  function readField(el) {
    const path = el.dataset.cfg;
    if (el.type === 'checkbox') return el.checked;
    if (path === 'agnes.keys') return Array.from(new Set(el.value.split(/[\s,;]+/).map(s => s.trim()).filter(s => s.length >= 8)));
    if (path === 'falPar' || path === 'exp.mbps' || path === 'exp.sharpen') return +el.value;
    return el.type === 'password' || el.type === 'url' || el.type === 'text' ? el.value.trim() : el.value;
  }

  function onCfg(el, final) {
    const path = el.dataset.cfg;
    setPath(path, readField(el));
    if (path === 'exp.sharpen') { const v = document.getElementById('cfgSharpV'); if (v) v.textContent = el.value; }
    if (path.startsWith('agnes.')) syncKeys();
    saveCfg();
    refreshBits();
    // Les cartes de modèles dépendent des clés : mises à jour quand la saisie est terminée.
    if (final && (path === 'fal.key' || path === 'agnes.keys')) {
      const i = document.getElementById('cfgImg'), v = document.getElementById('cfgVid');
      if (i) i.innerHTML = mcard('image', 'auto', {}) + Object.keys(IMODELS).map(k => mcard('image', k, IMODELS[k])).join('');
      if (v) v.innerHTML = mcard('video', 'auto', {}) + Object.keys(VMODELS).map(k => mcard('video', k, VMODELS[k])).join('');
    }
  }

  function onOvr(el) {
    const id = el.dataset.ovr, f = el.dataset.f;
    CFG.ovr = CFG.ovr || {};
    const o = CFG.ovr[id] = Object.assign({}, CFG.ovr[id]);
    o[f] = el.value.trim();
    if (!o.ep && !o.extra) delete CFG.ovr[id];
    if (f === 'extra') {
      let bad = false;
      if (o.extra) { try { const j = JSON.parse(o.extra); bad = !j || typeof j !== 'object' || Array.isArray(j); } catch (e) { bad = true; } }
      const n = document.querySelector('[data-ovrerr="' + id + '"]');
      if (n) n.hidden = !bad;
    }
    saveCfg();
  }

  ON_INPUT.push(el => {
    if (!el.closest || !el.closest('#scr-settings')) return false;
    if (el.dataset.cfg && (el.tagName === 'TEXTAREA' || /^(text|password|url|range)$/.test(el.type))) { onCfg(el, false); return true; }
    if (el.dataset.ovr) { onOvr(el); return true; }
    return false;
  });
  ON_CHANGE.push(el => {
    if (!el.closest || !el.closest('#scr-settings')) return false;
    if (el.dataset.cfg) { onCfg(el, true); return true; }
    if (el.dataset.ovr) { onOvr(el); return true; }
    return false;
  });

  async function testFal() {
    const st = document.getElementById('cfgFalSt');
    const say = (t, ok) => { if (st) { st.textContent = t; st.style.color = ok == null ? '' : ok ? 'var(--ok)' : 'var(--er)'; } };
    if (!hasFal()) return say('Collez d’abord une clé.', false);
    say('Vérification…');
    try {
      // Requête de statut sur un identifiant inexistant : gratuite, et répond 401/403 si la clé est refusée.
      const r = await xfetch('https://queue.fal.run/fal-ai/any-llm/requests/00000000-0000-0000-0000-000000000000/status',
        { headers: { Authorization: 'Key ' + CFG.fal.key } });
      if (r.status === 401 || r.status === 403) { say('Clé refusée par fal.ai (' + r.status + ').', false); haptic('reject'); }
      else { say('✓ Clé acceptée par fal.ai.', true); haptic('confirm'); }
    } catch (e) { say('Réseau indisponible : ' + e.message, false); }
  }

  async function testAgnes() {
    const st = document.getElementById('cfgAgSt');
    const say = (t, ok) => { if (st) { st.textContent = t; st.style.color = ok == null ? '' : ok ? 'var(--ok)' : 'var(--er)'; } };
    syncKeys();
    if (!KEYS.list.length) return say('Collez d’abord au moins une clé.', false);
    say('Vérification de ' + KEYS.list.length + ' clé(s)…');
    const res = await Promise.all(KEYS.list.map(async k => {
      try {
        const r = await xfetch(API + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + k.k },
          body: JSON.stringify({ model: TXT[0], messages: [{ role: 'user', content: 'Réponds OK' }], max_tokens: 5, temperature: 0, chat_template_kwargs: { enable_thinking: false } }) });
        if (r.ok || r.status === 429) { k.off = false; k.bad = 0; return true; }
        if ([401, 402, 403].indexOf(r.status) >= 0) { k.off = true; return false; }
        return null;
      } catch (e) { return null; }
    }));
    const ok = res.filter(v => v === true).length, bad = res.filter(v => v === false).length;
    say(ok + ' clé(s) valide(s)' + (bad ? ', ' + bad + ' refusée(s)' : '') + (res.length - ok - bad ? ', ' + (res.length - ok - bad) + ' sans réponse' : ''), bad === 0 && ok > 0);
    refreshBits();
  }

  /* Actions des réglages */
  ACT.cfgShow = el => {
    const i = document.getElementById(el.dataset.for);
    if (i) i.type = i.type === 'password' ? 'text' : 'password';
  };
  ACT.cfgFalLink = () => openExternal('https://fal.ai/dashboard/keys');
  ACT.cfgTestFal = () => testFal();
  ACT.cfgTestAgnes = () => testAgnes();
  ACT.cfgPreset = el => {
    const p = PRESETS.find(x => x.id === el.dataset.p);
    if (!p) return;
    CFG.oai.url = p.url;
    CFG.oai.model = p.model;
    saveCfg();
    renderSettings();
    const d = $('#scr-settings details');
    if (d) d.open = true;
    toast(p.name + ' : collez maintenant votre clé API');
  };
  ACT.cfgEng = el => {
    const k = el.dataset.k, m = el.dataset.m;
    if (el.classList.contains('dis')) return toast('Ajoutez d’abord la clé ' + ((k === 'image' ? IMODELS : VMODELS)[m].prov === 'fal' ? 'fal.ai' : 'Agnès'), 'wr');
    CFG.eng[k] = m;
    saveCfg();
    haptic('tap');
    const box = document.getElementById(k === 'image' ? 'cfgImg' : 'cfgVid');
    const cat = k === 'image' ? IMODELS : VMODELS;
    if (box) {
      const x = box.scrollLeft;
      box.innerHTML = mcard(k, 'auto', {}) + Object.keys(cat).map(id => mcard(k, id, cat[id])).join('');
      box.scrollLeft = x;
    }
  };
  ACT.cfgClear = async () => {
    if (!(await confirmSheet('Vider le cache ?', 'Les vidéos téléchargées pour le montage seront supprimées du téléphone (elles restent en ligne et dans vos projets).', 'Vider'))) return;
    try { N.clearCache(); toast('Cache vidé', 'ok'); } catch (e) { toast('Impossible de vider le cache', 'er'); }
  };

  /* Actions globales */
  ACT.tab = el => go(el.dataset.tab);
  ACT.log = () => {
    const p = document.getElementById('logPanel');
    if (!p) return;
    const on = p.classList.toggle('on');
    const closer = () => { p.classList.remove('on'); return true; };
    if (on) { p._closer = closer; BACK.push(closer); const b = document.getElementById('lb'); if (b) b.scrollTop = b.scrollHeight; }
    else if (p._closer) { const i = BACK.indexOf(p._closer); if (i >= 0) BACK.splice(i, 1); p._closer = null; }
  };

  /* ───────────────────────── Délégation des évènements ───────────────────────── */
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest ? e.target.closest('[data-a]') : null;
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return;
    const f = ACT[b.dataset.a];
    if (typeof f !== 'function') { log('wr', 'action inconnue : ' + b.dataset.a); return; }
    try {
      const r = f(b, e);
      if (r && typeof r.catch === 'function') r.catch(er => { log('er', 'action ' + b.dataset.a + ' : ' + er.message); toast('Erreur : ' + er.message, 'er'); });
    } catch (er) {
      log('er', 'action ' + b.dataset.a + ' : ' + er.message);
      toast('Erreur : ' + er.message, 'er');
    }
  });
  const dispatch = list => e => {
    const t = e.target;
    if (!t) return;
    for (const h of list) {
      try { if (h(t, e)) return; } catch (er) { log('er', 'saisie : ' + er.message); }
    }
  };
  document.addEventListener('input', dispatch(ON_INPUT));
  document.addEventListener('change', dispatch(ON_CHANGE));
  document.addEventListener('focusin', e => {
    const t = e.target;
    if (!document.body.classList.contains('kb') || !t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    setTimeout(() => { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (er) { t.scrollIntoView(); } }, 60);
  });
  window.addEventListener('error', e => {
    if (!e || !e.message) return;
    log('er', e.message + (e.filename ? ' (' + String(e.filename).split('/').pop() + ':' + e.lineno + ')' : ''));
    toast('Erreur : ' + e.message, 'er');
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e && e.reason;
    log('er', 'promesse : ' + ((r && r.message) || r));
  });

  window.cgResume = () => {
    updateChip();
    if (tab === 'gallery') call('GAL', 'render');
  };

  /* ───────────────────────── Démarrage ───────────────────────── */
  async function init() {
    try { await DB.open(); } catch (e) { log('wr', 'stockage : ' + e.message); }
    await loadCfg();
    syncKeys();
    try { await call('GAL', 'load'); } catch (e) { log('er', 'galerie : ' + e.message); }
    try { await call('FILM', 'restore'); } catch (e) { log('er', 'projet : ' + e.message); }
    call('STUDIO', 'resumeAll');
    call('FILM', 'resumeAll');
    const any = hasFal() || hasAgnes();
    go(any ? 'studio' : 'settings', { noHist: true, top: true });
    log('in', 'CINÉ-GENESIS prêt · ' + (hasFal() ? 'fal.ai ✓ · ' : '') + KEYS.list.length + ' clé(s) Agnès' + (IS_APP ? '' : ' · navigateur'));
  }

  init().catch(e => {
    log('er', 'démarrage : ' + e.message);
    toast('Erreur au démarrage : ' + e.message, 'er');
    try { go('settings', { noHist: true }); } catch (er) { /* rien de plus à faire */ }
  });

  return {
    get tab() { return tab; },
    go, back, renderSettings, updateChip,
  };
})();
