/*
 * Nova Graph — application : liste d'expressions, onglets, calculatrice,
 * table de valeurs, réglages, persistance et pont avec Android.
 */
(function () {
  'use strict';
  const NM = window.NovaMath;
  const Workspace = window.NovaWorkspace;
  const GraphView = window.NovaGraph;
  const Keypad = window.NovaKeypad;
  const { K, A, ICON } = Keypad;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const debounce = (fn, ms) => { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); }; };
  const STORE = 'novagraph.v1';

  const ICON_X = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const ICON_WARN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.01"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/></svg>';

  const DEFAULT_ITEMS = [
    { text: 'f(x) = a·sin(b·x)' },
    { text: 'a = 2' },
    { text: 'b = 1' },
    { text: 'y = x²/4 − 3' },
  ];

  const EXAMPLES = [
    { title: 'Onde', sub: 'Curseurs animables', items: ['f(x) = a·sin(b·x + c)', 'a = 2', 'b = 1.5', 'c = 0'] },
    { title: 'Tangente', sub: 'Dérivée & curseur', items: ['f(x) = x³/6 − x', 'y = f′(a)(x − a) + f(a)', '(a, f(a))', 'a = 1'] },
    { title: 'Cœur', sub: 'Courbe implicite', items: ['((x/3)² + (y/3)² − 1)³ = (x/3)²(y/3)³'] },
    { title: 'Rose polaire', sub: 'r = f(θ)', items: ['r = 4cos(k·θ)', 'k = 3'] },
    { title: 'Lissajous', sub: 'Courbe paramétrée', items: ['(4sin(3t), 4sin(2t))'] },
    { title: 'Spirale', sub: 'Polaire, 3 tours', items: [{ text: 'r = θ/2', domain: { min: '0', max: '6π' } }], span: 22 },
    { title: 'Inéquations', sub: 'Zones colorées', items: ['y ≤ 2sin(x)', 'x² + y² < 9'] },
    { title: 'Intégrale', sub: 'Primitive & aire', items: ['f(x) = 3e^(−x²/4)', 'F(x) = ∫(f(t), 0, x)', '∫(f(x), −2, 2)'] },
  ];

  /* ------------------------------------------------------------------ */
  /* Pont natif (Android) avec repli navigateur                          */
  /* ------------------------------------------------------------------ */

  const native = window.NovaNative || null;
  const settings = { theme: 'dark', angle: 'rad', haptics: true, grid: true, poi: true };
  const Bridge = {
    haptic(kind) {
      if (!settings.haptics) return;
      try {
        if (native) native.haptic(kind);
        else if (navigator.vibrate) navigator.vibrate(kind === 'confirm' ? 14 : kind === 'long' ? 24 : 6);
      } catch (e) { /* ignore */ }
    },
    bars(dark) { try { if (native) native.setSystemBars(dark); } catch (e) { /* ignore */ } },
    back(enabled) { try { if (native) native.setBackEnabled(!!enabled); } catch (e) { /* ignore */ } },
    systemDark() {
      try { if (native) return !!native.isSystemDark(); } catch (e) { /* ignore */ }
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    },
    saveImage(dataUrl) {
      if (native) {
        try { return native.saveImage(dataUrl.split(',')[1], true); } catch (e) { return 'error'; }
      }
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'nova-graph.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return 'ok';
    },
  };

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { saved = null; }
  if (saved && saved.settings) Object.assign(settings, saved.settings);
  NM.setAngleMode(settings.angle);

  const ws = new Workspace();
  ws.load(saved && Array.isArray(saved.items) ? saved.items : DEFAULT_ITEMS);
  ws.build();

  const state = { tab: 'graph', active: null, modal: null, pop: false };
  const app = $('#app');
  // Le conteneur principal ne doit jamais défiler (focus, sélection de texte…)
  const pin = (el) => el.addEventListener('scroll', () => { if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; } });
  pin(app);
  window.addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); });

  const graph = new GraphView($('#graph'), {
    haptic: (k) => Bridge.haptic(k),
    onSelect: (id) => selectItem(id, true),
    onTapEmpty: () => selectItem(null),
    onFrame: (t) => animateSliders(t),
    onView: () => save(),
    onInteract: () => closePopover(),
  });
  graph.showGrid = settings.grid;
  graph.showPOI = settings.poi;

  const save = debounce(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        items: ws.toJSON(),
        settings,
        view: graph.view,
        snap: L.snap,
        table: { start: tStart.value, step: tStep.value },
        calc: { history: calc.history.slice(-80), ans: calc.ans },
      }));
    } catch (e) { /* stockage indisponible */ }
  }, 350);

  /* ------------------------------------------------------------------ */
  /* Thème                                                               */
  /* ------------------------------------------------------------------ */

  function isDark() {
    return settings.theme === 'dark' || (settings.theme === 'auto' && Bridge.systemDark());
  }

  function applyTheme() {
    const dark = isDark();
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('meta[name="theme-color"]').setAttribute('content', dark ? '#06070d' : '#f3f4fa');
    graph.setTheme(dark ? 'dark' : 'light');
    Bridge.bars(dark);
  }
  window.novaSystemTheme = applyTheme;
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', applyTheme);
  }

  /* ------------------------------------------------------------------ */
  /* Disposition : panneau, clavier, encarts                              */
  /* ------------------------------------------------------------------ */

  const L = { snap: (saved && saved.snap) || 'mid', h: 0, kb: false, kbH: 0, dragH: null };
  const topbar = $('.topbar');
  const keypadEl = $('#keypad');
  const wide = () => window.innerWidth >= 720;

  function sheetHeights() {
    const H = window.innerHeight;
    return { min: 116, mid: Math.round(H * 0.38), max: Math.round(H - topbar.offsetHeight - 12) };
  }

  function layout() {
    const hs = sheetHeights();
    let h = L.dragH !== null ? L.dragH : hs[L.snap];
    let kbH = 0;
    if (L.kb) {
      kbH = keypadEl.offsetHeight;
      const avail = window.innerHeight - kbH - topbar.offsetHeight;
      h = Math.max(150, Math.min(h, avail * 0.48));
    }
    if (wide()) h = Math.min(h, window.innerHeight - kbH - topbar.offsetHeight - 24);
    L.h = h;
    L.kbH = kbH;
    app.style.setProperty('--sheet-h', h + 'px');
    app.style.setProperty('--kb-h', kbH + 'px');
    graph.setInsets(topbar.offsetHeight, wide() ? kbH : h + kbH);
  }

  window.novaInsets = function (t, r, b, l) {
    const st = document.documentElement.style;
    st.setProperty('--sat', (+t || 0) + 'px');
    st.setProperty('--sar', (+r || 0) + 'px');
    st.setProperty('--sab', (+b || 0) + 'px');
    st.setProperty('--sal', (+l || 0) + 'px');
    requestAnimationFrame(layout);
  };
  window.addEventListener('resize', () => { layout(); graph.resize(); });

  // Glisser le panneau
  (function () {
    const zone = $('#sheet-top');
    let st = null;
    zone.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      st = { y: e.clientY, h: L.h, t: performance.now(), ly: e.clientY, lt: performance.now(), v: 0, moved: false };
      try { zone.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    zone.addEventListener('pointermove', (e) => {
      if (!st) return;
      const dy = e.clientY - st.y;
      if (!st.moved && Math.abs(dy) < 5) return;
      if (!st.moved) { st.moved = true; app.classList.add('dragging'); }
      const hs = sheetHeights();
      L.dragH = clamp(st.h - dy, hs.min - 40, hs.max);
      const now = performance.now();
      st.v = (st.ly - e.clientY) / Math.max(1, now - st.lt);
      st.ly = e.clientY;
      st.lt = now;
      layout();
    });
    const end = () => {
      if (!st) return;
      const hs = sheetHeights();
      if (!st.moved) {
        L.snap = L.snap === 'min' ? 'mid' : L.snap === 'mid' ? 'max' : 'mid';
      } else {
        const target = L.dragH + st.v * 220;
        let best = 'mid', bd = Infinity;
        for (const k of ['min', 'mid', 'max']) { const d = Math.abs(hs[k] - target); if (d < bd) { bd = d; best = k; } }
        L.snap = best;
      }
      L.dragH = null;
      st = null;
      app.classList.remove('dragging');
      layout();
      save();
      Bridge.haptic('tick');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  })();

  /* ------------------------------------------------------------------ */
  /* Liste des expressions                                               */
  /* ------------------------------------------------------------------ */

  const rows = new Map();
  const listEl = $('#expr-list');

  function revealRow(li) {
    if (!li || !li.isConnected) return;
    const lr = listEl.getBoundingClientRect(), r = li.getBoundingClientRect();
    if (r.top < lr.top) listEl.scrollBy({ top: r.top - lr.top - 8, behavior: 'smooth' });
    else if (r.bottom > lr.bottom) listEl.scrollBy({ top: Math.min(r.top - lr.top - 8, r.bottom - lr.bottom + 8), behavior: 'smooth' });
  }

  function prettyHTML(inf, text) {
    if (!text.trim()) return '<span class="ph">Saisir une expression…</span>';
    if (inf && inf.ast) {
      try { return '<span class="mrow">' + NM.toHTML(inf.ast) + '</span>'; } catch (e) { /* repli texte */ }
    }
    return '<span class="raw">' + esc(text) + '</span>';
  }

  function fmtValue(v) {
    if (Array.isArray(v)) return '(' + NM.fmt(v[0], 8) + ', ' + NM.fmt(v[1], 8) + ')';
    if (typeof v === 'string') return v;
    return NM.fmt(v, 10);
  }

  function createRow(item) {
    const li = document.createElement('li');
    li.className = 'expr';
    li.dataset.id = item.id;
    li.innerHTML =
      '<button class="swatch" type="button" aria-label="Afficher ou masquer"><span class="dot"></span></button>' +
      '<div class="expr-body"><div class="expr-field"><div class="math pretty"></div>' +
      '<input class="expr-input" data-kp="expr" inputmode="none" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Saisir une expression…"></div>' +
      '<div class="expr-meta"></div></div>' +
      '<button class="expr-del" type="button" aria-label="Supprimer">' + ICON_X + '</button>';
    const r = {
      li, item,
      input: $('.expr-input', li),
      pretty: $('.pretty', li),
      meta: $('.expr-meta', li),
      swatch: $('.swatch', li),
      sig: null,
      lastEdit: 0,
    };
    r.input.value = item.text;
    r.input.addEventListener('input', () => {
      item.text = r.input.value;
      r.lastEdit = Date.now();
      onItemsChanged();
    });
    r.input.addEventListener('focus', () => {
      const was = li.classList.contains('editing');
      li.classList.add('editing');
      selectItem(item.id, false);
      if (!was) requestAnimationFrame(() => { const n = r.input.value.length; try { r.input.setSelectionRange(n, n); } catch (e) { /* ignore */ } });
    });
    r.input.addEventListener('blur', () => {
      li.classList.remove('editing');
      updateRow(r);
    });
    r.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); kpAction('enter'); }
    });

    let lp = null, long = false;
    r.swatch.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      long = false;
      clearTimeout(lp);
      lp = setTimeout(() => { long = true; Bridge.haptic('long'); openColorPop(item, r.swatch); }, 430);
    });
    const cancel = () => clearTimeout(lp);
    r.swatch.addEventListener('pointerup', () => {
      cancel();
      if (long) return;
      item.hidden = !item.hidden;
      Bridge.haptic('tick');
      onItemsChanged();
    });
    r.swatch.addEventListener('pointerleave', cancel);
    r.swatch.addEventListener('pointercancel', cancel);
    $('.expr-del', li).addEventListener('pointerdown', (e) => e.preventDefault());
    $('.expr-del', li).addEventListener('click', () => removeItem(item));
    li.addEventListener('click', (e) => {
      if (e.target === li || e.target.classList.contains('expr-body')) r.input.focus();
    });
    rows.set(item.id, r);
    return r;
  }

  function buildMeta(r, inf, err) {
    const parts = [];
    if (err) {
      parts.push('<div class="m-err">' + ICON_WARN + '<span>' + esc(err) + '</span></div>');
      const miss = (inf.missing || []).filter((n) => /^[A-Za-zα-ωΑ-Ω](_\w+)?$/.test(n) && !Workspace.RESERVED.has(n));
      if (miss.length) {
        parts.push('<div class="m-chips">' + miss.map((n) => '<button class="chip" type="button" data-slider="' + esc(n) + '">＋ Curseur ' + esc(n) + '</button>').join('') + '</div>');
      }
    }
    if (!err && inf.slider) {
      parts.push(
        '<div class="m-slider">' +
        '<button class="play" type="button" aria-label="Animer">' + ICON_PLAY + '</button>' +
        '<input class="mini s-min" data-kp="slider" inputmode="none" autocomplete="off">' +
        '<input class="s-range" type="range">' +
        '<input class="mini s-max" data-kp="slider" inputmode="none" autocomplete="off">' +
        '</div>');
    }
    if (!err && inf.domainVar) {
      parts.push('<div class="m-domain"><input class="mini d-min" data-kp="domain" inputmode="none" autocomplete="off" placeholder="0">' +
        '<span>≤ <i>' + inf.domainVar + '</i> ≤</span><input class="mini d-max" data-kp="domain" inputmode="none" autocomplete="off" placeholder="' + (settings.angle === 'deg' ? '360' : '2π') + '"></div>');
    }
    if (!err && inf.plot) {
      const tag = { polar: 'Polaire', param: 'Paramétrée', implicit: 'Implicite', ineq: 'Inéquation', 'ineq-fx': 'Inéquation', fy: 'x = f(y)' }[inf.plot.type];
      if (tag) parts.push('<span class="m-tag">' + tag + '</span>');
    }
    if (!err && (inf.kind === 'value' || inf.kind === 'point' || (inf.kind === 'vardef' && !inf.slider))) parts.push('<div class="m-val"></div>');
    r.meta.innerHTML = parts.join('');
    wireMeta(r);
  }

  function wireMeta(r) {
    const item = r.item;
    $$('[data-slider]', r.meta).forEach((b) => {
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('click', () => addSliders([b.dataset.slider], item));
    });
    const range = $('.s-range', r.meta);
    if (range) {
      let lastInt = null;
      range.addEventListener('input', () => {
        const v = parseFloat(range.value);
        const i = Math.round(v);
        if (Math.abs(v - i) < 1e-9 && i !== lastInt) { lastInt = i; Bridge.haptic('tick'); }
        item.playing = false;
        ws.setSlider(item.id, v);
        afterSlider();
      });
      const play = $('.play', r.meta);
      play.addEventListener('click', () => {
        item.playing = !item.playing;
        item.phase = null;
        Bridge.haptic('tap');
        fillMeta(r, ws.info.get(item.id));
      });
      const bound = (cls, key) => {
        const inp = $(cls, r.meta);
        inp.addEventListener('input', () => {
          let v;
          try { v = NM.evaluate(inp.value, ws.V, ws.U, ws.env); } catch (e) { v = NaN; }
          if (!Number.isFinite(v)) return;
          item.slider = item.slider || {};
          item.slider[key] = v;
          onItemsChanged();
        });
      };
      bound('.s-min', 'min');
      bound('.s-max', 'max');
    }
    const dmin = $('.d-min', r.meta);
    if (dmin) {
      const dmax = $('.d-max', r.meta);
      item.domain = item.domain || { min: '', max: '' };
      dmin.value = item.domain.min || '';
      dmax.value = item.domain.max || '';
      dmin.addEventListener('input', () => { item.domain.min = dmin.value; onItemsChanged(); });
      dmax.addEventListener('input', () => { item.domain.max = dmax.value; onItemsChanged(); });
    }
  }

  function fillMeta(r, inf) {
    if (!inf) return;
    const val = $('.m-val', r.meta);
    if (val) {
      const v = inf.kind === 'vardef' ? ws.V[inf.name] : inf.value;
      const fr = typeof v === 'number' ? NM.toFraction(v) : null;
      val.innerHTML = '= <b>' + esc(fmtValue(v)) + '</b>' + (fr ? ' <span>· ' + esc(fr) + '</span>' : '');
    }
    const range = $('.s-range', r.meta);
    if (range && inf.slider) {
      const s = inf.slider;
      range.min = s.min;
      range.max = s.max;
      range.step = s.step;
      if (+range.value !== s.value) range.value = s.value;
      range.style.setProperty('--p', (100 * (s.value - s.min) / (s.max - s.min || 1)) + '%');
      const mn = $('.s-min', r.meta), mx = $('.s-max', r.meta);
      if (document.activeElement !== mn) mn.value = NM.fmt(s.min, 6).replace('−', '-');
      if (document.activeElement !== mx) mx.value = NM.fmt(s.max, 6).replace('−', '-');
      const play = $('.play', r.meta);
      play.classList.toggle('on', !!r.item.playing);
      play.innerHTML = r.item.playing ? ICON_PAUSE : ICON_PLAY;
    }
  }

  function updateRow(r) {
    const { item, li } = r;
    const inf = ws.info.get(item.id) || { kind: 'empty' };
    li.style.setProperty('--c', item.color);
    li.classList.toggle('hidden-curve', !!item.hidden);
    li.classList.toggle('active', state.active === item.id);
    li.classList.toggle('no-plot', !inf.plot);
    li.dataset.kind = inf.kind;
    const editing = document.activeElement === r.input;
    if (!editing && r.input.value !== item.text) r.input.value = item.text;
    if (!editing) r.pretty.innerHTML = prettyHTML(inf, item.text);
    const pending = editing && Date.now() - r.lastEdit < 700;
    const err = inf.error && !pending ? inf.error : null;
    const sig = [err, (inf.missing || []).join(','), !!inf.slider, inf.domainVar || '', inf.kind, inf.plot ? inf.plot.type : ''].join('|');
    if (sig !== r.sig) {
      r.sig = sig;
      buildMeta(r, inf, err);
      if (editing) requestAnimationFrame(() => revealRow(li));
    }
    fillMeta(r, inf);
  }

  const lateRefresh = debounce(() => rows.forEach(updateRow), 720);

  function renderList() {
    // Conserve le champ en cours d'édition malgré la réorganisation du DOM
    const ae = document.activeElement;
    const keep = ae && listEl.contains(ae) && ae.tagName === 'INPUT' ? { el: ae, s: ae.selectionStart, e: ae.selectionEnd } : null;
    const frag = document.createDocumentFragment();
    ws.items.forEach((item, i) => {
      const r = rows.get(item.id) || createRow(item);
      r.swatch.dataset.n = i + 1;
      frag.appendChild(r.li);
    });
    const ghost = document.createElement('li');
    ghost.className = 'expr ghost';
    ghost.innerHTML = '<span class="ghost-plus">+</span><span>Nouvelle expression</span>';
    ghost.addEventListener('pointerdown', (e) => e.preventDefault());
    ghost.addEventListener('click', () => addItem('', null, true));
    frag.appendChild(ghost);
    listEl.textContent = '';
    listEl.appendChild(frag);
    for (const id of Array.from(rows.keys())) if (!ws.items.some((i) => i.id === id)) rows.delete(id);
    if (keep && keep.el.isConnected) {
      keep.el.focus({ preventScroll: true });
      try { keep.el.setSelectionRange(keep.s, keep.e); } catch (e) { /* ignore */ }
    }
    rows.forEach(updateRow);
  }

  function onItemsChanged() {
    ws.build();
    graph.setPlots(ws.plots);
    rows.forEach(updateRow);
    lateRefresh();
    save();
    if (state.tab === 'table') renderTable();
  }

  function afterSlider() {
    graph.invalidate();
    graph._schedulePOI(120);
    rows.forEach((r) => {
      const inf = ws.info.get(r.item.id);
      if (inf && inf.slider && document.activeElement !== r.input) {
        r.input.value = r.item.text;
        r.pretty.innerHTML = prettyHTML(inf, r.item.text);
      }
      fillMeta(r, inf);
    });
    save();
    if (state.tab === 'table') renderTable();
  }

  function selectItem(id, fromGraph) {
    state.active = id;
    graph.setSelected(id);
    rows.forEach((r) => r.li.classList.toggle('active', r.item.id === id));
    if (fromGraph && id) {
      const r = rows.get(id);
      if (r) revealRow(r.li);
    }
  }

  function addItem(text, index, focus, opts) {
    const item = ws.add(text || '', opts);
    if (index === null || index === undefined) ws.items.push(item); else ws.items.splice(index, 0, item);
    renderList();
    onItemsChanged();
    if (focus) {
      const r = rows.get(item.id);
      r.input.focus();
      revealRow(r.li);
    }
    return item;
  }

  function addSliders(names, after) {
    let idx = ws.items.indexOf(after) + 1;
    for (const n of names) {
      if (ws.env.vars.has(n)) continue;
      ws.items.splice(idx++, 0, ws.add(n + ' = 1'));
    }
    Bridge.haptic('confirm');
    renderList();
    onItemsChanged();
  }

  function removeItem(item) {
    const idx = ws.items.indexOf(item);
    if (idx < 0) return;
    const r = rows.get(item.id);
    if (r) r.li.classList.add('removing');
    Bridge.haptic('tick');
    item.playing = false;
    setTimeout(() => {
      const i = ws.items.indexOf(item);
      if (i >= 0) ws.items.splice(i, 1);
      rows.delete(item.id);
      if (state.active === item.id) selectItem(null);
      renderList();
      onItemsChanged();
      toast('Expression supprimée', 'Annuler', () => {
        ws.items.splice(Math.min(idx, ws.items.length), 0, item);
        renderList();
        onItemsChanged();
      });
    }, 170);
  }

  function setItems(list) {
    for (const it of ws.items) it.playing = false;
    rows.clear();
    ws.load(list);
    selectItem(null);
    renderList();
    onItemsChanged();
  }

  // Animation des curseurs
  let lastT = 0;
  function animateSliders(t) {
    const dt = lastT ? Math.min(50, t - lastT) : 16;
    lastT = t;
    let any = false;
    for (const item of ws.items) {
      if (!item.playing) continue;
      const inf = ws.info.get(item.id);
      if (!inf || !inf.slider) { item.playing = false; continue; }
      const s = inf.slider;
      if (item.phase === null || item.phase === undefined) {
        item.phase = Math.acos(clamp(1 - (2 * (s.value - s.min)) / (s.max - s.min || 1), -1, 1));
      }
      item.phase += (dt / 5000) * 2 * Math.PI;
      const v = s.min + (s.max - s.min) * (0.5 - 0.5 * Math.cos(item.phase));
      ws.setSlider(item.id, Math.round(v / s.step) * s.step);
      any = true;
    }
    if (any) afterSlider();
  }

  /* ------------------------------------------------------------------ */
  /* Clavier flottant                                                    */
  /* ------------------------------------------------------------------ */

  const kp = new Keypad($('#kp-body'), {
    pages: Keypad.GRAPH_PAGES,
    haptic: (k) => Bridge.haptic(k),
    onAction: (a) => kpAction(a),
  });
  const HINTS = { slider: 'Borne du curseur', domain: 'Domaine du paramètre', table: 'Table de valeurs' };

  function kpAction(a) {
    if (a !== 'enter') return;
    const t = kp.target;
    if (!t || t.dataset.kp !== 'expr') { hideKeypad(); return; }
    const li = t.closest('.expr');
    const idx = ws.items.findIndex((i) => i.id === li.dataset.id);
    if (idx < 0) return;
    if (idx === ws.items.length - 1) {
      if (ws.items[idx].text.trim()) addItem('', idx + 1, true); else hideKeypad();
    } else {
      const r = rows.get(ws.items[idx + 1].id);
      if (r) r.input.focus();
    }
  }

  let hideTimer = null;
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!t.matches || !t.matches('input[data-kp]')) return;
    clearTimeout(hideTimer);
    kp.target = t;
    $('#kp-hint').textContent = HINTS[t.dataset.kp] || '';
    if (t.dataset.kp !== 'expr' && kp.page === 'abc') kp.setPage('main');
    if (!L.kb) {
      L.kb = true;
      app.classList.add('kb-open');
      layout();
      syncBack();
    }
    setTimeout(() => {
      revealRow(t.closest('.expr'));
    }, 380);
  });
  document.addEventListener('focusout', (e) => {
    if (!e.target.matches || !e.target.matches('input[data-kp]')) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const a = document.activeElement;
      if (!a || !a.matches || !a.matches('input[data-kp]')) closeKeypad();
    }, 90);
  });

  function closeKeypad() {
    if (!L.kb) return;
    L.kb = false;
    app.classList.remove('kb-open');
    layout();
    syncBack();
  }
  function hideKeypad() {
    const a = document.activeElement;
    if (a && a.blur) a.blur();
    closeKeypad();
  }
  $('#kp-hide').addEventListener('pointerdown', (e) => e.preventDefault());
  $('#kp-hide').addEventListener('click', () => { Bridge.haptic('tap'); hideKeypad(); });

  /* ------------------------------------------------------------------ */
  /* Calculatrice                                                        */
  /* ------------------------------------------------------------------ */

  const calc = {
    history: (saved && saved.calc && Array.isArray(saved.calc.history)) ? saved.calc.history : [],
    ans: saved && saved.calc && typeof saved.calc.ans === 'number' ? saved.calc.ans : 0,
    just: false,
  };
  const cIn = $('#calc-input'), cPrev = $('#calc-preview'), cHist = $('#calc-history');

  function calcEval(text) {
    const V = Object.create(ws.V);
    V.Ans = calc.ans;
    const vars = new Set(ws.env.vars);
    vars.add('Ans');
    return NM.evaluate(text, V, ws.U, { vars, funcs: ws.env.funcs });
  }

  function calcPreview() {
    const t = cIn.value.trim();
    cPrev.classList.remove('err');
    if (!t || calc.just || /^[\d.]+$/.test(t)) { cPrev.innerHTML = ''; return; }
    try {
      const v = calcEval(t);
      if (typeof v !== 'number') { cPrev.innerHTML = ''; return; }
      const fr = NM.toFraction(v);
      cPrev.innerHTML = '= ' + esc(NM.fmt(v)) + (fr ? '<span class="frac-hint">' + esc(fr) + '</span>' : '');
    } catch (e) { cPrev.innerHTML = ''; }
  }

  function prettyOf(text) {
    try { const ast = NM.parse(text); if (ast) return NM.toHTML(ast); } catch (e) { /* texte brut */ }
    return esc(text);
  }

  function renderHistory() {
    if (!calc.history.length) {
      cHist.innerHTML = '<div class="h-empty">Vos calculs apparaîtront ici</div>';
      return;
    }
    cHist.innerHTML = calc.history.map((h, i) => {
      const v = typeof h.v === 'number' ? h.v : NaN;
      const fr = NM.toFraction(v);
      return '<div class="h-item"><div class="h-expr math" data-i="' + i + '">' + prettyOf(h.e) + '</div>' +
        '<div class="h-res" data-i="' + i + '">= ' + esc(NM.fmt(v)) + (fr ? '<span class="frac-hint">' + esc(fr) + '</span>' : '') + '</div></div>';
    }).join('');
    cHist.scrollTop = cHist.scrollHeight;
  }

  function flash(cls) {
    cIn.classList.remove(cls);
    void cIn.offsetWidth;
    cIn.classList.add(cls);
  }

  function calcEquals() {
    const t = cIn.value.trim();
    if (!t) return;
    try {
      const v = calcEval(t);
      if (typeof v !== 'number') throw new NM.MathError('Résultat non numérique');
      calc.history.push({ e: t, v });
      if (calc.history.length > 120) calc.history.shift();
      calc.ans = v;
      calc.just = true;
      cIn.value = Number.isFinite(v) ? NM.fmt(v) : '';
      cIn.classList.add('big');
      flash('pop');
      const n = cIn.value.length;
      try { cIn.setSelectionRange(n, n); } catch (e) { /* ignore */ }
      renderHistory();
      calcPreview();
      Bridge.haptic('confirm');
      save();
    } catch (e) {
      cPrev.textContent = e.message;
      cPrev.classList.add('err');
      flash('shake');
      Bridge.haptic('reject');
    }
  }

  function calcBefore(text) {
    if (!calc.just) return;
    calc.just = false;
    cIn.classList.remove('big');
    cIn.value = /^[+\-−×÷*/^²³!%]/.test(text) ? 'Ans' : '';
    const n = cIn.value.length;
    try { cIn.setSelectionRange(n, n); } catch (e) { /* ignore */ }
  }

  function calcAction(a) {
    if (a === 'equals') { calcEquals(); return; }
    if (a === 'clear') {
      cIn.value = '';
      calc.just = false;
      cIn.classList.remove('big');
      calcPreview();
      return;
    }
    if (a === 'angle') {
      setAngle(settings.angle === 'rad' ? 'deg' : 'rad');
      return;
    }
    if (a === 'back') {
      if (calc.just) { calc.just = false; cIn.classList.remove('big'); }
    }
  }

  const v = (s) => '<i>' + s + '</i>';
  const sup = (b, e) => b + '<sup>' + e + '</sup>';
  const CALC_SCI = {
    sci: {
      cols: 5,
      rows: [
        [A('RAD', 'angle', 'k-mode', { dyn: () => (settings.angle === 'deg' ? 'DEG' : 'RAD') }),
          K('sin', 'sin(▮)', '', { inv: K(sup('sin', '−1'), 'asin(▮)') }),
          K('cos', 'cos(▮)', '', { inv: K(sup('cos', '−1'), 'acos(▮)') }),
          K('tan', 'tan(▮)', '', { inv: K(sup('tan', '−1'), 'atan(▮)') }),
          K('π')],
        [A('INV', 'inv', 'k-mode'),
          K('ln', 'ln(▮)', '', { inv: K(sup('e', v('x')), 'e^(▮)') }),
          K('log', 'log(▮)', '', { inv: K(sup('10', v('x')), '10^(▮)') }),
          K('√', '√(▮)', '', { inv: K('∛', '∛(▮)') }),
          K('e')],
        [K('(', '(▮)'), K(')'),
          K(sup(v('x'), '2'), '²', '', { inv: K(sup(v('x'), '3'), '³') }),
          K(sup(v('x'), v('y')), '^', '', { inv: K(sup('', v('n')) + '√', 'root(▮, )') }),
          K(v('n') + '!', '!', '', { inv: K('|' + v('x') + '|', '|▮|') })],
      ],
    },
  };
  const CALC_MAIN = {
    main: {
      cols: 4,
      rows: [
        [A('AC', 'clear', 'k-fn k-ac'), A(ICON.back, 'back', 'k-fn', { repeat: true }), K('%', '%', 'k-fn'), K('÷', '÷', 'k-op')],
        [K('7'), K('8'), K('9'), K('×', '×', 'k-op')],
        [K('4'), K('5'), K('6'), K('−', '−', 'k-op')],
        [K('1'), K('2'), K('3'), K('+', '+', 'k-op')],
        [K('0'), K('.'), K('Ans', 'Ans', 'k-fn'), A('=', 'equals', 'k-eq')],
      ],
    },
  };
  const calcSci = new Keypad($('#calc-sci'), { pages: CALC_SCI, haptic: (k) => Bridge.haptic(k), onAction: calcAction, beforeInsert: calcBefore });
  const calcMain = new Keypad($('#calc-main'), { pages: CALC_MAIN, haptic: (k) => Bridge.haptic(k), onAction: calcAction, beforeInsert: calcBefore });
  calcSci.target = cIn;
  calcMain.target = cIn;
  cIn.addEventListener('input', () => {
    if (calc.just && !cIn.classList.contains('big')) calc.just = false;
    calcPreview();
  });
  cIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); calcEquals(); return; }
    if (calc.just && e.key.length === 1) calcBefore(e.key);
  });
  cHist.addEventListener('click', (e) => {
    const ex = e.target.closest('.h-expr'), res = e.target.closest('.h-res');
    const el = ex || res;
    if (!el) return;
    const h = calc.history[+el.dataset.i];
    if (!h) return;
    Bridge.haptic('tap');
    if (ex) {
      cIn.value = h.e;
      calc.just = false;
      cIn.classList.remove('big');
    } else {
      calcBefore('0');
      Keypad.insert(cIn, Number.isFinite(h.v) ? NM.fmt(h.v) : '');
    }
    const n = cIn.value.length;
    try { cIn.setSelectionRange(n, n); } catch (err) { /* ignore */ }
    calcPreview();
  });
  $('#calc-clear-hist').addEventListener('click', () => {
    if (!calc.history.length) return;
    const old = calc.history.slice();
    calc.history = [];
    renderHistory();
    save();
    toast('Historique effacé', 'Annuler', () => { calc.history = old; renderHistory(); save(); });
  });

  /* ------------------------------------------------------------------ */
  /* Table de valeurs                                                    */
  /* ------------------------------------------------------------------ */

  const tStart = $('#tbl-start'), tStep = $('#tbl-step');
  if (saved && saved.table) {
    tStart.value = saved.table.start || '-5';
    tStep.value = saved.table.step || '1';
  }

  function constVal(txt, def) {
    try {
      const v = NM.evaluate(txt, ws.V, ws.U, ws.env);
      return Number.isFinite(v) ? v : def;
    } catch (e) { return def; }
  }

  function renderTable() {
    const cols = ws.items
      .map((it) => ({ it, inf: ws.info.get(it.id) }))
      .filter((c) => c.inf && c.inf.plot && c.inf.plot.type === 'fx' && !c.it.hidden && !c.inf.error);
    const view = $('#view-table');
    view.classList.toggle('is-empty', !cols.length);
    if (!cols.length) return;
    const start = constVal(tStart.value, -5);
    let step = constVal(tStep.value, 1);
    if (!step) step = 1;
    let html = '<thead><tr><th><i>x</i></th>' + cols.map((c) =>
      '<th><span class="dot" style="background:' + c.it.color + '"></span>' + esc(ws.labelFor(c.it)) + '</th>').join('') + '</tr></thead><tbody>';
    for (let i = 0; i < 100; i++) {
      const x = start + i * step;
      const xr = parseFloat(x.toPrecision(12));
      html += '<tr><td>' + esc(NM.fmt(xr, 10)) + '</td>';
      for (const c of cols) {
        let y;
        try { y = c.inf.plot.f(xr); } catch (e) { y = NaN; }
        html += '<td' + (Number.isFinite(y) ? '' : ' class="nan"') + '>' + esc(NM.fmt(y, 8)) + '</td>';
      }
      html += '</tr>';
    }
    $('#tbl').innerHTML = html + '</tbody>';
  }
  const onTableInput = () => { renderTable(); save(); };
  tStart.addEventListener('input', onTableInput);
  tStep.addEventListener('input', onTableInput);

  /* ------------------------------------------------------------------ */
  /* Onglets                                                             */
  /* ------------------------------------------------------------------ */

  const TABS = ['graph', 'calc', 'table'];
  function setTab(name) {
    if (state.tab === name) return;
    hideKeypad();
    state.tab = name;
    app.classList.remove('tab-graph', 'tab-calc', 'tab-table');
    app.classList.add('tab-' + name);
    $('.tabs').style.setProperty('--i', TABS.indexOf(name));
    $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    graph.active = name === 'graph';
    graph.invalidate();
    if (name === 'table') renderTable();
    if (name === 'calc') {
      renderHistory();
      calcPreview();
      setTimeout(() => cIn.focus({ preventScroll: true }), 60);
    }
    syncBack();
  }
  $$('.tab').forEach((b) => b.addEventListener('click', () => { Bridge.haptic('tick'); setTab(b.dataset.tab); }));

  /* ------------------------------------------------------------------ */
  /* Zoom                                                                */
  /* ------------------------------------------------------------------ */

  $$('[data-zoom]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      Bridge.haptic('tap');
      const z = b.dataset.zoom;
      if (z === 'in') graph.zoomBy(1.6);
      else if (z === 'out') graph.zoomBy(1 / 1.6);
      else graph.home(true);
    });
  });
  $('#graph').addEventListener('pointerdown', (e) => { if (L.kb) e.preventDefault(); });

  /* ------------------------------------------------------------------ */
  /* Modales, popover, toast                                             */
  /* ------------------------------------------------------------------ */

  function openModal(id) {
    hideKeypad();
    closePopover();
    const m = $('#' + id);
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    state.modal = m;
    syncBack();
  }
  function closeModal() {
    if (!state.modal) return;
    state.modal.classList.remove('open');
    state.modal.setAttribute('aria-hidden', 'true');
    state.modal = null;
    syncBack();
  }
  $$('.modal [data-close]').forEach((el) => el.addEventListener('click', closeModal));

  function openColorPop(item, anchor) {
    const pop = $('#color-pop');
    pop.innerHTML = Workspace.PALETTE.map((c) =>
      '<button class="cdot' + (c === item.color ? ' on' : '') + '" type="button" style="--c:' + c + '" data-c="' + c + '"></button>').join('') +
      '<button class="btn" type="button" data-hide>' + (item.hidden ? 'Afficher la courbe' : 'Masquer la courbe') + '</button>';
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 204, r.left)) + 'px';
    pop.style.top = Math.max(8, r.top - 150) + 'px';
    pop.classList.add('show');
    state.pop = true;
    syncBack();
    pop.onclick = (e) => {
      const b = e.target.closest('[data-c]');
      if (b) { item.color = b.dataset.c; Bridge.haptic('tick'); onItemsChanged(); }
      if (e.target.closest('[data-hide]')) { item.hidden = !item.hidden; onItemsChanged(); }
      closePopover();
    };
  }
  function closePopover() {
    if (!state.pop) return;
    $('#color-pop').classList.remove('show');
    state.pop = false;
    syncBack();
  }
  document.addEventListener('pointerdown', (e) => {
    if (state.pop && !e.target.closest('#color-pop')) closePopover();
  }, true);

  function toast(msg, label, action) {
    const el = $('#toast');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (label ? '<button type="button">' + esc(label) + '</button>' : '');
    el.classList.add('show');
    clearTimeout(el._t);
    if (action) {
      $('button', el).onclick = () => { action(); Bridge.haptic('tap'); el.classList.remove('show'); };
    }
    el._t = setTimeout(() => el.classList.remove('show'), 4200);
  }

  /* ------------------------------------------------------------------ */
  /* Réglages                                                            */
  /* ------------------------------------------------------------------ */

  function setAngle(mode) {
    settings.angle = mode;
    NM.setAngleMode(mode);
    $('#calc-mode').textContent = mode === 'deg' ? 'DEG' : 'RAD';
    calcSci.render();
    syncSettingsUI();
    rows.forEach((r) => { r.sig = null; });
    onItemsChanged();
    calcPreview();
  }

  function syncSettingsUI() {
    $$('.seg[data-set]').forEach((seg) => {
      $$('button', seg).forEach((b) => b.classList.toggle('on', settings[seg.dataset.set] === b.dataset.val));
    });
    $$('[data-toggle]').forEach((i) => { i.checked = !!settings[i.dataset.toggle]; });
  }

  $$('.seg[data-set]').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      Bridge.haptic('tick');
      const key = seg.dataset.set;
      if (key === 'angle') { setAngle(b.dataset.val); return; }
      settings[key] = b.dataset.val;
      if (key === 'theme') applyTheme();
      syncSettingsUI();
      save();
    });
  });
  $$('[data-toggle]').forEach((inp) => {
    inp.addEventListener('change', () => {
      settings[inp.dataset.toggle] = inp.checked;
      graph.showGrid = settings.grid;
      graph.showPOI = settings.poi;
      graph._schedulePOI(0);
      graph.invalidate();
      Bridge.haptic('tick');
      save();
    });
  });
  $$('[data-act]').forEach((b) => {
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      Bridge.haptic('tap');
      if (act === 'home') { closeModal(); setTab('graph'); graph.home(true); }
      if (act === 'export') { closeModal(); setTab('graph'); setTimeout(exportImage, 380); }
      if (act === 'clear') {
        const old = ws.toJSON();
        closeModal();
        setItems([]);
        toast('Expressions effacées', 'Annuler', () => setItems(old));
      }
    });
  });
  $('#btn-settings').addEventListener('click', () => { Bridge.haptic('tap'); syncSettingsUI(); openModal('modal-settings'); });

  function exportImage() {
    const legend = ws.items
      .filter((it) => { const inf = ws.info.get(it.id); return it.text.trim() && !it.hidden && inf && !inf.error; })
      .slice(0, 8)
      .map((it) => ({ text: it.text, color: it.color }));
    const url = graph.snapshot(legend);
    const res = Bridge.saveImage(url);
    if (res === 'ok') toast(native ? 'Image enregistrée dans la galerie' : 'Image téléchargée');
    else if (res === 'permission') toast('Autorisez l’accès au stockage puis réessayez');
    else toast('Impossible d’enregistrer l’image');
  }

  /* ------------------------------------------------------------------ */
  /* Exemples                                                            */
  /* ------------------------------------------------------------------ */

  function exampleItems(ex) {
    return ex.items.map((it) => (typeof it === 'string' ? { text: it } : it));
  }

  function openExamples() {
    const grid = $('#ex-grid');
    if (!grid.childElementCount) {
      grid.innerHTML = EXAMPLES.map((ex, i) =>
        '<button class="ex-card" type="button" data-ex="' + i + '"><canvas></canvas><div><b>' + esc(ex.title) + '</b><span>' + esc(ex.sub) + '</span></div></button>').join('');
      grid.addEventListener('click', (e) => {
        const card = e.target.closest('[data-ex]');
        if (!card) return;
        const ex = EXAMPLES[+card.dataset.ex];
        const old = ws.toJSON();
        Bridge.haptic('confirm');
        closeModal();
        setItems(exampleItems(ex));
        graph.animateTo(graph.homeView(ex.span || 14));
        toast('Exemple « ' + ex.title + ' » chargé', 'Annuler', () => setItems(old));
      });
    }
    openModal('modal-examples');
    requestAnimationFrame(() => setTimeout(() => {
      $$('.ex-card', grid).forEach((card) => {
        const ex = EXAMPLES[+card.dataset.ex];
        const w = new Workspace().load(exampleItems(ex)).build();
        const g = new GraphView($('canvas', card), { interactive: false, labels: false });
        g.setTheme(isDark() ? 'dark' : 'light');
        g.view = g.homeView(ex.span || 14);
        g.showPOI = false;
        g.plots = w.plots;
        g.render();
      });
    }, 60));
  }
  $('#btn-examples').addEventListener('click', () => { Bridge.haptic('tap'); openExamples(); });
  $('#btn-add').addEventListener('pointerdown', (e) => e.preventDefault());
  $('#btn-add').addEventListener('click', () => { Bridge.haptic('tap'); addItem('', null, true); });

  /* ------------------------------------------------------------------ */
  /* Bouton retour Android                                               */
  /* ------------------------------------------------------------------ */

  function syncBack() {
    Bridge.back(!!(state.modal || state.pop || L.kb || state.tab !== 'graph'));
  }

  window.novaBack = function () {
    if (state.modal) { closeModal(); return true; }
    if (state.pop) { closePopover(); return true; }
    if (L.kb) { hideKeypad(); return true; }
    if (state.tab !== 'graph') { setTab('graph'); return true; }
    return false;
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.novaBack();
  });

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */

  if (native && native.getInsets) {
    try {
      const ins = JSON.parse(native.getInsets());
      window.novaInsets(ins.top, ins.right, ins.bottom, ins.left);
    } catch (e) { /* ignore */ }
  }
  applyTheme();
  $('#calc-mode').textContent = settings.angle === 'deg' ? 'DEG' : 'RAD';
  renderList();
  graph.setPlots(ws.plots);
  layout();
  graph.resize();
  if (saved && saved.view && Number.isFinite(saved.view.scale) && saved.view.scale > 0) {
    graph.view = { cx: +saved.view.cx || 0, cy: +saved.view.cy || 0, scale: saved.view.scale };
  } else {
    graph.home(false);
  }
  graph.invalidate();
  renderHistory();
  syncSettingsUI();
  syncBack();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { graph.invalidate(); rows.forEach(updateRow); });

  window.NovaApp = { ws, graph, setTab, settings };
})();
